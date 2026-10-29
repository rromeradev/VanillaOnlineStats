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
type Watch = {id:string;server:Server;actor:Pick<Session,'actor_id'|'kind'> & {role?:string};operation:string;args:any;listeners:Set<(value:any)=>void>;sequence:number;renewAt:number;epoch?:string;last?:any};
export class Control {
  private privateKey; readonly publicKey: string;
  private sockets = new Map<string, WebSocket>(); private pending = new Map<string, Pending>();
  private wss = new WebSocketServer({ noServer: true, maxPayload: 262144, perMessageDeflate: false });
  private watches=new Map<string,Watch>();private watchQueue=new Map<string,{watch:Watch;stop:boolean}>();private streaming=new Set<string>();private leases:NodeJS.Timeout;private dispatch:NodeJS.Timeout;
  private limits = new Limits(); private ping: NodeJS.Timeout;
  constructor(private db: Database, encodedKey: string, server: HttpServer, private ingest?: (server:Server,messages:any[])=>Promise<string[]>) {
    this.privateKey = createPrivateKey({ key: Buffer.from(encodedKey, 'base64'), format: 'der', type: 'pkcs8' });
    if (this.privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Invalid control key');
    this.publicKey = createPublicKey(this.privateKey).export({ format: 'der', type: 'spki' }).toString('base64');
    server.on('upgrade', async (request, socket, head) => {
      socket.on('error',()=>{});
      try {
        if(request.url==='/api/v1/panel')return;
        if (request.url !== '/api/v1/agents/control') { socket.destroy(); return; }
        this.limits.check('upgrade:' + request.socket.remoteAddress, 60);
        const token = /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(request.headers.authorization ?? '')?.[1];
        const agent = await this.db.agent(token);
        this.wss.handleUpgrade(request, socket, head, ws => this.attach(agent, ws));
      } catch { socket.destroy(); }
    });
    this.ping = setInterval(() => { for (const ws of this.sockets.values()) { if ((ws as any).alive === false) ws.terminate(); else { (ws as any).alive = false; ws.ping(); } } }, 15_000);
    this.ping.unref();
    this.leases=setInterval(()=>{for(const watch of this.watches.values())if(Date.now()>=watch.renewAt)this.sendWatch(watch);},1000);this.leases.unref();
    this.dispatch=setInterval(()=>{for(const [id,item]of [...this.watchQueue].slice(0,2)){this.watchQueue.delete(id);this.writeWatch(item.watch,item.stop);}},50);this.dispatch.unref();
  }
  private attach(server: Server, ws: WebSocket) {
    this.streaming.delete(server.id);
    this.sockets.get(server.id)?.close(1012); this.sockets.set(server.id, ws); (ws as any).alive = true;
    ws.on('pong', () => { (ws as any).alive = true; });
    ws.on('error', () => {});
    ws.on('close', () => {
      if (this.sockets.get(server.id) === ws) {this.sockets.delete(server.id);this.streaming.delete(server.id);this.db.notify(server.id);for(const watch of this.watches.values())if(watch.server.id===server.id){watch.last=undefined;for(const listener of watch.listeners)listener({state:'UNKNOWN',payload:{reasonCode:'AGENT_DISCONNECTED'}});}}
      for (const [id, pending] of this.pending) if (pending.socket === ws) void this.finish(id, 'UNKNOWN', null);
    });
    ws.on('message', (data, binary) => {
      void (async () => {
        if(this.sockets.get(server.id)!==ws)return;
        if (binary) throw new Error('binary');
        const value = JSON.parse(data.toString());
        if(value.type==='agent.telemetry'){
          this.limits.check('stream-batches:'+server.id,600);
          fields(value,['type','messages']);
          if(!this.streaming.has(server.id)||!this.ingest||!Array.isArray(value.messages)||value.messages.length<1||value.messages.length>32)throw new Error('telemetry');
          const ids=await this.ingest(server,value.messages);ws.send(JSON.stringify({type:'agent.telemetry.ack',ids}));return;
        }
        if(value.type==='watch.update'||value.type==='watch.error'){
          this.limits.check('stream-updates:'+server.id,6000);
          fields(value,value.type==='watch.update'?['type','watchId','sequence','state','payload','observedAt','epoch']:['type','watchId','payload']);
          if(!this.streaming.has(server.id))return;
          const watch=[...this.watches.values()].find(w=>w.id===value.watchId&&w.server.id===server.id);
          if(!watch)return;
          if(value.type==='watch.update'&&value.epoch!==undefined){const epoch=id(value.epoch);if(watch.epoch!==epoch){watch.epoch=epoch;watch.sequence=0;}}
          if(value.type==='watch.update'&&(!Number.isSafeInteger(value.sequence)||value.sequence<=watch.sequence))return;
          const state=value.type==='watch.error'?'FAILED':value.state;
          if(!['SUCCEEDED','FAILED'].includes(state)||Buffer.byteLength(JSON.stringify(value.payload))>65536)throw new Error('watch');
          if(value.type==='watch.update')watch.sequence=value.sequence;watch.last={state,payload:value.payload,receivedAt:new Date().toISOString(),...(typeof value.observedAt==='string'&&Math.abs(Date.now()-Date.parse(value.observedAt))<=300000?{observedAt:value.observedAt}:{})};for(const listener of watch.listeners)listener(structuredClone(watch.last));return;
        }
        this.limits.check('agent-result:' + server.id, 1200);
        if (value.type === 'agent.capabilities') {
          const p = value.payload;
          if (!p || p.schemaVersion !== 1 || !Array.isArray(p.queries) || !Array.isArray(p.collectors) || p.queries.length > 64 || p.collectors.length > 32) throw new Error('capabilities');
          const sanitized = { schemaVersion: 1, playerQueries: p.playerQueries === true, authmePasswordLogin: p.authmePasswordLogin === true,
            streaming:p.streaming===true, controls:{writesEnabled:p.controls?.writesEnabled===true,consoleEnabled:p.controls?.consoleEnabled===true,allowedOperations:Array.isArray(p.controls?.allowedOperations)?p.controls.allowedOperations.filter((op:any)=>Object.hasOwn(ACTIONS,op)):[]}, collectors: p.collectors.filter((v: any) => typeof v === 'string' && v.length < 64),
            queries: p.queries.filter((v: any) => QUERIES.includes(v)), privacy: Object.fromEntries(['players','positions','inventories','addresses','seeds'].map(key => [key, p.privacy?.[key] === true])),
            unsupported: Array.isArray(p.unsupported) ? p.unsupported.filter((v: any) => typeof v === 'string' && v.length < 128).slice(0, 64) : [] };
          await this.db.rows('UPDATE vos_servers SET capabilities=$1 WHERE tenant_id=$2 AND id=$3', [JSON.stringify(sanitized), server.tenant_id, server.id]);
          if(sanitized.streaming){this.streaming.add(server.id);ws.send(JSON.stringify({type:'agent.ready',telemetry:!!this.ingest,watches:true}));for(const watch of this.watches.values())if(watch.server.id===server.id){watch.sequence=0;watch.last=undefined;this.sendWatch(watch);}}
          this.db.notify(server.id); return;
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
  watch(server:Server,actor:Watch['actor'],operation:string,args:any,listener:(value:any)=>void):()=>void {
    if(!QUERIES.includes(operation as any))fail(400);
    const key=JSON.stringify([server.id,actor.kind,actor.actor_id,actor.role,operation,args]);let watch=this.watches.get(key);
    if(!watch){if([...this.watches.values()].filter(w=>w.server.id===server.id).length>=64)fail(429);watch={id:randomUUID(),server,actor,operation,args,listeners:new Set(),sequence:0,renewAt:0};this.watches.set(key,watch);}
    watch.listeners.add(listener);if(watch.last)listener(structuredClone(watch.last));this.sendWatch(watch);
    if(!this.streaming.has(server.id))listener({state:'FAILED',payload:{reasonCode:'STREAMING_AGENT_REQUIRED'}});
    return ()=>{watch!.listeners.delete(listener);if(watch!.listeners.size===0){this.watches.delete(key);this.sendWatch(watch!,true);}};
  }
  private sendWatch(watch:Watch,stop=false){
    if(this.streaming.has(watch.server.id))this.watchQueue.set(watch.id,{watch,stop});
  }
  private writeWatch(watch:Watch,stop:boolean){
    const socket=this.sockets.get(watch.server.id);if(!this.streaming.has(watch.server.id)||socket?.readyState!==WebSocket.OPEN)return;
    const now=Date.now(),actionId=randomUUID(),body={schemaVersion:1,actionId,actorId:watch.actor.actor_id,actorRole:watch.actor.kind==='PLAYER'?'PLAYER':watch.actor.role??'ADMIN',serverId:watch.server.id,tenantId:watch.server.tenant_id,operation:watch.operation,kind:'watch',arguments:{watchId:watch.id,query:watch.args,stop},issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+25000).toISOString(),riskLevel:'LOW',confirmed:false,nonce:randomUUID(),auditCorrelationId:actionId};
    const bytes=Buffer.from(JSON.stringify(body));watch.renewAt=Date.now()+30000;socket.send(JSON.stringify({body:bytes.toString('base64url'),signature:sign(null,bytes,this.privateKey).toString('base64url')}));
  }
  async request(server: Server, session: Pick<Session, 'actor_id' | 'kind'> & { role?: string }, operation: string, args: any, kind: 'query' | 'action' | 'link', confirmed = false) {
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
    const persist = kind !== 'link';
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
  async revoke(serverId: string) { const ws = this.sockets.get(serverId);this.sockets.delete(serverId);this.streaming.delete(serverId); if (ws) ws.close(1008);for(const watch of this.watches.values())if(watch.server.id===serverId){watch.last=undefined;for(const listener of watch.listeners)listener({state:'UNKNOWN',payload:{reasonCode:'AGENT_DISCONNECTED'}});}this.db.notify(serverId); }
  async close() {
    clearInterval(this.ping);clearInterval(this.leases);clearInterval(this.dispatch);this.watchQueue.clear();this.watches.clear(); for (const ws of this.sockets.values()) ws.terminate();
    for (const id of this.pending.keys()) await this.finish(id, 'UNKNOWN', null);
    this.wss.close();
  }
}
