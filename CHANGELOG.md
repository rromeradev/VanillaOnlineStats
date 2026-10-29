# Changelog

## 0.5.1 — 2026-10-29

- Todas as telas carregam automaticamente; removidos os botões de atualizar e de iniciar consultas de inventário, estatísticas e conquistas.
- Consultas administrativas acompanham automaticamente a operação e o alvo selecionados; ações continuam exigindo confirmação explícita.
- Atualizações continuam com detalhes abertos; formulários em edição são preservados e abas ocultas suspendem leituras automáticas.
- Leituras assinadas possuem orçamento independente de ações, cache compartilhado entre abas, auditoria agrupada por observação e recuperação automática com espera progressiva.
- Plugin 0.4.1: desempenho e mundos coletados a cada segundo com amostragem limitada; limites separados para consultas e mutações.

## 0.5.0 — 2026-10-29

- Plugin 0.4.0: snapshots de jogadores autenticados a cada segundo, limitados pelo orçamento de coleta.
- Atualização automática por SSE autenticado e isolado por servidor, reconexão e atualização periódica de recuperação.
- Controles anunciam a política local e retornam motivos específicos; broadcast verificado com Paper real.
- Ícones, metadados e renders de itens/blocos pela BlocksItems API 2026.1.2, com limites e cache.
- Cabeças e modelos 3D a partir da skin aplicada no Paper; integração opcional com a API pública do SkinsRestorer.
- Desconectar do Minecraft preserva a sessão web; logout explícito continua revogando-a.

- Stack Compose completo para Coolify 4.5.3, com exemplos de variáveis, geração nativa de senhas/Base64 e UUID/Ed25519 persistentes.
- Testes de identidade automática, preservação no redeploy e rotas do painel no stack completo.


- Dockerfile na raiz para Git Repository com GitHub App no Coolify; variáveis somente em runtime e PostgreSQL separado.
- Documentação consolidada em docs/, removendo duplicatas, guias antigos por release e diretórios sem implementação.
- Comando start padronizado e verificação de rotas SPA/JS/CSS no deploy.


- Deploy Coolify via Compose na raiz, variáveis runtime obrigatórias e PostgreSQL interno persistente.
- Gerador privado de variáveis para Coolify, guia de instalação e teste da configuração na CI.

## 0.4.1 — 2026-10-29

- Login Player por nick/senha AuthMe, sem presença no jogo e sem /vos link.
- Plugin 0.3.2: verificação assíncrona, resolução de UUID conhecido e recusa de contas TOTP.
- Credenciais transitórias, sem persistência; limites por conta e origem.


## 0.4.0 — 2026-10-28

- API persistente PostgreSQL: lotes, snapshots, histórico, alertas e isolamento tenant/servidor.
- Portal Angular responsivo com temas claro, escuro e padrão do sistema.
- Autenticação Owner/Admin, vínculo e rotação de agentes, membros e troca de senha.
- Área Player por código in-game, perfil, jornada, inventário, estatísticas e conquistas.
- Consultas e todas as ações tipadas do agente através de WebSocket assinado e auditoria.
- Dockerfile, Compose, configuração privada inicial e guia de instalação.
- Plugin 0.3.1: consultas Player limitadas ao UUID do próprio ator, anunciadas nas capacidades.
- Testes PostgreSQL de autorização/persistência e integração com Paper real.

## 0.3.0 — 2026-10-28

- Release funcional do plugin: coletores de servidor, JVM/performance, mundos e jogadores; consultas limitadas de chunks, entidades, inventários, estatísticas e advancements.
- Eventos AuthMe e gameplay, políticas de privacidade e código in-game de vinculação.
- Telemetria em lotes, fila por bytes/mensagens e spool AES-GCM opcional.
- Canal WSS com assinaturas Ed25519, escopo tenant/servidor, TTL e auditoria/replay persistentes.
- Ações tipadas de moderação, jogador e mundo; console opt-in com restrições.
- Migração de configuração v1 → v2, comandos de diagnóstico e testes de protocolo no Paper real.
- Integrações opcionais/futuras, limitações e requisitos da API registrados na matriz de cobertura.

## 0.2.0-SNAPSHOT

- Heartbeat básico com identidade persistente, fila limitada, timeout, backoff e status local.
- API NestJS autenticada por agente, vinculada ao tenant/servidor e validada pelo contrato compartilhado.
- Testes de contrato Java/TypeScript e envio real Paper → API com queda e reconexão.
- Guia de provisionamento manual self-hosted; API guarda estado apenas em memória nesta etapa.

- Baseline Paper 26.3 build 227 / Java 25 / AuthMe 6.0.1-b2770.
- Plugin inicial, comando /vos status e dependência obrigatória AuthMe.
- Gradle Wrapper 9.2.1, locks, checksums, JUnit e CI de build.
- Contrato heartbeat v1, testes negativos e script de smoke test isolado.
- Blueprint atualizado a DRAFT-003 por decisão do mantenedor.

- Estrutura documental inicial do monorepo.
- Blueprint DRAFT-002 preservado em docs/SPECIFICATION.md.
- Licença AGPL-3.0-only, DCO e orientações de comunidade.
- Templates de colaboração e CI documental.
