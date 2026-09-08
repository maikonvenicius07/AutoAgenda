# Plano de backup — até 22/09/2026

Decisão atual: manter o AutoAgenda no ambiente atual e preparar a proteção dos dados antes de qualquer migração/upgrade relevante.

Versão de referência: **AutoAgenda V3.6.0**.

## Até 21/09

- confirmar que a V3.6.0 está estável;
- conferir alunos, aulas, planos, instrutores, veículos, locais, configurações e usuários;
- baixar periodicamente o backup completo JSON;
- confirmar no painel do Render se a instância PostgreSQL atual possui Recovery/PITR;
- decidir se a camada opcional de Cron Job + S3 será ativada;
- se ativada, executar ao menos um backup e uma restauração de teste em banco temporário.

## Em 22/09 — antes de qualquer migração/upgrade

1. baixar um backup completo JSON do AutoAgenda;
2. criar uma exportação lógica/nativa do PostgreSQL;
3. conferir tamanho, data e integridade do arquivo;
4. manter pelo menos uma cópia fora do banco atual;
5. somente depois iniciar migração ou upgrade;
6. validar no destino as quantidades das tabelas principais;
7. testar login, alunos, agenda diária, agenda semanal, planos, financeiro e backups antes de considerar a migração concluída.

## Tabelas principais a conferir

- `autoagenda.usuarios`
- `autoagenda.alunos`
- `autoagenda.aulas`
- `autoagenda.planos_aula`
- `autoagenda.instrutores`
- `autoagenda.instrutor_indisponibilidades`
- `autoagenda.veiculos`
- `autoagenda.veiculo_indisponibilidades`
- `autoagenda.locais`
- `autoagenda.configuracoes`
- `autoagenda.financeiro`
- `autoagenda.lembrete_envios`
- `autoagenda.email_envios`
- `autoagenda.backup_execucoes`

Nunca salvar `DATABASE_URL`, senhas, tokens ou outras credenciais dentro dos arquivos enviados ao GitHub.
