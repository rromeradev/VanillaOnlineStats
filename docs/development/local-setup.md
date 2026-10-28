# Bootstrap Paper

Baseline atual: **Paper 26.3 build 227 + Java 25 + AuthMe 6.0.1 Paper** (decisão do mantenedor em 28/10/2026).

Use Java 25 no JAVA_HOME. No diretório plugin:

- Windows: ./gradlew.bat clean build
- Linux/macOS: bash gradlew clean build

O JAR fica em plugin/build/libs/VanillaOnlineStats-0.1.0-SNAPSHOT.jar. Paper/AuthMe são dependências externas; não estão incluídos no JAR.

Em um servidor de testes separado, instale AuthMe-6.0.1-Paper.jar e o JAR do projeto em plugins/. Execute vos status no console ou /vos status com vanillaonlinestats.status (OP por padrão). Esta permissão local não cria identidade Admin/Owner do portal.

Sem AuthMe, o carregador Paper deve rejeitar o plugin antes de onEnable. Versões diferentes da baseline e API AuthMe indisponível também são recusadas.

## Teste reproduzível de carregamento

O script scripts/smoke_server.py cria dois diretórios novos, com e sem AuthMe, inicia servidores limitados a 127.0.0.1:25585, executa o comando de status e encerra os processos. Usa mundo descartável e não modifica servidores existentes.

Leia a EULA Minecraft antes de usar a opção --accept-eula. Exemplo a partir da raiz:

python scripts/smoke_server.py --java CAMINHO_JAVA_25 --paper CAMINHO_PAPER_227 --authme CAMINHO_AUTHME_PAPER --plugin plugin/build/libs/VanillaOnlineStats-0.1.0-SNAPSHOT.jar --output .tools/smoke --accept-eula

## Contratos

python -m pip install -r packages/api-contracts/requirements-test.txt
python packages/api-contracts/test_contract.py

Heartbeat v1 está em packages/api-contracts/heartbeat.schema.json. O backend deverá derivar o tenant da credencial, validar o vínculo do serverId, registrar receivedAt e deduplicar messageId por servidor. Esse contrato ainda não é emitido pelo plugin.

## Limites

Bootstrap e comando local; coleta, transporte, vínculo, autenticação web e administração remota serão implementados nas próximas fases. O smoke test não comprova autenticação de jogadores, performance ou compatibilidade integral.

## Resultado registrado em 28/10/2026

- Build e JUnit: aprovados com Java 25 e Gradle 9.2.1.
- Contratos: três testes aprovados, incluindo rejeição de campos extras, segredo, versão desconhecida e contagens inválidas.
- Servidor real Paper 26.3 build 227 com AuthMe: plugin habilitado, API pública acessível, vos status respondeu.
- Servidor real sem AuthMe: carregador recusou o plugin por UnknownDependencyException.
- Não houve login de jogador nem medição de desempenho neste teste.

Artefatos usados, com SHA-256 conferido contra a origem oficial:

- paper-26.3-227.jar: 416b7d105b1d0192df4afa4b29d2800d9dbeda092a82fbc5b511248a54adde15
- AuthMe-6.0.1-Paper.jar (versão interna 6.0.1-b2770): 7704335e9e73a634d9d926344f77897f4c74f78f82453a59f5aa0f8d2722450a

A CI repete o teste isolado nas duas condições e disponibiliza relatórios e logs como artefato.
