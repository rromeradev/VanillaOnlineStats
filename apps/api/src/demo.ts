// SPDX-License-Identifier: AGPL-3.0-only
// Explicit demo fixtures. Never loaded unless VOS_DEMO=1, never represent real telemetry.
import { randomUUID } from 'node:crypto';
import { Database } from './database';
import { sha } from './security';
export async function seedDemo(db: Database, tenant: string) {
  if (await db.one('SELECT 1 FROM vos_messages LIMIT 1')) return;
  const serverId = randomUUID();
  await db.rows('INSERT INTO vos_servers(id,tenant_id,name,agent_hash,capabilities) VALUES($1,$2,$3,$4,$5)', [serverId, tenant, 'Aurora · Survival (demo)', sha(randomUUID()), JSON.stringify({ collectors: ['performance','server','worlds','players'], playerQueries: true, privacy: { players: true, positions: false, inventories: false, addresses: false, seeds: false } })]);
  const server = await db.server(serverId), now = Date.now(), worldId = randomUUID(), netherId = randomUUID();
  const message = (type: string, payload: any, at = now) => ({ schemaVersion: 1, messageId: randomUUID(), serverId, type, source: 'paper-api', occurredAt: new Date(at).toISOString(), sentAt: new Date(at).toISOString(), payload });
  const points = Array.from({length: 90}, (_, i) => { const tps = Math.min(20, 19.8 + Math.sin(i / 5) * .12 - (i > 30 && i < 38 ? .8 : 0)); return message('server.performance.snapshot', { tps: [tps,19.8,19.9], msptAverage: 20 + Math.sin(i / 8) * 6, msptP95: 38.2, msptP99: 44.1, heapUsed: (3.2 + Math.sin(i / 11) * .35) * 1024 ** 3, heapMax: 12 * 1024 ** 3, threads: 47, gc: [], uptimeSeconds: 32905, processCpuLoad: .13 }, now - (89-i) * 60_000); });
  await db.ingest(server, points);
  const players = [{uuid:randomUUID(),name:'Luna',level:28,ping:24,gamemode:'SURVIVAL',health:20,food:19},{uuid:randomUUID(),name:'Bento',level:17,ping:38,gamemode:'SURVIVAL',health:18,food:20},{uuid:randomUUID(),name:'Nina',level:34,ping:19,gamemode:'SURVIVAL',health:20,food:20}];
  await db.ingest(server, [
    message('server.heartbeat',{pluginVersion:'0.3.1',paperVersion:'26.3-227',minecraftVersion:'26.3',authMeVersion:'6.0.1-b2770',playersOnline:3,uptimeSeconds:32905}),
    message('server.metadata.snapshot',{paperVersion:'26.3-227',maxPlayers:32,onlineMode:true,whitelist:true,plugins:[{name:'AuthMe',version:'6.0.1-b2770',enabled:true}]}),
    message('worlds.snapshot',{items:[{worldId,name:'Mundo principal',environment:'NORMAL',difficulty:'NORMAL',loadedChunks:128,entities:241,players:3,time:6500,storm:false,thunder:false,gamerules:{}},{worldId:netherId,name:'Nether',environment:'NETHER',difficulty:'NORMAL',loadedChunks:26,entities:57,players:0,time:18000,storm:false,thunder:false,gamerules:{}}],partial:false}),
    message('players.snapshot',{items:players,online:3,partial:false}),
    message('auth.session.started',{uuid:players[0].uuid,name:'Luna'},now-420_000),
    message('player.PlayerAdvancementDoneEvent',{uuid:players[2].uuid,name:'Nina',advancement:'minecraft:story/mine_diamond'},now-240_000),
    message('world.WorldSaveEvent',{worldId},now-120_000),
    message('player.PlayerLevelChangeEvent',{uuid:players[1].uuid,name:'Bento',NewLevel:17,OldLevel:16},now-55_000),
  ]);
}
