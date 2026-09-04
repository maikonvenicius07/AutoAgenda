# Relatório de testes — AutoAgenda V2.7.0

## Escopo
ETAPA 13 — Relatórios.

## Testes executados
- `node --check server.js`: aprovado.
- `node --check public/app.js`: aprovado.
- `npm run check`: aprovado.
- HTML: 238 IDs encontrados, 238 únicos, 0 duplicados.
- JavaScript: 197 referências simples a IDs, 0 ausentes no HTML.
- Rotas Express: 57 rotas, 0 duplicadas.
- Funções declaradas: 38 no servidor e 80 no frontend, sem duplicidade de nome.

## Funcionalidade validada estaticamente
- rota `/api/relatorios/resumo` com período selecionável;
- validação de datas e limite de 366 dias;
- agregações por status, instrutor, veículo e horário;
- cálculo de ocupação estimada;
- carregamento sob demanda no frontend;
- layout responsivo e compatível com modo escuro;
- nenhuma migração de banco necessária.

## Observação
Os testes locais validam sintaxe, estrutura e consistência estática. A validação final dos números do relatório deve ser feita após o deploy no Render, usando os dados reais do PostgreSQL.
