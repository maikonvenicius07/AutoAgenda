# AutoAgenda V3.8.7 — checklist

## Cancelamento rápido na Agenda de hoje

- [x] Botão **❌ Cancelar** aparece nas aulas ativas da Agenda de hoje.
- [x] Botão não aparece para aulas realizadas, com falta, canceladas ou arquivadas.
- [x] Antes do cancelamento há confirmação com aluno, data e horário.
- [x] Cancelamento usa `PATCH /api/aulas/:id/status` com `CANCELADA`.
- [x] Aula cancelada sai da agenda ativa e libera o horário.
- [x] Histórico da aula é preservado.
- [x] ADMIN e Instrutor responsável podem usar o atalho conforme suas permissões existentes.
- [x] Após cancelar, o sistema oferece procurar reposição.
- [ ] Validar no PostgreSQL/Render com uma aula de teste.
