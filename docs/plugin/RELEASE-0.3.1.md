# Agente 0.3.1 para a plataforma 0.4.0

Baseline: Paper 26.3 build 227, Java 25 e AuthMe 6.0.1-b2770. Substitua o JAR 0.3.0 pelo 0.3.1 e reinicie o Paper; configuração v2 e identidade existentes são preservadas.

Esta atualização limita consultas do portal Player ao UUID do próprio ator, anuncia essa capacidade na conexão e usa HTTP/1.1 nos transportes de heartbeat/lotes para compatibilidade com o backend que também aceita WebSocket.

Instalação completa da API, portal e conexão: [guia da plataforma 0.4.0](https://github.com/rromeradev/VanillaOnlineStats/blob/v0.4.0/docs/platform/RELEASE-0.4.0.md). A cobertura, políticas de coleta e limitações do agente 0.3.0 permanecem aplicáveis: [matriz do agente](https://github.com/rromeradev/VanillaOnlineStats/blob/v0.4.0/docs/plugin/RELEASE-0.3.0.md).

Não coloque token no config.yml. Use VOS_AGENT_TOKEN no ambiente do processo Paper. O portal mostra endpoints, tenant e chave pública; mantenha a chave privada somente no backend. Escritas e coleta sensível continuam opt-in na configuração local.
