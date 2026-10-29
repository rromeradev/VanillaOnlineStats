# API e painel 0.4.0

Release self-hosted para os recursos disponíveis no agente. Inclui plugin **0.3.1**, que permite consultas Player somente ao próprio UUID. Baseline: Paper **26.3 build 227**, Java **25**, AuthMe **6.0.1-b2770**.

## Funcionalidades

- Portal Angular com temas claro, escuro e automático pelo sistema; preferência manual persistente. Layout responsivo, navegação móvel, estados vazios e indicação de dados antigos.
- Owner com vínculo de servidores, token de agente mostrado uma vez, rotação e concessão/revogação de Admin por servidor.
- Login administrativo com senha scrypt, cookie HttpOnly/SameSite, CSRF, limitação de tentativas, troca de senha e encerramento das outras sessões.
- Player entra usando código `/vos link`, sem fornecer senha AuthMe ao portal. Sessão de 15 minutos, restrita ao servidor e UUID; logout/unregister recebido do AuthMe a invalida.
- PostgreSQL: heartbeat, lotes, deduplicação, projeções, histórico, sessões, comandos, auditoria, alertas e pedidos de privacidade. Payloads e resultados criptografados com AES-256-GCM e contexto tenant/servidor.
- Visão geral: TPS, MSPT, heap, conexões, histórico de 1/6/24/168 horas; limiares TPS < 18, MSPT > 50 ms e heap > 90%, com reconhecimento manual.
- Jogadores e mundos observados, eventos, exportação JSON/CSV e consultas nativas a todos os recursos já implementados no plugin: chunks, blocos, entidades, inventários, estatísticas, advancements, armazenamento, listas e integrações opcionais.
- Todas as ações tipadas existentes no plugin estão no painel. Operações de alto risco exigem Owner e reautenticação recente. O plugin exige habilitação local e allowlist.
- Canal WebSocket de saída com Ed25519, TTL de 25 segundos, nonce, escopo e correlação. Resultado sem confirmação é `UNKNOWN`; nenhuma ação é reenviada automaticamente.
- Área Player com perfil, jornada, inventário/Ender Chest, estatísticas paginadas e conquistas. Consultas exigem jogador autenticado no jogo e política de coleta habilitada.

## Instalação com Docker Compose

Requer Node **24.22+**, pnpm **10.34.9**, Docker com Compose e domínio HTTPS para uso remoto. Na raiz do checkout desta release:

```sh
node scripts/setup-platform.mjs --email SEU_EMAIL
```

O script cria `.env` privado e não sobrescreve arquivo existente. Abra-o localmente: as credenciais iniciais estão em `VOS_ADMIN_EMAIL`/`VOS_ADMIN_PASSWORD`. Configure `APP_ORIGIN` com a URL pública exata, sem caminho, por exemplo `https://test.rromera.dev`.

```sh
docker compose --env-file .env -f infrastructure/compose.yml up -d --build
```

Portal em **127.0.0.1:3000**, banco na rede interna dos containers. Aponte o serviço HTTP do Cloudflare Tunnel para `http://127.0.0.1:3000` **na máquina que executa o portal**. Um túnel somente na VPS não alcança o loopback do seu computador. Se `cloudflared` roda em container, use rede compartilhada e `portal:3000`. O mesmo hostname serve painel, API e WebSocket. Não coloque uma autenticação Cloudflare Access que impeça o agente de conectar.

Entre como Owner e altere a senha no botão da conta. Em Configuração, vincule o UUID mostrado por `vos status`. Guarde o token exibido e coloque-o em `VOS_AGENT_TOKEN` no ambiente do processo Paper/Pterodactyl. Para importar o vínculo antigo de heartbeat, defina `VOS_AGENT_SERVER_ID` e `VOS_AGENT_TOKEN_SHA256` antes do primeiro início; preserve o token no Paper. Não use modo legado para o painel.

## Configurar o plugin

Substitua o JAR pelo **0.3.1** e reinicie o Paper. Em Configuração, copie endpoints, tenant e chave **pública** para `plugins/VanillaOnlineStats/config.yml`:

```yaml
schema-version: 2
heartbeat:
  enabled: true
  endpoint: https://test.rromera.dev/api/v1/agents/heartbeat
  allow-loopback-http: false
telemetry:
  endpoint: https://test.rromera.dev/api/v1/agents/telemetry/batches
control:
  endpoint: wss://test.rromera.dev/api/v1/agents/control
  tenant-id: UUID_COPIADO_DO_PAINEL
  public-key: CHAVE_PUBLICA_COPIADA_DO_PAINEL
  writes-enabled: false
  allowed-operations: []
```

Preserve as outras opções. Reinicie o Paper. `vos status` deve indicar heartbeat conectado; o painel deve indicar controle conectado e receber amostras. Consultas usam esse canal mesmo com escritas desativadas.

Para a área Player, habilite `privacy.player-state: true` no plugin e login Player no portal. Inventários exigem `privacy.inventories: true`. No jogo autenticado, execute `/vos link` e insira o código no portal em até dois minutos. Uso único. Escritas exigem `control.writes-enabled: true` e cada operação em `allowed-operations`; console exige suas opções adicionais. Confira a [política do agente](../plugin/RELEASE-0.3.0.md).

## Executar sem Docker

Provisione PostgreSQL 18 com banco e usuário exclusivos. Ajuste `DATABASE_URL` no `.env` gerado. A aplicação cria tabelas ao iniciar, com transação e trava de migração. Precisa de permissão para criar/alterar tabelas no seu schema.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm -r build
node --env-file=.env apps/api/dist/main.js
```

O backend serve o Angular compilado no mesmo endereço. Desenvolvimento separado: API em 3000, `pnpm --filter @vanillaonlinestats/web start` em 4200 e `APP_ORIGIN=http://localhost:4200`. O proxy encaminha `/api`; reinicie a API após alterar ambiente.

## Operação e limites

Preserve juntos o banco e **VOS_DATA_KEY**; perder a chave impede ler payloads. Preserve chave privada de controle e segredo de sessão. Nunca copie chaves privadas para o plugin. Faça backup com `pg_dump` e teste restauração em banco separado. Não gere outro `.env` para uma instalação existente. `VOS_ADMIN_PASSWORD` só cria a primeira conta; depois altere a senha pelo portal.

Uma instância de API por instalação: sockets e requisições pendentes são locais ao processo. Não use múltiplas réplicas atrás de balanceador. Retenção: mensagens 30 dias, últimas projeções 7 dias e resultados de consultas/ações 7 dias. Metadados de auditoria, identidades e solicitações não expiram automaticamente. Histórico retorna até 500 eventos/1.000 amostras ou registros exportados, sem paginação histórica completa. As janelas mostram as amostras mais recentes dentro do limite. Perfis de jogadores são estados observados, não presença atual garantida.

Pedidos de exclusão/exportação são **registrados para atendimento manual**; não apagam dados automaticamente. Não há reset por e-mail, MFA, convites por e-mail, gráficos históricos ilimitados ou SaaS nesta release. Integrações opcionais continuam condicionadas às capacidades do agente e à matriz de suporte.

Use `VOS_DEMO=1` somente em banco separado descartável: cria dados simulados e exibe aviso no painel. Para dados reais, use outro banco sem esse modo. Não remova apenas o aviso de uma base demo.

## Validação

`TEST_DATABASE_URL` habilita testes PostgreSQL em schemas aleatórios isolados, removidos ao final. Sem essa variável os testes de banco são explicitamente ignorados. A CI fornece PostgreSQL.

```sh
pnpm -r test
python packages/api-contracts/test_contract.py
```

`scripts/smoke_platform.mjs` inicia Paper descartável, API e schema PostgreSQL; verifica heartbeat/lotes, consulta assinada, `world.time`, leitura de confirmação e auditoria. Requer caminhos Java/Paper/AuthMe/plugin e aceite prévio da EULA; veja os argumentos no workflow. Docker Compose foi preparado; a validação local usou PostgreSQL nativo porque Docker Engine não estava disponível.
