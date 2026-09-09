# CHECKLIST — AutoAgenda V3.6.0

## 1. Deploy normal do AutoAgenda

1. [ ] enviar os arquivos da atualização V3.6.0 ao GitHub;
2. [ ] aguardar o deploy do web service no Render;
3. [ ] confirmar `/api/health` e login ADMIN;
4. [ ] abrir **Backup** e verificar o novo cartão **Backup automático do PostgreSQL**;
5. [ ] se nenhum Cron Job externo estiver configurado, confirmar que aparece **Não ativado / sem execução**;
6. [ ] confirmar que os backups manuais JSON/Excel/CSV e a restauração JSON continuam funcionando.

Nenhum serviço externo é ativado automaticamente nesta etapa.

## 2. Validação técnica já executada

- [x] `node --check server.js`;
- [x] `node --check public/app.js`;
- [x] `bash -n infrastructure/postgres-backup/backup-postgres-s3.sh`;
- [x] `npm run check`;
- [x] `npm run test:static`;
- [x] 83/83 testes estáticos aprovados;
- [x] nenhuma dependência npm nova;
- [x] `render.yaml` principal não cria Cron Job;
- [x] credenciais não estão hardcoded;
- [x] tabela `autoagenda.backup_execucoes` alinhada entre `server.js` e `sql/schema.sql`.

## 3. Proteção do Render Postgres

No painel do banco:

1. [ ] abrir a área **Recovery**;
2. [ ] confirmar se o banco está em instância paga e se existe recuperação point-in-time (PITR);
3. [ ] anotar a janela de recuperação disponível no plano atual;
4. [ ] criar uma exportação manual antes de alterações críticas quando necessário.

## 4. Ativação opcional do backup externo S3

Faça somente se decidir criar a camada externa de proteção.

1. [ ] criar bucket S3 dedicado;
2. [ ] criar credenciais AWS de menor privilégio possível, limitadas ao bucket/prefixo;
3. [ ] implantar primeiro a V3.6.0 para garantir que `autoagenda.backup_execucoes` exista;
4. [ ] criar um **Cron Job** separado no Render;
5. [ ] usar `infrastructure/postgres-backup/Dockerfile`;
6. [ ] usar como referência `infrastructure/postgres-backup/render-backup.example.yaml`;
7. [ ] configurar uma `DATABASE_URL` direta do Postgres, sem PgBouncer/pooler;
8. [ ] configurar `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` e `S3_BUCKET_NAME`;
9. [ ] manter `BACKUP_RETENTION_DAYS=30` inicialmente;
10. [ ] disparar uma execução manual com **Trigger Run**.

## 5. Conferência da primeira execução

Após o primeiro Cron Job:

1. [ ] log termina com `backup concluído com sucesso`;
2. [ ] existe um `.dump` no S3;
3. [ ] AutoAgenda > Backup mostra **Último backup OK**;
4. [ ] tamanho do arquivo é maior que zero;
5. [ ] SHA-256 aparece no histórico;
6. [ ] retenção aparece como 30 dias;
7. [ ] não existem senhas, tokens ou `DATABASE_URL` no arquivo de log do projeto/GitHub.

## 6. Teste de restauração nativa

Não restaure primeiro sobre o banco de produção.

1. [ ] criar banco PostgreSQL temporário;
2. [ ] baixar um dump do S3;
3. [ ] executar `pg_restore --list`;
4. [ ] restaurar no banco temporário;
5. [ ] conferir alunos, aulas, planos, usuários e configurações;
6. [ ] iniciar o AutoAgenda contra o banco temporário, quando possível;
7. [ ] registrar data e resultado do teste.

Recomendação: repetir o teste de restauração periodicamente.

## 7. Custos

- [ ] confirmar o custo atual do Cron Job no Render antes de ativar;
- [ ] confirmar o custo do bucket/armazenamento S3;
- [ ] se não quiser custo adicional agora, manter somente a proteção nativa do plano Render Postgres + backups manuais do AutoAgenda.
