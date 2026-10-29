# Arquitetura

O monorepo reúne plugin Paper/Java, API NestJS e painel Angular. O build Docker usa a raiz como contexto e entrega painel/API no mesmo container; PostgreSQL é um serviço separado. O frontend usa URLs relativas, evitando configuração por domínio no build.

## Identidade e autorização

Cada agente é vinculado a tenant e serverId por token Bearer. Sessões web usam cookie HttpOnly/SameSite, CSRF e Origin exato para mutações. Owner/Admin são permissões da plataforma; OP ou grupos do jogo não concedem autoridade administrativa.

Player entra com nick/senha AuthMe, validada pelo plugin em worker através de WSS e solicitação assinada. A senha é transitória, não incluída no histórico. UUID é resolvido pelo AuthMe/cache Paper; identidade desconhecida e contas TOTP são recusadas. Não exige jogador online. Consultas ao vivo ainda dependem de personagem autenticado e privacidade local habilitada. O fluxo de código permanece somente para compatibilidade, sem ser exigido pelo formulário.

## Telemetria e controle

Filas e amostragens do agente são limitadas; snapshots são coalescidos e lotes recebem ACK por mensagem. Spool AES-GCM é opcional, com chave independente e retenção de cinco minutos. Telemetria não promete entrega sem perdas.

O canal de controle é de saída, com Ed25519, tenant/servidor/ator, TTL, nonce e auditoria antes/depois. Escritas exigem opt-in e allowlist no plugin. Alto risco exige Owner/reautenticação na API. Uma execução sem resultado confirmado fica UNKNOWN; não é reenviada automaticamente.

Payloads e resultados persistidos são cifrados por AES-256-GCM com contexto tenant/servidor. Contratos versionados ficam em `packages/api-contracts`. A baseline fixada evita prometer compatibilidade com versões não verificadas.

## Limites atuais

Uma instância de API por instalação: sockets e solicitações pendentes são locais ao processo. Retenção automática: mensagens 30 dias, últimas projeções 7 dias, resultados de consultas/ações 7 dias. Auditoria, identidades e pedidos de privacidade não expiram automaticamente. Histórico retorna até 500 eventos ou 1.000 amostras/registros exportados, sem paginação histórica completa.

Pedidos de exportação/exclusão são registrados para atendimento manual. Não há MFA web, reset de senha por e-mail, convites por e-mail nem operação SaaS. Integrações opcionais seguem a [cobertura do plugin](PLUGIN.md). Perfis observados não garantem presença atual; sem sinal recente o servidor é marcado offline.

## Evolução

A baseline foi definida primeiro, seguida por heartbeat mínimo, agente funcional, API/painel e login AuthMe offline. O deploy GitHub App foi padronizado em Dockerfile na raiz; configurações locais são auxiliares. Mudanças de arquitetura, identidade e controles devem atualizar este documento e incluir motivação e testes na descrição do commit/PR. A [especificação](SPECIFICATION.md) registra a visão original; a cobertura atual é descrita aqui, no plugin e no roadmap.
