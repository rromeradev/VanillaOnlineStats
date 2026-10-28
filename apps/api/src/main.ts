// SPDX-License-Identifier: AGPL-3.0-only
import { configuration, createApplication } from './app';

async function main() {
  const config = configuration(process.env);
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const { app } = await createApplication(config);
  app.enableShutdownHooks();
  await app.listen(port, process.env.HOST ?? '127.0.0.1');
  console.log('VanillaOnlineStats API pronta; armazenamento temporario em memoria.');
}
main().catch(() => {
  // Do not echo environment values, request bodies, headers or error details.
  console.error('API nao iniciou. Verifique configuracao, dependencias e porta.');
  process.exitCode = 1;
});
