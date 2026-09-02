# AutoAgenda V1.3

Sistema web para gestão de aulas práticas de instrutor de autoescola.

## Destaques da V1.3

- Agenda automática por aluno
- Horário fixo e múltiplos dias da semana
- Geração de todas as aulas futuras a partir da data inicial
- Aulas simples ou duplas
- Prévia com verificação de conflitos
- Sugestão de horário em caso de conflito
- Alteração somente de uma aula ou desta e das próximas
- Reposição de aulas canceladas/faltas
- Indicadores de contratadas, realizadas, agendadas e ainda a programar
- Aba de planos automáticos
- PostgreSQL com migração automática

## Publicação

O projeto continua usando GitHub + Render + PostgreSQL.
As variáveis de ambiente do Render continuam as mesmas:

- `DATABASE_URL`
- `NODE_ENV=production`

Não publique credenciais no GitHub.
