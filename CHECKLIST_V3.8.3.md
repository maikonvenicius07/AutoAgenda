# CHECKLIST — AutoAgenda V3.8.3

## Correção principal
- [x] Corrigir alteração de aula quando `data_aula` antiga chega do PostgreSQL como objeto `Date`.
- [x] `dateOnlyUTC()` aceita `Date` válido e texto `AAAA-MM-DD`.
- [x] Datas inválidas retornam erro 400 claro em vez de erro interno genérico.
- [x] A correção também protege a alteração em série de aulas de plano automático.

## Validações
- [x] `node --check server.js`
- [x] `node --check public/app.js`
- [x] `npm run check`
- [x] `npm run test:static`

## Teste recomendado no Render
1. Abrir uma aula existente que faça parte de plano automático.
2. Alterar local, horário ou outro campo permitido e salvar sem marcar “Aplicar às próximas aulas”.
3. Confirmar que aparece “✅ Aula alterada.”.
4. Reabrir e conferir os dados.
5. Repetir marcando “Aplicar às próximas aulas do plano” em uma aula futura de teste.
