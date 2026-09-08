# Checklist V2.9.0 — Backup / Exportação

## Deploy
- [ ] Substituir os arquivos do pacote de atualização no GitHub.
- [ ] Confirmar que o Render concluiu o deploy sem erro.
- [ ] Confirmar no topo: AutoAgenda V2.9.0.
- [ ] Não alterar DATABASE_URL, AUTOAGENDA_USER ou AUTOAGENDA_PASSWORD.

## Tela Backup
- [ ] Abrir a aba 💾 Backup.
- [ ] Conferir contagem de alunos.
- [ ] Conferir contagem de aulas.
- [ ] Conferir contagem de planos.
- [ ] Conferir contagem do financeiro.

## JSON
- [ ] Baixar “Backup completo” em JSON.
- [ ] Abrir o arquivo e confirmar que existe `tipo: AUTOAGENDA_BACKUP_COMPLETO`.
- [ ] Confirmar que há dados de alunos, instrutores, veículos, locais, aulas, planos, financeiro e configurações.
- [ ] Confirmar que DATABASE_URL e senhas não aparecem no arquivo.

## Excel
- [ ] Exportar “Todos os dados” em Excel.
- [ ] Abrir o .xlsx.
- [ ] Conferir abas Alunos, Instrutores, Veiculos, Locais, Aulas, Planos, Financeiro e Configuracoes.
- [ ] Conferir abas auxiliares de indisponibilidades.

## CSV
- [ ] Selecionar Alunos e exportar CSV.
- [ ] Abrir no Excel/LibreOffice e conferir cabeçalhos e registros.
- [ ] Selecionar Aulas e repetir o teste.

## Regressão
- [ ] Agenda diária continua abrindo.
- [ ] Agenda semanal continua abrindo.
- [ ] WhatsApp da aula continua funcionando.
- [ ] Plano completo no WhatsApp continua funcionando.
- [ ] Lembretes continuam funcionando.
- [ ] Relatórios continuam funcionando.
- [ ] Financeiro continua funcionando.
- [ ] Modo escuro continua funcionando.
