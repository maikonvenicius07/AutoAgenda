# Relatório técnico de testes — AutoAgenda V1.8

## Testes locais realizados

- `node --check server.js`
- `node --check public/app.js`
- `npm run check`
- conferência de IDs usados pelo frontend versus HTML;
- revisão das rotas novas de indisponibilidade;
- revisão da migração automática do PostgreSQL;
- revisão das chamadas de validação em aula manual, edição, série e plano automático.

## Observação

Os testes locais não escrevem no PostgreSQL real de produção porque a `DATABASE_URL` privada não é utilizada fora do Render.
O teste final de integração deve ser feito após o deploy usando `CHECKLIST_V1.8.md`.
