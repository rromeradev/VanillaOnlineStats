# Deploy no Coolify

O repositório inclui `docker-compose.coolify.yml`, próprio para uma aplicação Git no Coolify. Ele constrói o Angular e a API na mesma imagem e inicia PostgreSQL 18 com volume persistente. O domínio recebe painel, API e WebSocket no serviço `portal`, porta interna 3000. Não precisa criar um frontend separado nem configurar Nixpacks.

## 1. Gerar configuração privada

Em um checkout atualizado, com Node 24.22+:

```sh
node scripts/setup-platform.mjs --coolify --email SEU_EMAIL --origin https://stats.seu-dominio.com --output .env.coolify
```

O script gera senha inicial do Owner, senha do banco, tenant UUID, chave AES de 32 bytes, segredo de sessão e chave privada Ed25519. Não sobrescreve arquivo existente nem imprime credenciais. `.env.coolify` é ignorado pelo Git. Abra-o localmente para importar no Coolify. Use a senha de banco gerada, sem trocar por uma senha com caracteres especiais de URL.

Para **migrar uma instalação existente**, reutilize banco, tenant, chaves e segredos existentes; não gere novas chaves para dados antigos. O volume criado por este Compose é uma base nova: ele não importa automaticamente seu banco local. Faça backup/restauração antes de apontar um domínio já em uso. O gerador é para instalações novas.

## 2. Criar aplicação Git

No projeto/ambiente do Coolify, adicione um recurso a partir de repositório Git público (ou da sua conexão GitHub):

| Campo | Valor |
|---|---|
| Repository | `https://github.com/rromeradev/VanillaOnlineStats` |
| Branch | `main` |
| Build Pack / Build strategy | Docker Compose / Compose |
| Base Directory | `/` |
| Docker Compose Location | `/docker-compose.coolify.yml` |

Salve e carregue o Compose. Na seção **Environment Variables**, importe o conteúdo de `.env.coolify` no editor multilinha. As variáveis devem estar disponíveis em runtime; não são argumentos de build. O Compose marca todas as variáveis necessárias como obrigatórias. Não é necessário preencher `DATABASE_URL`: a conexão interna usa `db:5432` e a mesma `POSTGRES_PASSWORD` do PostgreSQL.

## 3. Domínio e deploy

Em **Domains**, atribua somente ao serviço **portal**:

```text
https://stats.seu-dominio.com:3000
```

O `:3000` orienta o proxy do Coolify para a porta interna. A URL pública continuará `https://stats.seu-dominio.com`. A variável **APP_ORIGIN** deve ser essa URL pública, **sem `:3000`**, sem caminho e sem barra no final. Aponte o DNS para o servidor do Coolify e aguarde HTTPS válido. Não atribua domínio ou porta pública ao `db`.

Clique em **Deploy**. O primeiro início cria as tabelas e a primeira conta Owner. Confira:

- `https://stats.seu-dominio.com/api/v1/health` responde com sucesso.
- `/login` abre o painel com os estilos.
- Entre com `VOS_ADMIN_EMAIL` e a senha inicial gerada; altere-a pelo botão da conta.

O Coolify termina o HTTPS no proxy; o container recebe HTTP na rede Docker. O WebSocket do agente usa o mesmo domínio com `wss://`. Se mantiver Cloudflare Tunnel, a rota deve alcançar esse serviço na máquina/rede do Coolify, com suporte a WebSocket. Não exponha a porta do banco para resolver problemas de conexão.

## 4. Conectar o Paper

No painel, vincule o serverId do plugin. Configure o token mostrado em `VOS_AGENT_TOKEN` no Pterodactyl. Copie da tela Configuração os endpoints, tenant e chave pública para o plugin:

- Heartbeat: `https://stats.seu-dominio.com/api/v1/agents/heartbeat`
- Telemetria: `https://stats.seu-dominio.com/api/v1/agents/telemetry/batches`
- Controle: `wss://stats.seu-dominio.com/api/v1/agents/control`

Reinicie o Paper. Para login Player, habilite o acesso Player na Configuração do portal; o usuário informa nick/senha AuthMe, sem precisar entrar no jogo. Veja as condições de identidade e 2FA no [guia 0.4.1](../platform/RELEASE-0.4.1.md).

## Atualizações e diagnóstico

Use **Redeploy** após atualizar `main`, preservando variáveis e volume PostgreSQL. Mantenha **uma réplica** de `portal` por instalação. Faça backup do banco e das chaves fora do servidor. A senha inicial de Owner só é aplicada ao criar a primeira conta; mudar a variável depois não troca a senha existente. Alterar `POSTGRES_PASSWORD` após inicializar o volume também não altera a senha gravada no PostgreSQL; uma rotação exige alterar o usuário no banco e a configuração em conjunto.

| Sintoma | Conferir |
|---|---|
| Deploy recusa variável vazia | Todas as chaves geradas foram importadas nas variáveis runtime |
| Erro de build / COPY | Base Directory `/` e Compose da raiz; não use `infrastructure/` como raiz |
| 502/503 no domínio | Saúde do serviço `portal`, domínio apontando para porta interna 3000 e logs da API |
| Login retorna 403 | `APP_ORIGIN` coincide exatamente com o endereço público utilizado no navegador |
| API não inicia após atualização | Banco acessível e mesmas chaves/tenant da instalação anterior |
| Login Player indisponível | Plugin 0.3.2+, canal WSS conectado e login Player habilitado |

Referência: [aplicações Docker Compose no Coolify](https://coolify.io/docs/applications/builds/docker-compose).
