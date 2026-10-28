# ADR-015: release do plugin antes da expansão API/frontend

Aceito em 28/10/2026 por instrução explícita do mantenedor nesta sessão.

Priorizar o agente Paper: coletores, observação de eventos, consultas, fila limitada, recuperação, políticas de dados e o lado agente do controle remoto. A implementação de PostgreSQL, onboarding do Owner, login web e UI é posterior. As fronteiras novas são testadas por um simulador local; isso não implementa uma API de produção nem autoriza claims vindos de um navegador.

O plugin somente aceita controles assinados por uma chave Ed25519 fixada localmente, em canal WSS autenticado, com escopo e auditoria persistente. Nenhum segredo AuthMe é lido para esse fluxo. Senha web permanece indisponível; o vínculo usa código in-game após autenticação real, incluindo a política AuthMe aplicada no jogo.

Release 0.3.0 é uma release funcional do agente, não uma declaração de que todas as integrações e funcionalidades FUTURO do documento estão prontas. A matriz docs/plugin/RELEASE-0.3.0.md é obrigatória nas notas. Integrações opcionais sem testes de artefatos não são anunciadas como suportadas. Host/rollback/Folia e recursos que dependem de infraestrutura externa permanecem indisponíveis.

Dados privados são opt-in; raw NBT e persistent-data-containers de itens não são serializados, pois podem conter segredos de outros plugins. Itens expõem tipo, quantidade, dano e encantamentos. O spool exige chave de armazenamento independente e é limitado em bytes e tempo. Sem ela, a fila é volátil e os descartes são expostos.

As consultas de gamerules usam o registro público. Regras presentes no registro mas não habilitadas pelo conjunto de features do mundo são reportadas em unavailableGamerules, sem invalidar toda a consulta.
