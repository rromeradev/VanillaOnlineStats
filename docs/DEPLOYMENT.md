# Deploy: Coolify com GitHub App

O `Dockerfile` na raiz é o ponto de entrada do deploy. Ele compila Angular e NestJS, instala dependências de produção e inicia uma aplicação que serve painel, API e WebSocket na porta 3000. As variáveis são configuradas diretamente no Coolify; não existe dependência de arquivo `.env` no container.

## Aplicação

Em **Git Repository (with GitHub App)**, selecione o repositório `rromeradev/VanillaOnlineStats` e configure:

| Campo | Valor |
|---|---|
| Branch | `main` |
| Build Pack / Build strategy | `Dockerfile` |
| Base Directory | `/` |
| Dockerfile Location | `/Dockerfile` |
| Ports Exposes | `3000` |
| Health check | `/api/v1/health`, porta `3000` (também definido na imagem) |
| Domínio | Sua URL HTTPS pública, por exemplo `https://stats.rromera.dev` |

A seleção GitHub App define de onde vem o código; Dockerfile define como construí-lo. Se sua versão do Coolify não selecionar Dockerfile automaticamente, escolha esse Build Pack uma vez. Não selecione Static: o painel precisa da API no mesmo serviço. Não é necessário configurar comandos de build/start no Coolify.

## PostgreSQL

Crie um recurso **PostgreSQL 18** no Coolify ou utilize um PostgreSQL existente. Permita que a aplicação alcance sua rede privada e copie a conexão **interna** para `DATABASE_URL`. Use o hostname interno informado pelo Coolify, não `localhost`: a aplicação e o banco rodam em containers distintos. O Dockerfile não cria um banco embutido. O banco precisa estar disponível antes do deploy; as tabelas são criadas pela API no início.

## Variáveis no Coolify

Cadastre os valores em **Environment Variables**, disponíveis em runtime. Não precisam ser variáveis de build. `HOST=0.0.0.0`, `PORT=3000` e `NODE_ENV=production` já são padrões da imagem.

| Variável | Valor |
|---|---|
| `DATABASE_URL` | Conexão PostgreSQL interna completa |
| `APP_ORIGIN` | URL HTTPS pública exata, sem caminho nem barra final |
| `VOS_ADMIN_EMAIL` | E-mail da primeira conta Owner |
| `VOS_ADMIN_PASSWORD` | Senha inicial do Owner, com pelo menos 12 caracteres |
| `VOS_TENANT_ID` | UUID da instalação |
| `VOS_DATA_KEY` | 32 bytes aleatórios codificados em Base64 |
| `VOS_SESSION_SECRET` | Segredo aleatório de pelo menos 32 caracteres |
| `VOS_CONTROL_PRIVATE_KEY` | Chave privada Ed25519, PKCS8 DER codificado em Base64 |

Para uma instalação existente, reutilize tenant, segredos, chave privada e banco. Não gere outra chave de dados para um banco existente. Senha inicial do Owner só cria a primeira conta: alterá-la no ambiente não troca a senha de uma conta já criada.

Se ainda não possui os segredos, este comando opcional imprime valores novos para copiar diretamente no Coolify, sem criar `.env`:

```sh
node scripts/generate-secrets.mjs
```

Execute em ambiente privado e guarde os valores. Não inclua sua saída no Git ou em issues. E-mail, senha do Owner, domínio e conexão do banco são preenchidos por você no Coolify.

## Deploy e verificação

Aponte o DNS para o servidor do Coolify, configure o domínio e clique em **Deploy**. Aguarde o serviço ficar saudável. Acesse seu domínio: a aplicação abre o painel/login. `/api/v1/health` deve responder com sucesso e `/login` deve carregar os estilos. Entre com a conta Owner definida acima.

O Coolify termina HTTPS no proxy. Use o mesmo domínio para painel, API e WSS; não é necessário compilar o frontend novamente ao mudar domínio, pois ele usa `/api` na mesma origem. Para mudança de domínio, atualize também `APP_ORIGIN` e reinicie a aplicação.

O servidor Paper é conectado pela tela Configuração do painel. Veja [instalação do plugin](PLUGIN.md). O Player entra com nick/senha AuthMe; o Paper precisa estar ligado, mas o jogador pode estar offline.

## Operação

Mantenha uma réplica da aplicação por instalação. Faça backup do PostgreSQL e das chaves antes de atualizar. Deploys de `main` substituem o container da aplicação, mantendo os dados no recurso PostgreSQL separado. Não habilite previews contra o mesmo banco de produção. Se migrar do Compose antigo, restaure o banco no recurso PostgreSQL escolhido e preserve as chaves; o deploy GitHub App não importa volumes antigos automaticamente.

| Sintoma | Conferir |
|---|---|
| Nixpacks ou framework incorreto | Selecione Dockerfile como Build Pack |
| Erro COPY no build | Base `/` e Dockerfile `/Dockerfile` |
| 502/503 | Porta 3000, saúde do container e logs da API |
| API não inicia | Variáveis runtime, conexão interna do banco e chaves válidas |
| Login retorna 403 | `APP_ORIGIN` coincide exatamente com a URL pública |
| Login Player falha | Plugin atualizado, WSS conectado, login Player permitido e política 2FA/identidade |

Referência oficial: [Dockerfile a partir de Git no Coolify](https://coolify.io/docs/applications/builds/dockerfile).
