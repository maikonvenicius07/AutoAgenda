#!/usr/bin/env bash
set -Eeuo pipefail

# AutoAgenda V3.6.0 — backup nativo do PostgreSQL para S3.
# Credenciais são lidas exclusivamente de variáveis de ambiente.

STEP="inicialização"
RUN_ID=""
BACKUP_FINALIZADO=0
TMP_DIR=""

log() {
  printf '[AutoAgenda backup] %s\n' "$*"
}

fail_msg() {
  printf '[AutoAgenda backup] ERRO: %s\n' "$*" >&2
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    fail_msg "variável obrigatória ausente: ${name}"
    exit 2
  fi
}

validate_positive_int() {
  local name="$1" value="$2" min="$3" max="$4"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || (( value < min || value > max )); then
    fail_msg "${name} deve ser um inteiro entre ${min} e ${max}."
    exit 2
  fi
}

audit_start() {
  RUN_ID="$(
    psql "$DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 \
      -v retention="$BACKUP_RETENTION_DAYS" \
      -c "INSERT INTO autoagenda.backup_execucoes (tipo,status,retencao_dias,iniciado_em) VALUES ('POSTGRES_S3','INICIADO',:retention,NOW()) RETURNING id;" \
      2>/dev/null | tail -n 1
  )" || true
  if [[ -n "$RUN_ID" ]]; then
    log "execução registrada no AutoAgenda (id ${RUN_ID})."
  else
    log "aviso: não foi possível registrar o início em autoagenda.backup_execucoes; o dump continuará."
  fi
}

audit_success() {
  [[ -n "$RUN_ID" ]] || return 0
  psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 \
    -v id="$RUN_ID" \
    -v file="$FILENAME" \
    -v dest="$S3_URI" \
    -v size="$FILE_SIZE" \
    -v sha="$FILE_SHA256" \
    -v retention="$BACKUP_RETENTION_DAYS" \
    -c "UPDATE autoagenda.backup_execucoes SET status='ENVIADO', arquivo=:'file', destino=:'dest', tamanho_bytes=:size, sha256=:'sha', retencao_dias=:retention, concluido_em=NOW(), erro=NULL WHERE id=:id;" \
    >/dev/null
}

audit_failure() {
  local message="$1"
  [[ -n "$RUN_ID" ]] || return 0
  psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 \
    -v id="$RUN_ID" -v err="$message" \
    -c "UPDATE autoagenda.backup_execucoes SET status='FALHOU', concluido_em=NOW(), erro=LEFT(:'err',2000) WHERE id=:id AND status='INICIADO';" \
    >/dev/null 2>&1 || true
}

cleanup() {
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
  fi
}

on_error() {
  local code="${1:-1}"
  local message="Falha na etapa '${STEP}' (código ${code}). Consulte os logs do Cron Job."
  fail_msg "$message"
  if (( BACKUP_FINALIZADO == 0 )); then audit_failure "$message"; fi
  cleanup
  exit "$code"
}

trap 'on_error $?' ERR
trap 'on_error 130' INT
trap 'on_error 143' TERM
trap cleanup EXIT

STEP="validação de ambiente"
for name in DATABASE_URL S3_BUCKET_NAME AWS_REGION AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do
  require_env "$name"
done

BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
BACKUP_LOG_RETENTION_DAYS="${BACKUP_LOG_RETENTION_DAYS:-365}"
S3_PREFIX="${S3_PREFIX:-autoagenda/postgres}"
S3_PREFIX="${S3_PREFIX#/}"
S3_PREFIX="${S3_PREFIX%/}"
validate_positive_int BACKUP_RETENTION_DAYS "$BACKUP_RETENTION_DAYS" 1 3650
validate_positive_int BACKUP_LOG_RETENTION_DAYS "$BACKUP_LOG_RETENTION_DAYS" 30 3650

for cmd in pg_dump pg_restore psql aws python3 sha256sum stat; do
  command -v "$cmd" >/dev/null || { fail_msg "comando obrigatório não encontrado: $cmd"; exit 2; }
done

TMP_DIR="$(mktemp -d)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILENAME="AutoAgenda-postgres-${STAMP}.dump"
DUMP_FILE="${TMP_DIR}/${FILENAME}"
S3_KEY="${S3_PREFIX}/${FILENAME}"
S3_URI="s3://${S3_BUCKET_NAME}/${S3_KEY}"

STEP="registro inicial"
audit_start

STEP="pg_dump"
log "gerando dump PostgreSQL em formato custom..."
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file "$DUMP_FILE"

STEP="verificação do dump"
pg_restore --list "$DUMP_FILE" >/dev/null
FILE_SIZE="$(stat -c '%s' "$DUMP_FILE")"
FILE_SHA256="$(sha256sum "$DUMP_FILE" | awk '{print $1}')"
log "dump validado: ${FILENAME} (${FILE_SIZE} bytes)."

STEP="upload para S3"
aws s3 cp "$DUMP_FILE" "$S3_URI" \
  --region "$AWS_REGION" \
  --sse AES256 \
  --only-show-errors
log "backup enviado ao armazenamento externo."

STEP="registro de sucesso"
audit_success
BACKUP_FINALIZADO=1

# Limpeza por retenção é pós-backup. Se falhar, o backup recém-criado continua válido.
STEP="retenção no S3"
LIST_JSON="${TMP_DIR}/objetos.json"
DELETE_KEYS="${TMP_DIR}/excluir.txt"
if aws s3api list-objects-v2 \
    --bucket "$S3_BUCKET_NAME" \
    --prefix "${S3_PREFIX}/" \
    --region "$AWS_REGION" \
    --output json > "$LIST_JSON"; then
  python3 - "$LIST_JSON" "$BACKUP_RETENTION_DAYS" > "$DELETE_KEYS" <<'PY'
import json, sys
from datetime import datetime, timezone, timedelta
from pathlib import PurePosixPath

path = sys.argv[1]
days = int(sys.argv[2])
cutoff = datetime.now(timezone.utc) - timedelta(days=days)
with open(path, 'r', encoding='utf-8') as f:
    payload = json.load(f)
for obj in payload.get('Contents') or []:
    key = str(obj.get('Key') or '')
    name = PurePosixPath(key).name
    if not (name.startswith('AutoAgenda-postgres-') and name.endswith('.dump')):
        continue
    raw = str(obj.get('LastModified') or '').replace('Z', '+00:00')
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        continue
    if dt < cutoff:
        print(key)
PY
  deleted=0
  while IFS= read -r key; do
    [[ -n "$key" ]] || continue
    if aws s3api delete-object --bucket "$S3_BUCKET_NAME" --key "$key" --region "$AWS_REGION" >/dev/null; then
      deleted=$((deleted + 1))
    else
      fail_msg "não foi possível excluir objeto antigo: ${key}"
    fi
  done < "$DELETE_KEYS"
  log "retenção aplicada: ${deleted} backup(s) antigo(s) removido(s)."
else
  fail_msg "não foi possível listar o bucket para aplicar retenção; o backup atual foi preservado."
fi

# Limpa apenas o histórico técnico muito antigo, sem afetar nenhum dado operacional.
STEP="retenção do histórico técnico"
psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 \
  -v days="$BACKUP_LOG_RETENTION_DAYS" \
  -c "DELETE FROM autoagenda.backup_execucoes WHERE iniciado_em < NOW() - make_interval(days => :days);" \
  >/dev/null 2>&1 || fail_msg "não foi possível limpar registros técnicos antigos; isso não invalida o backup."

STEP="concluído"
log "backup concluído com sucesso."
