# CHECKLIST V2.9.1 — Correção da exportação Excel

- [x] Mantido o endpoint `/api/backup/exportar`.
- [x] Mantidos CSV e JSON sem mudança funcional.
- [x] Removida a dependência `exceljs`.
- [x] Implementado gerador XLSX Office Open XML com `zlib` nativo do Node.
- [x] Workbook com múltiplas abas para backup completo.
- [x] Cabeçalho, congelamento da primeira linha, larguras e autofiltro preservados.
- [x] Textos escapados para XML e limitados ao tamanho aceito por célula.
- [x] Arquivo ZIP/XLSX validado estruturalmente.
- [x] XLSX de teste importado com sucesso por leitor de planilhas.
- [x] `node --check server.js`.
- [x] `node --check public/app.js`.
- [x] `npm run check`.
- [x] Nenhuma alteração no PostgreSQL.
- [ ] Teste final no Render após deploy.
