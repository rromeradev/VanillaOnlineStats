// SPDX-License-Identifier: AGPL-3.0-only
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const arg = key => process.argv[process.argv.indexOf(key) + 1];
const file = process.argv.includes('--output') ? arg('--output') : '.env';
const email = process.argv.includes('--email') ? arg('--email') : 'owner@example.com';
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid email');
const { privateKey } = generateKeyPairSync('ed25519');
const databasePassword = randomBytes(24).toString('base64url');
const config = {
  POSTGRES_PASSWORD: databasePassword,
  DATABASE_URL: process.env.SETUP_DATABASE_URL ?? `postgresql://vos:${databasePassword}@127.0.0.1:5432/vanilla_stats`,
  APP_ORIGIN: process.env.SETUP_APP_ORIGIN ?? 'http://127.0.0.1:3000', HOST: '127.0.0.1', PORT: process.env.SETUP_PORT ?? '3000',
  VOS_TENANT_ID: randomUUID(), VOS_ADMIN_EMAIL: email, VOS_ADMIN_PASSWORD: process.env.SETUP_ADMIN_PASSWORD ?? randomBytes(24).toString('base64url'),
  VOS_DATA_KEY: randomBytes(32).toString('base64'), VOS_SESSION_SECRET: randomBytes(32).toString('base64url'),
  VOS_CONTROL_PRIVATE_KEY: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
};
writeFileSync(file, '# Arquivo privado. Preserve as chaves e mantenha fora do Git.\n' + Object.entries(config).map(([key,value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
console.log('Configuração criada em ' + resolve(file) + '. Ajuste DATABASE_URL e APP_ORIGIN; as credenciais iniciais estão no arquivo.');
