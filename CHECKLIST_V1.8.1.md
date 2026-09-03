# Checklist de testes — AutoAgenda V1.8.1

## 1. Segurança e deploy

- [ ] Antes do deploy, `AUTOAGENDA_USER` foi configurado no Render.
- [ ] Antes do deploy, `AUTOAGENDA_PASSWORD` foi configurado no Render.
- [ ] A senha não foi salva em arquivo do GitHub.
- [ ] O Render concluiu o deploy sem erro.
- [ ] Ao abrir o site em uma janela anônima, o navegador solicita usuário e senha.
- [ ] Credencial incorreta não permite entrar.
- [ ] Credencial correta permite entrar.
- [ ] `/api/health` retorna `version: 1.8.1`.
- [ ] `/api/health` retorna `security_ready: true`.

## 2. Alunos e CPF

- [ ] Lista de alunos continua carregando normalmente.
- [ ] CPF aparece mascarado na lista.
- [ ] Abrir **Editar aluno** carrega o CPF completo no formulário.
- [ ] Novo aluno com CPF válido pode ser cadastrado.
- [ ] CPF duplicado é bloqueado.
- [ ] Desativar um aluno funciona.
- [ ] **Mostrar inativos** exibe o aluno desativado.
- [ ] **Reativar aluno** funciona.
- [ ] Aluno reativado volta a aparecer normalmente nas novas aulas/planos.

## 3. Saldo de aulas

Crie/use um aluno de teste com saldo conhecido.

- [ ] Nova aula manual dentro do saldo é aceita.
- [ ] Nova aula manual acima do saldo é bloqueada.
- [ ] Alterar uma aula de 1 para mais unidades, ainda dentro do saldo, funciona.
- [ ] Alterar para quantidade acima do saldo é bloqueado.
- [ ] Plano automático continua respeitando o saldo.
- [ ] Marcar uma aula como REALIZADA atualiza corretamente os totais.

## 4. Histórico e arquivamento

- [ ] Aula AGENDADA pode ser arquivada.
- [ ] A aula arquivada some da agenda operacional.
- [ ] O registro continua no PostgreSQL, sem exclusão física.
- [ ] Aula REALIZADA não mostra ação comum de arquivamento.
- [ ] Aula FALTOU não mostra ação comum de arquivamento.
- [ ] Tentar arquivar REALIZADA/FALTOU diretamente pela API é bloqueado.

## 5. Mudança de status

- [ ] CANCELADA → AGENDADA só funciona se o horário continuar válido.
- [ ] Reativação com conflito é bloqueada.
- [ ] Reativação fora do horário da autoescola é bloqueada.
- [ ] Reativação fora da disponibilidade do instrutor é bloqueada.
- [ ] Reativação acima do saldo do aluno é bloqueada.

## 6. Disponibilidade do instrutor

- [ ] Configure um intervalo individual do instrutor.
- [ ] Tente criar aula dentro do intervalo: deve bloquear.
- [ ] Cadastre uma folga/indisponibilidade.
- [ ] Tente criar aula nesse período: deve bloquear.
- [ ] Quando houver conflito, a sugestão de próximo horário não deve sugerir horário em folga ou intervalo do instrutor.

## 7. Agenda e desempenho

- [ ] Agenda diária carrega a data selecionada.
- [ ] Agenda semanal carrega a semana correta.
- [ ] Clicar numa aula da agenda semanal abre a edição corretamente.
- [ ] Painel continua mostrando os totais principais.
- [ ] Planos automáticos continuam aparecendo.
- [ ] Configurações de instrutor, veículo e local continuam funcionando.

## 8. Regressão geral

- [ ] Criar aluno.
- [ ] Editar aluno.
- [ ] Criar aula.
- [ ] Editar aula.
- [ ] Criar plano automático.
- [ ] Encerrar plano.
- [ ] Repor aula cancelada/falta.
- [ ] Horário de funcionamento continua válido.
- [ ] Disponibilidade individual do instrutor continua válida.

## Aprovação

A V1.8.1 deve ser considerada aprovada somente depois que os itens críticos de Segurança, CPF, Saldo e Histórico estiverem funcionando no Render com o PostgreSQL real.
