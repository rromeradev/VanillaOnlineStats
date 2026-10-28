# Changelog

## Não lançado

## 0.3.0 — 2026-10-28

- Release funcional do plugin: coletores de servidor, JVM/performance, mundos e jogadores; consultas limitadas de chunks, entidades, inventários, estatísticas e advancements.
- Eventos AuthMe e gameplay, políticas de privacidade e código in-game de vinculação.
- Telemetria em lotes, fila por bytes/mensagens e spool AES-GCM opcional.
- Canal WSS com assinaturas Ed25519, escopo tenant/servidor, TTL e auditoria/replay persistentes.
- Ações tipadas de moderação, jogador e mundo; console opt-in com restrições.
- Migração de configuração v1 → v2, comandos de diagnóstico e testes de protocolo no Paper real.
- Integrações opcionais/futuras, limitações e requisitos da API registrados na matriz de cobertura.

## 0.2.0-SNAPSHOT

- Heartbeat básico com identidade persistente, fila limitada, timeout, backoff e status local.
- API NestJS autenticada por agente, vinculada ao tenant/servidor e validada pelo contrato compartilhado.
- Testes de contrato Java/TypeScript e envio real Paper → API com queda e reconexão.
- Guia de provisionamento manual self-hosted; API guarda estado apenas em memória nesta etapa.

- Baseline Paper 26.3 build 227 / Java 25 / AuthMe 6.0.1-b2770.
- Plugin inicial, comando /vos status e dependência obrigatória AuthMe.
- Gradle Wrapper 9.2.1, locks, checksums, JUnit e CI de build.
- Contrato heartbeat v1, testes negativos e script de smoke test isolado.
- Blueprint atualizado a DRAFT-003 por decisão do mantenedor.

- Estrutura documental inicial do monorepo.
- Blueprint DRAFT-002 preservado em docs/PROJECT_BLUEPRINT.md.
- Licença AGPL-3.0-only, DCO e orientações de comunidade.
- Templates de colaboração e CI documental.
