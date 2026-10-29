// SPDX-License-Identifier: AGPL-3.0-only
import { createPrivateKey, createPublicKey, randomUUID, sign } from 'node:crypto';
import { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { Database, Server, Session } from './database';
import { fail, fields, id, text, Limits } from './security';

export const QUERIES = ['server.snapshot','server.performance','worlds.list','world.snapshot','chunk.snapshot','block.snapshot','entity.snapshot','player.snapshot','player.inventory','player.statistics','player.advancements','statistics.catalog','host.filesystem','integrations.status','integration.luckperms','integration.vault','integration.placeholder','server.bans','server.operators','server.whitelist'] as const;
export const ACTIONS: Record<string, { risk: 'MEDIUM' | 'HIGH'; fields: string[] }> = {
  'player.kick': { risk: 'MEDIUM', fields: ['playerId','reason'] }, 'player.ban': { risk: 'MEDIUM', fields: ['playerId','reason'] },
  'player.unban': { risk: 'MEDIUM', fields: ['playerId'] }, 'player.whitelist.add': { risk: 'MEDIUM', fields: ['playerId'] },
  'player.whitelist.remove': { risk: 'MEDIUM', fields: ['playerId'] }, 'player.message': { risk: 'MEDIUM', fields: ['playerId','message'] },
  'server.broadcast': { risk: 'MEDIUM', fields: ['message'] }, 'player.gamemode': { risk: 'MEDIUM', fields: ['playerId','mode'] },
  'player.health': { risk: 'MEDIUM', fields: ['playerId','value'] }, 'player.food': { risk: 'MEDIUM', fields: ['playerId','value'] },
  'player.level': { risk: 'MEDIUM', fields: ['playerId','value'] }, 'player.teleport': { risk: 'HIGH', fields: ['playerId','worldId','x','y','z'] },
  'player.inventory.clear': { risk: 'HIGH', fields: ['playerId'] }, 'world.time': { risk: 'MEDIUM', fields: ['worldId','value'] },
  'world.weather': { risk: 'MEDIUM', fields: ['worldId','value'] }, 'world.difficulty': { risk: 'MEDIUM', fields: ['worldId','value'] },
  'world.gamerule': { risk: 'HIGH', fields: ['worldId','rule','value'] }, 'world.border': { risk: 'HIGH', fields: ['worldId','size'] },
  'world.save': { risk: 'HIGH', fields: ['worldId'] }, 'server.console': { risk: 'HIGH', fields: ['command'] },
};
export function argumentsFor(operation: string, value: any, kind: 'query' | 'action') {
  const allowed = kind === 'action' ? ACTIONS[operation]?.fields : ['worldId','playerId','entityId','x','y','z','offset','statistic','material','entityType','placeholder'];
  if (!allowed) fail(400);
  fields(value, allowed);
  for (const [name, entry] of Object.entries(value)) {
    if (name.endsWith('Id')) id(entry);
    else if (['x','y','z','offset','size'].includes(name)) { if (typeof entry !== 'number' || !Number.isFinite(entry) || Math.abs(entry) > 60_000_000) fail(400); }
    else if (name === 'value' && typeof entry === 'number') { if (!Number.isFinite(entry) || Math.abs(entry) > 1_000_000) fail(400); }
    else text(entry, name === 'command' || name === 'message' ? 512 : 256);
  }
  if (kind === 'action' && allowed.some(name => !(name in value))) fail(400);
  return value;
}
type Pending = { server: Server; socket: WebSocket; correlation: string; resolve: (value: any) => void; timer: NodeJS.Timeout; persist: boolean };
export class Control {
  private privateKey; readonly publicKey: string;
  private sockets = new Map<string, WebSocket>(); private pending = new Map<string, Pending>();
  private wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
  private limits = new Limits(); private ping: NodeJS.Timeout;
  private observations = new Map<string, {until:number;auditUntil:number;value?:any;pending?:Promise<any>}>();
  constructor(private db: Database, encodedKey: string, server: HttpServer) {
    this.privateKey = createPrivateKey({ key: Buffer.from(encodedKey, 'base64'), format: 'der', type: 'pkcs8' });
    if (this.privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Invalid control key');
    this.publicKey = createPublicKey(this.privateKey).export({ format: 'der', type: 'spki' }).toString('base64');
    server.on('upgrade', async (request, socket, head) => {
      try {
        if (request.url !== '/api/v1/agents/control') { socket.destroy(); return; }
        this.limits.check('upgrade:' + request.socket.remoteAddress, 60);
        const token = /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(request.headers.authorization ?? '')?.[1];
        const agent = await this.db.agent(token);
        this.wss.handleUpgrade(request, socket, head, ws => this.attach(agent, ws));
      } catch { socket.destroy(); }
    });
    this.ping = setInterval(() => { for (const ws of this.sockets.values()) { if ((ws as any).alive === false) ws.terminate(); else { (ws as any).alive = false; ws.ping(); } } }, 15_000);
    this.ping.unref();
  }
  private attach(server: Server, ws: WebSocket) {
    this.observations.clear();
    this.sockets.get(server.id)?.close(1012); this.sockets.set(server.id, ws); (ws as any).alive = true;
    ws.on('pong', () => { (ws as any).alive = true; });
    ws.on('error', () => {});
    ws.on('close', () => {
      if (this.sockets.get(server.id) === ws) this.sockets.delete(server.id);
      for (const [id, pending] of this.pending) if (pending.socket === ws) void this.finish(id, 'UNKNOWN', null);
    });
    ws.on('message', (data, binary) => {
      void (async () => {
        this.limits.check('agent-result:' + server.id, 1200);
        if (binary) throw new Error('binary');
        const value = JSON.parse(data.toString());
        if (value.type === 'agent.capabilities') {
          this.observations.clear();
          const p = value.payload;
          if (!p || p.schemaVersion !== 1 || !Array.isArray(p.queries) || !Array.isArray(p.collectors) || p.queries.length > 64 || p.collectors.length > 32) throw new Error('capabilities');
          const sanitized = { schemaVersion: 1, playerQueries: p.playerQueries === true, authmePasswordLogin: p.authmePasswordLogin === true,
            controls:{writesEnabled:p.controls?.writesEnabled===true,consoleEnabled:p.controls?.consoleEnabled===true,allowedOperations:Array.isArray(p.controls?.allowedOperations)?p.controls.allowedOperations.filter((op:any)=>Object.hasOwn(ACTIONS,op)):[]}, collectors: p.collectors.filter((v: any) => typeof v === 'string' && v.length < 64),
            queries: p.queries.filter((v: any) => QUERIES.includes(v)), privacy: Object.fromEntries(['players','positions','inventories','addresses','seeds'].map(key => [key, p.privacy?.[key] === true])),
            unsupported: Array.isArray(p.unsupported) ? p.unsupported.filter((v: any) => typeof v === 'string' && v.length < 128).slice(0, 64) : [] };
          await this.db.rows('UPDATE vos_servers SET capabilities=$1 WHERE tenant_id=$2 AND id=$3', [JSON.stringify(sanitized), server.tenant_id, server.id]); this.db.notify(server.id); return;
        }
        if (value.type !== 'control.result') return;
        const pending = this.pending.get(value.actionId);
        if (!pending || pending.socket !== ws || pending.server.id !== server.id || value.auditCorrelationId !== pending.correlation) return;
        if (!['SUCCEEDED','FAILED','REJECTED','EXPIRED'].includes(value.state)) throw new Error('state');
        await this.finish(value.actionId, value.state, value.payload ?? null);
      })().catch(() => { ws.close(1008); });
    });
  }
  connected(serverId: string) { return this.sockets.get(serverId)?.readyState === WebSocket.OPEN; }
  async observe(server: Server, session: Pick<Session, 'actor_id' | 'kind'> & {role?:string}, operation:string, args:any) {
    if (!QUERIES.includes(operation as any)) fail(400);
    if (!this.connected(server.id)) fail(503);
    const key=JSON.stringify([server.tenant_id,server.id,session.kind,session.actor_id,session.role,operation,args]);
    const cached=this.observations.get(key);
    if(cached?.pending)return structuredClone(await cached.pending);
    if(cached && cached.until>Date.now())return structuredClone(cached.value);
    if(this.observations.size>=512)this.observations.delete(this.observations.keys().next().value!);
    const entry:{until:number;auditUntil:number;value?:any;pending?:Promise<any>}={until:0,auditUntil:cached?.auditUntil??0};
    const pending=(async()=>{if(entry.auditUntil<Date.now()){await this.db.audit(server,session.actor_id,'live.'+operation,'STARTED');entry.auditUntil=Date.now()+60000;}return this.request(server,session,operation,args,'query',false,false);})();
    entry.pending=pending;this.observations.set(key,entry);
    try{const value=await pending;entry.value=value;entry.until=Date.now()+(value.state==='SUCCEEDED'?900:3000);entry.pending=undefined;return structuredClone(value);}
    catch(error){this.observations.delete(key);throw error;}
  }
  async request(server: Server, session: Pick<Session, 'actor_id' | 'kind'> & { role?: string }, operation: string, args: any, kind: 'query' | 'action' | 'link', confirmed = false, record = true) {
    const socket = this.sockets.get(server.id);
    if (!socket || socket.readyState !== WebSocket.OPEN) fail(503, 'Servidor sem canal de controle.');
    if(kind==='query'){this.limits.check('reads:'+server.id,600);this.limits.check('reads:'+server.id+':'+session.actor_id,90);}
    else this.limits.check('control:' + server.id, 24);
    // Reserve capacity for explicitly confirmed commands during continuous reads.
    if ([...this.pending.values()].filter(value => value.server.id === server.id).length >= (kind==='query'?4:6)) fail(429);
    const actionId = randomUUID(), correlation = randomUUID(), now = Date.now(), risk = kind === 'action' ? ACTIONS[operation].risk : 'LOW';
    const body = { schemaVersion: 1, actionId, actorId: session.actor_id, actorRole: session.kind === 'PLAYER' ? 'PLAYER' : session.role ?? 'ADMIN',
      serverId: server.id, tenantId: server.tenant_id, operation, kind, arguments: args,
      issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 25_000).toISOString(), riskLevel: risk, confirmed, nonce: randomUUID(), auditCorrelationId: correlation };
    const bytes = Buffer.from(JSON.stringify(body)); if (bytes.length > 32768) fail(413);
    const persist = kind !== 'link' && record;
    if (persist) {
      await this.db.rows(`INSERT INTO vos_actions(id,tenant_id,server_id,actor_id,operation,kind,risk,state,correlation_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,'PENDING',$8,$9)`, [actionId, server.tenant_id, server.id, session.actor_id, operation, kind, risk, correlation, body.expiresAt]);
      await this.db.audit(server, session.actor_id, operation, 'PENDING', correlation);
    }
    const result = new Promise<any>(resolve => {
      const timer = setTimeout(() => { void this.finish(actionId, 'UNKNOWN', null).catch(() => resolve({ id: actionId, state: 'UNKNOWN', payload: null })); }, 27_000); timer.unref();
      this.pending.set(actionId, { server, socket, correlation, resolve, timer, persist });
    });
    socket.send(JSON.stringify({ body: bytes.toString('base64url'), signature: sign(null, bytes, this.privateKey).toString('base64url') }), error => { if (error) void this.finish(actionId, 'UNKNOWN', null); });
    return result;
  }
  private async finish(actionId: string, state: string, payload: any) {
    const pending = this.pending.get(actionId); if (!pending) return;
    this.pending.delete(actionId); clearTimeout(pending.timer);
    try {
      if (pending.persist) {
        const action = await this.db.one('UPDATE vos_actions SET state=$1,encrypted_result=$2 WHERE id=$3 AND tenant_id=$4 AND server_id=$5 RETURNING actor_id,operation', [state, this.db.vault.seal(payload, this.db.context(pending.server)), actionId, pending.server.tenant_id, pending.server.id]);
        if (action) await this.db.audit(pending.server, action.actor_id, action.operation, state, pending.correlation);
      }
      if(pending.persist)this.db.notify(pending.server.id); pending.resolve({ id: actionId, state, payload });
    } catch { pending.resolve({ id: actionId, state: 'UNKNOWN', payload: null }); }
  }
  async revoke(serverId: string) { const ws = this.sockets.get(serverId); if (ws) ws.close(1008); }
  async close() {
    clearInterval(this.ping); for (const ws of this.sockets.values()) ws.terminate();
    for (const id of this.pending.keys()) await this.finish(id, 'UNKNOWN', null);
    this.wss.close();
  }
}
