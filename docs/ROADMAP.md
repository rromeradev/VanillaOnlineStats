# Roadmap

Base: [blueprint DRAFT-003](PROJECT_BLUEPRINT.md), seção 13.

- [x] Iniciar documentação, licença, contribuição, templates e CI documental.
- [x] F0: validar build da baseline Paper 26.3/Java 25, fixar dependências e definir contrato mínimo de heartbeat.
- [x] F1: plugin Paper, eventos de sessão AuthMe, registro de coletores, filas e heartbeat (release 0.3.0).
- [x] F1 parcial: identidade persistente, heartbeat básico, fila limitada, timeout e reconexão.
- [x] F2 parcial: API NestJS com credencial de agente e vínculo estático tenant/servidor; armazenamento temporário em memória.
- [ ] F2: API, PostgreSQL, vínculo do Owner e overview Admin.
- [ ] F3: autenticação web segura e estatísticas pessoais Player.
- [ ] F4: observabilidade Admin e primeiros controles tipados.
- [ ] F5: ampliar coletores e administração com budgets e auditoria.
- [ ] F6: compatibilidade, benchmarks e comunidade.
- [ ] SaaS: operação multi-tenant comercial, após maturidade self-hosted.

F2 requer PostgreSQL, vínculo do Owner, credenciais rotacionáveis por onboarding e painel. A API usa pnpm com lockfile; frontend ainda pendente. As partes do agente para consultas e ações avançadas foram antecipadas por instrução do mantenedor e testadas contra um simulador; veja a matriz de cobertura da release.

## Prioridade do mantenedor: plugin antes de API/frontend

Release do agente 0.3.0: registro de coletores, eventos AuthMe, consultas nativas, eventos de jogo, fila limitada, spool criptografado opcional, canal WSS assinado, auditoria e ações tipadas. Consulte docs/plugin/RELEASE-0.3.0.md para cobertura/limitações. Integrações opcionais não validadas não contam como suporte. A API 0.2 e o frontend permanecem no estágio anterior; os contratos novos são validados por um simulador de teste.
