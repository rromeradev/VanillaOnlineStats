// SPDX-License-Identifier: AGPL-3.0-only
import { configuration, createApplication } from './app';
import { platformConfiguration } from './platform-config';
import { createPlatform } from './platform';

async function main() {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const { app } = process.env.VOS_LEGACY_MODE === '1'
    ? await createApplication(configuration(process.env))
    : await createPlatform(platformConfiguration(process.env));
  app.enableShutdownHooks();
  await app.listen(port, process.env.HOST ?? '127.0.0.1');
  console.log('VanillaOnlineStats API pronta.');
}
main().catch(() => {
  // Do not echo environment values, request bodies, headers or error details.
  console.error('API nao iniciou. Verifique configuracao, dependencias e porta.');
  process.exit(1);
});
