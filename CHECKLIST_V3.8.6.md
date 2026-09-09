# AutoAgenda V3.8.6 — correção definitiva do cancelamento

- [x] Cancelar aula usa caminho direto no backend.
- [x] Cancelamento não depende de saldo, conflito, disponibilidade ou horário de funcionamento.
- [x] Aula cancelada permanece no histórico.
- [x] Aula de plano cancelada fica marcada como exceção do plano.
- [x] Token de confirmação é invalidado ao cancelar.
- [x] Horário cancelado permanece liberado para nova aula.
- [x] Comunicação de cancelamento continua desacoplada da operação principal.
- [x] Erro de backend passa a devolver código diagnóstico quando disponível.
- [x] Testes de sintaxe e testes estáticos aprovados.

## Teste no Render
1. Abra uma aula AGENDADA ou CONFIRMADA.
2. Altere apenas `Situação da aula` para `Cancelada`.
3. Clique em `Salvar alterações`.
4. Deve aparecer `Aula cancelada. O horário foi liberado.`
5. A aula deve sair da agenda ativa e o horário deve aparecer como Livre.
6. Confirme no Histórico do aluno que a aula cancelada continua registrada.
