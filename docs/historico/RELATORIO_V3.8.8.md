# Relatório — AutoAgenda V3.8.8

## Objetivo

Limpar e organizar o repositório sem alterar o comportamento funcional do AutoAgenda.

## Limpeza realizada

Foram removidas cópias antigas de arquivos da aplicação na raiz (`app.js`, `index.html`, `schema.sql` e `test-static.js`) e arquivos temporários de atualização. A documentação histórica foi agrupada em `docs/historico/`, enquanto documentos de operação e planejamento foram separados em pastas próprias.

Foi restaurado um `.gitignore` conservador para evitar o envio acidental de `.env`, `node_modules`, logs, caches, bancos locais, chaves/certificados e artefatos gerados.

## Arquivos oficiais após a limpeza

- frontend: `public/index.html`, `public/app.js`, `public/style.css`;
- backend: `server.js`;
- banco: `sql/schema.sql`;
- testes estáticos: `scripts/test-static.js`;
- deploy: `render.yaml`;
- dependências: `package.json` e `package-lock.json`.

## Resultado

A versão V3.8.8 é uma manutenção de organização. Não altera regras de agenda, planos, financeiro, confirmação, avaliação, backups ou permissões.
