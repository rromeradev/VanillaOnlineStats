// SPDX-License-Identifier: AGPL-3.0-only
import { createPrivateKey, generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, linkSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

export function runtimeEnvironment(input, directory) {
  const env = { ...input };
  if (!env.APP_ORIGIN?.trim() || !env.VOS_ADMIN_EMAIL?.trim()) throw new Error('Configure APP_ORIGIN e VOS_ADMIN_EMAIL no Coolify.');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'identity.json');
  let saved;
  try { saved = JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Identidade persistente invalida; restaure o backup.');
    const fresh = {
      VOS_TENANT_ID: env.VOS_TENANT_ID?.trim() || randomUUID(),
      VOS_CONTROL_PRIVATE_KEY: env.VOS_CONTROL_PRIVATE_KEY?.trim() || generateKeyPairSync('ed25519').privateKey.export({ type:'pkcs8', format:'der' }).toString('base64'),
    };
    validateIdentity(fresh);
    const temporary = join(directory, 'identity-' + randomUUID() + '.tmp');
    try {
      writeFileSync(temporary, JSON.stringify(fresh), { flag:'wx', mode:0o600 });
      try { linkSync(temporary, path); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    } finally { unlinkSync(temporary); }
    saved = JSON.parse(readFileSync(path, 'utf8'));
  }
  validateIdentity(saved);
  for (const key of ['VOS_TENANT_ID','VOS_CONTROL_PRIVATE_KEY']) {
    if (env[key]?.trim() && env[key].trim() !== saved[key]) throw new Error('Identidade do ambiente difere do volume; preserve tenant e chave existentes.');
    env[key] = saved[key];
  }
  return env;
}
function validateIdentity(identity) {
  if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(identity?.VOS_TENANT_ID ?? '')) throw new Error('Tenant persistente invalido.');
  const key = createPrivateKey({ key:Buffer.from(identity.VOS_CONTROL_PRIVATE_KEY,'base64'), type:'pkcs8', format:'der' });
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Chave persistente invalida.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const env = runtimeEnvironment(process.env, process.env.VOS_STATE_DIR ?? '/app/state');
    const child = spawn(process.execPath, ['apps/api/dist/main.js'], { env, stdio:'inherit' });
    for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => child.kill(signal));
    child.on('error', () => { console.error('Nao foi possivel iniciar a API.'); process.exitCode = 1; });
    child.on('exit', code => { process.exitCode = code ?? 1; });
  } catch (error) {
    console.error('Inicializacao recusada. Confira variaveis manuais e integridade do volume identity.');
    process.exitCode = 1;
  }
}
