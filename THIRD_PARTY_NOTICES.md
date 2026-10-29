# Avisos de terceiros

Nenhum código ou binário de terceiros é distribuído neste bootstrap.
Paper e AuthMeReloaded são integrações planejadas, não estão incluídos.
Registrar dependência, versão, origem, licença e atribuições ao adicionar componentes; gerar SBOM antes das releases.

## Gradle Wrapper

plugin/gradle/wrapper/gradle-wrapper.jar e scripts do Gradle 9.2.1: Gradle Inc. e contribuidores, Apache-2.0.
Origem: https://github.com/gradle/gradle/tree/v9.2.1
Licença: https://github.com/gradle/gradle/blob/v9.2.1/LICENSE
É ferramenta de build, não incorporada ao JAR do plugin.

## Dependências de desenvolvimento

Paper API 26.3.build.227-stable: GPL-3.0 (conforme metadados upstream), compileOnly, não incluída no JAR.
JUnit 5.12.2: EPL-2.0, apenas testes.
jsonschema 4.23.0: MIT, apenas testes de contratos.
As dependências transitivas estão no lockfile/metadados Gradle. SBOM e revisão integral de distribuição continuam necessários antes da release.

## API e serialização

- Gson 2.14.0 (Apache-2.0): fornecido pelo runtime Paper, não incorporado ao JAR; utilizado também nos testes.
- NestJS 12.3.2, Express 5.3.0, AJV 8.20.0, ajv-formats 3.0.1: MIT.
- reflect-metadata 0.2.2 e TypeScript 5.9.3: Apache-2.0.
- RxJS 7.8.2: Apache-2.0.

Versões e integridade das dependências JavaScript em pnpm-lock.yaml; os pacotes distribuídos pelos gerenciadores mantêm seus textos de licença. O software não inclui binários Paper/AuthMe. Não há release de distribuição agregada nesta etapa.

## Portal e persistência 0.4.0

- Angular 22.2.3/CLI e build 22.2.5: MIT; TypeScript 6.0.3: Apache-2.0.
- node-postgres (pg) 8.23.1, ws 8.22.0 e tslib 2.8.1: MIT.
- PostgreSQL é serviço externo sob PostgreSQL License; Docker usa a imagem oficial.
- Node.js é runtime externo; textos de licença das dependências são mantidos nos pacotes instalados.

O bundle web contém Angular/RxJS/tslib; apps/web/dist/3rdpartylicenses.txt é gerado pelo build e deve acompanhar a distribuição. A lista completa de versões e integridade está em pnpm-lock.yaml. Nenhum Paper/AuthMe é redistribuído.
