# Checklist — AutoAgenda V3.8.4

## Objetivo
Fazer com que aulas CANCELADAS preservem o histórico sem ocupar a agenda ativa.

## Verificações automáticas
- [x] API de agenda exclui CANCELADA por padrão.
- [x] Agenda diária possui filtro defensivo para CANCELADA.
- [x] Agenda semanal possui filtro defensivo para CANCELADA.
- [x] Conflito continua considerando somente AGENDADA/CONFIRMADA.
- [x] Histórico do aluno continua consultando todos os registros.
- [x] Sintaxe de `server.js` e `public/app.js` validada.
- [x] `npm run test:static` aprovado.

## Teste após deploy
1. Encerre um plano com cancelamento das aulas futuras ou marque uma aula como CANCELADA.
2. Abra a Agenda semanal.
3. Confirme que a aula cancelada não aparece mais na célula.
4. Confirme que a célula mostra **+ Livre**.
5. Cadastre uma nova aula no mesmo dia/horário.
6. Abra o Histórico do aluno original e confirme que o cancelamento permanece registrado.
