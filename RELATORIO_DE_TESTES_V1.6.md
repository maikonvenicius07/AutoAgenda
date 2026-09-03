# Relatório de testes técnicos — AutoAgenda V1.6

Testes executados antes da entrega:

- `node --check server.js`: aprovado.
- `node --check public/app.js`: aprovado.
- Referências principais de IDs entre JavaScript e HTML: verificadas.
- Novo campo `cpf`: presente no HTML, frontend, API, migração automática e `schema.sql`.
- Validação de CPF: testada com CPF válido e sequência inválida.
- Índice único de CPF: criado de forma segura somente para valores preenchidos.
- Endpoint `/api/aulas`: já aceitava `data_inicio` e `data_fim` e agora é utilizado pela agenda semanal.
- Filtro semanal por instrutor: preservado.
- Filtro semanal por veículo: adicionado.
- Clique em célula livre: gera prefill de data/hora e filtros selecionados.
- Regras de conflito: não foram alteradas.

Limitação do teste local:
não foi utilizada a `DATABASE_URL` real do projeto. A confirmação final da migração PostgreSQL e das gravações deve ser feita após o deploy no Render usando o checklist.
