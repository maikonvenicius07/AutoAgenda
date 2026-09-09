# AutoAgenda V3.6.0 — imagem opcional para o Cron Job de backup PostgreSQL.
# PostgreSQL 18 client consegue gerar dumps de servidores PostgreSQL suportados
# atualmente pelo Render. Revise esta versão quando o banco for atualizado além dela.
FROM postgres:18-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends awscli ca-certificates python3 \
    && rm -rf /var/lib/apt/lists/*

COPY infrastructure/postgres-backup/backup-postgres-s3.sh /usr/local/bin/autoagenda-postgres-backup
RUN chmod +x /usr/local/bin/autoagenda-postgres-backup

ENTRYPOINT ["/usr/local/bin/autoagenda-postgres-backup"]
