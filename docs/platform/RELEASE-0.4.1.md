# Plataforma 0.4.1

A área Player agora usa nick e senha do AuthMe e funciona com o jogador offline. /vos link não é necessário.

Atualize API/painel para 0.4.1 e o plugin para 0.3.2. Preserve .env, banco, identidade e chaves existentes. A configuração e instalação geral seguem o [guia 0.4.0](RELEASE-0.4.0.md); a instrução de gerar código é substituída pelo formulário de nick/senha.

O servidor Paper e seu canal de controle precisam estar ativos para validar a senha. A senha não é armazenada ou incluída no histórico. Contas com TOTP são recusadas até implementar segunda etapa. Jogadores precisam ter identidade conhecida no AuthMe/cache Paper para vincular corretamente o histórico. Perfil/histórico funcionam offline; consultas de inventário/estado ao vivo ainda dependem de personagem online e coleta habilitada.

Leia [detalhes do adaptador](../plugin/RELEASE-0.3.2.md). O papel web continua Player, nunca derivado de OP ou grupo no jogo. Limitação de tentativas por conta e origem e erros genéricos protegem o formulário.
