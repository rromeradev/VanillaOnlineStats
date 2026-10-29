# Plugin Paper/AuthMe

Versão atual: **0.6.0**, integrada à plataforma 0.7.0. Baseline: Paper 26.3 build 227, Java 25, AuthMe 6.0.1-b2770 e SkinsRestorer 15.12.6. As funcionalidades abaixo são a cobertura atual, não uma promessa de todas as funções da especificação.

## Instalação

Instale AuthMe e o JAR VanillaOnlineStats em `plugins/` e inicie o Paper. Na tela Configuração do painel, vincule o UUID mostrado por `vos status`. Coloque o token gerado em `VOS_AGENT_TOKEN` no ambiente do Paper/Pterodactyl. Copie endpoints, tenant e chave pública para `plugins/VanillaOnlineStats/config.yml` e reinicie o servidor.

```yaml
schema-version: 2
heartbeat:
  enabled: true
  endpoint: https://stats.seu-dominio.com/api/v1/agents/heartbeat
  allow-loopback-http: false
telemetry:
  endpoint: https://stats.seu-dominio.com/api/v1/agents/telemetry/batches
control:
  endpoint: wss://stats.seu-dominio.com/api/v1/agents/control
  tenant-id: UUID_DO_PAINEL
  public-key: CHAVE_PUBLICA_DO_PAINEL
  writes-enabled: false
  allowed-operations: []
```

Preserve as demais opções do config. Token nunca vai no arquivo. A chave privada fica somente na API. O heartbeat e o canal WSS devem aparecer conectados.

## Login Player

Habilite login Player na Configuração do painel. O jogador informa nick e senha AuthMe, sem entrar no jogo e sem /vos link. A validação roda fora da thread principal e não grava senha no backend/auditoria. O servidor Paper deve estar ligado. Contas TOTP são recusadas até integrar segunda etapa; contas sem UUID conhecido no AuthMe/cache Paper também são recusadas.

Histórico/perfil previamente coletados podem ser vistos offline. Para coletar estado de jogadores, habilite `privacy.player-state`; inventários exigem também `privacy.inventories`. Consultas ao vivo exigem personagem online/autenticado. `/vos link` continua disponível por compatibilidade, mas não é requerido pelo formulário.
## Funcionalidades presentes

| Área | Implementação |
|---|---|
| Inicialização | Dependência obrigatória AuthMe; baseline verificada; identidade persistente; migração config v1 → v2 com backup |
| Heartbeat | Envio assíncrono, ACK validado, timeout, backoff, contadores |
| Servidor | Versões, implementação, MOTD, capacidade, modo online, whitelist e plugins |
| Performance | TPS, MSPT médio e percentis da janela disponível, slow ticks, heap/non-heap, threads, GC, uptime, CPU e memória visíveis à JVM/container |
| Mundos | Identidade, dimensão, clima, tempo, dificuldade, chunks/entidades carregados, regras disponíveis, border, spawn/seed sob política |
| Chunks/blocos | Apenas carregados; amostragem opcional limitada, block entities, entidades, biome/luz/potência sob demanda; sem carregar mundos/chunks para consultas |
| Entidades | Tipo, UUID, estado/vida, equipamentos sob política, mobs, villagers e itens sob demanda |
| Jogadores | Estado autenticado, UUID com origem Paper declarada, nickname, ping, locale, gamemode, saúde/fome/XP, efeitos; posição/IP/inventário/Ender Chest opcionais |
| Estatísticas | Estatísticas nativas sem parâmetro paginadas; estatísticas por material ou entidade consultáveis individualmente; advancements paginados com datas |
| AuthMe | Login, logout, restauração, registro e exclusão pelo jogador; sessões com duração; código in-game de uso único após autenticação |
| Eventos | Entrada/saída, morte/dano/PvP, progressão, XP, itens, crafting/smelting, veículos, mundos/chunks, clima; blocos/entidades de alto volume opcionais |
| Privacidade | Campos sensíveis desativados por padrão; credenciais de login são transitórias; o AuthMe valida a senha sem exportar hashes; auditoria de comandos guarda apenas raiz explicitamente permitida |
| Chat | Opt-in, jogador autenticado, máximo 512 caracteres, fila de encaminhamento limitada; não captura comandos |
| Telemetria | Envelope v1, fila limitada por bytes/mensagens, coalescência de snapshots, ACK por IDs, retenção de cinco minutos e contadores de perdas |
| Recuperação | Spool AES-256-GCM opcional com VOS_STORAGE_KEY independente; checkpoint assíncrono a cada dois segundos, limite igual ao da fila |
| Controle | WSS de saída, chave pública Ed25519 fixada, tenant/servidor/ator/TTL/nonce, limite de chamadas e auditoria antes/depois |
| Moderação | Kick/ban de jogador online, unban por UUID, whitelist add/remove, mensagens e broadcast |
| Jogador | Gamemode, vida, fome, nível, teleporte para destino seguro em chunk já carregado e limpar inventário com confirmação de Owner |
| Mundo | Tempo, clima, dificuldade, gamerule tipada, border e save; writes sempre opt-in e allowlist |
| Console | Opt-in adicional, Owner, confirmação HIGH, allowlist de raízes e bloqueio de comandos críticos/autenticação e encadeamento |
| Diagnóstico | Status, coletores, capacidades, fila, consultas locais somente no console e auditoria de controle sem argumentos |
| Arquivos | Métricas de filesystem visível; tamanho amostrado dos mundos opcional, no worker, sem seguir symlinks e com limites de arquivos/tempo |

## Cobertura parcial e recursos ausentes

- LuckPerms (grupo primário), Vault (saldo) e PlaceholderAPI (allowlist) possuem adaptadores opcionais por API pública; ainda não foram validados com artefatos desses plugins e ficam desligados por padrão.
- WorldGuard, CoreProtect, EssentialsX, spark, BlueMap/Dynmap são detectados, mas não possuem adaptadores funcionais nesta release. Detecção não significa suporte à integração.
- Não há rollback, arquivos/reinício/backups do host, profiling por plugin, varredura de chunks descarregados, Folia, importação histórica nem dados de cliente Minecraft.
- O identificador é o UUID conhecido pelo Paper/AuthMe. Login web não inventa UUIDs a partir do nickname; contas sem identidade conhecida são recusadas.
- Ainda não há benchmark com carga de jogadores reais. Os budgets controlam amostragens, não interrompem uma chamada nativa que já começou. Uma consulta pode ultrapassar o orçamento; as durações são expostas.

## Atualização a partir de 0.2

1. Pare o Paper, faça backup da pasta do plugin e substitua o JAR.
2. Preserve server-id.txt e VOS_AGENT_TOKEN. O heartbeat continua compatível com sua API atual.
3. A configuração vira schema-version 2; config-v1.backup.yml é preservado. Os campos novos recebem defaults conservadores.
4. O envio completo e o controle continuam desligados até configurar os endpoints correspondentes. Use a API atual para os lotes e o controle.

Use `vos status`, `vos collectors`, `vos capabilities` e `vos queue`. No console, `vos query server.performance` e `vos query worlds.list` permitem validar coleta para validar a coleta local. Consultas com argumentos usam JSON: `vos query world.snapshot {"worldId":"UUID"}`.

## Configuração de telemetria e controle

Na plataforma 0.7.0, o painel mantém uma conexão WebSocket autenticada em `/api/v1/panel`. Recebe o estado inicial e depois os eventos/projeções alterados, sem polling HTTP, sem SSE de invalidação e sem consultas repetidas ao agente. Trocar a tela ou os argumentos troca a assinatura; ocultar a aba a pausa. Ao reconectar, o estado é ressincronizado uma vez.

Inventário, estatísticas, conquistas e consultas administrativas usam assinaturas Ed25519 `kind: watch`, exclusivamente de leitura. O plugin observa os alvos na thread principal e envia `watch.update` somente quando o resultado muda. O agendamento tem intervalo mínimo de 200 ms por assinatura, rotação, até quatro amostras por tick e orçamento local; não há garantia de latência fixa sob carga/rede. São até 64 assinaturas por agente, compartilhadas entre abas do mesmo ator/alvo. Cada assinatura tem lease de 75 s renovado por frame assinado a cada 30 s. Cancelar a assinatura ou desconectar a API encerra a coleta. As permissões locais e a autenticação do jogador são verificadas em cada amostra.

A telemetria passa pelo mesmo WSS do agente, com ACK dos envelopes após commit no PostgreSQL. Enquanto esse transporte está negociado, o emissor HTTP de lotes fica suspenso. Se o WSS do agente cair, a fila conserva o funcionamento HTTP anterior até reconectar; esse mecanismo não cria consultas HTTP no navegador. `telemetry.endpoint` deve continuar configurado para habilitar o envio. A coleta exige personagem autenticado e a política de privacidade correspondente. O painel também mostra os últimos dados salvos quando o jogador está offline.

O painel verifica cookie, Origin exato, tenant/servidor e permissões ao assinar e antes de entregar dados. São até quatro conexões por sessão, frames recebidos limitados e encerramento de consumidores lentos. Revogação de acesso/sessão impede novas entregas. Heartbeats de conexão e renovações de lease não são consultas de dados. Ações continuam separadas, com confirmação e allowlist, e nunca são repetidas automaticamente.

Para habilitar um aviso administrativo, ajuste localmente a seção existente, preservando endpoint, tenant-id e public-key:

```yaml
control:
  writes-enabled: true
  allowed-operations:
    - server.broadcast
```

Reinicie o Paper. Acrescente somente as operações que deseja permitir. O painel exibe a política anunciada e o motivo específico de recusa; versões antigas que retornavam IllegalArgumentException devem ser atualizadas. Não há ativação remota de permissões.

Cabeças e modelos 3D usam a skin efetivamente aplicada ao perfil Paper, inclusive alterações feitas pelo SkinsRestorer. Com SkinsRestorer presente, o login web também consulta sua skin armazenada pela API pública. `privacy.player-state: true` habilita essa coleta. Sem textura observada, o painel mostra uma identificação alternativa; não inventa a skin pelo nickname. Não é necessário configurar chave da BlocksItems.

`telemetry.endpoint`: `https://DOMINIO/api/v1/agents/telemetry/batches`.

`control.endpoint`: `wss://DOMINIO/api/v1/agents/control`; `control.tenant-id` deve ser UUID; `control.public-key` é Ed25519 pública X.509 DER em Base64. A chave privada pertence somente à API. A credencial de agente não autoriza comandos sozinha.

`control.writes-enabled`, `control.allowed-operations`, `control.console-enabled` e `control.allowed-console-roots` são configurados localmente. Nenhum comando remoto habilita suas próprias permissões. Um PLAYER pode autenticar-se e consultar somente seu próprio UUID; nunca consultar dados administrativos ou alterar o jogo.

`VOS_STORAGE_KEY` contém 32 bytes aleatórios codificados em Base64. Preserve a chave para recuperar o spool; chave incorreta ou spool corrompido recusa inicialização. Sem chave, não há persistência de telemetria. Checkpoints têm janela de até dois segundos e a retenção é de cinco minutos; não há promessa de entrega sem perdas. O status expõe descartes e falha de armazenamento.

Auditoria em control-audit.jsonl e um segmento anterior, até cerca de 16 MiB totais; sem argumentos, senhas ou resultados privados. Claims são persistidos antes da execução e recusados em replay. Uma queda entre mutação e resultado deixa PENDING: o backend deve mostrar resultado desconhecido, sem reenviar automaticamente uma operação destrutiva.

## Protocolo do controle

WebSocket usa Authorization Bearer na abertura; primeiro envia `agent.capabilities`. Entrada: `{"body":"BASE64URL_BYTES_JSON","signature":"BASE64URL_ED25519"}`. Assine os bytes exatos decodificados de body, não o wrapper nem uma serialização diferente. Limite: 32 KiB no corpo, 64 KiB no frame lógico, 30 ações/logins por minuto e 600 consultas por minuto, oito solicitações em execução.

O corpo segue packages/api-contracts/control-body.schema.json. O TTL máximo é 30s. Resultado: `control.result` com actionId, auditCorrelationId, state e payload. Estados finais SUCCEEDED/FAILED/REJECTED/EXPIRED; PENDING é persistido antes da execução. Mensagens inválidas recebem control.rejected sem ecoar conteúdo.

Consulta: kind=query; operation é uma das operações de vos capabilities; arguments contém worldId/playerId/entityId conforme a consulta. Ação: kind=action; operação explicitamente permitida. Link: kind=link, operation=player.link.redeem, arguments.code; o código é gerado por `/vos link` e expira em 120s, é revogado no logout e só pode ser usado uma vez. Não registre esse código em filas duráveis ou logs do backend.

O simulador scripts/smoke_release.py é a referência executável do protocolo. Ele não é uma API de produção e não deve ser exposto publicamente.

## Última sessão e edição de skin

SkinsRestorer **15.12.6** é dependência obrigatória (`depend`), usando sua API pública como `compileOnly`; o JAR não é incorporado. Instale-o antes de atualizar este plugin. Preserve os dados do SkinsRestorer para manter as escolhas após reinícios.

Com `privacy.player-state: true`, o agente salva automaticamente estado, páginas de estatísticas gerais e conquistas, mesmo sem painel aberto. `privacy.inventories: true` também salva inventário e Ender Chest. A coleta é distribuída na thread principal; páginas são deduplicadas, com checkpoint de recuperação de no máximo um minuto para páginas inalteradas. A saída captura os últimos valores autenticados. Estado, páginas, skin e os últimos 200 eventos da sessão são criptografados no PostgreSQL e não expiram automaticamente. A próxima sessão atualiza o estado e inicia uma nova lista de eventos. Dados que nunca foram coletados não podem ser recuperados retroativamente. Consultas administrativas continuam com a semântica de leitura ao vivo.

Em **Visão geral → Sua aparência no servidor → Editar minha skin**, o jogador escolhe uma skin popular ou envia seu PNG. O arquivo deve ter 64×64 ou 64×32 pixels, até 1 MB na seleção; o navegador o reencoda, remove metadados e envia até 20 KiB. Escolha modelo clássico/slim para uploads. A consulta ao catálogo é feita no backend com cache de uma hora, sem polling. Erros do catálogo não impedem uploads.

O mapeamento do [NameMC](https://pt.namemc.com/minecraft-skins) identificou galeria de tendências, cartões e detalhes `/skin/<id>`, mas as consultas automatizadas retornaram HTTP 403. Não há contorno desse bloqueio. Conforme a alternativa autorizada, a galeria usa a rota pública [MineSkin `/v2/skins/popular`](https://github.com/MineSkin/api.mineskin.org/blob/master/src/routes/v2/skins.ts), identificada como MineSkin na interface. Rankings não são atribuídos ao NameMC.

A alteração própria usa uma operação assinada separada `kind: skin`, `player.skin.set`, limitada ao ator da sessão, sem conceder comandos administrativos. Não é preciso ativar `writes-enabled`, `console-enabled` nem adicionar a operação à allowlist administrativa. Confirmação explícita no botão Aplicar, limite de duas solicitações/minuto por jogador e uma geração simultânea no agente. O PNG é validado novamente no plugin antes da assinatura pelo MineSkin via SkinsRestorer. A geração depende da conexão com esse serviço e pode aguardar a fila; `api.mineskinAPIKey` no SkinsRestorer é opcional conforme seu plano/configuração ([documentação](https://skinsrestorer.net/docs/integrations/mineskin)). Nenhuma chave nova é exigida no painel.

A seleção é persistida no armazenamento do SkinsRestorer. Se estiver autenticado online, o perfil recebe a skin na thread principal. Offline ou se o refresh falhar, a seleção permanece para o próximo login. Salvar e aplicar são resultados distintos. Operações não são repetidas automaticamente. Sem confirmação após 180 s, o resultado é desconhecido: confira a aparência antes de repetir.
