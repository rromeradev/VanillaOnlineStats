// SPDX-License-Identifier: AGPL-3.0-only
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, randomUUID, verify, createPublicKey } from 'node:crypto';
import pg from 'pg';
import WebSocket from 'ws';
import { createPlatform } from '../dist/platform.js';
import { sha, passwordHash } from '../dist/security.js';

const enabled = !!process.env.TEST_DATABASE_URL;
const suite = enabled ? test : test.skip;
const serverId = randomUUID(), tenantId = randomUUID(), otherServer = randomUUID(), otherTenant = randomUUID();
const token = randomBytes(32).toString('base64url'), password = 'Test-only-password-948!';
let platform, url, pool, schemaName, owner, ws, config;
const sessions = {}; let observedCalls=0,holdReads=false;const heldReplies=[];const activeWatches=new Map();let streamAcks=[];
async function request(path, options = {}, actor = owner) {
  const headers = { 'Content-Type': 'application/json', Origin: config.origin, ...(actor ? { Cookie: actor.cookie, 'X-CSRF-Token': actor.csrf } : {}), ...options.headers };
  return fetch(url + '/api/v1/' + path, { ...options, headers });
}
const post = (path, body, actor) => request(path, { method: 'POST', body: JSON.stringify(body) }, actor);
async function login(email, pass) { const response = await post('auth/admin/login', { email, password: pass }, null); assert.equal(response.status, 200); const data = await response.json(); return { cookie: response.headers.get('set-cookie').split(';')[0], csrf: data.csrf }; }
const sample = (type = 'server.heartbeat', payload = { pluginVersion: '0.3.1', minecraftVersion: '26.3', paperVersion: '26.3-227', authMeVersion: '6.0.1-b2770', uptimeSeconds: 10, playersOnline: 1 }) => ({ schemaVersion: 1, messageId: randomUUID(), serverId, sentAt: new Date().toISOString(), occurredAt: new Date().toISOString(), type, source: 'paper-api', payload });
before(async () => {
  if (!enabled) return;
  const urlValue = new URL(process.env.TEST_DATABASE_URL); schemaName = 'vos_test_' + randomBytes(8).toString('hex');
  pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL }); await pool.query(`CREATE SCHEMA ${schemaName}`);
  urlValue.searchParams.set('options', '-c search_path=' + schemaName);
  const pair = generateKeyPairSync('ed25519');
  config = { databaseUrl: urlValue.toString(), dataKey: randomBytes(32).toString('base64'), sessionSecret: randomBytes(32).toString('base64url'), privateKey: pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'), origin: 'http://127.0.0.1:3100', tenantId, ownerEmail: 'owner@example.test', ownerPassword: password, initialServerId: serverId, initialAgentHash: sha(token) };
  platform = await createPlatform(config); await platform.app.listen(0, '127.0.0.1'); url = await platform.app.getUrl(); owner = await login(config.ownerEmail, password);
  await platform.db.rows('INSERT INTO vos_tenants(id,name) VALUES($1,$2)', [otherTenant, 'Other']);
  await platform.db.rows('INSERT INTO vos_servers(id,tenant_id,name,agent_hash) VALUES($1,$2,$3,$4)', [otherServer, otherTenant, 'Other server', sha(randomUUID())]);
});
after(async () => { if (!enabled) return; ws?.terminate(); await platform?.app.close(); if (schemaName && /^vos_test_[a-f0-9]+$/.test(schemaName)) await pool.query(`DROP SCHEMA ${schemaName} CASCADE`); await pool?.end(); });

suite('authenticated persistent ingestion, conflicts and cross-tenant isolation', async () => {
  const message = sample();
  const agent = { headers: { Authorization: 'Bearer ' + token } };
  assert.equal((await request('agents/heartbeat', { ...agent, method: 'POST', body: JSON.stringify(message) }, null)).status, 202);
  const duplicate = await request('agents/heartbeat', { ...agent, method: 'POST', body: JSON.stringify(message) }, null); assert.equal((await duplicate.json()).duplicate, true);
  assert.equal((await request('agents/heartbeat', { ...agent, method: 'POST', body: JSON.stringify({ ...message, payload: { ...message.payload, playersOnline: 9 } }) }, null)).status, 409);
  assert.equal((await request('agents/heartbeat', { ...agent, method: 'POST', body: JSON.stringify({ ...sample(), serverId: otherServer }) }, null)).status, 403);
  assert.equal((await request('agents/heartbeat', { method: 'POST', body: JSON.stringify(sample()) }, null)).status, 401);
  assert.equal((await request(`servers/${otherServer}/overview`)).status, 404);
  assert.equal((await request(`servers/${serverId}/overview`, {}, null)).status, 401);
  const record = await platform.db.one('SELECT encrypted_payload FROM vos_messages WHERE message_id=$1', [message.messageId]);
  assert.ok(!record.encrypted_payload.includes('playersOnline'));
  const overview = await request(`servers/${serverId}/overview`); assert.equal(overview.status, 200); assert.equal((await overview.json()).server.online, true);
});
suite('CSRF and privileges cannot be supplied by the browser', async () => {
  assert.equal((await request(`servers/${serverId}/settings`, { method: 'PATCH', headers: { 'X-CSRF-Token': 'wrong' }, body: JSON.stringify({ name: 'Bad', playerLogin: true }) })).status, 403);
  assert.equal((await post(`servers/${serverId}/actions`, { operation: 'server.console', arguments: { command: 'say hello' }, confirmed: true })).status, 403);
  const result = await post(`servers/${serverId}/queries`, { operation: 'server.snapshot', actorRole: 'OWNER', arguments: {} }); assert.equal(result.status, 400);
});
suite('last player pages and session events survive retention, restart, and cross-player reads',async()=>{
  const server=await platform.db.server(serverId),player=randomUUID(),other=randomUUID();
  const page=sample('player.saved.snapshot',{uuid:player,operation:'player.advancements',arguments:{offset:64},data:{items:[{key:'minecraft:story/mine_stone',complete:true}],nextOffset:-1}});
  await platform.db.ingest(server,[page,sample('auth.session.started',{uuid:player}),sample('player.PlayerLevelChangeEvent',{uuid:player,NewLevel:8})]);
  await platform.db.rows("UPDATE vos_latest SET occurred_at=now()-interval '90 days' WHERE server_id=$1 AND entity_id LIKE $2",[serverId,player+'%']);
  await platform.db.cleanup();
  assert.equal((await platform.db.savedPlayer(server,player,'player.advancements',{offset:64})).payload.items[0].complete,true);
  assert.equal(await platform.db.savedPlayer(server,player,'player.advancements',{offset:0}),null);
  assert.equal(await platform.db.savedPlayer(server,other,'player.advancements',{offset:64}),null);
  assert.equal((await platform.db.latest(server,'player-events',player))[0].payload.items.length,2);
  const restarted=new (await import('../dist/database.js')).Database(config.databaseUrl,config.dataKey);
  try{assert.ok(await restarted.savedPlayer(server,player,'player.advancements',{offset:64}));}finally{await restarted.close();}
  await platform.db.ingest(server,[sample('auth.session.started',{uuid:player})]);assert.equal((await platform.db.latest(server,'player-events',player))[0].payload.items.length,1);
});
suite('batches validate schema, block secret fields, persist projections and alerts', async () => {
  const perf = sample('server.performance.snapshot', { tps: [15,18,19], msptAverage: 65, heapUsed: 950, heapMax: 1000 });
  const player = sample('players.snapshot', { items: [{ uuid: randomUUID(), name: 'Player One', level: 6 }], online: 1, partial: false });
  const response = await request('agents/telemetry/batches', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify({ schemaVersion: 1, messages: [perf, player] }) }, null);
  assert.equal(response.status, 202); assert.equal((await response.json()).acceptedMessageIds.length, 2);
  const denied = await request('agents/telemetry/batches', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify({ schemaVersion: 1, messages: [sample('player.event', { password: 'DO_NOT_STORE' })] }) }, null); assert.equal(denied.status, 400); assert.ok(!(await denied.text()).includes('DO_NOT_STORE'));
  const overview = await (await request(`servers/${serverId}/overview`)).json(); assert.equal(overview.alerts.filter(v => v.active).length, 3);
  assert.equal((await (await request(`servers/${serverId}/players`)).json()).length, 1);
});
suite('real WebSocket protocol signs exact scoped requests and matches results', async () => {
  ws = new WebSocket(url.replace(/^http/, 'ws') + '/api/v1/agents/control', { headers: { Authorization: 'Bearer ' + token } });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const publicKey = createPublicKey({ key: Buffer.from(platform.control.publicKey, 'base64'), type: 'spki', format: 'der' });
  ws.on('message', data => {
    const wrapper = JSON.parse(data.toString());if(wrapper.type==='agent.ready')return;if(wrapper.type==='agent.telemetry.ack'){streamAcks.push(...wrapper.ids);return;}const bytes = Buffer.from(wrapper.body, 'base64url'); assert.ok(verify(null, bytes, publicKey, Buffer.from(wrapper.signature, 'base64url')));
    const body = JSON.parse(bytes.toString());if(body.kind==='query')observedCalls++; assert.equal(body.serverId, serverId); assert.equal(body.tenantId, tenantId);
    if(body.kind==='watch'){
      const watchId=body.arguments.watchId;if(body.arguments.stop){activeWatches.delete(watchId);return;}
      if(activeWatches.has(watchId))return;const watch={...body,sequence:1};activeWatches.set(watchId,watch);
      ws.send(JSON.stringify({type:'watch.update',watchId,sequence:1,state:'SUCCEEDED',payload:{uuid:body.arguments.query.playerId,amount:1,address:'private-address',permissions:['private-permission']}}));return;
    }
    if (body.operation === 'player.authme.login' && body.arguments.password !== 'Dummy-password-no-persistence') {
      ws.send(JSON.stringify({type:'control.result',actionId:body.actionId,auditCorrelationId:body.auditCorrelationId,state:'FAILED',payload:null})); return;
    }
    if(body.kind==='skin'){assert.equal(body.actorRole,'PLAYER');assert.equal(body.actorId,sessions.playerId);assert.equal(body.arguments.playerId,undefined);assert.equal(body.confirmed,true);}
    const payload = body.kind==='skin'?{saved:true,application:'next-login',skin:{textureHash:'a'.repeat(64),model:'slim',source:'skinsrestorer'}}:['player.link.redeem','player.authme.login'].includes(body.operation) ? { playerId: sessions.playerId, name: 'Only Me' } : body.operation === 'player.snapshot' ? { uuid: body.arguments.playerId, name: 'Only Me', permissions: ['not-for-player'], address: '127.0.0.1' } : { ok: true };
    if (body.kind === 'action') assert.equal(body.actorRole, 'OWNER');
    if (body.operation === 'player.snapshot') { assert.equal(body.actorRole, 'PLAYER'); assert.equal(body.arguments.playerId, sessions.playerId); }
    const reply=()=>ws.send(JSON.stringify({ type: 'control.result', actionId: body.actionId, auditCorrelationId: body.auditCorrelationId, state: 'SUCCEEDED', payload }));if(holdReads&&body.kind==='query')heldReplies.push(reply);else reply();
  });
  ws.send(JSON.stringify({ type: 'agent.capabilities', payload: { schemaVersion: 1, skinChanges: true, playerQueries: true, authmePasswordLogin: true, collectors: ['players','performance'], queries: ['server.snapshot','player.snapshot'], privacy: { players: true }, unsupported: [] } }));
  for (let i=0; i<30; i++) { const server = await platform.db.server(serverId); if (server.capabilities.playerQueries) break; await new Promise(resolve => setTimeout(resolve, 20)); }
  const response = await post(`servers/${serverId}/queries`, { operation: 'server.snapshot', arguments: {} }); assert.equal(response.status, 200); assert.equal((await response.json()).state, 'SUCCEEDED');
  await post('auth/reauth', { password });
  const action = await post(`servers/${serverId}/actions`, { operation: 'server.console', arguments: { command: 'say hello' }, confirmed: true }); assert.equal((await action.json()).state, 'SUCCEEDED');
  assert.ok((await platform.db.rows('SELECT * FROM vos_audit WHERE server_id=$1', [serverId])).length > 0);
});
async function panelConnection(actor=owner,origin=config.origin){
  const socket=new WebSocket(url.replace(/^http/,'ws')+'/api/v1/panel',{headers:{Origin:origin,...(actor?{Cookie:actor.cookie}:{})}}),frames=[];
  socket.on('message',data=>frames.push(JSON.parse(data.toString())));
  await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
  return {socket,frames,async next(predicate){const until=Date.now()+5000;while(Date.now()<until){const index=frames.findIndex(predicate);if(index>=0)return frames.splice(index,1)[0];await new Promise(r=>setTimeout(r,10));}throw new Error('Expected pushed frame was not received');},async close(){if(socket.readyState===WebSocket.CLOSED)return;const done=new Promise(resolve=>socket.once('close',resolve));socket.close();await done;}};
}
suite('panel WebSocket authenticates origin and pushes native changes and telemetry without reads',async()=>{
  await assert.rejects(panelConnection(null));await assert.rejects(panelConnection(owner,'https://wrong-origin.test'));
  ws.send(JSON.stringify({type:'agent.capabilities',payload:{schemaVersion:1,skinChanges:true,streaming:true,playerQueries:true,authmePasswordLogin:true,collectors:['players','performance'],queries:['server.snapshot','player.inventory'],privacy:{players:true,inventories:true}}}));
  const until=Date.now()+3000;while(!(await platform.db.server(serverId)).capabilities.streaming&&Date.now()<until)await new Promise(r=>setTimeout(r,10));
  const panel=await panelConnection();try{
    const reads=observedCalls;
    panel.socket.send(JSON.stringify({type:'subscribe',id:1,serverId,section:'explorer',hours:24,query:{operation:'server.snapshot',arguments:{}}}));
    assert.equal((await panel.next(v=>v.type==='snapshot')).data.server.id,serverId);
    assert.equal((await panel.next(v=>v.type==='query')).result.payload.amount,1);
    const watch=[...activeWatches.values()][0];assert.ok(watch);assert.equal(watch.actorRole,'OWNER');
    ws.send(JSON.stringify({type:'watch.update',watchId:watch.arguments.watchId,sequence:++watch.sequence,state:'SUCCEEDED',payload:{amount:2}}));
    assert.equal((await panel.next(v=>v.type==='query')).result.payload.amount,2);assert.equal(observedCalls,reads);
    ws.send(JSON.stringify({type:'watch.update',watchId:watch.arguments.watchId,epoch:randomUUID(),sequence:1,state:'SUCCEEDED',payload:{amount:3}}));assert.equal((await panel.next(v=>v.type==='query')).result.payload.amount,3);
    const entry=sample('server.performance.snapshot',{tps:[20,20,20],msptAverage:2,playersOnline:2,heapUsed:2,heapMax:10});
    ws.send(JSON.stringify({type:'agent.telemetry',messages:[entry]}));assert.equal((await panel.next(v=>v.type==='telemetry'&&v.entry.messageId===entry.messageId)).entry.payload.playersOnline,2);
    const deadline=Date.now()+2000;while(!streamAcks.includes(entry.messageId)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));assert.ok(streamAcks.includes(entry.messageId));
    panel.socket.send(JSON.stringify({type:'unsubscribe'}));await panel.next(v=>v.type==='paused');
    const limit=Date.now()+2000;while(activeWatches.size&&Date.now()<limit)await new Promise(r=>setTimeout(r,10));assert.equal(activeWatches.size,0);
  }finally{await panel.close();}
});
suite('two tabs share one native subscription and release it only after both close',async()=>{
  const first=await panelConnection(),second=await panelConnection();try{
    const subscription={type:'subscribe',id:1,serverId,section:'explorer',query:{operation:'server.snapshot',arguments:{}}};
    first.socket.send(JSON.stringify(subscription));await first.next(v=>v.type==='query');second.socket.send(JSON.stringify(subscription));await second.next(v=>v.type==='query');assert.equal(activeWatches.size,1);
    await first.close();assert.equal(activeWatches.size,1);const watch=[...activeWatches.values()][0];ws.send(JSON.stringify({type:'watch.update',watchId:watch.arguments.watchId,sequence:++watch.sequence,state:'SUCCEEDED',payload:{amount:99}}));assert.equal((await second.next(v=>v.type==='query'&&v.result.payload.amount===99)).result.payload.amount,99);
  }finally{await first.close();await second.close();}
  const until=Date.now()+2000;while(activeWatches.size&&Date.now()<until)await new Promise(r=>setTimeout(r,10));assert.equal(activeWatches.size,0);
});
suite('continuous reads reserve capacity for commands',async()=>{
  holdReads=true;const pending=Array.from({length:4},()=>post(`servers/${serverId}/queries`,{operation:'server.snapshot',arguments:{}}));
  try{
    const until=Date.now()+5000;while(heldReplies.length<4&&Date.now()<until)await new Promise(r=>setTimeout(r,10));assert.equal(heldReplies.length,4);
    assert.equal((await post(`servers/${serverId}/queries`,{operation:'worlds.list',arguments:{}})).status,429);
    const action=await post(`servers/${serverId}/actions`,{operation:'world.time',arguments:{worldId:randomUUID(),value:6000},confirmed:true});assert.equal(action.status,200);assert.equal((await action.json()).state,'SUCCEEDED');
  }finally{holdReads=false;for(const reply of heldReplies.splice(0))reply();await Promise.all(pending);}
});
suite('Offline Player password login remains scoped; no administrative access or different player target', async () => {
  sessions.playerId = randomUUID(); await platform.db.rows('UPDATE vos_servers SET player_login=true WHERE id=$1', [serverId]);
  assert.equal((await post('auth/player/login', {serverId,nickname:'OnlyMe',password:'wrong-password'}, null)).status, 401);
  const response = await post('auth/player/login', { serverId, nickname: 'OnlyMe', password: 'Dummy-password-no-persistence' }, null); assert.equal(response.status, 200);
  const identity = await response.json(); const player = { cookie: response.headers.get('set-cookie').split(';')[0], csrf: identity.csrf };
  assert.equal(identity.kind, 'PLAYER');
  const forbidden=await panelConnection(player);const denied=new Promise(resolve=>forbidden.socket.once('close',resolve));forbidden.socket.send(JSON.stringify({type:'subscribe',id:1,serverId:otherServer,section:'inventory',query:{operation:'player.inventory',arguments:{}}}));assert.equal(await denied,4403);assert.ok(forbidden.frames.every(frame=>frame.type==='ready'));await forbidden.close();
  assert.equal((await platform.db.one("SELECT count(*)::int AS n FROM vos_actions WHERE operation='player.authme.login'")).n, 0);
  assert.equal((await request(`servers/${serverId}/overview`, {}, player)).status, 403);
  assert.equal((await post(`servers/${serverId}/actions`, { operation: 'world.time', arguments: {}, confirmed: true }, player)).status, 403);
  assert.equal((await request(`me/servers/${otherServer}`, {}, player)).status, 403);
  assert.equal((await post(`me/servers/${serverId}/queries`, { operation: 'player.snapshot', arguments: { playerId: randomUUID() } }, player)).status, 400);
  const own = await post(`me/servers/${serverId}/queries`, { operation: 'player.snapshot', arguments: {} }, player); assert.equal(own.status, 200); const data = await own.json(); assert.equal(data.payload.uuid, sessions.playerId); assert.equal(data.payload.address, undefined); assert.equal(data.payload.permissions, undefined);
  const panel=await panelConnection(player);
  panel.socket.send(JSON.stringify({type:'subscribe',id:1,serverId,section:'inventory',query:{operation:'player.inventory',arguments:{}}}));
  await panel.next(v=>v.type==='snapshot');const pushed=await panel.next(v=>v.type==='query');assert.equal(pushed.result.payload.uuid,sessions.playerId);assert.equal(pushed.result.payload.address,undefined);assert.equal(pushed.result.payload.permissions,undefined);
  const secret=sample('players.live.snapshot',{items:[{uuid:randomUUID(),name:'Never-show-this-player'},{uuid:sessions.playerId,name:'Only Me',level:42,address:'never-show-address',permissions:['secret']}]});
  ws.send(JSON.stringify({type:'agent.telemetry',messages:[secret]}));const profile=await panel.next(v=>v.type==='player');assert.equal(profile.profile.payload.level,42);assert.equal(profile.profile.payload.address,undefined);assert.equal(JSON.stringify(panel.frames).includes('Never-show-this-player'),false);
  const disconnect=sample('auth.session.ended',{uuid:sessions.playerId,reason:'disconnect',durationSeconds:40});
  await request('agents/telemetry/batches',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({schemaVersion:1,messages:[disconnect]})},null);
  assert.equal((await request(`me/servers/${serverId}`,{},player)).status,200);
  const savedPage=sample('player.saved.snapshot',{uuid:sessions.playerId,operation:'player.inventory',arguments:{},data:{uuid:sessions.playerId,inventory:[{slot:0,item:{type:'minecraft:diamond',amount:7}}],enderChest:[]}});
  await platform.db.ingest(await platform.db.server(serverId),[savedPage]);await panel.next(v=>v.type==='query'&&v.result.saved);
  const watch=[...activeWatches.values()].find(w=>w.arguments.query.playerId===sessions.playerId);
  ws.send(JSON.stringify({type:'watch.update',watchId:watch.arguments.watchId,sequence:++watch.sequence,state:'FAILED',payload:{reasonCode:'PLAYER_NOT_AUTHENTICATED'}}));
  const fallback=await panel.next(v=>v.type==='query'&&v.result.saved);assert.equal(fallback.result.payload.inventory[0].item.amount,7);
  assert.equal((await post(`me/servers/${otherServer}/skin`,{png:'invalid',model:'slim'},player)).status,403);
  assert.equal((await post(`me/servers/${serverId}/skin`,{playerId:randomUUID(),png:'invalid',model:'slim'},player)).status,400);
  const header=Buffer.alloc(33);Buffer.from('89504e470d0a1a0a','hex').copy(header);header.write('IHDR',12);header.writeUInt32BE(64,16);header.writeUInt32BE(64,20);
  const changedSkin=await post(`me/servers/${serverId}/skin`,{png:header.toString('base64'),model:'slim'},player);assert.equal(changedSkin.status,200);assert.equal((await changedSkin.json()).payload.saved,true);
  assert.equal((await platform.db.latest(await platform.db.server(serverId),'skin',sessions.playerId))[0].payload.textureHash,'a'.repeat(64));
  const panelClosed=new Promise(resolve=>panel.socket.once('close',code=>resolve(code)));
  const logout = sample('auth.session.ended', { uuid: sessions.playerId, durationSeconds: 40 });
  await request('agents/telemetry/batches', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify({ schemaVersion: 1, messages: [logout] }) }, null);
  assert.equal((await request(`me/servers/${serverId}`, {}, player)).status, 401);
  assert.equal(await panelClosed,4401);
});
suite('data remains after reconnect and stale servers are marked offline', async () => {
  await platform.db.rows("UPDATE vos_servers SET last_seen=now()-interval '2 minutes' WHERE id=$1", [serverId]);
  const overview = await (await request(`servers/${serverId}/overview`)).json(); assert.equal(overview.server.online, false); assert.ok(overview.snapshots.length > 0);
  const rows = await platform.db.rows('SELECT tenant_id,server_id FROM vos_messages'); assert.ok(rows.every(row => row.tenant_id === tenantId && row.server_id === serverId));
});
suite('server Admin permissions can be granted and revoked without tenant escalation', async () => {
  const email = 'admin@example.test', pass = 'Initial-test-password-2026!';
  assert.equal((await post(`servers/${serverId}/members`, { email, password: pass })).status, 201);
  const admin = await login(email, pass);
  assert.equal((await request(`servers/${serverId}/overview`, {}, admin)).status, 200);
  assert.equal((await request(`servers/${otherServer}/overview`, {}, admin)).status, 404);
  assert.equal((await post(`servers/${serverId}/actions`, { operation: 'server.console', arguments: { command: 'say no' }, confirmed: true }, admin)).status, 403);
  const members = await (await request(`servers/${serverId}/members`)).json();
  assert.equal((await request(`servers/${serverId}/members/${members[0].id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await request(`servers/${serverId}/overview`, {}, admin)).status, 404);
});
suite('API restart preserves sessions and telemetry; password change revokes other sessions', async () => {
  const second = await login(config.ownerEmail, password);
  ws.terminate(); await platform.app.close();
  platform = await createPlatform(config); await platform.app.listen(0, '127.0.0.1'); url = await platform.app.getUrl();
  assert.equal((await request('auth/me')).status, 200);
  assert.ok((await (await request(`servers/${serverId}/overview`)).json()).snapshots.length > 0);
  const response = await post('auth/password', { currentPassword: password, newPassword: 'New-test-password-2026!' }); assert.equal(response.status, 200);
  assert.equal((await request('auth/me', {}, second)).status, 401);
  assert.equal((await request('auth/me')).status, 200);
  await login(config.ownerEmail, 'New-test-password-2026!');
});
suite('credential rotation invalidates the previous agent token', async () => {
  await post('auth/reauth', { password: 'New-test-password-2026!' });
  const rotated = await (await post(`servers/${serverId}/rotate-agent`)).json(); assert.ok(rotated.agentToken);
  assert.equal((await request('agents/heartbeat', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify(sample()) }, null)).status, 401);
  assert.equal((await request('agents/heartbeat', { method: 'POST', headers: { Authorization: 'Bearer ' + rotated.agentToken }, body: JSON.stringify(sample()) }, null)).status, 202);
});
