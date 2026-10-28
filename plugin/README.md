# Plugin Paper

Bootstrap para Paper 26.3 build 227 / Java 25 / AuthMe 6.0.1 Paper.

Compile com ./gradlew.bat clean build (Windows) ou bash gradlew clean build (Linux/macOS), neste diretório.

Consulte [setup e testes](../docs/development/local-setup.md) e o [guia de heartbeat](../docs/development/heartbeat.md). O comando /vos status exige vanillaonlinestats.status e mostra identidade, envio, falhas, descarte e último ACK. Heartbeat começa desativado, exige configuração e token no ambiente. Rede é executada fora do tick, com fila limitada, timeout e reconexão.
