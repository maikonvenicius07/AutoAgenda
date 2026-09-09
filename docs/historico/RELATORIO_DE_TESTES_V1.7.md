# Relatório técnico de testes — AutoAgenda V1.7

## Testes executados antes da entrega

### Sintaxe
- `node --check server.js` — aprovado.
- `node --check public/app.js` — aprovado.
- `npm run check` — aprovado.

### Interface
- IDs HTML verificados: 133.
- IDs HTML duplicados: 0.
- Referências diretas do JavaScript a IDs inexistentes: 0.

### Regras puras de funcionamento
Foram testados diretamente a partir das funções do `server.js`:

- aula válida em dia aberto — aprovado;
- bloqueio em domingo fechado no cenário de teste — aprovado;
- bloqueio antes da abertura — aprovado;
- bloqueio quando a aula termina depois do fechamento — aprovado;
- normalização dos dias selecionados — aprovado;
- rejeição de configuração sem nenhum dia — aprovado;
- geração de ocorrências do plano preservada — aprovado;
- ocorrências válidas do plano compatíveis com o horário configurado — aprovado.

## Limitação do teste local
Não foi feita escrita no PostgreSQL real do projeto porque a `DATABASE_URL` de produção não é utilizada nos testes locais. Depois do deploy no Render, execute `CHECKLIST_V1.7.md` para validar a integração real com o banco.
