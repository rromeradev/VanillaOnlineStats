// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes, randomUUID, createHash } from 'node:crypto';
const serverId = process.argv[2];
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(serverId ?? '')) {
  console.error('Uso: node scripts/create-agent.mjs SERVER_ID_DO_PLUGIN');
  process.exit(1);
}
// Explicit local provisioning output, never called by the running API/plugin.
const token = randomBytes(32).toString('base64url');
console.log('Configure no ambiente do processo Paper (segredo; guarde fora do Git):');
console.log('VOS_AGENT_TOKEN=' + token);
console.log('\nConfigure no ambiente da API:');
console.log('VOS_AGENT_SERVER_ID=' + serverId);
console.log('VOS_TENANT_ID=' + randomUUID());
console.log('VOS_AGENT_TOKEN_SHA256=' + createHash('sha256').update(token).digest('hex'));
