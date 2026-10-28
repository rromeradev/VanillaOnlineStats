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
