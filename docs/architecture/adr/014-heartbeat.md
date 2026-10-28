# ADR-014: heartbeat autenticado inicial

Aceito em 28/10/2026. Escopo: F1 parcial e início de F2.

O plugin observa a contagem de jogadores no scheduler principal do Paper a cada 10 segundos (configurável entre 5 e 60). Cria um envelope imutável com horário, versões e uptime da JVM. Não coleta identidade, posição, inventário, IP ou dados de autenticação dos jogadores.

server-id.txt contém um UUID persistente da instalação. Identidade corrompida desativa o plugin em vez de gerar vínculo novo silenciosamente. Não clone o mesmo arquivo entre servidores diferentes.

Uma única amostra pendente é substituída pela mais recente; um único worker faz HTTP fora do tick. Timeout padrão: 3 segundos. Cada mensagem tem no máximo três tentativas; backoff exponencial com jitter, limitado a aproximadamente 60 segundos. Novas amostras respeitam o backoff global. Respostas 4xx permanentes não são repetidas; há cooldown de 60 segundos. Os contadores expõem envio, falha e amostras substituídas/descartadas. Desligamento cancela tarefas e rede sem aguardar na thread do Paper.

O transporte usa HTTPS, não segue redirects e não imprime endpoint, cabeçalhos, payload, senha ou exceção de rede. HTTP requer habilitação explícita e IP literal de loopback, apenas para desenvolvimento no mesmo computador. A resposta é limitada a 8 KiB; só confirma ACK com HTTP 202, messageId correspondente, receivedAt válido e flag duplicate booleana. Respostas genéricas de proxies não confirmam recebimento.

A API NestJS 12.3.2/Node 24 usa o JSON Schema compartilhado via AJV 2020-12. Um agente é provisionado manualmente por processo, com serverId e tenantId fixados no ambiente. O plugin recebe token aleatório de 256 bits pelo ambiente; a API guarda somente SHA-256 e compara em tempo constante. tenantId não é aceito do corpo; um token não pode enviar dados de outro serverId. Não existe endpoint de leitura administrativa público.

O bootstrap manual é substituível pelo onboarding com prova de posse na F2. Rotação exige novo token no plugin e novo hash na API, preservando tenantId e serverId. Reinicie os processos. Nenhum login Player usa essa credencial.

Limites: corpo 8 KiB, 30 requisições autenticadas/minuto, teto global 600/minuto, 64 conexões simultâneas. Mensagens fora de uma janela de dois minutos são rejeitadas. Deduplicação em memória, TTL cinco minutos, no máximo 1024 IDs; repetir ID com corpo diferente gera conflito. Repetições exatas retornam ACK sem renovar liveness; amostras antigas não substituem a observação mais recente.

O estado é efêmero, limitado e perdido ao reiniciar a API. PostgreSQL, migrações, vínculo do Owner, sessões web, painel e histórico ficam para F2. O modo continua self-hosted, sem serviço externo obrigatório. Idempotência durável e retenção serão implementadas com o banco.

Antes da primeira emissão real, o contrato preliminar v1 ganha paperVersion obrigatório para identificar o build Paper, além de minecraftVersion. A versão 0.1 apenas definiu o contrato; não havia produtor/consumidor implantado. A partir desta implementação, mudanças incompatíveis exigem nova versão de schema.

Fontes: documentação oficial [NestJS controllers](https://docs.nestjs.com/controllers), [body parser](https://docs.nestjs.com/faq/raw-body), [Java 25 HttpClient](https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpClient.html).
