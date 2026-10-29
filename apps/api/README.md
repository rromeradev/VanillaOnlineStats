# API 0.4.0

NestJS, PostgreSQL e WebSocket assinado. Consulte [instalação e cobertura](../../docs/platform/RELEASE-0.4.0.md).

Agentes usam Bearer. Portal usa cookie HttpOnly; mutações exigem Origin exato e X-CSRF-Token retornado no login ou GET /api/v1/auth/me. Tenant, papel e UUID Player são determinados pelo backend.

| Grupo /api/v1/ | Recursos |
|---|---|
| health, public/info, public/servers | Liveness, versão, servidores com login Player permitido |
| agents/heartbeat, agents/telemetry/batches | Ingestão autenticada e deduplicada |
| agents/control | Upgrade WebSocket de agente |
| auth/admin/login, auth/player/link, auth/me, auth/logout, auth/reauth, auth/password | Identidade e sessão |
| servers | Listar e vincular servidor |
| servers/:id/overview, metrics, players, worlds, events | Leituras Admin/Owner |
| servers/:id/catalog, queries, actions, actions/:actionId, audit | Consultas e controles auditados |
| servers/:id/settings, rotate-agent, members, members/:accountId | Configuração e acesso |
| servers/:id/export, alerts/:rule/ack, privacy-requests | Exportação, alertas e revisão de pedidos |
| me/servers/:id, queries, privacy-requests | Perfil, consultas próprias e pedido Player |

Histórico aceita hours=1|6|24|168; eventos aceitam type; exportação aceita format=json|csv. Consultas recebem {operation,arguments}; ações exigem também confirmed:true. Campos e riscos estão no catálogo. VOS_LEGACY_MODE=1 serve exclusivamente os testes antigos em memória.
