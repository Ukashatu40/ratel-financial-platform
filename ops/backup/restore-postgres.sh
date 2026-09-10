#!/bin/sh
# ops/backup/restore-postgres.sh
#
# Restores a dump produced by backup-postgres.sh. Deliberately requires the
# dump path as an explicit argument and a typed confirmation — this drops
# and recreates the database, so there is no safe default to fall back on.
#
#   ops/backup/restore-postgres.sh /var/backups/ratel-financial/ratel_financial_20260909T020000Z.sql.gz
set -eu

COMPOSE_FILE="${RATEL_COMPOSE_FILE:-docker-compose.prod.yml}"
DUMP_FILE="${1:?usage: restore-postgres.sh <path-to-dump.sql.gz>}"

# RATEL_APP_DB_USER is read from the same .env file compose itself loads —
# needed on the HOST side below to parameterize the re-GRANT step.
if [ -f .env ]; then
  # shellcheck disable=SC1091
  . ./.env
fi
: "${RATEL_APP_DB_USER:?RATEL_APP_DB_USER must be set (checked .env)}"

if [ ! -f "$DUMP_FILE" ]; then
  echo "[restore-postgres] ERROR: $DUMP_FILE not found" >&2
  exit 1
fi

echo "This will DROP and recreate the ratel_financial database, destroying its"
echo "current contents, then restore from: $DUMP_FILE"
printf 'Type "restore" to continue: '
read -r CONFIRM
if [ "$CONFIRM" != "restore" ]; then
  echo "Aborted."
  exit 1
fi

# Stop the app first so nothing writes to the database mid-restore.
docker compose -f "$COMPOSE_FILE" stop app

docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
  "DROP DATABASE IF EXISTS ratel_financial; CREATE DATABASE ratel_financial;"

gunzip -c "$DUMP_FILE" | docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U postgres -d ratel_financial -v ON_ERROR_STOP=1

# The app role itself survives (Postgres roles are cluster-level, unaffected
# by DROP/CREATE DATABASE) but the fresh database's `public` schema has none
# of its grants — those are per-database (GRANT ... ON ALL TABLES,
# ALTER DEFAULT PRIVILEGES), not part of what pg_dump's plain-format output
# restores for a role it doesn't own. Re-running init-app-role.sh's CREATE
# ROLE would fail (the role already exists), so re-apply just the grants
# directly here instead of reusing that script wholesale.
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U postgres -d ratel_financial -v ON_ERROR_STOP=1 -v app_role="$RATEL_APP_DB_USER" <<'SQL'
GRANT CONNECT ON DATABASE ratel_financial TO :"app_role";
GRANT USAGE ON SCHEMA public TO :"app_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app_role";
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_role";
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_role";
REVOKE UPDATE, DELETE ON audit_log_entries FROM :"app_role";
SQL

docker compose -f "$COMPOSE_FILE" start app

echo "[restore-postgres] restore complete from $DUMP_FILE"
