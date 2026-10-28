# VanillaOnlineStats

Observabilidade para servidores Minecraft Paper Survival, com integração obrigatória ao AuthMeReloaded e áreas Admin e Player.

**Estado: bootstrap F0/F1.** Plugin inicial para Paper 26.3 build 227, Java 25 e AuthMe 6.0.1 Paper, com comando de status. API, transporte e painéis estão pendentes.

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

Consulte o [setup local](docs/development/local-setup.md) para compilar e executar os testes. O projeto usa Gradle Wrapper, testes JUnit e validação JSON Schema. A CI compila o JAR e verifica contratos.

## Licença

Código original sob [AGPL-3.0-only](LICENSE). Contribuições usam DCO (commits com Signed-off-by). Dependências futuras preservam suas respectivas licenças.

Projeto independente, sem afiliação oficial com Mojang, Microsoft, PaperMC ou AuthMe.
