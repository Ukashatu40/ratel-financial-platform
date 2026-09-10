#!/bin/sh
# ops/backup/backup-postgres.sh
#
# Local-only backup, per confirmed deployment decision (no off-VPS/S3
# destination for now — a single VPS is both the primary and the only
# copy). Structured so upgrading to an off-VPS destination later is one
# added step, not a rewrite: everything up through the retention rotation
# below is destination-agnostic; an off-VPS copy would be a single command
# appended after "upload step goes here", operating on the same dump file
# this script already produces.
#
# Run via cron on the HOST (not inside a container — see DEPLOYMENT.md for
# the crontab line), against the running docker-compose.prod.yml stack:
#
#   0 2 * * * /path/to/ops/backup/backup-postgres.sh >> /var/log/ratel-backup.log 2>&1
set -eu

COMPOSE_FILE="${RATEL_COMPOSE_FILE:-docker-compose.prod.yml}"
BACKUP_DIR="${RATEL_BACKUP_DIR:-/var/backups/ratel-financial}"
RETENTION_DAYS="${RATEL_BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_DIR/ratel_financial_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

# pg_dump runs INSIDE the postgres container, as the postgres superuser
# (never the app's least-privilege role — a backup needs to see everything,
# the app role deliberately does not, e.g. it cannot even UPDATE/DELETE
# audit_log_entries). Piped straight to gzip on the host rather than
# writing an uncompressed dump inside the container first.
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U postgres -d ratel_financial --format=plain | gzip > "$DEST"

if [ ! -s "$DEST" ]; then
  echo "[backup-postgres] ERROR: $DEST is empty — pg_dump likely failed" >&2
  rm -f "$DEST"
  exit 1
fi

echo "[backup-postgres] wrote $DEST ($(du -h "$DEST" | cut -f1))"

# --- upload step goes here when/if an off-VPS destination is added ---
# e.g.: aws s3 cp "$DEST" "s3://<bucket>/ratel-financial/" (or rclone,
# restic, etc.) — deliberately not built yet per the current decision to
# stay local-only; the dump file above is already in the right shape for
# any of those tools to pick up unchanged.

# Retention: delete local dumps older than RETENTION_DAYS. This is the
# ONLY copy of these backups right now (local-only decision), so
# RETENTION_DAYS is a real data-loss boundary, not just disk-space
# housekeeping — keep it generous unless disk space genuinely forces it
# down, and reconsider going off-VPS before shortening it further.
find "$BACKUP_DIR" -name 'ratel_financial_*.sql.gz' -mtime "+${RETENTION_DAYS}" -delete

echo "[backup-postgres] retention: pruned dumps older than ${RETENTION_DAYS} days"
