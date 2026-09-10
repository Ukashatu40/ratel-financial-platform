# syntax=docker/dockerfile:1
#
# Single build stage's node_modules is reused wholesale for runtime, not a
# separate `npm ci --omit=dev` — Prisma 7's generated client lives INSIDE
# node_modules/@prisma/client, produced by `prisma generate` below. A fresh
# prod-only install has no postinstall hook to regenerate it (checked:
# package.json has none), so it would ship the raw, ungenerated package and
# break the first time anything touches the database. Keeping the `prisma`
# CLI in the final image is deliberate too, not just a side effect of this:
# `docker compose exec app npx prisma migrate deploy` needs it, and running
# migrations from the exact image about to serve traffic is a real
# correctness property, not just convenience. Image size is not a real
# constraint on a VPS.
FROM node:24-alpine AS build
WORKDIR /app

# --legacy-peer-deps: a PRE-EXISTING @fastify/static peer conflict between
# @nestjs/swagger and @nestjs/platform-fastify — present on a clean
# checkout of this repo even before any dependency this project's own work
# added, confirmed by running plain `npm install` with none of that work
# applied and getting the identical ERESOLVE failure. Not something this
# Dockerfile is working around casually; see TECH_DEBT.md for the
# investigation.
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY . .
RUN npx prisma generate
RUN npm run build

# ---- runtime ----
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# wget only, for the HEALTHCHECK below — matches the same tool
# docker/docker-compose.yml's own Mailpit healthcheck already uses, rather
# than introducing curl as a second HTTP client for no reason.
RUN apk add --no-cache wget \
  && addgroup -S app && adduser -S app -G app

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/prisma ./prisma
COPY --from=build --chown=app:app /app/prisma.config.ts ./prisma.config.ts
COPY --chown=app:app package.json package-lock.json ./

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/v1/health/liveness || exit 1

# Direct `node`, deliberately NOT `npm run start` / `npm start`: npm's
# process wrapping does not reliably forward SIGTERM to the child process
# it spawns (a well-known Node-in-Docker gotcha), which would silently
# defeat main.ts's `app.enableShutdownHooks()` — a container orchestrator's
# SIGTERM would never reach the app that's supposed to react to it. Calling
# node directly makes this process PID 1 and the actual signal recipient.
CMD ["node", "dist/src/main.js"]
