# Testar o heartbeat

Baseline: Paper 26.3 build 227, Java 25, AuthMe 6.0.1-b2770. API: Node 24 e pnpm 10.34.9.

## 1. Preparar a build

Na raiz do repositório:

```powershell
./plugin/gradlew.bat -p plugin clean build
corepack enable
pnpm install --frozen-lockfile
pnpm -r test
```

Use `bash plugin/gradlew -p plugin clean build` no Linux. O JAR fica em `plugin/build/libs/VanillaOnlineStats-0.2.0-SNAPSHOT.jar`.

## 2. Obter a identidade do servidor

Substitua o JAR antigo em `plugins/` e inicie o Paper. O heartbeat começa desativado. Execute `vos status` no console e copie o `serverId`, também salvo em `plugins/VanillaOnlineStats/server-id.txt`. Preserve esse arquivo nos backups e reinícios. Não copie a mesma identidade para outra instalação.

## 3. Provisionar a credencial

Execute localmente, substituindo o UUID pelo valor real:

```powershell
node scripts/create-agent.mjs UUID_DO_SERVIDOR
```

O comando gera um token aleatório e mostra dois grupos de variáveis. O token é um segredo: configure-o somente no ambiente do processo Paper, fora do Git e dos logs. A API recebe somente o hash, o serverId e o tenantId. Guarde esse tenantId para preservar a identidade da instalação.

No terminal que inicia o Paper, defina `VOS_AGENT_TOKEN` com o valor gerado antes de executar Java. Se usa painel de hospedagem ou serviço, configure a variável no ambiente desse processo. Reinicie o Paper após alterações de credencial.

## 4. Iniciar a API

Copie `apps/api/.env.example` para um arquivo local ignorado, por exemplo `apps/api/.env`, e preencha as três variáveis geradas para a API. Mantenha HOST=127.0.0.1 e PORT=3000 para o teste na mesma máquina.

Na raiz:

```powershell
pnpm --filter @vanillaonlinestats/api build
node --env-file=apps/api/.env apps/api/dist/main.js
```

Confirme `GET http://127.0.0.1:3000/api/v1/health` (status ok). Esse endpoint não exibe dados do servidor. A rota de ingestão é `POST /api/v1/agents/heartbeat`, com `Authorization: Bearer TOKEN`, validada pelo schema compartilhado. A resposta 202 confirma recebimento e informa messageId/receivedAt. Repetições idênticas são reconhecidas sem renovar a última observação.

## 5. Habilitar o plugin

Com o Paper parado, adicione/ajuste este bloco em `plugins/VanillaOnlineStats/config.yml`. O arquivo antigo não é sobrescrito automaticamente:

```yaml
schema-version: 1
heartbeat:
  enabled: true
  endpoint: http://127.0.0.1:3000/api/v1/agents/heartbeat
  interval-seconds: 10
  timeout-seconds: 3
  allow-loopback-http: true
```

O endereço 127.0.0.1 funciona apenas quando API e Paper estão na mesma máquina/contexto de rede. Para máquinas diferentes, coloque a API atrás de um proxy com certificado TLS válido e configure `https://SEU_DOMINIO/api/v1/agents/heartbeat`, com allow-loopback-http=false. O processo API escuta loopback por padrão. HOST pode ser ajustado conforme a implantação; o token exige TLS fora de loopback. O plugin não segue redirecionamentos.

Reinicie o Paper com a variável VOS_AGENT_TOKEN configurada. Após cerca de 10 segundos, execute `vos status`. Esperado: `heartbeat=conectado`, `enviados` crescente e `ultimoACK` preenchido. O comando não revela o token.

## 6. Conferir queda e recuperação

Pare somente a API, mantenha o Paper ligado e aguarde um intervalo de coleta. O status deve mostrar `API indisponivel; reconectando`, falhas e, quando necessário, descarte de amostras. A fila não cresce: preserva a amostra mais recente. Reinicie a API com as mesmas variáveis; o envio retorna após o backoff (até aproximadamente 60 segundos).

Se aparecer `rejeitado pela API`, confira o hash da credencial, serverId, relógio do sistema, rota e configuração. O plugin omite detalhes sensíveis. Para rotacionar a credencial, substitua token e hash, mantendo os mesmos serverId e tenantId, e reinicie os processos.

O servidor continua funcional sem a API. O teste de queda comprova isolamento da rede; benchmarks de MSPT/TPS continuam pendentes. Nesta fase há um agente por processo API e armazenamento apenas em memória, perdido ao reiniciar. Histórico, PostgreSQL, vínculo do Owner e painel são as próximas etapas.

## Automação

A CI compila o Java, testa API/contrato (inclusive envelope serializado pelo Java), executa Paper com AuthMe, derruba e reinicia a API e verifica reconexão. Também testa recusa sem AuthMe. Com os JARs oficiais obtidos e após ler a EULA, reproduza com `scripts/smoke_server.py --heartbeat --accept-eula` e os caminhos `--java`, `--paper`, `--authme`, `--plugin` e `--output`. Consulte o cabeçalho/ajuda do script para detalhes. O diretório de saída deve ser novo.
