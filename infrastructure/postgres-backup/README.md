# AutoAgenda V3.6.0 — Backup automático do PostgreSQL

Esta pasta contém uma **estrutura opcional** para manter uma cópia nativa do PostgreSQL fora do Render.
Ela não é ativada pelo `render.yaml` principal e não cria cobrança automaticamente.

## Estratégia recomendada

Use três camadas:

1. **Banco PostgreSQL principal no Render**.
2. **Recuperação do próprio Render (PITR)** quando o banco estiver em instância paga.
3. **Dump externo diário em S3**, opcional, para uma cópia fora do provedor principal.

O backup JSON do AutoAgenda continua útil para restauração operacional pela interface, mas não substitui um dump nativo do PostgreSQL para recuperação de infraestrutura.

## O que a rotina externa faz

- executa `pg_dump` em formato custom (`-Fc`);
- usa `--no-owner --no-privileges` para facilitar restauração em outra instância;
- valida o arquivo com `pg_restore --list` antes do upload;
- calcula SHA-256 e tamanho do arquivo;
- envia o dump ao Amazon S3 com criptografia server-side AES256;
- registra no banco apenas metadados seguros da execução;
- remove dumps mais antigos que `BACKUP_RETENTION_DAYS`;
- mantém o histórico técnico do AutoAgenda por `BACKUP_LOG_RETENTION_DAYS`;
- nunca grava `DATABASE_URL`, chave AWS ou segredo no código/backup.

## Importante sobre o Render

A documentação atual do Render informa que:

- instâncias **pagas** do Render Postgres possuem recuperação point-in-time;
- bancos Free não possuem recuperação automática;
- o Render também permite criar exportações lógicas manuais na área Recovery;
- Cron Jobs são serviços cobrados pelo tempo de execução e possuem cobrança mínima mensal;
- Cron Jobs não possuem disco persistente, por isso o dump precisa ser enviado para armazenamento externo como S3.

Confirme valores e condições atuais no painel/documentação do Render antes de ativar.

## Antes de ativar

1. Faça o deploy da V3.6.0 do AutoAgenda primeiro, para criar `autoagenda.backup_execucoes`.
2. No Render, abra o PostgreSQL e confirme a versão e a área **Recovery**.
3. Se o banco for pago, confirme que a recuperação point-in-time está disponível.
4. Crie um bucket S3 dedicado ao AutoAgenda.
5. Crie credenciais AWS com permissão limitada somente a esse bucket/prefixo.
6. Não use a URL de PgBouncer/connection pool para `pg_dump`; use a conexão direta do banco.
7. Crie um Cron Job separado usando o modelo `render-backup.example.yaml` ou configure os mesmos campos manualmente.

## Variáveis do Cron Job

Obrigatórias:

- `DATABASE_URL` — conexão direta do PostgreSQL;
- `AWS_REGION`;
- `AWS_ACCESS_KEY_ID`;
- `AWS_SECRET_ACCESS_KEY`;
- `S3_BUCKET_NAME`.

Opcionais:

- `S3_PREFIX` — padrão `autoagenda/postgres`;
- `BACKUP_RETENTION_DAYS` — padrão `30`;
- `BACKUP_LOG_RETENTION_DAYS` — padrão `365`.

## Frequência sugerida

O exemplo executa uma vez por dia às **07:00 UTC**, equivalente a **03:00 em Porto Velho**.
O Render interpreta expressões Cron em UTC.

## Como validar depois de criar o Cron Job

1. Abra o Cron Job no Render.
2. Use **Trigger Run** para executar manualmente uma vez.
3. Confirme no log a mensagem `backup concluído com sucesso`.
4. Verifique se existe um arquivo `AutoAgenda-postgres-AAAA...dump` no bucket S3.
5. Abra **AutoAgenda > Backup** e confirme **Último backup OK**.
6. Confirme tamanho, data e prefixo SHA-256 exibidos no painel.

## Restauração PostgreSQL nativa — procedimento de emergência

Prefira **PITR do Render** quando ele estiver disponível e o objetivo for recuperar o estado mais recente.
Para restaurar um dump externo, faça sempre uma restauração isolada antes de apontar o AutoAgenda para ela.

### Procedimento seguro

1. Crie um **novo** banco PostgreSQL de destino; não restaure primeiro sobre o banco atual.
2. Pare temporariamente gravações no sistema se estiver executando uma recuperação definitiva.
3. Baixe o dump do S3 para uma máquina/ambiente seguro.
4. Valide o dump:

```bash
pg_restore --list AutoAgenda-postgres-AAAA...dump > /dev/null
```

5. Use uma versão de `pg_restore` compatível com o PostgreSQL de destino.
6. Restaure no banco novo:

```bash
pg_restore \
  --no-owner \
  --no-privileges \
  --dbname "$TARGET_DATABASE_URL" \
  AutoAgenda-postgres-AAAA...dump
```

7. Valide alunos, aulas, planos, usuários e configurações no banco restaurado.
8. Só depois altere `DATABASE_URL` do AutoAgenda para o banco recuperado.
9. Faça novo deploy/restart e execute os testes funcionais.
10. Preserve o banco antigo até confirmar que a recuperação está correta.

## Teste periódico recomendado

Faça pelo menos trimestralmente um teste de restauração em banco temporário. Um backup só deve ser considerado confiável depois de uma restauração de teste bem-sucedida.
