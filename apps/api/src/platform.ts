// SPDX-License-Identifier: AGPL-3.0-only
import 'reflect-metadata';
import { ArgumentsHost, Body, Catch, Controller, Delete, ExceptionFilter, Get, Headers, HttpCode, HttpException, Module, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Request, Response, json, static as serveStatic } from 'express';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { Database, Server, Session } from './database';
import { PlatformConfig } from './platform-config';
import { seedDemo } from './demo';
import { Visuals } from './visuals';
import {SkinCatalog,skinUpload} from './skins';
import {PanelStream,PanelView} from './panel-stream';
import { ACTIONS, QUERIES, Control, argumentsFor } from './control';
import { UUID, Limits, canonical, csrf, fail, fields, id, opaque, passwordHash, passwordMatches, same, sha, text } from './security';

export async function createPlatform(config: PlatformConfig) {
  const db = new Database(config.databaseUrl, config.dataKey); await db.migrate();
  await db.rows('INSERT INTO vos_tenants(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING', [config.tenantId, 'Instalação local']);
  const bootstrap = await db.pool.connect();
  try {
    await bootstrap.query('BEGIN');
    await bootstrap.query('SELECT pg_advisory_xact_lock(1747281192)');
  if (!(await bootstrap.query('SELECT id FROM vos_accounts LIMIT 1')).rows.length) {
    const email = text(config.ownerEmail, 200).trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400);
    const account = randomUUID();
    await bootstrap.query('INSERT INTO vos_accounts(id,email,password_hash) VALUES($1,$2,$3)', [account, email, await passwordHash(text(config.ownerPassword, 128, 12))]);
    await bootstrap.query("INSERT INTO vos_tenant_members(tenant_id,account_id,role) VALUES($1,$2,'OWNER')", [config.tenantId, account]);
  }
    await bootstrap.query('COMMIT');
  } catch (error) { await bootstrap.query('ROLLBACK'); throw error; }
  finally { bootstrap.release(); }
  if (config.initialServerId && config.initialAgentHash) {
    await db.rows(`INSERT INTO vos_servers(id,tenant_id,name,agent_hash) VALUES($1,$2,'Servidor Paper',$3) ON CONFLICT(id) DO NOTHING`, [config.initialServerId, config.tenantId, config.initialAgentHash]);
  }
  if (config.demo) await seedDemo(db, config.tenantId);
  const visuals=new Visuals(); const skinCatalog=new SkinCatalog(); const limits = new Limits(), ajv = new Ajv2020({ strict: true }); addFormats(ajv);
  const schema = (name: string) => JSON.parse(readFileSync(resolve(__dirname, '../../../packages/api-contracts/' + name + '.schema.json'), 'utf8'));
  const heartbeatValidator = ajv.compile(schema('heartbeat')), envelopeValidator = ajv.compile(schema('telemetry-envelope'));
  const cookieSecure = config.origin.startsWith('https:'); let control: Control;
  const cookie = (req: Request) => /(?:^|;\s*)vos_session=([A-Za-z0-9_-]{43})\b/.exec(req.headers.cookie ?? '')?.[1];
  const rateSessions=new Map<string,number>();
  async function session(req: Request): Promise<Session> {
    const token = cookie(req); if (!token) fail(401);
    const row = await db.one('SELECT * FROM vos_sessions WHERE token_hash=$1 AND expires_at>now()', [sha(token)]); if (!row) fail(401);
    if(rateSessions.size>=8192)rateSessions.delete(rateSessions.keys().next().value!);rateSessions.set(row.token_hash,new Date(row.expires_at).getTime());return row;
  }
  async function mutation(req: Request): Promise<Session> {
    const value = await session(req); if (req.headers.origin !== config.origin || !same(req.headers['x-csrf-token']?.toString() ?? '', csrf(cookie(req)!, config.sessionSecret))) fail(403);
    return value;
  }
  function origin(req: Request) { if (req.headers.origin !== config.origin) fail(403); }
  function safeServer(server: Server & { role?: string }) { return { id: server.id, tenantId: server.tenant_id, name: server.name, role: server.role,
    playerLogin: server.player_login, lastSeen: server.last_seen, online: !!server.last_seen && Date.now() - new Date(server.last_seen).getTime() < 45_000,
    controlConnected: control.connected(server.id), capabilities: server.capabilities }; }
  async function createSession(res: Response, kind: 'ADMIN' | 'PLAYER', actor: string, display: string, server?: Server) {
    const token = opaque(), expires = new Date(Date.now() + (kind === 'ADMIN' ? 8 * 3600_000 : 15 * 60_000));
    await db.rows('INSERT INTO vos_sessions(token_hash,kind,actor_id,tenant_id,server_id,display_name,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [sha(token), kind, actor, server?.tenant_id ?? null, server?.id ?? null, display, expires]);
    res.cookie('vos_session', token, { httpOnly: true, secure: cookieSecure, sameSite: 'strict', path: '/', expires });
    return { kind, displayName: display, serverId: server?.id, csrf: csrf(token, config.sessionSecret), expiresAt: expires };
  }
  function since(value: any) { const hours = Number(value ?? 24); if (![1,6,24,168].includes(hours)) fail(400); return new Date(Date.now() - hours * 3600_000); }
  function secrets(value: any, depth = 0): boolean {
    if (depth > 16) return true;
    if (Array.isArray(value)) return value.length > 1024 || value.some(v => secrets(v, depth + 1));
    if (value && typeof value === 'object') return Object.keys(value).length > 1024 || Object.entries(value).some(([k,v]) => /password|passwd|credential|private.?key|authorization|access.?token|^token$|^hash$|^secret$/i.test(k) || secrets(v, depth + 1));
    return typeof value === 'string' && value.length > 4096;
  }
  function validateMessage(entry: any, server: Server, heartbeat = false) {
    if (!(heartbeat ? heartbeatValidator(entry) : envelopeValidator(entry))) fail(400);
    if (entry.serverId !== server.id) fail(403);
    if (Buffer.byteLength(JSON.stringify(entry)) > 65536 || secrets(entry.payload)) fail(400);
    const sent = Date.parse(entry.sentAt), at = Date.parse(entry.occurredAt), now = Date.now();
    if (!Number.isFinite(sent) || !Number.isFinite(at) || at > sent + 5000 || Math.abs(now - sent) > 300_000 || Math.abs(now - at) > 300_000) fail(400);
    if (['players.snapshot','players.live.snapshot','worlds.snapshot'].includes(entry.type) && (!Array.isArray(entry.payload.items) || entry.payload.items.length > 256)) fail(400);
  }
  const bearer = (authorization: string | undefined) => /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(authorization ?? '')?.[1];
  async function scopedPlayer(req: Request, serverId: string) { const actor = await session(req); if (actor.kind !== 'PLAYER' || actor.server_id !== serverId) fail(403); return { actor, server: await db.server(serverId) }; }
  const sanitizePlayer = (value: any) => { if (!value || typeof value !== 'object') return value; const result = structuredClone(value); delete result.address; delete result.permissions; return result; };
  const eventFields=['durationSeconds','reason','Cause','Reason','Amount','Damage','FinalDamage','ExpToDrop','NewLevel','OldLevel','PreviousValue','NewValue','Statistic','advancement','root'];
  const technical=(type:string)=>type.endsWith('.snapshot')||['server.heartbeat','events.counters','chunks.sample','host.filesystem','integrations.status'].includes(type);
  const safeEvent=(entry:any)=>({...entry,payload:Object.fromEntries(Object.entries(entry.payload).filter(([key])=>eventFields.includes(key)))});
  async function selfData(actor:Session,server:Server){
    const [profiles,skins,events]=await Promise.all([db.latest(server,'player',actor.actor_id),db.latest(server,'skin',actor.actor_id),db.history(server,null,new Date(Date.now()-7*86400_000),200,actor.actor_id,true)]);
    const observed=profiles[0]?.payload.skin,skin=skins[0]&&(!observed?.textureHash||skins[0].occurredAt>profiles[0].occurredAt)?skins[0].payload:observed;
    const savedEvents=await db.latest(server,'player-events',actor.actor_id);
    return {server:safeServer(server),skin,profile:profiles[0]?{...profiles[0],payload:sanitizePlayer(profiles[0].payload)}:null,events:(savedEvents[0]?.payload.items??events).map(safeEvent)};
  }
  async function panelView(actor:Session,value:any):Promise<PanelView>{
    fields(value,['type','id','serverId','section','hours','query']);if(value.type!=='subscribe'||!Number.isSafeInteger(value.id)||value.id<1)fail(400);
    const section=text(value.section,32),sid=id(value.serverId),hours=Number(value.hours??24);since(hours);
    const allowed=actor.kind==='PLAYER'?['overview','journey','inventory','statistics','advancements','privacy']:['overview','players','worlds','events','explorer','controls','audit','settings'];if(!allowed.includes(section))fail(403);
    const server=actor.kind==='PLAYER'?(actor.server_id===sid?await db.server(sid):fail(403)):await db.admin(actor,sid);
    if(actor.kind==='PLAYER'&&actor.tenant_id!==server.tenant_id)fail(403);
    let query:PanelView['query'];
    if(value.query){fields(value.query,['operation','arguments']);const operation=text(value.query.operation,64);if(!QUERIES.includes(operation as any))fail(400);let args=value.query.arguments??{};
      if(actor.kind==='PLAYER'){const own:Record<string,string>={overview:'player.snapshot',inventory:'player.inventory',statistics:'player.statistics',advancements:'player.advancements'};if(own[section]!==operation)fail(403);fields(args,['offset','statistic','material','entityType']);args={...args,playerId:actor.actor_id};}
      else if(section!=='explorer')fail(400);
      query={operation,args:argumentsFor(operation,args,'query')};
    }
    return {id:value.id,actor,server,section,hours,query};
  }
  async function panelSnapshot(view:PanelView){
    const {actor,server,section,hours}=view;const data:any={server:safeServer(server)};
    if(actor.kind==='PLAYER'){data.self=await selfData(actor,server);return data;}
    data.overview={server:data.server,snapshots:await db.latest(server),alerts:await db.rows('SELECT rule,active,value,acknowledged_by,first_seen,last_seen FROM vos_alerts WHERE tenant_id=$1 AND server_id=$2 ORDER BY active DESC,rule',[server.tenant_id,server.id])};
    if(['overview','events','players','controls','explorer'].includes(section))data.players=await db.latest(server,'player');
    if(['worlds','controls','explorer'].includes(section))data.worlds=await db.latest(server,'world');
    if(section==='overview'){data.metrics=await db.history(server,'server.performance.snapshot',since(hours),1000);data.events=await db.history(server,null,since(1),500,null,true);}
    if(section==='events')data.events=await db.history(server,null,since(hours),500,null,true);
    if(['controls','explorer'].includes(section))data.catalog={queries:QUERIES,actions:ACTIONS,capabilities:server.capabilities,role:server.role};
    if(section==='controls')data.actions=await db.rows('SELECT id,operation,kind,risk,state,created_at,expires_at FROM vos_actions WHERE tenant_id=$1 AND server_id=$2 ORDER BY created_at DESC LIMIT 100',[server.tenant_id,server.id]);
    if(section==='audit')data.audit=await db.rows('SELECT id,actor_id,operation,outcome,correlation_id,created_at FROM vos_audit WHERE tenant_id=$1 AND server_id=$2 ORDER BY created_at DESC LIMIT 200',[server.tenant_id,server.id]);
    if(section==='settings'){
      data.settings={...data.server,publicKey:control.publicKey,apiOrigin:config.origin,heartbeat:config.origin+'/api/v1/agents/heartbeat',telemetry:config.origin+'/api/v1/agents/telemetry/batches',control:config.origin.replace(/^http/,'ws')+'/api/v1/agents/control'};
      data.privacyRequests=await db.rows('SELECT id,player_id,kind,state,created_at FROM vos_privacy_requests WHERE tenant_id=$1 AND server_id=$2 ORDER BY created_at DESC LIMIT 100',[server.tenant_id,server.id]);
      if(server.role==='OWNER')data.members=await db.rows('SELECT a.id,a.email,m.role FROM vos_server_members m JOIN vos_accounts a ON a.id=m.account_id WHERE m.tenant_id=$1 AND m.server_id=$2',[server.tenant_id,server.id]);
    }return data;
  }
  function panelDelta(view:PanelView,messages:any[]){
    if(view.actor.kind==='ADMIN')return messages.map(entry=>({type:'telemetry',entry}));
    const packets:any[]=[];for(const entry of messages){
      if(entry.type==='player.saved.snapshot'&&entry.payload.uuid===view.actor.actor_id&&view.query&&entry.payload.operation===view.query.operation&&(entry.payload.arguments?.offset??0)===(view.query.args.offset??0)){packets.push({type:'query',result:{state:'SUCCEEDED',payload:sanitizePlayer(entry.payload.data),observedAt:entry.occurredAt,saved:true}});continue;}
      if(['players.snapshot','players.live.snapshot'].includes(entry.type)){const item=entry.payload.items?.find((p:any)=>p.uuid===view.actor.actor_id);if(item)packets.push({type:'player',profile:{id:item.uuid,occurredAt:entry.occurredAt,payload:sanitizePlayer(item)}});}
      else if(entry.payload.uuid===view.actor.actor_id&&!technical(entry.type))packets.push({type:'event',entry:safeEvent({id:entry.messageId,type:entry.type,occurredAt:entry.occurredAt,payload:entry.payload})});
    }return packets;
  }

  @Controller('api/v1')
  class PlatformController {
    @Get('visuals/icon/:registryId') async icon(@Param('registryId') registryId:string,@Query('angle') angle:string,@Res() res:Response){const asset=await visuals.image(registryId,angle);res.type(asset.type).setHeader('Cache-Control','public, max-age=86400');res.send(asset.bytes);}
    @Get('visuals/skin/:hash') async skin(@Param('hash') hash:string,@Res() res:Response){const asset=await visuals.skin(hash);res.type(asset.type).setHeader('Cache-Control','public, max-age=86400');res.send(asset.bytes);}
    @Get('visuals/item/:registryId') async item(@Req() req:Request,@Param('registryId') registryId:string){await session(req);return visuals.item(registryId);}
    @Get('health') health() { return { status: 'ok' }; }
    @Get('public/info') info() { return { name: 'VanillaOnlineStats', version: '0.6.0', demo: config.demo === true, playerLogin: 'authme-password', source: 'https://github.com/rromeradev/VanillaOnlineStats' }; }
    @Get('public/servers') async publicServers() { return db.rows('SELECT id,name FROM vos_servers WHERE player_login=true ORDER BY name LIMIT 100'); }
    @Post('agents/heartbeat') @HttpCode(202)
    async heartbeat(@Headers('authorization') header: string, @Body() body: any) {
      const server = await db.agent(bearer(header)); limits.check('heartbeat:' + server.id, 30); validateMessage(body, server, true);
      const existing = await db.one('SELECT message_id FROM vos_messages WHERE tenant_id=$1 AND server_id=$2 AND message_id=$3', [server.tenant_id, server.id, body.messageId]);
      const result = await db.ingest(server, [body]); return { messageId: body.messageId, receivedAt: result.receipts.get(body.messageId), duplicate: !!existing };
    }
    @Post('agents/telemetry/batches') @HttpCode(202)
    async batches(@Headers('authorization') header: string, @Body() body: any) {
      const server = await db.agent(bearer(header)); limits.check('batches:' + server.id, 90); fields(body, ['schemaVersion','messages']);
      if (body.schemaVersion !== 1 || !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 128) fail(400);
      for (const entry of body.messages) { limits.check('messages:' + server.id, 6000); validateMessage(entry, server); }
      const result = await db.ingest(server, body.messages); return { acceptedMessageIds: result.ids };
    }
    @Post('auth/admin/login') @HttpCode(200)
    async login(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: any) {
      origin(req); fields(body, ['email','password']); const email = text(body.email, 200).trim().toLowerCase(), password = text(body.password, 128);
      limits.check('login:' + sha(email) + ':' + req.socket.remoteAddress, 5, 5 * 60_000);
      const account = await db.one('SELECT * FROM vos_accounts WHERE email=$1', [email]);
      const dummy = 'scrypt$00000000000000000000000000000000$' + '00'.repeat(64);
      if (!(await passwordMatches(password, account?.password_hash ?? dummy)) || !account) fail(401);
      return createSession(res, 'ADMIN', account.id, account.email);
    }
    @Post('auth/player/login') @HttpCode(200)
    async passwordLogin(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: any) {
      origin(req); fields(body, ['serverId','nickname','password']);
      const server = await db.server(id(body.serverId)), nickname = text(body.nickname, 16);
      if (!/^[A-Za-z0-9_]{3,16}$/.test(nickname)) fail(400);
      const password = text(body.password, 128);
      limits.check('player-password-account:' + server.id + ':' + nickname.toLowerCase(), 5, 900_000);
      limits.check('player-password-source:' + req.socket.remoteAddress, 60, 900_000);
      if (!server.player_login) fail(403);
      if (!server.capabilities?.authmePasswordLogin) fail(409);
      const result = await control.request(server, { kind:'PLAYER', actor_id:randomUUID() }, 'player.authme.login', {nickname,password}, 'link');
      if (result.state !== 'SUCCEEDED' || !UUID.test(result.payload?.playerId ?? '') || typeof result.payload?.name !== 'string') fail(401);
      if(/^[a-f0-9]{32,64}$/.test(result.payload?.skin?.textureHash??''))await db.rows(`INSERT INTO vos_latest(tenant_id,server_id,kind,entity_id,occurred_at,encrypted_payload) VALUES($1,$2,'skin',$3,now(),$4) ON CONFLICT(tenant_id,server_id,kind,entity_id) DO UPDATE SET occurred_at=EXCLUDED.occurred_at,encrypted_payload=EXCLUDED.encrypted_payload`,[server.tenant_id,server.id,result.payload.playerId,db.vault.seal(result.payload.skin,db.context(server))]);
      return createSession(res, 'PLAYER', result.payload.playerId, result.payload.name.slice(0,64), server);
    }
    @Post('auth/player/link') @HttpCode(200)
    async link(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: any) {
      origin(req); fields(body, ['serverId','code']); const server = await db.server(id(body.serverId));
      limits.check('player-link:' + server.id + ':' + req.socket.remoteAddress, 4, 5 * 60_000);
      if (!server.player_login) fail(403);
      const code = text(body.code, 64, 16); if (!/^[A-Za-z0-9_-]+$/.test(code)) fail(400);
      const result = await control.request(server, { kind: 'PLAYER', actor_id: randomUUID() }, 'player.link.redeem', { code }, 'link');
      if (result.state !== 'SUCCEEDED' || !UUID.test(result.payload?.playerId ?? '') || typeof result.payload?.name !== 'string') fail(401);
      return createSession(res, 'PLAYER', result.payload.playerId, result.payload.name.slice(0, 64), server);
    }
    @Get('auth/me') async me(@Req() req: Request) { const actor = await session(req); return { kind: actor.kind, displayName: actor.display_name, serverId: actor.server_id, expiresAt: actor.expires_at, csrf: csrf(cookie(req)!, config.sessionSecret) }; }
    @Post('auth/logout') @HttpCode(200)
    async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) { const actor = await mutation(req); await db.rows('DELETE FROM vos_sessions WHERE token_hash=$1', [actor.token_hash]); res.clearCookie('vos_session', { httpOnly: true, secure: cookieSecure, sameSite: 'strict', path: '/' }); return { ok: true }; }
    @Post('auth/reauth') @HttpCode(200)
    async reauth(@Req() req: Request, @Body() body: any) { const actor = await mutation(req); if (actor.kind !== 'ADMIN') fail(403); fields(body, ['password']); limits.check('reauth:' + actor.actor_id, 5, 300_000);
      const account = await db.one('SELECT password_hash FROM vos_accounts WHERE id=$1', [actor.actor_id]); if (!account || !(await passwordMatches(text(body.password, 128), account.password_hash))) fail(401);
      await db.rows('UPDATE vos_sessions SET reauthenticated_at=now() WHERE token_hash=$1', [actor.token_hash]); return { ok: true }; }
    @Post('auth/password') @HttpCode(200)
    async changePassword(@Req() req: Request, @Body() body: any) {
      const actor = await mutation(req); if (actor.kind !== 'ADMIN') fail(403);
      fields(body, ['currentPassword','newPassword']); limits.check('password:' + actor.actor_id, 5, 300_000);
      const account = await db.one('SELECT password_hash FROM vos_accounts WHERE id=$1', [actor.actor_id]);
      if (!account || !await passwordMatches(text(body.currentPassword, 128), account.password_hash)) fail(401);
      const hash = await passwordHash(text(body.newPassword, 128, 12));
      const client = await db.pool.connect();
      try { await client.query('BEGIN'); await client.query('UPDATE vos_accounts SET password_hash=$1 WHERE id=$2', [hash, actor.actor_id]);
        await client.query("DELETE FROM vos_sessions WHERE kind='ADMIN' AND actor_id=$1 AND token_hash<>$2", [actor.actor_id, actor.token_hash]);
        await client.query('UPDATE vos_sessions SET reauthenticated_at=NULL WHERE token_hash=$1', [actor.token_hash]); await client.query('COMMIT');
      } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
      return { ok: true };
    }
    @Get('servers') async servers(@Req() req: Request) {
      const actor = await session(req); if (actor.kind === 'PLAYER') return [safeServer(await db.server(actor.server_id!))];
      const values = await db.rows(`SELECT DISTINCT s.*,CASE WHEN t.role='OWNER' THEN 'OWNER' ELSE m.role END AS role FROM vos_servers s
        LEFT JOIN vos_tenant_members t ON t.tenant_id=s.tenant_id AND t.account_id=$1 LEFT JOIN vos_server_members m ON m.server_id=s.id AND m.account_id=$1
        WHERE t.role='OWNER' OR m.role='ADMIN' ORDER BY s.name`, [actor.actor_id]); return values.map(safeServer);
    }
    @Post('servers') async addServer(@Req() req: Request, @Body() body: any) {
      const actor = await mutation(req); if (actor.kind !== 'ADMIN') fail(403); fields(body, ['serverId','name','tenantId']);
      const tenant = id(body.tenantId ?? config.tenantId), serverId = id(body.serverId), name = text(body.name, 80);
      if (!(await db.one("SELECT 1 FROM vos_tenant_members WHERE tenant_id=$1 AND account_id=$2 AND role='OWNER'", [tenant, actor.actor_id]))) fail(403);
      const token = opaque(); await db.rows('INSERT INTO vos_servers(id,tenant_id,name,agent_hash) VALUES($1,$2,$3,$4)', [serverId, tenant, name, sha(token)]);
      await db.audit(await db.server(serverId), actor.actor_id, 'server.register', 'SUCCEEDED'); return { serverId, tenantId: tenant, agentToken: token };
    }
    @Get('servers/:serverId/overview') async overview(@Req() req: Request, @Param('serverId') serverId: string) {
      const actor = await session(req), server = await db.admin(actor, id(serverId));
      await db.audit(server, actor.actor_id, 'overview.read', 'SUCCEEDED');
      return { server: safeServer(server), snapshots: await db.latest(server), alerts: await db.rows('SELECT rule,active,value,acknowledged_by,first_seen,last_seen FROM vos_alerts WHERE tenant_id=$1 AND server_id=$2 ORDER BY active DESC,rule', [server.tenant_id, server.id]) };
    }
    @Get('servers/:serverId/metrics') async metrics(@Req() req: Request, @Param('serverId') serverId: string, @Query('hours') hours: string) {
      const actor = await session(req), server = await db.admin(actor, id(serverId)); return db.history(server, 'server.performance.snapshot', since(hours), 1000);
    }
    @Get('servers/:serverId/players') async players(@Req() req: Request, @Param('serverId') serverId: string) {
      const actor = await session(req), server = await db.admin(actor, id(serverId)); await db.audit(server, actor.actor_id, 'players.read', 'SUCCEEDED'); return db.latest(server, 'player');
    }
    @Get('servers/:serverId/worlds') async worlds(@Req() req: Request, @Param('serverId') serverId: string) {
      const actor = await session(req), server = await db.admin(actor, id(serverId)); return db.latest(server, 'world');
    }
    @Get('servers/:serverId/events') async events(@Req() req: Request, @Param('serverId') serverId: string, @Query('hours') hours: string, @Query('type') type?: string) {
      const actor = await session(req), server = await db.admin(actor, id(serverId)); await db.audit(server, actor.actor_id, 'events.read', 'SUCCEEDED'); return db.history(server, type ? text(type, 128) : null, since(hours), 500,null,!type);
    }
    @Get('servers/:serverId/catalog') async catalog(@Req() req: Request, @Param('serverId') serverId: string) {
      const actor = await session(req), server = await db.admin(actor, id(serverId)); return { queries: QUERIES, actions: ACTIONS, capabilities: server.capabilities, role: server.role };
    }
    @Post('servers/:serverId/queries') @HttpCode(200)
    async query(@Req() req: Request, @Param('serverId') serverId: string, @Body() body: any) {
      const actor = await mutation(req), server = await db.admin(actor, id(serverId)); fields(body, ['operation','arguments']);
      const op = text(body.operation, 64); if (!(QUERIES as readonly string[]).includes(op)) fail(400);
      return control.request(server, { ...actor, role: server.role }, op, argumentsFor(op, body.arguments ?? {}, 'query'), 'query');
    }
    @Post('servers/:serverId/actions') @HttpCode(200)
    async action(@Req() req: Request, @Param('serverId') serverId: string, @Body() body: any) {
      const actor = await mutation(req), server = await db.admin(actor, id(serverId)); fields(body, ['operation','arguments','confirmed']);
      const op = text(body.operation, 64); if (!ACTIONS[op] || body.confirmed !== true) fail(400);
      if (ACTIONS[op].risk === 'HIGH' && (server.role !== 'OWNER' || !actor.reauthenticated_at || Date.now() - new Date(actor.reauthenticated_at).getTime() > 120_000)) fail(403);
      return control.request(server, { ...actor, role: server.role }, op, argumentsFor(op, body.arguments, 'action'), 'action', true);
    }
    @Get('servers/:serverId/actions') async actions(@Req() req: Request, @Param('serverId') serverId: string) {
      const actor = await session(req), server = await db.admin(actor, id(serverId));
      return db.rows('SELECT id,operation,kind,risk,state,created_at,expires_at FROM vos_actions WHERE tenant_id=$1 AND server_id=$2 ORDER BY created_at DESC LIMIT 100', [server.tenant_id, server.id]);
    }
    @Get('servers/:serverId/actions/:actionId') async actionResult(@Req() req: Request, @Param('serverId') serverId: string, @Param('actionId') actionId: string) {
      const actor = await session(req), server = await db.admin(actor, id(serverId));
      const row = await db.one('SELECT id,operation,state,encrypted_result FROM vos_actions WHERE tenant_id=$1 AND server_id=$2 AND id=$3', [server.tenant_id, server.id, id(actionId)]); if (!row) fail(404);
      await db.audit(server, actor.actor_id, 'action-result.read', 'SUCCEEDED');
      return { id: row.id, operation: row.operation, state: row.state, payload: row.encrypted_result ? db.vault.open(row.encrypted_result, db.context(server)) : null };
    }
    @Get('servers/:serverId/audit') async audit(@Req() req: Request, @Param('serverId') serverId: string) {
      const actor = await session(req), server = await db.admin(actor, id(serverId)); return db.rows('SELECT id,actor_id,operation,outcome,correlation_id,created_at FROM vos_audit WHERE tenant_id=$1 AND server_id=$2 ORDER BY created_at DESC LIMIT 200', [server.tenant_id, server.id]);
    }
    @Post('servers/:serverId/alerts/:rule/ack') @HttpCode(200)
    async ack(@Req() req: Request, @Param('serverId') serverId: string, @Param('rule') rule: string) {
      const actor = await mutation(req), server = await db.admin(actor, id(serverId)); if (!['low-tps','high-mspt','high-heap'].includes(rule)) fail(400);
      await db.rows('UPDATE vos_alerts SET acknowledged_by=$1 WHERE tenant_id=$2 AND server_id=$3 AND rule=$4', [actor.actor_id, server.tenant_id, server.id, rule]); await db.audit(server, actor.actor_id, 'alert.ack', 'SUCCEEDED'); return { ok: true };
    }
    @Get('servers/:serverId/settings') async settings(@Req() req: Request, @Param('serverId') serverId: string) {
      const actor = await session(req), server = await db.admin(actor, id(serverId));
      return { ...safeServer(server), publicKey: control.publicKey, apiOrigin: config.origin, heartbeat: config.origin + '/api/v1/agents/heartbeat', telemetry: config.origin + '/api/v1/agents/telemetry/batches', control: config.origin.replace(/^http/, 'ws') + '/api/v1/agents/control' };
    }
    @Patch('servers/:serverId/settings') async updateSettings(@Req() req: Request, @Param('serverId') serverId: string, @Body() body: any) {
      const actor = await mutation(req), server = await db.admin(actor, id(serverId)); if (server.role !== 'OWNER') fail(403); fields(body, ['name','playerLogin']);
      if (typeof body.playerLogin !== 'boolean') fail(400); await db.rows('UPDATE vos_servers SET name=$1,player_login=$2 WHERE id=$3 AND tenant_id=$4', [text(body.name, 80), body.playerLogin, server.id, server.tenant_id]);
      await db.audit(server, actor.actor_id, 'settings.update', 'SUCCEEDED'); return { ok: true };
    }
    @Post('servers/:serverId/rotate-agent') @HttpCode(200)
    async rotate(@Req() req: Request, @Param('serverId') serverId: string) {
      const actor = await mutation(req), server = await db.admin(actor, id(serverId)); if (server.role !== 'OWNER' || !actor.reauthenticated_at || Date.now() - new Date(actor.reauthenticated_at).getTime() > 120_000) fail(403);
      const token = opaque(); await db.rows('UPDATE vos_servers SET agent_hash=$1 WHERE id=$2 AND tenant_id=$3', [sha(token), server.id, server.tenant_id]); await control.revoke(server.id);
      await db.audit(server, actor.actor_id, 'agent.rotate', 'SUCCEEDED'); return { agentToken: token };
    }
    @Get('servers/:serverId/members') async members(@Req() req: Request, @Param('serverId') serverId: string) {
      const actor = await session(req), server = await db.admin(actor, id(serverId)); if (server.role !== 'OWNER') fail(403);
      return db.rows('SELECT a.id,a.email,m.role FROM vos_server_members m JOIN vos_accounts a ON a.id=m.account_id WHERE m.tenant_id=$1 AND m.server_id=$2', [server.tenant_id, server.id]);
    }
    @Post('servers/:serverId/members') async addMember(@Req() req: Request, @Param('serverId') serverId: string, @Body() body: any) {
      const actor = await mutation(req), server = await db.admin(actor, id(serverId)); if (server.role !== 'OWNER') fail(403); fields(body, ['email','password']);
      const email = text(body.email, 200).trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400);
      let account = await db.one('SELECT id FROM vos_accounts WHERE email=$1', [email]);
      if (!account) { account = { id: randomUUID() }; await db.rows('INSERT INTO vos_accounts(id,email,password_hash) VALUES($1,$2,$3)', [account.id, email, await passwordHash(text(body.password, 128, 12))]); }
      await db.rows("INSERT INTO vos_server_members(tenant_id,server_id,account_id,role) VALUES($1,$2,$3,'ADMIN') ON CONFLICT DO NOTHING", [server.tenant_id, server.id, account.id]);
      await db.audit(server, actor.actor_id, 'membership.add', 'SUCCEEDED'); return { ok: true };
    }
    @Delete('servers/:serverId/members/:accountId') async removeMember(@Req() req: Request, @Param('serverId') serverId: string, @Param('accountId') accountId: string) {
      const actor = await mutation(req), server = await db.admin(actor, id(serverId)); if (server.role !== 'OWNER') fail(403);
      await db.rows('DELETE FROM vos_server_members WHERE tenant_id=$1 AND server_id=$2 AND account_id=$3', [server.tenant_id, server.id, id(accountId)]); await db.audit(server, actor.actor_id, 'membership.remove', 'SUCCEEDED'); return { ok: true };
    }
    @Get('servers/:serverId/export') async exportData(@Req() req: Request, @Param('serverId') serverId: string, @Query('hours') hours: string, @Query('format') format: string, @Res() res: Response) {
      const actor = await session(req), server = await db.admin(actor, id(serverId)); await db.audit(server, actor.actor_id, 'data.export', 'SUCCEEDED');
      const values = await db.history(server, null, since(hours), 1000); res.setHeader('Content-Disposition', 'attachment; filename="telemetry.' + (format === 'csv' ? 'csv' : 'json') + '"');
      if (format === 'csv') { const quote = (s: any) => '"' + String(s).replace(/"/g, '""') + '"'; res.type('text/csv').send('id,type,occurredAt,payload\n' + values.map(value => [value.id,value.type,new Date(value.occurredAt).toISOString(),JSON.stringify(value.payload)].map(quote).join(',')).join('\n')); }
      else res.json(values);
    }
    @Get('me/servers/:serverId') async playerData(@Req() req: Request, @Param('serverId') serverId: string) {
      const { actor, server } = await scopedPlayer(req, id(serverId));
      return selfData(actor,server);
    }
    @Post('me/servers/:serverId/queries') @HttpCode(200)
    async playerQuery(@Req() req: Request, @Param('serverId') serverId: string, @Body() body: any) {
      await mutation(req); const { actor, server } = await scopedPlayer(req, id(serverId)); fields(body, ['operation','arguments']);
      const operation = text(body.operation, 64); if (!['player.snapshot','player.inventory','player.statistics','player.advancements'].includes(operation)) fail(403);
      const args = body.arguments ?? {}; fields(args, ['offset','statistic','material','entityType']);
      if (!server.capabilities?.playerQueries) fail(409);
      const saved=await db.savedPlayer(server,actor.actor_id,operation,args);
      if(!control.connected(server.id)&&saved)return saved;
      const result = await control.request(server, actor, operation, argumentsFor(operation, { ...args, playerId: actor.actor_id }, 'query'), 'query');
      if(result.state!=='SUCCEEDED'&&saved)return saved;
      if (result.payload) result.payload = sanitizePlayer(result.payload); return result;
    }
    @Get('me/servers/:serverId/skins') async skins(@Req() req:Request,@Param('serverId') serverId:string){
      await scopedPlayer(req,id(serverId));return {source:'MineSkin',items:await skinCatalog.popular()};
    }
    @Post('me/servers/:serverId/skin') @HttpCode(200) async changeSkin(@Req() req:Request,@Param('serverId') serverId:string,@Body() body:any){
      await mutation(req);const {actor,server}=await scopedPlayer(req,id(serverId));fields(body,['id','png','model']);
      limits.check('skin:'+server.id+':'+actor.actor_id,2);
      if(!control.connected(server.id))fail(503);
      if(!server.capabilities?.skinChanges)fail(409);
      let args:any;
      if(body.id!==undefined){if(Object.keys(body).length!==1)fail(400);args=await skinCatalog.property(text(body.id,32,32));}
      else {if(!['classic','slim'].includes(body.model))fail(400);args={png:skinUpload(body.png),model:body.model};}
      const result=await control.request(server,actor,'player.skin.set',args,'skin',true);
      if(result.state==='SUCCEEDED'&&result.payload?.saved&&/^[a-f0-9]{32,64}$/.test(result.payload.skin?.textureHash??'')){
        await db.rows(`INSERT INTO vos_latest(tenant_id,server_id,kind,entity_id,occurred_at,encrypted_payload) VALUES($1,$2,'skin',$3,now(),$4) ON CONFLICT(tenant_id,server_id,kind,entity_id) DO UPDATE SET occurred_at=EXCLUDED.occurred_at,encrypted_payload=EXCLUDED.encrypted_payload`,[server.tenant_id,server.id,actor.actor_id,db.vault.seal(result.payload.skin,db.context(server))]);db.notify(server.id);
      }return result;
    }
    @Post('me/servers/:serverId/privacy-requests') async privacy(@Req() req: Request, @Param('serverId') serverId: string, @Body() body: any) {
      await mutation(req); const { actor, server } = await scopedPlayer(req, id(serverId)); fields(body, ['kind']); if (!['DELETE','EXPORT'].includes(body.kind)) fail(400);
      await db.rows('INSERT INTO vos_privacy_requests(id,tenant_id,server_id,player_id,kind) VALUES($1,$2,$3,$4,$5)', [randomUUID(), server.tenant_id, server.id, actor.actor_id, body.kind]);db.notify(server.id); return { ok: true };
    }
    @Get('servers/:serverId/privacy-requests') async privacyRequests(@Req() req: Request, @Param('serverId') serverId: string) { const actor = await session(req), server = await db.admin(actor, id(serverId)); return db.rows('SELECT id,player_id,kind,state,created_at FROM vos_privacy_requests WHERE tenant_id=$1 AND server_id=$2 ORDER BY created_at DESC LIMIT 100', [server.tenant_id, server.id]); }
  }
  @Module({ controllers: [PlatformController] }) class PlatformModule {}
  const app = await NestFactory.create<NestExpressApplication>(PlatformModule, { logger: false, bodyParser: false });
  @Catch() class SafeErrors implements ExceptionFilter {
    catch(error: any, host: ArgumentsHost) {
      const raw = error instanceof HttpException ? error.getStatus() : error?.code === '23505' ? 409 : error?.status ?? 500;
      const status = [400,401,403,404,409,413,415,429,503].includes(raw) ? raw : 500;
      host.switchToHttp().getResponse().status(status).json({ statusCode: status, message: status === 503 ? 'Servidor sem conexão de controle.' : 'Não foi possível concluir a solicitação.' });
    }
  }
  app.useGlobalFilters(new SafeErrors()); app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use((req: Request, res: Response, next: () => void) => {
    const token=cookie(req),hash=token?sha(token):'',until=rateSessions.get(hash)??0;
    if(until<Date.now())rateSessions.delete(hash);
    try { limits.check('http:' + (until>Date.now()?hash:req.socket.remoteAddress), 1200); } catch { res.status(429).json({ message: 'Limite de solicitações.' }); return; }
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://blocksitems.com; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    next();
  });
  app.use(json({ limit: '9mb', strict: true, inflate: false }));
  const web = config.webDist ?? resolve(__dirname, '../../web/dist/browser');
  if (existsSync(resolve(web, 'index.html'))) {
    app.use((req: Request, res: Response, next: () => void) => { if (req.path.startsWith('/api')) return next(); return serveStatic(web)(req, res, next); });
    app.use((req: Request, res: Response, next: () => void) => { if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.includes('.')) res.sendFile(resolve(web, 'index.html')); else next(); });
  }
  const server = app.getHttpServer(); server.requestTimeout = 35_000; server.headersTimeout = 10_000; server.maxConnections = 128;
  control = new Control(db, config.privateKey, server,async(agent,messages)=>{for(const entry of messages){limits.check('messages:'+agent.id,6000);validateMessage(entry,agent);}return (await db.ingest(agent,messages)).ids;});
  const panel=new PanelStream(server,db,control,config.origin,req=>session(req as Request),panelView,async(req,view)=>{
    const actor=await session(req as Request);if(actor.kind!==view.actor.kind)fail(403);
    if(actor.kind==='PLAYER'){if(actor.server_id!==view.server.id)fail(403);view.server=await db.server(view.server.id);}else view.server=await db.admin(actor,view.server.id);view.actor=actor;
  },panelSnapshot,panelDelta);
  const cleanup = setInterval(() => { void db.cleanup().catch(() => {}); }, 60_000); cleanup.unref();
  await db.cleanup();
  const close = app.close.bind(app);
  app.close = async () => { clearInterval(cleanup); await panel.close(); await control.close(); await close(); await db.close(); };
  return { app, db, control };
}
