# VanillaOnlineStats

Observabilidade para servidores Minecraft Paper Survival, com integração obrigatória ao AuthMeReloaded e áreas Admin e Player.

**Estado: planejamento inicial (F0).** Este repositório contém a especificação e a estrutura documental. Ainda não há plugin executável, API, painel ou release disponível. Nenhuma combinação de versões foi validada.

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

Clone o repositório e leia a especificação antes de contribuir. Nesta etapa não há comandos de build ou instalação de aplicações. As versões propostas no blueprint precisam ser verificadas antes de configurar dependências e anunciar compatibilidade.

A CI inicial verifica os arquivos essenciais e a identidade da especificação. Builds, testes de contrato e integração serão acrescentados junto com os módulos executáveis.

## Licença

Código original sob [AGPL-3.0-only](LICENSE). Contribuições usam DCO (commits com Signed-off-by). Dependências futuras preservam suas respectivas licenças.

Projeto independente, sem afiliação oficial com Mojang, Microsoft, PaperMC ou AuthMe.
