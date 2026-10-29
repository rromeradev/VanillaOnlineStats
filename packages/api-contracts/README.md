# Contratos de API

Heartbeat v1: heartbeat.schema.json, com exemplo em examples/heartbeat.v1.json.

JSON Schema 2020-12; habilite validação de formatos UUID/date-time. Campos extras são recusados. Tenant e autoridade sobre o servidor são resolvidos pelo backend usando a credencial do agente; o schema não substitui autenticação/autorização.

Instale requirements-test.txt e execute test_contract.py para validar os casos positivos e negativos. O plugin produz esse envelope; os testes da API validam também o JSON serializado pelo Java. Execute o build Java antes de pnpm -r test.

O agente 0.3.0 acrescenta telemetry-envelope.schema.json e control-body.schema.json. A API 0.4 implementa ingestão e controle; scripts/smoke_release.py e scripts/smoke_platform.mjs validam protocolo e integração. O agente 0.3.1 também autoriza consultas Player apenas ao próprio UUID, igualdade verificada em tempo de execução. A assinatura Ed25519 cobre os bytes exatos do corpo decodificado. Regras adicionais de TTL, replay, escopo e confirmação são obrigatórias além da validação estrutural.

## Streaming 0.6.0 / agente 0.5.0

- Navegador: WebSocket `/api/v1/panel`, cookie HttpOnly e Origin exato. Envia `subscribe` com `id`, `serverId`, `section`, `hours` e consulta opcional `{operation, arguments}`; `unsubscribe` cancela. Recebe `snapshot`, `telemetry`, `player`, `event`, `query`, `alerts` e `server`, com o mesmo `id` da assinatura para descartar respostas antigas.
- Agente: `agent.capabilities.payload.streaming: true` negocia `agent.ready`. `agent.telemetry` transporta `messages` (envelopes v1); `agent.telemetry.ack.ids` confirma IDs após commit. Escopo e validação dos envelopes são iguais aos do endpoint HTTP.
- Assinatura nativa: corpo Ed25519 `kind: watch`, operação de leitura e argumentos `{watchId, query, stop}`. `actionId` e nonce são novos a cada renovação, enquanto `watchId` permanece estável. TTL do frame permanece até 30 s; a aceitação renova um lease local de 75 s. `watch.update` contém `watchId`, `epoch` (UUID da instância da assinatura), sequência crescente dentro dessa instância, estado, horário observado e payload; somente mudanças são enviadas. O fechamento do canal cancela as assinaturas. Operações de escrita não são permitidas em watches.
- O schema verifica a estrutura; igualdade ator/UUID, autorização, replay, TTL, limites, lease e filtragem dos dados são verificados também em runtime. Testes de API, agente Java, cliente e Paper real cobrem esse fluxo.
