# CHECKLIST — AutoAgenda V3.8.0

## Avaliação para prova

- [ ] Entrar como INSTRUTOR.
- [ ] Abrir Alunos e confirmar o botão **🎯 Avaliar** em aluno vinculado ao instrutor.
- [ ] Registrar **🔄 Em avaliação**.
- [ ] Registrar **⚠️ Ainda não apto** com observações.
- [ ] Confirmar que “Ainda não apto” sem observações é recusado.
- [ ] Registrar **✅ Apto para prova**.
- [ ] Abrir **📚 Histórico** e confirmar que todas as avaliações permanecem em ordem da mais recente para a mais antiga.
- [ ] Confirmar nome do avaliador, perfil, data/hora e observações.
- [ ] Entrar como ADMIN e confirmar que também pode registrar avaliação.
- [ ] Confirmar que o INSTRUTOR não consegue avaliar aluno sem vínculo com suas aulas.
- [ ] Gerar backup JSON completo e confirmar a presença de `avaliacoes_aluno`.
- [ ] Rodar `npm run check`.
- [ ] Rodar `npm run test:static`.

## Resultado esperado

A avaliação mais recente aparece como status atual no cartão do aluno, sem apagar as avaliações anteriores.
