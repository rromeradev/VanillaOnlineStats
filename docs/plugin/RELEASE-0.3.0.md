# VanillaOnlineStats 0.3.0 — plugin

Build estável do agente para Paper 26.3 build 227, Java 25 e AuthMe 6.0.1-b2770. Esta release amplia o agente; não torna concluídas todas as funcionalidades futuras do blueprint. A matriz abaixo é o contrato de cobertura desta versão. Não há frontend nem backend novo nesta entrega.

## Funcionalidades presentes

| Área | Implementação |
|---|---|
| Inicialização | Dependência obrigatória AuthMe; baseline verificada; identidade persistente; migração config v1 → v2 com backup |
| Heartbeat | Compatível com API 0.2; envio assíncrono, ACK validado, timeout, backoff, contadores |
| Servidor | Versões, implementação, MOTD, capacidade, modo online, whitelist e plugins |
| Performance | TPS, MSPT médio e percentis da janela disponível, slow ticks, heap/non-heap, threads, GC, uptime, CPU e memória visíveis à JVM/container |
| Mundos | Identidade, dimensão, clima, tempo, dificuldade, chunks/entidades carregados, regras disponíveis, border, spawn/seed sob política |
| Chunks/blocos | Apenas carregados; amostragem opcional limitada, block entities, entidades, biome/luz/potência sob demanda; sem carregar mundos/chunks para consultas |
| Entidades | Tipo, UUID, estado/vida, equipamentos sob política, mobs, villagers e itens sob demanda |
| Jogadores | Estado autenticado, UUID com origem Paper declarada, nickname, ping, locale, gamemode, saúde/fome/XP, efeitos; posição/IP/inventário/Ender Chest opcionais |
| Estatísticas | Estatísticas nativas sem parâmetro paginadas; estatísticas por material ou entidade consultáveis individualmente; advancements paginados com datas |
| AuthMe | Login, logout, restauração, registro e exclusão pelo jogador; sessões com duração; código in-game de uso único após autenticação |
| Eventos | Entrada/saída, morte/dano/PvP, progressão, XP, itens, crafting/smelting, veículos, mundos/chunks, clima; blocos/entidades de alto volume opcionais |
| Privacidade | Campos sensíveis desativados por padrão; nenhum hash/senha AuthMe é consultado; auditoria de comandos guarda apenas raiz explicitamente permitida |
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
- O login web por senha não está habilitado. O plugin oferece prova de autenticação por código in-game; senha isolada não substitui a política premium/2FA do AuthMe. A API futura deve consumir o fluxo de código e aplicar sua própria política de sessão.
- O identificador exportado é UUID Paper com origem explícita. Reconciliação de aliases e identidades premium/offline depende do backend e não pode ser deduzida apenas pelo nickname.
- Estatísticas históricas, rankings, metas, alertas, retenção longa e cálculo de online/offline pertencem ao backend.
- Ainda não há benchmark com carga de jogadores reais. Os budgets controlam amostragens, não interrompem uma chamada nativa que já começou. Uma consulta pode ultrapassar o orçamento; as durações são expostas.

## Atualização a partir de 0.2

1. Pare o Paper, faça backup da pasta do plugin e substitua o JAR.
2. Preserve server-id.txt e VOS_AGENT_TOKEN. O heartbeat continua compatível com sua API atual.
3. A configuração vira schema-version 2; config-v1.backup.yml é preservado. Os campos novos recebem defaults conservadores.
4. O envio completo e o controle continuam desligados até configurar os endpoints correspondentes. A API 0.2 só recebe heartbeat.

Use `vos status`, `vos collectors`, `vos capabilities` e `vos queue`. No console, `vos query server.performance` e `vos query worlds.list` permitem validar coleta antes de desenvolver o frontend. Consultas com argumentos usam JSON: `vos query world.snapshot {"worldId":"UUID"}`.

## Configuração de telemetria e controle

`telemetry.endpoint`: `https://DOMINIO/api/v1/agents/telemetry/batches`.

`control.endpoint`: `wss://DOMINIO/api/v1/agents/control`; `control.tenant-id` deve ser UUID; `control.public-key` é Ed25519 pública X.509 DER em Base64. A chave privada pertence somente à futura API. A credencial de agente não autoriza comandos sozinha.

`control.writes-enabled`, `control.allowed-operations`, `control.console-enabled` e `control.allowed-console-roots` são configurados localmente. Nenhum comando remoto habilita suas próprias permissões. Um PLAYER só pode resgatar um código de vinculação; nunca consultar dados administrativos ou alterar o jogo.

`VOS_STORAGE_KEY` contém 32 bytes aleatórios codificados em Base64. Preserve a chave para recuperar o spool; chave incorreta ou spool corrompido recusa inicialização. Sem chave, não há persistência de telemetria. Checkpoints têm janela de até dois segundos e a retenção é de cinco minutos; não há promessa de entrega sem perdas. O status expõe descartes e falha de armazenamento.

Auditoria em control-audit.jsonl e um segmento anterior, até cerca de 16 MiB totais; sem argumentos, senhas ou resultados privados. Claims são persistidos antes da execução e recusados em replay. Uma queda entre mutação e resultado deixa PENDING: o backend deve mostrar resultado desconhecido, sem reenviar automaticamente uma operação destrutiva.

## Protocolo do controle

WebSocket usa Authorization Bearer na abertura; primeiro envia `agent.capabilities`. Entrada: `{"body":"BASE64URL_BYTES_JSON","signature":"BASE64URL_ED25519"}`. Assine os bytes exatos decodificados de body, não o wrapper nem uma serialização diferente. Limite: 32 KiB no corpo, 64 KiB no frame lógico, 30 solicitações/minuto, oito solicitações em execução.

O corpo segue packages/api-contracts/control-body.schema.json. O TTL máximo é 30s. Resultado: `control.result` com actionId, auditCorrelationId, state e payload. Estados finais SUCCEEDED/FAILED/REJECTED/EXPIRED; PENDING é persistido antes da execução. Mensagens inválidas recebem control.rejected sem ecoar conteúdo.

Consulta: kind=query; operation é uma das operações de vos capabilities; arguments contém worldId/playerId/entityId conforme a consulta. Ação: kind=action; operação explicitamente permitida. Link: kind=link, operation=player.link.redeem, arguments.code; o código é gerado por `/vos link` e expira em 120s, é revogado no logout e só pode ser usado uma vez. Não registre esse código em filas duráveis ou logs do backend.

O simulador scripts/smoke_release.py é a referência executável do protocolo. Ele não é uma API de produção e não deve ser exposto publicamente.
