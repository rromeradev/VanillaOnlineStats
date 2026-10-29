# VanillaOnlineStats

Painel web e API para servidores Minecraft Paper, com integração AuthMe e áreas Owner/Admin e Player. O painel oferece temas claro, escuro e automático pelo sistema.

**Versões:** plataforma 0.4.1, plugin 0.3.2. **Baseline:** Paper 26.3 build 227, Java 25 e AuthMe 6.0.1-b2770.

## Deploy no Coolify com GitHub App

1. Crie uma aplicação em **Git Repository (with GitHub App)** e selecione este repositório, branch `main`.
2. Use **Build Pack: Dockerfile**, **Base Directory: /**, **Dockerfile: /Dockerfile** e **Port: 3000**.
3. Configure as variáveis de runtime diretamente em **Environment Variables** no Coolify e informe a conexão do seu PostgreSQL.
4. Configure o domínio HTTPS e clique em **Deploy**. O mesmo container serve painel, API e WebSocket. A página inicial abre o painel/login.

Nenhum arquivo `.env` precisa ser criado ou enviado para o deploy. Veja [variáveis e configuração do Coolify](docs/DEPLOYMENT.md).

## Estrutura

| Caminho | Conteúdo |
|---|---|
| `Dockerfile` | Build e execução da aplicação no Coolify |
| `apps/web` | Painel Angular |
| `apps/api` | API NestJS e migração PostgreSQL |
| `plugin` | Agente Paper/AuthMe em Java |
| `packages/api-contracts` | Contratos JSON Schema compartilhados |
| `infrastructure/compose.yml` | Ambiente local opcional com PostgreSQL |
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
