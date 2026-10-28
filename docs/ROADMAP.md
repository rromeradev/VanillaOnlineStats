# Roadmap

Base: [blueprint DRAFT-003](PROJECT_BLUEPRINT.md), seção 13.

- [x] Iniciar documentação, licença, contribuição, templates e CI documental.
- [x] F0: validar build da baseline Paper 26.3/Java 25, fixar dependências e definir contrato mínimo de heartbeat.
- [ ] F1: plugin Paper, integração AuthMe e heartbeat.
- [ ] F2: API, PostgreSQL, vínculo do Owner e overview Admin.
- [ ] F3: autenticação web segura e estatísticas pessoais Player.
- [ ] F4: observabilidade Admin e primeiros controles tipados.
- [ ] F5: ampliar coletores e administração com budgets e auditoria.
- [ ] F6: compatibilidade, benchmarks e comunidade.
- [ ] SaaS: operação multi-tenant comercial, após maturidade self-hosted.

Bootstrap Java e contrato inicial presentes. F1 segue pendente: integração funcional de eventos, coletores, filas e transporte de heartbeat. Backend e frontend ainda não existem, portanto gates pnpm se aplicam quando criados.
