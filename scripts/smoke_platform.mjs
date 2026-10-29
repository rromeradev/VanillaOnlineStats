// SPDX-License-Identifier: AGPL-3.0-only
// Disposable real Paper -> NestJS -> PostgreSQL -> signed control round trip.
import { createRequire } from 'node:module';
import { randomBytes, randomUUID, generateKeyPairSync } from 'node:crypto';
import { mkdir, writeFile, copyFile, cp } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Pool } = require('pg'), { createPlatform } = require('./dist/platform.js'), { sha } = require('./dist/security.js');
const argv = process.argv.slice(2), arg = name => argv[argv.indexOf('--' + name) + 1];
for (const name of ['java','paper','authme','plugin','output']) if (!argv.includes('--' + name)) throw new Error('Missing --' + name);
if (!argv.includes('--accept-eula') || !process.env.TEST_DATABASE_URL) throw new Error('Requires --accept-eula and TEST_DATABASE_URL');
const root = resolve(arg('output')), schema = 'vos_smoke_' + randomBytes(8).toString('hex');
await mkdir(root); await mkdir(resolve(root, 'plugins/VanillaOnlineStats'), { recursive: true });
const dbUrl = new URL(process.env.TEST_DATABASE_URL), pool = new Pool({ connectionString: dbUrl.toString() });
await pool.query('CREATE SCHEMA ' + schema); dbUrl.searchParams.set('options', '-c search_path=' + schema);
const tenantId = randomUUID(), serverId = randomUUID(), token = randomBytes(32).toString('base64url');
const keys = generateKeyPairSync('ed25519'), password = randomBytes(24).toString('base64url');
let platform, paper, output; const findings = [];
try {
  platform = await createPlatform({ databaseUrl: dbUrl.toString(), dataKey: randomBytes(32).toString('base64'), sessionSecret: randomBytes(32).toString('base64url'), privateKey: keys.privateKey.export({ format:'der', type:'pkcs8' }).toString('base64'), origin:'http://127.0.0.1:3199', tenantId, ownerEmail:'smoke@example.test', ownerPassword:password, initialServerId:serverId, initialAgentHash:sha(token) });
  const httpResults = new Map();
  platform.app.use((req,res,next) => { res.on('finish',()=>{ const label = req.path + ' ' + res.statusCode; httpResults.set(label,(httpResults.get(label)??0)+1); }); next(); });
  await platform.app.listen(0, '127.0.0.1'); const url = await platform.app.getUrl();
  await copyFile(resolve(arg('paper')), resolve(root,'paper.jar'));
  await copyFile(resolve(arg('authme')), resolve(root,'plugins/AuthMe.jar'));
  await copyFile(resolve(arg('plugin')), resolve(root,'plugins/VanillaOnlineStats.jar'));
  if (argv.includes('--cache')) for (const dir of ['libraries','cache']) await cp(resolve(arg('cache'),dir), resolve(root,dir), {recursive:true});
  const playerId = randomUUID(), playerPassword = randomBytes(20).toString('base64url'), salt = '0123456789abcdef';
  await mkdir(resolve(root,'plugins/AuthMe'),{recursive:true});
  await copyFile(resolve(arg('cache'),'plugins/AuthMe/authme.db'),resolve(root,'plugins/AuthMe/authme.db'));
  const fixtureDb = new DatabaseSync(resolve(root,'plugins/AuthMe/authme.db'));
  fixtureDb.prepare('INSERT INTO authme(username,realname,password,totp) VALUES(?,?,?,?)').run('offlinetest','OfflineTest','$SHA$'+salt+'$'+sha(sha(playerPassword)+salt), null);
  fixtureDb.prepare('INSERT INTO authme(username,realname,password,totp) VALUES(?,?,?,?)').run('totptest','TotpTest','$SHA$'+salt+'$'+sha(sha(playerPassword)+salt),'ABCDEFGHIJKLMNOP');
  fixtureDb.close();
  await writeFile(resolve(root,'usercache.json'),JSON.stringify([{name:'OfflineTest',uuid:playerId,expiresOn:'2030-01-01 00:00:00 +0000'}]));
  await writeFile(resolve(root,'eula.txt'), 'eula=true\n');
  await writeFile(resolve(root,'server.properties'), 'server-ip=127.0.0.1\nserver-port=25586\nview-distance=2\nsimulation-distance=2\nlevel-type=minecraft:flat\ngenerate-structures=false\n');
  await writeFile(resolve(root,'plugins/VanillaOnlineStats/server-id.txt'),serverId+'\n');
  await writeFile(resolve(root,'plugins/VanillaOnlineStats/config.yml'),`schema-version: 2
heartbeat:
  enabled: true
  endpoint: ${url}/api/v1/agents/heartbeat
  allow-loopback-http: true
  interval-seconds: 5
telemetry:
  endpoint: ${url}/api/v1/agents/telemetry/batches
collectors:
  period-seconds: 5
limits:
  collector-budget-micros: 20000
control:
  endpoint: ${url.replace(/^http/,'ws')}/api/v1/agents/control
  tenant-id: ${tenantId}
  public-key: ${platform.control.publicKey}
  writes-enabled: true
  allowed-operations: [world.time]
`);
  output = createWriteStream(resolve(root,'console.log'));
  paper = spawn(resolve(arg('java')), ['-Xms256M','-Xmx768M','-XX:ActiveProcessorCount=2','-jar','paper.jar','--nogui'], {cwd:root, env:{...process.env,VOS_AGENT_TOKEN:token},stdio:['pipe','pipe','pipe']});
  paper.stdout.pipe(output); paper.stderr.pipe(output); let done = false;
  paper.stdout.on('data', data => { if (data.toString().includes('Done (')) done = true; });
  const deadline = Date.now()+180_000;
  while (Date.now()<deadline) { if (paper.exitCode !== null) throw new Error('Paper exited; inspect console.log'); if (done && platform.control.connected(serverId) && await platform.db.one("SELECT 1 FROM vos_messages WHERE server_id=$1 AND type='server.performance.snapshot' LIMIT 1", [serverId])) break; await new Promise(r=>setTimeout(r,1000)); }
  console.log('HTTP diagnostics:',Object.fromEntries(httpResults));
  assert.ok(done && platform.control.connected(serverId),'Paper and control ready');
  const call = (path, body, cookie, csrf) => fetch(url+'/api/v1/'+path,{method:body?'POST':'GET',headers:{Origin:'http://127.0.0.1:3199','Content-Type':'application/json',...(cookie?{Cookie:cookie,'X-CSRF-Token':csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const login = await call('auth/admin/login',{email:'smoke@example.test',password}); assert.equal(login.status,200);
  const cookie = login.headers.get('set-cookie').split(';')[0], identity = await login.json();
  const invoke = async (path, body) => { const response = await call('servers/'+serverId+'/'+path,body,cookie,identity.csrf); assert.equal(response.status,200); return response.json(); };
  const overview = await invoke('overview'); assert.ok(overview.server.online); assert.ok(overview.snapshots.some(v=>v.id==='server.performance.snapshot')); findings.push('Real heartbeat, telemetry and encrypted PostgreSQL projections accepted.');
  const worlds = await invoke('queries',{operation:'worlds.list',arguments:{}}); assert.equal(worlds.state,'SUCCEEDED'); assert.ok(worlds.payload.items.length>0);
  const worldId = worlds.payload.items[0].worldId;
  const action = await invoke('actions',{operation:'world.time',arguments:{worldId,value:6000},confirmed:true}); assert.equal(action.state,'SUCCEEDED');
  const world = await invoke('queries',{operation:'world.snapshot',arguments:{worldId}}); assert.equal(world.state,'SUCCEEDED'); assert.ok(world.payload.time>=6000 && world.payload.time<6200); findings.push('Signed API query and world.time mutation completed by real Paper; result verified by readback.');
  const persisted = await platform.db.one('SELECT count(*)::int AS n FROM vos_audit WHERE server_id=$1',[serverId]); assert.ok(persisted.n>=6); findings.push('Scoped execution and audit history persisted.');
  await platform.db.rows('UPDATE vos_servers SET player_login=true WHERE id=$1',[serverId]);
  assert.equal((await call('auth/player/login',{serverId,nickname:'OfflineTest',password:'wrong-password'})).status,401);
  assert.equal((await call('auth/player/login',{serverId,nickname:'TotpTest',password:playerPassword})).status,401);
  const offline = await call('auth/player/login',{serverId,nickname:'OfflineTest',password:playerPassword}); assert.equal(offline.status,200); assert.equal((await offline.json()).kind,'PLAYER');
  const session = await platform.db.one("SELECT actor_id FROM vos_sessions WHERE kind='PLAYER'"); assert.equal(session.actor_id,playerId);
  assert.equal((await platform.db.one("SELECT count(*)::int AS n FROM vos_actions WHERE operation='player.authme.login'")).n,0);
  findings.push('Offline AuthMe password login accepted, wrong password/2FA refused, Paper cached UUID matched; login credentials not persisted.');
  await writeFile(resolve(root,'results.txt'),findings.join('\n')+'\n'); console.log(findings.join('\n'));
} finally {
  if (paper && paper.exitCode === null) { paper.stdin.write('stop\n'); await Promise.race([new Promise(r=>paper.once('exit',r)),new Promise(r=>setTimeout(r,20000))]); if(paper.exitCode===null) paper.kill(); }
  output?.end(); await platform?.app.close();
  if (/^vos_smoke_[a-f0-9]+$/.test(schema)) await pool.query('DROP SCHEMA '+schema+' CASCADE'); await pool.end();
}
