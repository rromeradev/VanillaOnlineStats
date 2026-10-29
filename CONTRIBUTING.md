# Contribuindo

Leia o README e docs/SPECIFICATION.md. Idioma da documentação: pt-BR; código e identificadores: inglês.

Abra uma issue descrevendo requisito, escopo (MVP/V1/FUTURO) e critérios de aceite. Envie PRs pequenas com motivação, validação e documentação. Mudanças de arquitetura, autenticação, coleta sensível, controle remoto ou licença requerem atualização em docs/ARCHITECTURE.md, com motivação e validação.

## DCO

Ao contribuir, você certifica a contribuição segundo o Developer Certificate of Origin 1.1: https://developercertificate.org/.

Assine cada commit com sua identidade real usando git commit -s (Signed-off-by: Nome <email>). As contribuições originais são oferecidas sob AGPL-3.0-only; preserve atribuição e licenças de terceiros.

## Validação

Nesta fase, confira links locais e a CI documental. Ao implementar módulos, inclua build, lint e testes adequados, especialmente isolamento tenant/servidor/jogador, autorização e proteção de credenciais. Não inclua segredos, bancos, mundos ou JARs de terceiros.
