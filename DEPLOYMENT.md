# Deployment — single VPS (Nigeria)

This document describes the confirmed production setup: a single
self-managed VPS, no domain/TLS yet, a third-party transactional email
provider, a plain (but locked-down) `.env` for secrets, and local-only
backups. Every one of those is a deliberate decision, not a gap — see
TECH_DEBT.md for the reasoning behind each and what upgrading each one
later would look like.

## 1. One-time VPS setup

1. Install Docker Engine + the Compose plugin (`docker compose`, not the
   old standalone `docker-compose`).
2. Create a non-root deploy user with permission to run Docker
   (`usermod -aG docker <user>`), and an SSH key pair for it. This is the
   `VPS_USER` / `VPS_SSH_KEY` the `deploy.yml` GitHub Actions workflow
   uses — generate the key pair, install the public half in that user's
   `~/.ssh/authorized_keys`, and add the private half plus `VPS_HOST` and
   `VPS_DEPLOY_PATH` (e.g. `/home/deploy/ratel-financial-platform`) as
   repository secrets (Settings → Secrets and variables → Actions) before
   the Deploy workflow can do anything.
3. `git clone` the repo to `VPS_DEPLOY_PATH`.
4. `cp .env.production.example .env`, fill in every value (generate
   secrets with `openssl rand -base64 48` / `openssl rand -base64 32` as
   noted inline), then lock the file down:
   ```
   chown root:root .env && chmod 600 .env
   ```
   This is the confirmed secrets posture — a plain file, not a KMS/Vault/
   SOPS setup — hardened purely through filesystem permissions. Only the
   user running `docker compose` (root, or the deploy user if it's in the
   `docker` group) can read it.
5. Open ports 80 and 443 on the VPS firewall (`ufw allow 80,443/tcp` or
   equivalent). Nothing else needs to be open — postgres/redis/minio/
   clamav are internal-only in `docker-compose.prod.yml` and unreachable
   from outside the Docker network regardless of the firewall.

## 2. First deploy

From `VPS_DEPLOY_PATH`:
```
./ops/deploy/deploy.sh
```
This brings up postgres/redis/minio/clamav, builds the app image, runs
`prisma migrate deploy` and the audit-log hardening from the built image,
runs the one-time production seed (creates the organization, the full
`role_permissions` matrix, and one real `finance_director` admin account
from `RATEL_ADMIN_EMAIL`/`RATEL_ADMIN_PASSWORD`), then starts the app and
Caddy. See `ops/deploy/deploy.sh` for exactly why the steps are ordered
this way.

Log in with `RATEL_ADMIN_EMAIL`/`RATEL_ADMIN_PASSWORD`, then use that
account (`reference-data:manage`) to create real departments, vendors,
projects, categories, and employees through the API — the production seed
deliberately does not fabricate any of that.

Verify:
```
curl http://<vps-ip>/api/v1/health/liveness
curl http://<vps-ip>/api/v1/health/readiness
```

## 3. Subsequent deploys

Either:
- **Manually** on the VPS: `git pull && ./ops/deploy/deploy.sh`, or
- **From GitHub Actions**: Actions tab → "Deploy" → Run workflow, choosing
  the branch/tag. This is `workflow_dispatch`-only, deliberately not
  triggered automatically on every push to `main` — a financial
  system-of-record's production deploys should be a deliberate action,
  not a side effect of a merge.

`ops/deploy/deploy.sh` is idempotent throughout (migrations, grants, and
the production seed all are), so re-running it is always safe.

## 4. TLS, once a domain exists

Point the domain's DNS `A` record at the VPS, then edit
`ops/caddy/Caddyfile`: replace the `:80 {` line with the domain (e.g.
`api.ratel-plus.com {`). That is the entire change — Caddy provisions and
renews the Let's Encrypt certificate itself on next `docker compose up
-d caddy`. No app code, no other config, changes.

## 5. Backups

Local-only, per the confirmed decision (no off-VPS destination yet — see
`ops/backup/backup-postgres.sh`'s own comments for how to add one later
without restructuring anything). Install a cron job on the VPS host (not
inside a container):
```
0 2 * * * cd <VPS_DEPLOY_PATH> && ./ops/backup/backup-postgres.sh >> /var/log/ratel-backup.log 2>&1
```
Dumps land in `/var/backups/ratel-financial` (override with
`RATEL_BACKUP_DIR`) with a 14-day retention (override with
`RATEL_BACKUP_RETENTION_DAYS`). To restore:
```
./ops/backup/restore-postgres.sh /var/backups/ratel-financial/<file>.sql.gz
```
This is destructive (drops and recreates the database) and requires a
typed `restore` confirmation.

Being local-only, these backups do NOT protect against total VPS loss
(disk failure, account termination, etc.) — only against logical
mistakes (a bad migration, an accidental delete) on an otherwise-healthy
VPS. Revisit the off-VPS decision once real financial data is at stake;
see TECH_DEBT.md.

**Separately from database backups:** `FIELD_ENCRYPTION_MASTER_KEY`
cannot be recovered or rotated after the fact — back it up once, offline,
outside of both the `.env` file and the database dumps (which don't
contain it), before any real payroll data exists.

## 6. Monitoring

The app exposes Prometheus metrics natively at `:9464/metrics` (no extra
work). Two independent, non-exclusive options:

- **Zero-cost baseline**: point a free external uptime checker (e.g.
  UptimeRobot) at `/api/v1/health/liveness` — catches "the whole VPS/app
  is down" with no setup on the VPS itself.
- **Self-hosted dashboards**: `docker compose -f docker-compose.prod.yml
  -f docker-compose.monitoring.yml up -d` adds Prometheus (scraping the
  app's own metrics endpoint) + Grafana, reachable at `/grafana/` behind
  Caddy once the commented block in `ops/caddy/Caddyfile` is uncommented.

Neither is required for the app to run — both are purely for operator
visibility.

## 7. What's deliberately NOT here

- Off-VPS/S3 backup destination — confirmed decision, local-only for now.
- KMS/Vault/SOPS for secrets — confirmed decision, hardened `.env` file
  instead.
- Auto-deploy-on-push — deliberate, see section 3.
- A domain/TLS certificate — none exists yet; see section 4 for the day
  it does.

See TECH_DEBT.md for the entry documenting this whole batch, including
what upgrading any of the above would involve.
