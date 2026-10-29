# Self-hosted

**Coolify:** use o [guia dedicado](../docs/deployment/coolify.md) e `docker-compose.coolify.yml` da raiz. Ele recebe variáveis pelo Coolify e não publica portas no host.

Dockerfile multi-stage e Compose com PostgreSQL 18. Siga o [guia 0.4.0](../docs/platform/RELEASE-0.4.0.md). Gere .env antes do primeiro início. O banco não publica porta; o portal fica no loopback do host.
