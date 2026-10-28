# Contratos de API

Heartbeat v1: heartbeat.schema.json, com exemplo em examples/heartbeat.v1.json.

JSON Schema 2020-12; habilite validação de formatos UUID/date-time. Campos extras são recusados. Tenant e autoridade sobre o servidor são resolvidos pelo backend usando a credencial do agente; o schema não substitui autenticação/autorização.

Instale requirements-test.txt e execute test_contract.py para validar os casos positivos e negativos. O plugin ainda não produz este contrato; testes Java ↔ TypeScript serão necessários ao implementar o transporte.
