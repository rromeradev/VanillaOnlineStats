# ADR: baseline inicial e bootstrap

Estado: aceito em 28/10/2026.

Por instrução do mantenedor, o alvo inicial é **Paper 26.3 build 227, Java 25, AuthMe 6.0.1 Paper**, substituindo a proposta 1.21.11/Java 21 do DRAFT-002. A especificação passa a DRAFT-003.

API Paper fixada em 26.3.build.227-stable, Gradle 9.2.1, lockfile e hashes de dependências. Builds adicionais dependem de nova validação.

Usamos plugin.yml clássico com dependência obrigatória AuthMe. A chamada inicial à API pública é getInstance, por reflexão isolada para verificar disponibilidade sem incorporar código AuthMe. A integração funcional e os adaptadores tipados ficam para F1. Isso não autoriza login web nem valida políticas premium/2FA.

Heartbeat v1 usa JSON Schema 2020-12 com campos fechados. tenantId será derivado da credencial no backend; serverId deve corresponder ao vínculo autenticado. receivedAt será registrado pela API. Transporte ainda não implementado.

Fontes oficiais:

- https://docs.papermc.io/paper/getting-started/
- https://docs.papermc.io/paper/dev/project-setup/
- https://fill.papermc.io/v3/projects/paper/versions/26.3/builds/227
- https://github.com/AuthMe/AuthMeReloaded/releases/tag/6.0.1

O JAR da release AuthMe 6.0.1 declara internamente a versão 6.0.1-b2770. A guarda de bootstrap exige este identificador real; outras builds são recusadas até validação. Não é usada correspondência por prefixo.
