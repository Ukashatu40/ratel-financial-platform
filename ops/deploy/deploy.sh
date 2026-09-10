#!/bin/sh
# ops/deploy/deploy.sh
#
# Run on the VPS itself (triggered manually, or by the deploy workflow's
# `workflow_dispatch` — deliberately NOT auto-deploy-on-push for a
# financial system; see DEPLOYMENT.md). Assumes the repo is already
# checked out at the target commit and `.env` (copied from
# .env.production.example and filled in) already sits next to
# docker-compose.prod.yml.
#
# Ordering matters and is NOT arbitrary:
#   1. infra services up first — app's healthcheck-gated `depends_on`
#      would otherwise just block, but migrations/hardening below need
#      postgres directly, before the app container is even built.
#   2. build + migrate + harden, using a throwaway `run --rm` container so
#      migrations run from the EXACT image about to serve traffic (see the
#      Dockerfile's own reasoning for keeping the prisma CLI in the image).
#   3. only then bring up app + caddy.
set -eu

COMPOSE_FILE="${RATEL_COMPOSE_FILE:-docker-compose.prod.yml}"
COMPOSE="docker compose -f $COMPOSE_FILE"

if [ ! -f .env ]; then
  echo "[deploy] ERROR: .env not found next to $COMPOSE_FILE — copy .env.production.example first" >&2
  exit 1
fi

# Needed on the HOST side below, to build the superuser DATABASE_URL for
# the migration step specifically (see the comment at that step for why).
# shellcheck disable=SC1091
. ./.env

echo "[deploy] starting infra services (postgres, redis, minio, clamav)..."
$COMPOSE up -d postgres redis minio clamav

echo "[deploy] waiting for postgres to be healthy..."
until [ "$($COMPOSE ps -q postgres | xargs docker inspect -f '{{.State.Health.Status}}')" = "healthy" ]; do
  sleep 2
done

echo "[deploy] building app image..."
$COMPOSE build app

# Migrations run as the `postgres` superuser, NOT the app's own
# RATEL_APP_DB_USER — found by actually running this, not assumed: the app
# role only has DML (SELECT/INSERT/UPDATE/DELETE) grants via
# init-app-role.sh's ALTER DEFAULT PRIVILEGES, deliberately no CREATE, so
# `prisma migrate deploy` (which creates tables and its own
# `_prisma_migrations` tracking table) fails with "permission denied for
# schema public" under the app's normal DATABASE_URL. Overriding
# DATABASE_URL for just this one command is correct, not a workaround —
# the running app itself still only ever connects as the least-privilege
# role.
echo "[deploy] running migrations from the built image (as postgres superuser)..."
$COMPOSE run --rm \
  -e DATABASE_URL="postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/ratel_financial?schema=public" \
  app npx prisma migrate deploy

echo "[deploy] hardening audit_log_entries grants (safe to re-run)..."
$COMPOSE exec -T postgres sh -c \
  'RATEL_APP_DB_USER="$RATEL_APP_DB_USER" POSTGRES_USER=postgres POSTGRES_DB=ratel_financial sh' \
  < ops/db/harden-audit-log.sh

if [ "${RATEL_SKIP_PRODUCTION_SEED:-}" != "true" ]; then
  echo "[deploy] running production seed (idempotent — creates org/permissions/admin only if missing)..."
  $COMPOSE run --rm app npm run prisma:seed:production
fi

echo "[deploy] starting app + caddy..."
$COMPOSE up -d app caddy

echo "[deploy] done. Tail logs with: $COMPOSE logs -f app"
