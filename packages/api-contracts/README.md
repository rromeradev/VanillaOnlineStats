# Contratos de API

Heartbeat v1: heartbeat.schema.json, com exemplo em examples/heartbeat.v1.json.

JSON Schema 2020-12; habilite validação de formatos UUID/date-time. Campos extras são recusados. Tenant e autoridade sobre o servidor são resolvidos pelo backend usando a credencial do agente; o schema não substitui autenticação/autorização.

Instale requirements-test.txt e execute test_contract.py para validar os casos positivos e negativos. O plugin produz esse envelope; os testes da API validam também o JSON serializado pelo Java. Execute o build Java antes de pnpm -r test.

O agente 0.3.0 acrescenta telemetry-envelope.schema.json e control-body.schema.json. A API atual ainda não implementa essas rotas; o simulador scripts/smoke_release.py valida o lado do plugin. A assinatura Ed25519 cobre os bytes exatos do corpo decodificado. Regras adicionais de TTL, replay, escopo e confirmação são obrigatórias além da validação estrutural.
