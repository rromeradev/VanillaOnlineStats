# Roadmap

Base: [blueprint DRAFT-003](PROJECT_BLUEPRINT.md), seção 13.

- [x] Iniciar documentação, licença, contribuição, templates e CI documental.
- [x] F0: validar build da baseline Paper 26.3/Java 25, fixar dependências e definir contrato mínimo de heartbeat.
- [ ] F1: plugin Paper, integração AuthMe e heartbeat.
- [x] F1 parcial: identidade persistente, heartbeat básico, fila limitada, timeout e reconexão.
- [x] F2 parcial: API NestJS com credencial de agente e vínculo estático tenant/servidor; armazenamento temporário em memória.
- [ ] F2: API, PostgreSQL, vínculo do Owner e overview Admin.
- [ ] F3: autenticação web segura e estatísticas pessoais Player.
- [ ] F4: observabilidade Admin e primeiros controles tipados.
- [ ] F5: ampliar coletores e administração com budgets e auditoria.
- [ ] F6: compatibilidade, benchmarks e comunidade.
- [ ] SaaS: operação multi-tenant comercial, após maturidade self-hosted.

F1 ainda requer integração de eventos AuthMe e registro extensível de coletores. F2 requer PostgreSQL, vínculo do Owner, credenciais rotacionáveis por onboarding e painel. A API usa pnpm com lockfile; frontend ainda pendente.
