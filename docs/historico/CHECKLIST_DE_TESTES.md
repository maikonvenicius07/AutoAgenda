# Checklist de testes — AutoAgenda V1.4

Depois de atualizar no GitHub e o Render concluir o deploy:

- [ ] Abrir o AutoAgenda e confirmar **Banco conectado — AutoAgenda V1.4**.
- [ ] Abrir **Alunos** e confirmar que os alunos antigos continuam aparecendo.
- [ ] Editar um aluno e salvar sem perder os dados.
- [ ] Conferir o campo **Aulas realizadas antes de usar o AutoAgenda**.
- [ ] Criar um plano com 1 aula por encontro.
- [ ] Criar um plano com 2 aulas por encontro e quantidade ímpar; a última ocorrência deve consumir apenas 1 aula.
- [ ] Tentar gerar mais aulas que o saldo do aluno; o sistema deve bloquear.
- [ ] Criar um conflito de horário; a prévia deve avisar e sugerir outro horário quando possível.
- [ ] Alterar somente uma aula de um plano; as demais devem permanecer iguais.
- [ ] Alterar uma aula e marcar **aplicar às próximas**; os próximos dias/horários devem acompanhar a mudança.
- [ ] Encerrar um plano mantendo as aulas futuras.
- [ ] Testar outro plano com **Encerrar e cancelar futuras**.
- [ ] Marcar uma aula como REALIZADA e conferir o total do aluno.
- [ ] Testar CANCELADA/FALTOU e o botão de reposição.
- [ ] Atualizar a página com `Ctrl + F5` e conferir a persistência.
- [ ] Se configurar `AUTOAGENDA_USER` e `AUTOAGENDA_PASSWORD`, confirmar que o navegador pede autenticação.

Se algum item falhar, tire uma captura de tela e, se possível, envie também as últimas linhas de **Render > AutoAgenda > Logs**.
