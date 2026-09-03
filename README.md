# AutoAgenda V1.8 — Disponibilidade dos Instrutores

Sistema web para organização de aulas práticas com alunos, CPF, planos automáticos, agenda diária/semanal, configurações, horário de funcionamento e disponibilidade individual dos instrutores.

## Novidades da V1.8

- Cada instrutor pode **usar o horário geral da autoescola** ou ter disponibilidade própria.
- Configuração individual de:
  - dias em que trabalha;
  - horário inicial e final;
  - intervalo opcional (ex.: almoço);
  - folgas, férias e dias específicos indisponíveis.
- A validação de disponibilidade é aplicada a:
  - nova aula manual;
  - edição/reagendamento;
  - alteração em série;
  - prévia do plano automático;
  - criação do plano automático.
- Aulas já existentes nunca são apagadas ou remarcadas ao alterar a disponibilidade.
- Ao cadastrar uma folga que alcança aulas futuras, o AutoAgenda informa quantas aulas precisam ser revisadas.
- Migração automática e segura do PostgreSQL.

## Atualização

Substitua os arquivos da versão anterior, faça commit no GitHub e aguarde o deploy do Render.
Não é necessário executar SQL manualmente: `server.js` cria/migra as estruturas automaticamente.

## Banco

Novos campos em `autoagenda.instrutores`:

- `disponibilidade_personalizada`
- `dias_trabalho`
- `hora_inicio`
- `hora_fim`
- `intervalo_inicio`
- `intervalo_fim`

Nova tabela:

- `autoagenda.instrutor_indisponibilidades`

## Versão

**1.8.0**
