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
const sessions = {}; let observedCalls=0,holdReads=false;const heldReplies=[];
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
suite('batches validate schema, block secret fields, persist projections and alerts', async () => {
  const perf = sample('server.performance.snapshot', { tps: [15,18,19], msptAverage: 65, heapUsed: 950, heapMax: 1000 });
  const player = sample('players.snapshot', { items: [{ uuid: randomUUID(), name: 'Player One', level: 6 }], online: 1, partial: false });
  const response = await request('agents/telemetry/batches', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify({ schemaVersion: 1, messages: [perf, player] }) }, null);
  assert.equal(response.status, 202); assert.equal((await response.json()).acceptedMessageIds.length, 2);
  const denied = await request('agents/telemetry/batches', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify({ schemaVersion: 1, messages: [sample('player.event', { password: 'DO_NOT_STORE' })] }) }, null); assert.equal(denied.status, 400); assert.ok(!(await denied.text()).includes('DO_NOT_STORE'));
  const overview = await (await request(`servers/${serverId}/overview`)).json(); assert.equal(overview.alerts.filter(v => v.active).length, 3);
  assert.equal((await (await request(`servers/${serverId}/players`)).json()).length, 1);
});
suite('stream is scoped and emits an invalidation after committed ingestion',async()=>{
  assert.equal((await request(`servers/${otherServer}/stream`)).status,404);
  assert.equal((await request(`servers/${serverId}/stream`,{},null)).status,401);
  const abort=new AbortController();const response=await request(`servers/${serverId}/stream`,{signal:abort.signal});assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/text\/event-stream/);const reader=response.body.getReader();
  try {
    assert.match(new TextDecoder().decode((await reader.read()).value),/event: update/);
    const message=sample('players.live.snapshot',{items:[{uuid:randomUUID(),name:'Stream Player',level:12}],partial:false});
    const ack=await request('agents/telemetry/batches',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({schemaVersion:1,messages:[message]})},null);assert.equal(ack.status,202);
    const next=await Promise.race([reader.read(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('No live update')),2000).unref())]);
    const text=new TextDecoder().decode(next.value);assert.match(text,/event: update/);assert.ok(!text.includes('Stream Player'));
    const players=await(await request(`servers/${serverId}/players`)).json();assert.ok(players.some(p=>p.payload.level===12));
    const events=await(await request(`servers/${serverId}/events?hours=1`)).json();assert.ok(events.every(e=>!e.type.endsWith('.snapshot')));
  }finally{abort.abort();await reader.cancel().catch(()=>{});}
});
suite('real WebSocket protocol signs exact scoped requests and matches results', async () => {
  ws = new WebSocket(url.replace(/^http/, 'ws') + '/api/v1/agents/control', { headers: { Authorization: 'Bearer ' + token } });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const publicKey = createPublicKey({ key: Buffer.from(platform.control.publicKey, 'base64'), type: 'spki', format: 'der' });
  ws.on('message', data => {
    const wrapper = JSON.parse(data.toString()), bytes = Buffer.from(wrapper.body, 'base64url'); assert.ok(verify(null, bytes, publicKey, Buffer.from(wrapper.signature, 'base64url')));
    const body = JSON.parse(bytes.toString());if(body.kind==='query')observedCalls++; assert.equal(body.serverId, serverId); assert.equal(body.tenantId, tenantId);
    if (body.operation === 'player.authme.login' && body.arguments.password !== 'Dummy-password-no-persistence') {
      ws.send(JSON.stringify({type:'control.result',actionId:body.actionId,auditCorrelationId:body.auditCorrelationId,state:'FAILED',payload:null})); return;
    }
    const payload = ['player.link.redeem','player.authme.login'].includes(body.operation) ? { playerId: sessions.playerId, name: 'Only Me' } : body.operation === 'player.snapshot' ? { uuid: body.arguments.playerId, name: 'Only Me', permissions: ['not-for-player'], address: '127.0.0.1' } : { ok: true };
    if (body.kind === 'action') assert.equal(body.actorRole, 'OWNER');
    if (body.operation === 'player.snapshot') { assert.equal(body.actorRole, 'PLAYER'); assert.equal(body.arguments.playerId, sessions.playerId); }
    const reply=()=>ws.send(JSON.stringify({ type: 'control.result', actionId: body.actionId, auditCorrelationId: body.auditCorrelationId, state: 'SUCCEEDED', payload }));if(holdReads&&body.kind==='query')heldReplies.push(reply);else reply();
  });
  ws.send(JSON.stringify({ type: 'agent.capabilities', payload: { schemaVersion: 1, playerQueries: true, authmePasswordLogin: true, collectors: ['players','performance'], queries: ['server.snapshot','player.snapshot'], privacy: { players: true }, unsupported: [] } }));
  for (let i=0; i<30; i++) { const server = await platform.db.server(serverId); if (server.capabilities.playerQueries) break; await new Promise(resolve => setTimeout(resolve, 20)); }
  const response = await post(`servers/${serverId}/queries`, { operation: 'server.snapshot', arguments: {} }); assert.equal(response.status, 200); assert.equal((await response.json()).state, 'SUCCEEDED');
  await post('auth/reauth', { password });
  const action = await post(`servers/${serverId}/actions`, { operation: 'server.console', arguments: { command: 'say hello' }, confirmed: true }); assert.equal((await action.json()).state, 'SUCCEEDED');
  assert.ok((await platform.db.rows('SELECT * FROM vos_audit WHERE server_id=$1', [serverId])).length > 0);
});
suite('automatic reads coalesce tabs, cannot execute actions and preserve scope',async()=>{
  const path=`servers/${serverId}/live?operation=server.snapshot&arguments=%7B%7D`;
  const beforeCalls=observedCalls,beforeActions=await platform.db.one('SELECT count(*)::int AS n FROM vos_actions');
  const values=await Promise.all(Array.from({length:32},()=>request(path)));
  assert.ok(values.every(v=>v.status===200));assert.equal(observedCalls-beforeCalls,1);
  assert.equal((await platform.db.one('SELECT count(*)::int AS n FROM vos_actions')).n,beforeActions.n);
  assert.equal((await request(`servers/${serverId}/live?operation=server.broadcast`)).status,400);
  assert.equal((await request(`servers/${otherServer}/live?operation=server.snapshot`)).status,404);
  assert.equal((await request(path,{},null)).status,401);
  assert.equal((await request(`servers/${serverId}/live?operation=server.snapshot&arguments=null`)).status,400);
});
suite('continuous reads reserve capacity for commands',async()=>{
  holdReads=true;const pending=Array.from({length:4},()=>post(`servers/${serverId}/queries`,{operation:'server.snapshot',arguments:{}}));
  try{
    const until=Date.now()+5000;while(heldReplies.length<4&&Date.now()<until)await new Promise(r=>setTimeout(r,10));assert.equal(heldReplies.length,4);
    assert.equal((await request(`servers/${serverId}/live?operation=worlds.list`)).status,429);
    const action=await post(`servers/${serverId}/actions`,{operation:'world.time',arguments:{worldId:randomUUID(),value:6000},confirmed:true});assert.equal(action.status,200);assert.equal((await action.json()).state,'SUCCEEDED');
  }finally{holdReads=false;for(const reply of heldReplies.splice(0))reply();await Promise.all(pending);}
});
suite('Offline Player password login remains scoped; no administrative access or different player target', async () => {
  sessions.playerId = randomUUID(); await platform.db.rows('UPDATE vos_servers SET player_login=true WHERE id=$1', [serverId]);
  assert.equal((await post('auth/player/login', {serverId,nickname:'OnlyMe',password:'wrong-password'}, null)).status, 401);
  const response = await post('auth/player/login', { serverId, nickname: 'OnlyMe', password: 'Dummy-password-no-persistence' }, null); assert.equal(response.status, 200);
  const identity = await response.json(); const player = { cookie: response.headers.get('set-cookie').split(';')[0], csrf: identity.csrf };
  assert.equal(identity.kind, 'PLAYER');
  assert.equal((await request(`servers/${otherServer}/stream`,{},player)).status,403);
  assert.equal((await platform.db.one("SELECT count(*)::int AS n FROM vos_actions WHERE operation='player.authme.login'")).n, 0);
  assert.equal((await request(`servers/${serverId}/overview`, {}, player)).status, 403);
  assert.equal((await post(`servers/${serverId}/actions`, { operation: 'world.time', arguments: {}, confirmed: true }, player)).status, 403);
  assert.equal((await request(`me/servers/${otherServer}`, {}, player)).status, 403);
  assert.equal((await post(`me/servers/${serverId}/queries`, { operation: 'player.snapshot', arguments: { playerId: randomUUID() } }, player)).status, 400);
  const own = await post(`me/servers/${serverId}/queries`, { operation: 'player.snapshot', arguments: {} }, player); assert.equal(own.status, 200); const data = await own.json(); assert.equal(data.payload.uuid, sessions.playerId); assert.equal(data.payload.address, undefined); assert.equal(data.payload.permissions, undefined);
  const live=await request(`me/servers/${serverId}/live?operation=player.snapshot`,{},player);
  assert.equal(live.status,200);const view=await live.json();assert.equal(view.payload.uuid,sessions.playerId);assert.equal(view.payload.address,undefined);assert.equal(view.payload.permissions,undefined);
  assert.equal((await request(`me/servers/${serverId}/live?operation=server.snapshot`,{},player)).status,403);
  assert.equal((await request(`me/servers/${serverId}/live?operation=player.snapshot&arguments=${encodeURIComponent(JSON.stringify({playerId:randomUUID()}))}`,{},player)).status,400);
  const disconnect=sample('auth.session.ended',{uuid:sessions.playerId,reason:'disconnect',durationSeconds:40});
  await request('agents/telemetry/batches',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({schemaVersion:1,messages:[disconnect]})},null);
  assert.equal((await request(`me/servers/${serverId}`,{},player)).status,200);
  const logout = sample('auth.session.ended', { uuid: sessions.playerId, durationSeconds: 40 });
  await request('agents/telemetry/batches', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify({ schemaVersion: 1, messages: [logout] }) }, null);
  assert.equal((await request(`me/servers/${serverId}`, {}, player)).status, 401);
  assert.equal((await request(`me/servers/${serverId}/live?operation=player.snapshot`,{},player)).status,401);
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
  assert.equal((await request(`servers/${serverId}/live?operation=server.snapshot`,{},admin)).status,200);
  const members = await (await request(`servers/${serverId}/members`)).json();
  assert.equal((await request(`servers/${serverId}/members/${members[0].id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await request(`servers/${serverId}/overview`, {}, admin)).status, 404);
  assert.equal((await request(`servers/${serverId}/live?operation=server.snapshot`,{},admin)).status,404);
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
