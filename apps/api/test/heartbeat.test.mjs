// SPDX-License-Identifier: AGPL-3.0-only
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createApplication, configuration } from '../dist/app.js';
import { readFileSync } from 'node:fs';

const token = 'a'.repeat(43), serverId = randomUUID(), tenantId = randomUUID();
let app, snapshot, url, now = Date.now();
before(async () => {
  ({ app, snapshot } = await createApplication({ serverId, tenantId,
    tokenSha256: createHash('sha256').update(token).digest('hex') }, () => now));
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
});
after(async () => { await app?.close(); });
const sample = () => ({ schemaVersion: 1, messageId: randomUUID(), serverId,
  sentAt: new Date(now).toISOString(), occurredAt: new Date(now).toISOString(),
  type: 'server.heartbeat', source: 'paper-api', payload: {
    pluginVersion: '0.2.0-SNAPSHOT', minecraftVersion: '26.3', paperVersion: '26.3-227', authMeVersion: '6.0.1-b2770',
    uptimeSeconds: 1, playersOnline: 0 } });
const post = (body, credential = token) => fetch(url + '/api/v1/agents/heartbeat', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + credential },
  body: JSON.stringify(body) });

test('agent binding, tenant isolation, strict schema and sanitized errors', async () => {
  assert.equal((await fetch(url + '/api/v1/health')).status, 200);
  assert.equal((await post(sample(), 'b'.repeat(43))).status, 401);
  assert.equal(snapshot(), undefined);
  assert.equal((await post({ ...sample(), serverId: randomUUID() })).status, 403);
  assert.equal((await post({ ...sample(), tenantId: randomUUID() })).status, 400);
  assert.equal((await post({ ...sample(), schemaVersion: 2 })).status, 400);
  const secret = 'never-echo-this-password';
  const invalid = await post({ ...sample(), payload: { ...sample().payload, password: secret } });
  assert.equal(invalid.status, 400);
  assert.ok(!(await invalid.text()).includes(secret));
  const malformed = await fetch(url + '/api/v1/agents/heartbeat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"' + secret });
  assert.equal(malformed.status, 400);
  assert.ok(!(await malformed.text()).includes(secret));
  const large = await post({ huge: 'x'.repeat(9000) });
  assert.equal(large.status, 413);
  assert.equal(snapshot(), undefined);
});

test('authenticated ingestion, exact idempotency, no cross-server reads', async () => {
  const message = sample();
  const result = await post(message);
  assert.equal(result.status, 202);
  const ack = await result.json();
  assert.equal(ack.messageId, message.messageId);
  assert.equal(ack.duplicate, false);
  assert.equal(snapshot().tenantId, tenantId);
  assert.deepEqual(snapshot().heartbeat, message);
  const receivedAt = snapshot().receivedAt;
  now += 1000;
  const retry = await post(message);
  assert.deepEqual(await retry.json(), { ...ack, duplicate: true });
  assert.equal(snapshot().receivedAt, receivedAt);
  assert.equal((await post({ ...message, payload: { ...message.payload, playersOnline: 1 } })).status, 409);
  assert.equal((await fetch(url + '/api/v1/servers/' + randomUUID())).status, 404);
});

test('late observation cannot replace latest; stale/future timestamps rejected', async () => {
  now += 1000;
  const fresh = sample();
  await post(fresh);
  const late = sample();
  late.occurredAt = new Date(now - 10_000).toISOString();
  assert.equal((await post(late)).status, 202);
  assert.equal(snapshot().heartbeat.messageId, fresh.messageId);
  assert.equal((await post({ ...sample(), sentAt: new Date(now - 121_000).toISOString() })).status, 400);
  assert.equal((await post({ ...sample(), sentAt: new Date(now + 121_000).toISOString() })).status, 400);
  assert.equal((await post({ ...sample(), occurredAt: new Date(now + 6_000).toISOString() })).status, 400);
});

test('agent rate limiting resets after window', async () => {
  now += 61_000;
  for (let i = 0; i < 30; i++) assert.equal((await post(sample())).status, 202);
  assert.equal((await post(sample())).status, 429);
  now += 61_000;
  assert.equal((await post(sample())).status, 202);
});

test('envelope serialized by the real Java producer satisfies the API contract', async () => {
  const fixture = JSON.parse(readFileSync('../../plugin/build/heartbeat-java.json', 'utf8'));
  fixture.serverId = serverId;
  fixture.sentAt = fixture.occurredAt = new Date(now).toISOString();
  assert.equal((await post(fixture)).status, 202);
  assert.deepEqual(snapshot().heartbeat, fixture);
});

test('configuration fails closed without printing values', () => {
  assert.throws(() => configuration({ VOS_AGENT_TOKEN: token }), error => !error.message.includes(token));
});
