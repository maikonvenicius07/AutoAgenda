# AutoAgenda V3.1.1 — Checklist

## Alteração desta versão
- [x] Campo opcional `data_nascimento` criado na tabela `autoagenda.alunos`.
- [x] Migração automática adiciona a coluna em bancos existentes sem apagar dados.
- [x] Campo “Data de nascimento (aniversário)” adicionado ao cadastro do aluno.
- [x] Edição do aluno carrega e salva a data de nascimento.
- [x] Lista de alunos exibe a data quando informada.
- [x] Histórico do aluno exibe a data quando informada.
- [x] Backend valida formato da data e impede data futura.
- [x] Alunos antigos continuam compatíveis com o campo vazio.
- [x] Backup CSV, Excel e JSON inclui a coluna automaticamente por usar todas as colunas da tabela.

## Verificações executadas
- [x] `node --check server.js`
- [x] `node --check public/app.js`
- [x] `npm run check`
- [x] Conferência dos parâmetros SQL de INSERT e UPDATE do aluno.
- [x] Conferência das consultas de lista, edição e histórico do aluno.

## Conferência após publicar no Render
- [ ] Abrir “Novo aluno” e verificar o campo Data de nascimento.
- [ ] Salvar um aluno com data de nascimento.
- [ ] Editar o aluno e confirmar que a data volta preenchida.
- [ ] Confirmar a exibição da data no cartão do aluno.
- [ ] Confirmar a exibição da data no histórico.
- [ ] Testar que uma data futura é recusada.
- [ ] Conferir um aluno antigo sem data de nascimento.
- [ ] Exportar backup e confirmar a coluna `data_nascimento`.
