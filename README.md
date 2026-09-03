# AutoAgenda V1.5 — Configurações e Agenda Semanal

Sistema web para organização de aulas práticas, com alunos, planos automáticos, agenda diária, agenda semanal e cadastros de apoio.

## Novidades da V1.5

- Nova aba **Configurações**.
- Cadastro, edição e exclusão segura de **instrutores**.
- Cadastro, edição e exclusão segura de **veículos**.
- Cadastro, edição e exclusão segura de **locais/pontos de encontro**.
- Recursos cadastrados passam a aparecer imediatamente nas aulas e nos planos automáticos.
- Exclusão protege o histórico: recursos usados por planos ativos ou aulas futuras não podem ser removidos até a realocação dos agendamentos.
- Nova **Agenda semanal**, de segunda a domingo.
- Navegação por semana anterior, hoje e próxima semana.
- Filtro da agenda semanal por instrutor.
- Clique em uma aula da agenda semanal para abrir a edição.
- Botão **+** em cada dia da semana para criar uma aula já com a data preenchida.
- Ao filtrar por instrutor, uma nova aula criada pela agenda semanal já seleciona esse instrutor.

## Atualização

Substitua os arquivos do repositório pelos arquivos desta versão e faça commit no GitHub. O Render deve realizar o deploy automaticamente.

Não é necessário criar outro banco de dados e não é necessário executar `schema.sql` manualmente. O `server.js` mantém a criação/migração automática do schema `autoagenda`.

## Variáveis de ambiente

Obrigatória:

- `DATABASE_URL`

Recomendadas:

- `NODE_ENV=production`
- `APP_TIMEZONE=America/Porto_Velho`
- `AUTOAGENDA_USER`
- `AUTOAGENDA_PASSWORD`

As duas últimas ativam a proteção básica por usuário e senha.

## Estrutura

- `server.js` — API, PostgreSQL e regras de negócio.
- `public/index.html` — interface.
- `public/app.js` — comportamento da interface.
- `public/style.css` — visual responsivo.
- `public/assets/` — imagens do projeto.
- `sql/schema.sql` — referência do banco.

## Versão

**1.5.0**
