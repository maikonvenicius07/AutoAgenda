# AutoAgenda V3.1.7 — Checklist final no Render

Use este checklist depois que o deploy da V3.1.7 terminar.

## 1. Deploy e conexão
- [ ] O deploy do Render terminou sem erro.
- [ ] A página inicial abriu normalmente.
- [ ] A tela de login apareceu.
- [ ] Após entrar, o indicador mostra banco conectado e V3.1.7.

## 2. ADMIN
- [ ] Login ADMIN funciona.
- [ ] Logout funciona e volta para a tela de login.
- [ ] ADMIN enxerga Painel, Alunos, Agenda, Planos, Lembretes, Relatórios, Financeiro, Backup, Usuários e Configurações.

## 3. INSTRUTOR
- [ ] Login INSTRUTOR funciona.
- [ ] Instrutor visualiza somente as áreas permitidas.
- [ ] Instrutor não consegue abrir módulos administrativos.
- [ ] Instrutor enxerga somente aulas/alunos vinculados às próprias atividades.

## 4. Alunos
- [ ] Criar aluno de teste.
- [ ] Preencher data de nascimento e salvar.
- [ ] Editar o aluno.
- [ ] Conferir histórico.
- [ ] Inativar e reativar o aluno, se aplicável.

## 5. Configurações básicas
- [ ] Criar/editar instrutor de teste.
- [ ] Criar/editar veículo de teste.
- [ ] Criar/editar local de teste.
- [ ] Conferir horários de funcionamento e disponibilidades.

## 6. Agenda e conflitos
- [ ] Criar uma aula válida.
- [ ] Editar a aula.
- [ ] Reagendar a aula.
- [ ] Cancelar aula de teste.
- [ ] Tentar sobrepor duas aulas do mesmo aluno e confirmar bloqueio.
- [ ] Tentar sobrepor duas aulas do mesmo instrutor e confirmar bloqueio.
- [ ] Tentar sobrepor duas aulas do mesmo veículo e confirmar bloqueio.
- [ ] Conferir controle de saldo do aluno.

## 7. Planos e histórico
- [ ] Gerar preview de plano.
- [ ] Criar plano de teste.
- [ ] Conferir aulas geradas e saldo.
- [ ] Conferir histórico do aluno.

## 8. Confirmação e lembretes
- [ ] Alterar confirmação da aula.
- [ ] Conferir os estados Aguardando / Confirmada / Pediu reagendamento.
- [ ] Conferir lembretes pendentes.
- [ ] Marcar lembrete como enviado e conferir registro.

## 9. Financeiro, painel e relatórios
- [ ] Abrir Dashboard e conferir os totais.
- [ ] Abrir Relatórios e aplicar período.
- [ ] Criar lançamento financeiro de teste.
- [ ] Editar/arquivar conforme as regras atuais.

## 10. Backup
- [ ] Baixar backup JSON.
- [ ] Baixar backup Excel.
- [ ] Baixar backup CSV.
- [ ] Abrir os três arquivos e conferir se não estão corrompidos.
- [ ] Conferir que a data de nascimento do aluno aparece no backup.

## 11. Interface
- [ ] Alternar modo claro/escuro.
- [ ] Atualizar a página e conferir se o tema permanece.
- [ ] Conferir em computador.
- [ ] Conferir em celular.

## Resultado
- [ ] TODOS OS TESTES ACIMA APROVADOS.

Se algum item falhar, anote o item, mensagem exibida e ação realizada antes do erro. Não avance para novas funcionalidades até corrigirmos a falha.
