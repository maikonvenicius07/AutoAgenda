# Checklist — AutoAgenda V3.8.5

## Correção de atualização/cancelamento de aula

- [x] Cancelamento pelo ADMIN usa a rota específica de status quando nenhum dado estrutural da aula foi alterado.
- [x] Aula cancelada continua preservada no histórico.
- [x] Horário cancelado permanece livre para novo agendamento.
- [x] Alteração de confirmação isolada usa a rota específica de confirmação.
- [x] Datas vindas do PostgreSQL como objeto `Date` são normalizadas antes de comparações de status/saldo.
- [x] Alteração em série aceita corretamente datas vindas do PostgreSQL.
- [x] Erros inesperados da edição estrutural podem retornar um código diagnóstico seguro.
- [x] Nenhuma alteração de schema foi necessária.
- [x] `npm run check` aprovado.
- [x] `npm run test:static` aprovado: 107/107.

## Teste recomendado no Render

1. Abra uma aula AGENDADA de um plano automático.
2. Altere somente `Situação da aula` para `Cancelada`.
3. Clique em `Salvar alterações`.
4. Confirme a mensagem `Aula cancelada. O horário foi liberado.`
5. Verifique que a aula cancelada sumiu da agenda ativa.
6. Cadastre outra aula no mesmo horário.
7. Confirme que a aula cancelada continua no histórico do aluno.
