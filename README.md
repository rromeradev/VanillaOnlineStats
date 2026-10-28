# VanillaOnlineStats

Observabilidade para servidores Minecraft Paper Survival, com integração obrigatória ao AuthMeReloaded e áreas Admin e Player.

**Estado: release funcional do agente 0.3.0.** Plugin para Paper 26.3 build 227, Java 25 e AuthMe 6.0.1 Paper, com coletores, eventos, consultas, telemetria limitada, spool criptografado opcional e controle assinado. API atual recebe somente heartbeat; endpoints completos e painéis serão a próxima etapa.

Leia a [cobertura e instalação da release](docs/plugin/RELEASE-0.3.0.md). A release não implementa todas as integrações opcionais/futuras do blueprint; a matriz informa explicitamente as limitações.

## Projeto

Self-hosted primeiro, com isolamento por tenant e servidor desde o início. A evolução prevista inclui telemetria, estatísticas pessoais e administração remota exclusiva de Admin/Owner, autenticada e auditada. SaaS é uma etapa futura.

- [Especificação completa](docs/PROJECT_BLUEPRINT.md)
- [Roadmap](docs/ROADMAP.md)
- [Contribuição e DCO](CONTRIBUTING.md)
- [Segurança](SECURITY.md)

## Estrutura

| Diretório | Responsabilidade planejada |
|---|---|
| plugin/ | Plugin Paper em Java, com AuthMe |
| apps/api/ | Backend NestJS |
| apps/web/ | Portal Angular |
| packages/api-contracts/ | Contratos versionados |
| packages/shared-types/ | Tipos compartilhados |
| packages/design-tokens/ | Tokens de interface |
| infrastructure/ | Implantação self-hosted |
| docs/ | Requisitos, roadmap e decisões |

## Desenvolvimento

Consulte o [setup local](docs/development/local-setup.md) e o [guia de heartbeat](docs/development/heartbeat.md). O projeto usa Gradle Wrapper, pnpm, JUnit e JSON Schema. A CI compila, verifica autorização/contratos e testa queda/reconexão da API usando um servidor Paper real.

## Licença

Código original sob [AGPL-3.0-only](LICENSE). Contribuições usam DCO (commits com Signed-off-by). Dependências futuras preservam suas respectivas licenças.

Projeto independente, sem afiliação oficial com Mojang, Microsoft, PaperMC ou AuthMe.
