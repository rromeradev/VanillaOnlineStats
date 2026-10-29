# Desenvolvimento

Requisitos: Node 24.22+, pnpm 10.34.9, Java 25 para o agente e PostgreSQL 18 para a plataforma.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm -r build
pnpm start
```

O comando de início usa variáveis do ambiente. Para desenvolvimento local, o gerador opcional `node scripts/setup-platform.mjs --email voce@exemplo.com` cria `.env` privado; nesse caso inicie com `node --env-file=.env apps/api/dist/main.js`. Este arquivo não faz parte do deploy no Coolify.

`infrastructure/compose.yml` é uma alternativa local com PostgreSQL: gere `.env` e execute `docker compose --env-file .env -f infrastructure/compose.yml up -d --build`.

Para desenvolver o painel separadamente, mantenha API em 3000, `APP_ORIGIN=http://localhost:4200` e execute `pnpm --filter @vanillaonlinestats/web start`. O proxy encaminha `/api`. Para compilar o plugin: `cd plugin` e `./gradlew.bat build` (Windows) ou `bash gradlew build` (Linux/macOS).

## Validação

- `pnpm -r test`: build Angular e testes API. Defina `TEST_DATABASE_URL` para executar os testes PostgreSQL em schemas descartáveis isolados.
- `python packages/api-contracts/test_contract.py`: contratos, após instalar `packages/api-contracts/requirements-test.txt`.
- Gradle: testes Java de compatibilidade, controle, replay e filas.
- `scripts/smoke_server.py`: Paper com/sem AuthMe e heartbeat legado.
- `scripts/smoke_release.py`: protocolo, privacidade, controles e reconexão.
- `scripts/smoke_platform.mjs`: Paper → API → PostgreSQL, mutação confirmada e login AuthMe offline. Requer os argumentos/caches definidos na CI e aceite prévio da EULA.

A CI também constrói o Dockerfile da raiz, conecta PostgreSQL e verifica login, arquivos JS/CSS, navegação SPA e endpoint de saúde. Scripts de teste operam em diretórios/schemas próprios; nunca aponte testes destrutivos para produção.

## Convenções

Documentação em pt-BR, identificadores do código em inglês, arquivos documentais canônicos em `docs/` com nomes em maiúsculas. Não mantenha cópias da mesma especificação ou guias separados por release; histórico fica no Git, releases e changelog. Segredos e artefatos compilados ficam fora do versionamento. Veja [contribuição](../CONTRIBUTING.md).
