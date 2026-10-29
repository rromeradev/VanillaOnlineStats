// SPDX-License-Identifier: AGPL-3.0-only
import { Pool, PoolClient } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Vault, canonical, fail, sha, UUID } from './security';
import { EventEmitter } from 'node:events';

export interface Server { id: string; tenant_id: string; name: string; agent_hash: string; last_seen: Date | null; player_login: boolean; capabilities: any }
export interface Session { token_hash: string; kind: 'ADMIN' | 'PLAYER'; actor_id: string; tenant_id: string | null; server_id: string | null; display_name: string; expires_at: Date; reauthenticated_at: Date | null }
export class Database {
  readonly changes = new EventEmitter().setMaxListeners(128);
  notify(serverId: string, change?: {messages:any[]}) { this.changes.emit(serverId,change); }
  readonly pool: Pool; readonly vault: Vault;
  constructor(url: string, key: string) { this.pool = new Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 5000, statement_timeout: 10_000 }); this.vault = new Vault(key); this.pool.on('error', () => {}); }
  async migrate() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(1747281191)');
      await client.query(readFileSync(resolve(__dirname, '../migrations/001-platform.sql'), 'utf8'));
      await client.query("UPDATE vos_actions SET state='UNKNOWN' WHERE state IN ('PENDING','RUNNING') AND expires_at < now()");
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async rows(sql: string, params: any[] = []): Promise<any[]> { return (await this.pool.query(sql, params)).rows; }
  async one(sql: string, params: any[] = []): Promise<any> { return (await this.rows(sql, params))[0]; }
  async server(id: string): Promise<Server> { const server = await this.one('SELECT * FROM vos_servers WHERE id=$1', [id]); if (!server) fail(404); return server; }
  async agent(token: string | undefined): Promise<Server> {
    if (!token || !/^[A-Za-z0-9_-]{43,128}$/.test(token)) fail(401);
    const server = await this.one('SELECT * FROM vos_servers WHERE agent_hash=$1', [sha(token)]); if (!server) fail(401); return server;
  }
  async admin(session: Session, serverId: string): Promise<Server & { role: 'OWNER' | 'ADMIN' }> {
    if (session.kind !== 'ADMIN') fail(403);
    const result = await this.one(`SELECT s.*, CASE WHEN t.role='OWNER' THEN 'OWNER' ELSE m.role END AS role FROM vos_servers s
      LEFT JOIN vos_tenant_members t ON t.tenant_id=s.tenant_id AND t.account_id=$2
      LEFT JOIN vos_server_members m ON m.tenant_id=s.tenant_id AND m.server_id=s.id AND m.account_id=$2
      WHERE s.id=$1 AND (t.role='OWNER' OR m.role='ADMIN')`, [serverId, session.actor_id]);
    if (!result) fail(404); return result;
  }
  context(server: Server) { return server.tenant_id + ':' + server.id; }
  async audit(server: Server, actor: string, operation: string, outcome: string, correlation: string | null = null) {
    await this.rows('INSERT INTO vos_audit(id,tenant_id,server_id,actor_id,operation,outcome,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), server.tenant_id, server.id, actor, operation, outcome, correlation]);
    if(!operation.endsWith('.read')&&!operation.startsWith('watch.')&&!operation.startsWith('live.'))this.notify(server.id);
  }
  async ingest(server: Server, messages: any[]): Promise<{ ids: string[]; receipts: Map<string, Date> }> {
    const client = await this.pool.connect(); const ids: string[] = []; const receipts = new Map<string, Date>();
    try {
      await client.query('BEGIN');
      // Serialize a server's ingestion so conflicting duplicates cannot win a race.
      await client.query('SELECT id FROM vos_servers WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [server.id, server.tenant_id]);
      for (const entry of messages) {
        const hash = sha(canonical(entry)); const previous = (await client.query('SELECT fingerprint,received_at FROM vos_messages WHERE tenant_id=$1 AND server_id=$2 AND message_id=$3', [server.tenant_id, server.id, entry.messageId])).rows[0];
        if (previous) { if (previous.fingerprint !== hash) fail(409); ids.push(entry.messageId); receipts.set(entry.messageId, previous.received_at); continue; }
        const player = typeof entry.payload.uuid === 'string' && UUID.test(entry.payload.uuid) ? entry.payload.uuid : null;
        const result = await client.query(`INSERT INTO vos_messages(tenant_id,server_id,message_id,type,source,occurred_at,fingerprint,player_id,encrypted_payload)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING received_at`, [server.tenant_id, server.id, entry.messageId, entry.type, entry.source, entry.occurredAt, hash, player, this.vault.seal(entry.payload, this.context(server))]);
        const received = result.rows[0].received_at; ids.push(entry.messageId); receipts.set(entry.messageId, received);
        await this.project(client, server, entry);
        await client.query('UPDATE vos_servers SET last_seen=GREATEST(COALESCE(last_seen,$2),$2) WHERE id=$1', [server.id, received]);
        if (entry.type.startsWith('auth.') && (entry.type.includes('ended') || entry.type.includes('Unregister')) && entry.payload.reason !== 'disconnect') {
          if (player) await client.query("DELETE FROM vos_sessions WHERE kind='PLAYER' AND tenant_id=$1 AND server_id=$2 AND actor_id=$3", [server.tenant_id, server.id, player]);
          else await client.query("DELETE FROM vos_sessions WHERE kind='PLAYER' AND tenant_id=$1 AND server_id=$2", [server.tenant_id, server.id]);
        }
      }
      await client.query('COMMIT'); this.notify(server.id,{messages}); return { ids, receipts };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  private async project(client: PoolClient, server: Server, entry: any) {
    const update = async (kind: string, entity: string, payload: any) => {
      await client.query(`INSERT INTO vos_latest(tenant_id,server_id,kind,entity_id,occurred_at,encrypted_payload) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(tenant_id,server_id,kind,entity_id) DO UPDATE SET occurred_at=EXCLUDED.occurred_at,encrypted_payload=EXCLUDED.encrypted_payload WHERE vos_latest.occurred_at<=EXCLUDED.occurred_at`,
        [server.tenant_id, server.id, kind, entity, entry.occurredAt, this.vault.seal(payload, this.context(server))]);
    };
    if(entry.type==='player.saved.snapshot'){
      const p=entry.payload;
      if(!UUID.test(p.uuid??'')||!['player.inventory','player.statistics','player.advancements'].includes(p.operation)||!p.data||typeof p.data!=='object')fail(400);
      const offset=p.arguments?.offset??0;if(!Number.isSafeInteger(offset)||offset<0||offset>10000)fail(400);
      if(p.data.uuid&&p.data.uuid!==p.uuid)fail(400);
      await update('player-query',p.uuid+':'+p.operation+':'+offset,p.data);
      return;
    }
    const playerId=entry.payload.uuid;
    if(UUID.test(playerId??'')&&!entry.type.endsWith('.snapshot')&&!['server.heartbeat','events.counters','chunks.sample','host.filesystem','integrations.status'].includes(entry.type)){
      const row=(await client.query("SELECT occurred_at,encrypted_payload FROM vos_latest WHERE tenant_id=$1 AND server_id=$2 AND kind='player-events' AND entity_id=$3",[server.tenant_id,server.id,playerId])).rows[0];
      if(!row||Date.parse(entry.occurredAt)>=new Date(row.occurred_at).getTime()){
        const items=entry.type==='auth.session.started'?[]:(row?this.vault.open(row.encrypted_payload,this.context(server)).items:[]);
        items.push({id:entry.messageId,type:entry.type,occurredAt:entry.occurredAt,payload:entry.payload});
        await update('player-events',playerId,{items:items.slice(-200)});
      }
    }
    if (entry.type.endsWith('.snapshot') || ['server.heartbeat','events.counters','chunks.sample','integrations.status','host.filesystem'].includes(entry.type)) await update('snapshot', entry.type, entry.payload);
    if (entry.type === 'players.snapshot' || entry.type === 'players.live.snapshot' || entry.type === 'worlds.snapshot') {
      for (const item of entry.payload.items ?? []) {
        const key = item.uuid ?? item.worldId;
        if (typeof key === 'string' && UUID.test(key)) await update(entry.type.startsWith('players.') ? 'player' : 'world', key, item);
      }
    }
    if (entry.type === 'server.performance.snapshot') {
      const p = entry.payload;
      for (const [rule, value, active] of [
        ['low-tps', Number(p.tps?.[0]), Number(p.tps?.[0]) < 18],
        ['high-mspt', Number(p.msptAverage), Number(p.msptAverage) > 50],
        ['high-heap', p.heapMax > 0 ? 100 * p.heapUsed / p.heapMax : NaN, p.heapMax > 0 && p.heapUsed / p.heapMax > .9],
      ] as [string, number, boolean][]) {
        if (!Number.isFinite(value)) continue;
        await client.query(`INSERT INTO vos_alerts(tenant_id,server_id,rule,active,value,first_seen,last_seen) VALUES($1,$2,$3,$4,$5,$6,$6)
          ON CONFLICT(tenant_id,server_id,rule) DO UPDATE SET active=EXCLUDED.active,value=EXCLUDED.value,last_seen=EXCLUDED.last_seen,
          first_seen=CASE WHEN NOT vos_alerts.active AND EXCLUDED.active THEN EXCLUDED.first_seen ELSE vos_alerts.first_seen END,
          acknowledged_by=CASE WHEN NOT vos_alerts.active AND EXCLUDED.active THEN NULL ELSE vos_alerts.acknowledged_by END
          WHERE vos_alerts.last_seen<=EXCLUDED.last_seen`, [server.tenant_id, server.id, rule, active, value, entry.occurredAt]);
      }
    }
  }
  async latest(server: Server, kind = 'snapshot', entity?: string) {
    const rows = await this.rows('SELECT kind,entity_id,occurred_at,encrypted_payload FROM vos_latest WHERE tenant_id=$1 AND server_id=$2 AND kind=$3 AND ($4::text IS NULL OR entity_id=$4) ORDER BY occurred_at DESC LIMIT 500', [server.tenant_id, server.id, kind, entity ?? null]);
    return rows.map(row => ({ id: row.entity_id, occurredAt: row.occurred_at, payload: this.vault.open(row.encrypted_payload, this.context(server)) }));
  }
  async history(server: Server, type: string | null, since: Date, limit: number, player: string | null = null, eventsOnly=false) {
    const rows = await this.rows(`SELECT message_id,type,occurred_at,received_at,encrypted_payload FROM vos_messages WHERE tenant_id=$1 AND server_id=$2
      AND occurred_at >= $3 AND ($4::text IS NULL OR type=$4) AND ($5::uuid IS NULL OR player_id=$5)
      AND (NOT $7 OR (type NOT LIKE '%.snapshot' AND type NOT IN ('server.heartbeat','events.counters','chunks.sample','host.filesystem','integrations.status')))
      ORDER BY occurred_at DESC LIMIT $6`, [server.tenant_id, server.id, since, type, player, limit, eventsOnly]);
    return rows.reverse().map(row => ({ id: row.message_id, type: row.type, occurredAt: row.occurred_at, receivedAt: row.received_at, payload: this.vault.open(row.encrypted_payload, this.context(server)) }));
  }
  async cleanup() {
    await this.rows('DELETE FROM vos_sessions WHERE expires_at<now()');
    await this.rows("UPDATE vos_actions SET state='UNKNOWN' WHERE state IN ('PENDING','RUNNING') AND expires_at<now()");
    await this.rows("DELETE FROM vos_messages WHERE received_at<now()-interval '30 days'");
    await this.rows("DELETE FROM vos_latest WHERE kind NOT IN ('player','player-query','player-events','skin') AND occurred_at<now()-interval '7 days'");
    await this.rows("UPDATE vos_actions SET encrypted_result=NULL WHERE created_at<now()-interval '7 days'");
  }
  async savedPlayer(server:Server,playerId:string,operation:string,args:any={}){
    const rows=await this.latest(server,operation==='player.snapshot'?'player':'player-query',operation==='player.snapshot'?playerId:playerId+':'+operation+':'+(args.offset??0));
    if(!rows[0]||args.statistic)return null;
    const payload=structuredClone(rows[0].payload);delete payload.address;delete payload.permissions;
    return {state:'SUCCEEDED',payload,observedAt:rows[0].occurredAt,saved:true};
  }
  async close() { await this.pool.end(); }
}
