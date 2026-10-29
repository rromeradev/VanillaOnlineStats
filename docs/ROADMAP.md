# Roadmap

A [especificação](SPECIFICATION.md) registra a visão original. A [arquitetura](ARCHITECTURE.md) e a [cobertura do plugin](PLUGIN.md) descrevem o comportamento atualmente implementado.

- [x] Plugin Paper 26.3/Java 25, integração obrigatória AuthMe e baseline verificada.
- [x] Telemetria, coletores, eventos, filas limitadas, spool opcional e controle assinado.
- [x] API PostgreSQL com isolamento tenant/servidor, sessões, histórico, auditoria e alertas.
- [x] Painel responsivo com áreas Owner/Admin e Player e temas claro/escuro/automático.
- [x] Login Player por nick/senha AuthMe, sem jogador conectado nem /vos link.
- [x] Deploy por GitHub App no Coolify com Dockerfile na raiz e variáveis de runtime.
- [ ] Paginação histórica completa, rankings e metas.
- [ ] Atendimento automático de solicitações de exportação/exclusão.
- [ ] Segunda etapa TOTP no login web e recuperação de senha por e-mail.
- [ ] Validar integrações opcionais e implementar adaptadores ainda ausentes.
- [ ] Benchmarks com jogadores reais e ampliar a matriz de compatibilidade.
- [ ] Recursos de host/rollback e operação SaaS, após amadurecer o self-hosted.
