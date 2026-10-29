# VanillaOnlineStats

Painel web e API para servidores Minecraft Paper, com integração AuthMe e áreas Owner/Admin e Player. O painel oferece temas claro, escuro e automático pelo sistema.

**Versões:** plataforma 0.6.0, plugin 0.5.0. **Baseline:** Paper 26.3 build 227, Java 25 e AuthMe 6.0.1-b2770.

## Deploy no Coolify 4.5.3

1. Use **Git Repository (with GitHub App)**, este repositório e branch `main`.
2. Selecione **Docker Compose**, Base Directory `/` e arquivo `/docker-compose.yml`.
3. O Coolify gera os segredos `SERVICE_*`. Preencha os campos manuais vazios: `APP_ORIGIN` e `VOS_ADMIN_EMAIL`.
4. Configure o domínio no serviço `portal`, porta interna 3000, e faça Deploy.

O Compose inclui **PostgreSQL, API e painel**, sem dependências externas para a instalação padrão. UUID e chave Ed25519 são gerados no primeiro início e preservados em volume. Veja [variáveis de exemplo](.env.example) e o [guia completo](docs/DEPLOYMENT.md). Não é necessário criar arquivo `.env` local.

## Estrutura

| Caminho | Conteúdo |
|---|---|
| `docker-compose.yml` | Stack completo para Coolify |
| `Dockerfile` | Imagem da API e do painel |
| `apps/web` | Painel Angular |
| `apps/api` | API NestJS e migração PostgreSQL |
| `plugin` | Agente Paper/AuthMe em Java |
| `packages/api-contracts` | Contratos JSON Schema compartilhados |
| `.env.example` | Campos manuais e variáveis automáticas |
| `scripts` | Configuração, testes de integração e empacotamento |
| `docs` | Documentação consolidada |

## Documentação

- [Deploy e variáveis](docs/DEPLOYMENT.md)
- [Desenvolvimento e testes](docs/DEVELOPMENT.md)
- [Instalação e cobertura do plugin](docs/PLUGIN.md)
- [Catálogo dos dados](docs/DATA-CATALOG.md)
- [Arquitetura e limites atuais](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md) e [especificação original](docs/SPECIFICATION.md)
- [Contribuição](CONTRIBUTING.md), [segurança](SECURITY.md) e [changelog](CHANGELOG.md)

## Licença

[AGPL-3.0-only](LICENSE), com DCO para contribuições. Dependências mantêm suas licenças, descritas em [avisos de terceiros](THIRD_PARTY_NOTICES.md).

Projeto independente, sem afiliação oficial com Mojang, Microsoft, PaperMC ou AuthMe.
