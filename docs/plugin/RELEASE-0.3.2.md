# Agente 0.3.2 / plataforma 0.4.1

Login Player por nick e senha AuthMe, sem entrar no jogo e sem executar /vos link. Atualize o plugin e a plataforma juntos. Baseline: Paper 26.3 build 227, Java 25, AuthMe 6.0.1-b2770.

A senha é verificada pelo AuthMe em um worker, por uma solicitação assinada sobre WSS. Senhas e hashes não são gravados pela plataforma nem pela auditoria do plugin. O painel exige servidor com login Player habilitado e canal de controle conectado. Dados históricos podem ser acessados offline; consultas ao estado ao vivo continuam exigindo personagem online/autenticado.

Contas AuthMe com TOTP são recusadas neste fluxo até existir suporte à segunda etapa. O adaptador de política 2FA usa a estrutura da baseline fixada e falha fechado se incompatível. A identidade usa o UUID conhecido pelo AuthMe ou pelo cache de jogadores do Paper; não inventa UUIDs a partir do nick. Uma conta sem identidade conhecida é recusada. Nenhuma nova entrada no jogo é necessária quando o jogador já possui identidade conhecida.

O fluxo de código continua disponível por compatibilidade de protocolo, mas não é exigido nem mostrado no formulário de login. O plugin não autentica o personagem no Minecraft quando o usuário entra no portal.

Instalação da plataforma e endpoints: docs/platform/RELEASE-0.4.0.md. Em 0.4.1 a área Player solicita nick e senha, substituindo a instrução de gerar código no jogo. Aplique as políticas de coleta conforme a comunidade. Preserve banco e chaves ao atualizar.
