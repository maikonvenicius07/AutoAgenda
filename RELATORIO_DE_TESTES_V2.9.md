# Relatório de testes — AutoAgenda V2.9.0

## Escopo
ETAPA 15 — Backup / Exportação.

## Testes estáticos executados
- `node --check server.js`
- `node --check public/app.js`
- `npm run check`
- verificação de IDs duplicados no HTML;
- verificação de referências simples de IDs usadas no JavaScript;
- verificação de rotas Express duplicadas;
- inspeção das rotas de backup/exportação;
- inspeção de segurança para garantir que as exportações partem apenas do schema `autoagenda`.

## Resultado esperado das exportações
- JSON completo com metadados e dados separados por entidade;
- CSV individual tabular com separador `;` e BOM UTF-8;
- CSV completo consolidado por entidade;
- Excel completo com uma aba por conjunto;
- `Cache-Control: no-store` nas respostas de exportação;
- credenciais do ambiente ausentes dos arquivos.

## Observação sobre Excel
A geração `.xlsx` usa a dependência `exceljs 4.4.0`. O Render deve instalar essa dependência a partir do `package.json` no deploy. Os testes locais de sintaxe não executam uma conexão real com o PostgreSQL de produção.

## Banco
Nenhuma migração de banco é necessária na V2.9.0.
