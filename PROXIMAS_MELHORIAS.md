# Próximas melhorias — AutoAgenda

Versão atual consolidada: **V2.9.1**.

Concluído até aqui: **ETAPAS 1 a 15** do roteiro principal.

## Concluído nesta versão

**ETAPA 15 — Backup e Exportação**

A nova área **💾 Backup** permite exportar:
- alunos;
- instrutores;
- veículos;
- locais;
- aulas;
- planos;
- financeiro;
- configurações.

Formatos disponíveis:
- CSV;
- Excel (.xlsx);
- JSON.

O backup completo também inclui tabelas auxiliares de indisponibilidade de instrutores e veículos, preservando dados necessários para uma futura restauração.

Credenciais do Render e variáveis de ambiente não fazem parte das exportações.

## Próxima etapa

**ETAPA 16 — Login individual**

Substituir futuramente o login básico por usuários individuais, com:
- nome;
- login;
- e-mail;
- senha armazenada com hash seguro;
- perfil;
- ativo/inativo;
- sessões seguras;
- proteção das rotas do backend.

Depois segue:
- ETAPA 17 — Permissões por usuário (Administrador e Instrutor).
