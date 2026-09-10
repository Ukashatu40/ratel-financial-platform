#!/bin/sh
# ops/db/init-app-role.sh
#
# Runs automatically, ONCE, the first time the Postgres container starts
# with an empty data directory — the official postgres image's own
# convention: anything in /docker-entrypoint-initdb.d/ (mounted there by
# docker-compose.prod.yml) runs in filename-sorted order on first init,
# with the container's full environment already available. This closes
# TECH_DEBT #4: the app has always connected as the `postgres` superuser
# in every environment so far (dev, e2e/integration Testcontainers), which
# is why the REVOKE this item describes was written but commented out —
# there was never a less-privileged role to target it at.
#
# Creates RATEL_APP_DB_USER, a role with NO superuser/createdb/createrole
# privileges, distinct from the `postgres` superuser that
# `prisma migrate deploy` and the seed script still connect as (schema
# changes and seeding legitimately need broader access; the RUNNING APP
# does not). The app's own DATABASE_URL (docker-compose.prod.yml) points
# at THIS role, not `postgres`, from day one in production.
set -e

: "${RATEL_APP_DB_USER:?RATEL_APP_DB_USER must be set}"
: "${RATEL_APP_DB_PASSWORD:?RATEL_APP_DB_PASSWORD must be set}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_role="$RATEL_APP_DB_USER" \
  -v app_password="$RATEL_APP_DB_PASSWORD" <<'SQL'
CREATE ROLE :"app_role" WITH LOGIN PASSWORD :'app_password';

GRANT CONNECT ON DATABASE ratel_financial TO :"app_role";
GRANT USAGE ON SCHEMA public TO :"app_role";

-- Covers tables that already exist at the moment this runs (none yet, on
-- a genuinely first init) — included for idempotency if this script is
-- ever re-run against a database that already has tables, not because
-- it's expected to do the real work on a fresh install.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app_role";

-- This is the statement that actually matters on a fresh install: it
-- applies to tables `prisma migrate deploy` creates LATER, connecting as
-- the `postgres` superuser (POSTGRES_USER) — without it, the app role
-- would have zero access to any table added after this script runs,
-- since the GRANT above only covers what existed at the instant it ran.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_role";
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_role";
SQL

echo "[init-app-role] created role '$RATEL_APP_DB_USER' with default privileges for future migrations"
