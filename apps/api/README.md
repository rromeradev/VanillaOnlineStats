# API VanillaOnlineStats

NestJS 12.3.2 / Node 24. Recebe heartbeat autenticado, vinculado a serverId/tenantId provisionados no ambiente. Validação JSON Schema, limites de corpo/taxa, proteção de timestamps e deduplicação limitada em memória.

Na raiz: `pnpm install --frozen-lockfile`, `pnpm --filter @vanillaonlinestats/api build` e `node --env-file=apps/api/.env apps/api/dist/main.js`. Leia [configuração completa](../../docs/development/heartbeat.md) para gerar a credencial e preencher o arquivo de ambiente.

`GET /api/v1/health` confirma liveness; `POST /api/v1/agents/heartbeat` exige token Bearer. Nenhum endpoint de leitura administrativa está implementado. Dados são temporários e não sobrevivem a reinício. PostgreSQL e onboarding do Owner são etapas futuras.
