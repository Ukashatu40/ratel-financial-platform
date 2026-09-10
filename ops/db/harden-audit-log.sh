#!/bin/sh
# ops/db/harden-audit-log.sh
#
# The other half of closing TECH_DEBT #4 — must run AFTER
# `prisma migrate deploy` (audit_log_entries has to exist first) rather
# than as part of init-app-role.sh (which runs before any table exists).
# Safe to re-run after every future migration: REVOKE on a table where the
# grantee already lacks the privilege is a no-op in Postgres, not an
# error, so this can unconditionally be part of every deploy rather than
# needing a "did this already run" check.
#
# The point: a hash-chained, INSERT-only audit log is only tamper-evident
# against a compromised APPLICATION if the app's own DB role literally
# cannot rewrite it — restricting this at the grant level is a real
# control, not just documentation of intent (this exact reasoning is
# already in PHASES.md 6.2's design for this table).
set -e

: "${RATEL_APP_DB_USER:?RATEL_APP_DB_USER must be set}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_role="$RATEL_APP_DB_USER" <<'SQL'
REVOKE UPDATE, DELETE ON audit_log_entries FROM :"app_role";
SQL

echo "[harden-audit-log] revoked UPDATE/DELETE on audit_log_entries from '$RATEL_APP_DB_USER'"
