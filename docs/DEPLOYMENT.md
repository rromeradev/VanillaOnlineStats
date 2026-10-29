# Deploy no Coolify 4.5.3

O arquivo principal é **`docker-compose.yml`**, na raiz. Ele contém PostgreSQL e a aplicação que serve API, painel Angular e WebSocket. Banco e identidade criptográfica ficam em volumes persistentes. Não é necessário criar banco separado, gerar arquivo `.env` local ou executar comandos antes do deploy.

## GitHub App

1. Em **Git Repository (with GitHub App)**, selecione este repositório e a branch `main`.
2. Selecione **Docker Compose** como Build Pack, **Base Directory `/`** e **Docker Compose Location `/docker-compose.yml`**.
3. Salve/carregue o Compose. O Coolify reconhece as referências e gera as variáveis `SERVICE_*`.
4. Preencha somente os campos manuais inicialmente vazios: **`APP_ORIGIN`** e **`VOS_ADMIN_EMAIL`**.
5. Configure o domínio no serviço **`portal`**, porta interna **3000**, e faça **Deploy**.

Exemplo de domínio no Coolify: `https://stats.rromera.dev:3000`. A URL pública é `https://stats.rromera.dev`; `APP_ORIGIN` deve conter essa URL pública **sem `:3000`**, caminho ou barra final. O sufixo na configuração de domínio seleciona a porta interna do container.

O arquivo [`.env.example`](../.env.example) documenta todos os campos, com exemplos em comentários. Os campos manuais começam vazios. Não importe os campos automáticos vazios por cima dos valores que o Coolify já gerou.

## Variáveis e geração automática

| Campo | Responsável / comportamento |
|---|---|
| `APP_ORIGIN` | Manual, vazio. Exemplo: `https://stats.rromera.dev` |
| `VOS_ADMIN_EMAIL` | Manual, vazio. E-mail da primeira conta Owner |
| `SERVICE_PASSWORD_DATABASE` | Coolify gera a senha PostgreSQL e reutiliza na conexão da API |
| `SERVICE_PASSWORD_OWNER` | Coolify gera a senha inicial Owner, visível nas variáveis do recurso |
| `SERVICE_REALBASE64_32_DATA` | Coolify gera a chave de dados, Base64 de 32 bytes reais |
| `SERVICE_BASE64_64_SESSION` | Coolify gera o segredo de sessão, com 64 caracteres |
| `VOS_TENANT_ID` | Vazio: a aplicação gera um UUID uma vez e o preserva no volume `identity` |
| `VOS_CONTROL_PRIVATE_KEY` | Vazio: a aplicação gera Ed25519 uma vez e a preserva no volume `identity` |

A geração `PASSWORD`, `BASE64_64` e `REALBASE64_32` foi conferida no [código do Coolify v4.5.3](https://github.com/coollabsio/coolify/blob/v4.5.3/bootstrap/helpers/shared.php). UUID e Ed25519 não são geradores nativos dessa versão; por isso a aplicação os gera e guarda em `/app/state/identity.json`, com acesso restrito. Eles não são reimpressos nos logs, regenerados a cada reinício ou inseridos em arquivos versionados.

`DATABASE_URL`, `HOST`, `PORT`, `POSTGRES_DB` e `POSTGRES_USER` já são montados/fixados no Compose. Não preencha uma conexão externa para a instalação padrão. Nenhuma porta do PostgreSQL é publicada no host.

## Primeiro acesso

Aguarde `db` e `portal` ficarem saudáveis. Abra seu domínio: o painel/login deve carregar. `/api/v1/health` confirma a API. Entre com `VOS_ADMIN_EMAIL` e a senha gerada em **`SERVICE_PASSWORD_OWNER`** no Coolify. Altere a senha pelo botão da conta após entrar.

O proxy do Coolify cuida do HTTPS e encaminha para o `portal:3000`. Painel, API e WSS usam o mesmo domínio. O plugin Paper é vinculado na Configuração do painel; veja [PLUGIN.md](PLUGIN.md).

## Atualizações, migração e backup

Preserve os volumes `postgres` e `identity`, assim como os valores `SERVICE_*` salvos no Coolify. Faça backup de ambos e das variáveis. Excluir o volume `identity` ou trocar os segredos pode impedir acesso a dados existentes e romper a confiança do plugin. Não use múltiplas réplicas de `portal`.

Se já existe uma instalação: restaure o banco no volume PostgreSQL deste stack; forneça o tenant e a chave privada anteriores em `VOS_TENANT_ID` e `VOS_CONTROL_PRIVATE_KEY` no primeiro início. Configure `SERVICE_REALBASE64_32_DATA` e `SERVICE_BASE64_64_SESSION` com a chave/segredo anteriores, e `SERVICE_PASSWORD_DATABASE` com a senha efetiva do banco restaurado. A aplicação importa a identidade fornecida e recusa alterações que contradigam uma identidade já persistida.

Mudar `SERVICE_PASSWORD_OWNER` depois que a conta foi criada não redefine sua senha; use o painel. Mudar `SERVICE_PASSWORD_DATABASE` não altera automaticamente o usuário de um PostgreSQL já inicializado; a rotação deve ser feita também no banco. Não habilite previews com os volumes/dados de produção.

| Sintoma | Conferir |
|---|---|
| Compose não carregou | GitHub App, Build Pack Docker Compose e arquivo `/docker-compose.yml` |
| Campo manual vazio | Preencha `APP_ORIGIN` e `VOS_ADMIN_EMAIL` no Coolify |
| Banco não inicia | `SERVICE_PASSWORD_DATABASE` foi gerado e o volume está íntegro |
| Erro de identidade | Preserve/restaure o volume identity e as chaves da instalação |
| 502/503 | Saúde do portal e domínio apontando à porta interna 3000 |
| Login retorna 403 | `APP_ORIGIN` coincide exatamente com o endereço público |

Referência: [Docker Compose por Git no Coolify](https://coolify.io/docs/applications/builds/docker-compose).
