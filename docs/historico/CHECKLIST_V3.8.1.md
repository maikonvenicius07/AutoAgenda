# CHECKLIST — AutoAgenda V3.8.1

## Exclusão de lançamento financeiro

- [ ] Entrar como ADMIN.
- [ ] Abrir **💰 Financeiro**.
- [ ] Criar um lançamento de teste.
- [ ] Confirmar que aparecem **✏️ Editar**, **🗃️ Arquivar** e **🗑️ Excluir**.
- [ ] Clicar em **🗑️ Excluir** e conferir se a confirmação mostra aluno, pacote, valor do pacote e valor pago.
- [ ] Cancelar a confirmação e verificar que o lançamento permanece.
- [ ] Repetir e confirmar **Excluir definitivamente**.
- [ ] Confirmar que o lançamento desaparece e os totais financeiros são recalculados.
- [ ] Confirmar que nenhuma aula, plano ou saldo de aulas do aluno foi alterado.
- [ ] Confirmar que **Arquivar/Reativar** continuam funcionando.
- [ ] Entrar como INSTRUTOR e confirmar que o módulo Financeiro continua sem acesso.
- [ ] Rodar `npm run check`.
- [ ] Rodar `npm run test:static`.

## Resultado esperado

Um lançamento financeiro cadastrado por engano pode ser removido definitivamente pelo ADMIN, enquanto registros válidos podem continuar sendo apenas arquivados.
