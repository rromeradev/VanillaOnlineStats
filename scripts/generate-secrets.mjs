// SPDX-License-Identifier: AGPL-3.0-only
// Optional interactive helper. Prints new secrets for the operator; creates no files.
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
const { privateKey } = generateKeyPairSync('ed25519');
const values = {
  VOS_TENANT_ID: randomUUID(),
  VOS_DATA_KEY: randomBytes(32).toString('base64'),
  VOS_SESSION_SECRET: randomBytes(32).toString('base64url'),
  VOS_CONTROL_PRIVATE_KEY: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
};
for (const [key, value] of Object.entries(values)) process.stdout.write(`${key}=${value}\n`);
