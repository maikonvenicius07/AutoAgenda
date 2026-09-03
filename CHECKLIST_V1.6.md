# Checklist de testes — AutoAgenda V1.6

## Deploy
- [ ] Render concluiu o deploy sem erro.
- [ ] O topo mostra **AutoAgenda V1.6.0**.
- [ ] Alunos, aulas, planos e Configurações anteriores continuam aparecendo.

## CPF
- [ ] Abrir **Novo aluno** e confirmar o campo CPF.
- [ ] Digitar 11 números e confirmar a máscara `000.000.000-00`.
- [ ] Tentar salvar CPF inválido e confirmar que o sistema bloqueia.
- [ ] Cadastrar um aluno com CPF válido.
- [ ] Confirmar que o CPF aparece mascarado no cartão do aluno.
- [ ] Editar o aluno e confirmar que o CPF completo aparece no formulário.
- [ ] Tentar cadastrar o mesmo CPF em outro aluno e confirmar o bloqueio.

## Agenda semanal
- [ ] Abrir **Agenda semanal**.
- [ ] Confirmar dias em colunas e horários em linhas.
- [ ] Usar Semana anterior / Hoje / Próxima semana.
- [ ] Filtrar por instrutor.
- [ ] Filtrar por veículo.
- [ ] Confirmar que cada aula mostra aluno, instrutor, veículo, local e status.
- [ ] Clicar em uma aula existente e abrir a edição.
- [ ] Clicar em um horário livre e confirmar data/hora preenchidas na Nova aula.
- [ ] Com filtro de instrutor, clicar em horário livre e confirmar o instrutor pré-selecionado.
- [ ] Com filtro de veículo, clicar em horário livre e confirmar o veículo pré-selecionado.
- [ ] Criar a aula e confirmar que aparece na agenda diária e semanal.
- [ ] Tentar criar conflito de aluno/instrutor/veículo e confirmar que continua bloqueado.

## Regressão
- [ ] Criar/editar aluno.
- [ ] Criar aula manual.
- [ ] Editar aula.
- [ ] Criar plano automático.
- [ ] Abrir Configurações e testar instrutores, veículos e locais.
- [ ] Desativar e reativar um recurso de teste sem histórico.
