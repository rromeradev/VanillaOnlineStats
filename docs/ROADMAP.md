# Roadmap

Base: [blueprint DRAFT-003](PROJECT_BLUEPRINT.md), seção 13.

- [x] Iniciar documentação, licença, contribuição, templates e CI documental.
- [x] F0: validar build da baseline Paper 26.3/Java 25, fixar dependências e definir contrato mínimo de heartbeat.
- [x] F1: plugin Paper, eventos de sessão AuthMe, registro de coletores, filas e heartbeat (release 0.3.0).
- [x] F1 parcial: identidade persistente, heartbeat básico, fila limitada, timeout e reconexão.
- [x] F2 parcial: API NestJS com credencial de agente e vínculo estático tenant/servidor; armazenamento temporário em memória.
- [x] F2: API, PostgreSQL, vínculo do Owner e overview Admin (0.4.0).
- [x] F3: autenticação web e estatísticas pessoais Player (0.4.0; MFA/reset por e-mail futuros).
- [x] F4: observabilidade Admin e controles tipados (0.4.0).
- [ ] F5: ampliar coletores e administração com budgets e auditoria.
- [ ] F6: compatibilidade, benchmarks e comunidade.
- [ ] SaaS: operação multi-tenant comercial, após maturidade self-hosted.

F2–F4 estão disponíveis na plataforma 0.4.0. Testes usam PostgreSQL e Paper reais, além das verificações de protocolo e autorização. Consulte a matriz de cobertura da release para os limites atuais.

## Prioridade do mantenedor: plugin antes de API/frontend

Release do agente 0.3.0: registro de coletores, eventos AuthMe, consultas nativas, eventos de jogo, fila limitada, spool criptografado opcional, canal WSS assinado, auditoria e ações tipadas. Consulte docs/plugin/RELEASE-0.3.0.md para cobertura/limitações. Integrações opcionais não validadas não contam como suporte. A plataforma 0.4.0 implementa esses contratos no backend e no portal; o simulador permanece como teste de regressão do agente.


## Plataforma 0.4.0

API PostgreSQL e portal Angular implementados: [cobertura e limitações atuais](platform/RELEASE-0.4.0.md). Os parágrafos anteriores registram a sequência histórica das releases. F5/F6 e SaaS permanecem em evolução; a release atual cobre as capacidades existentes do agente.
