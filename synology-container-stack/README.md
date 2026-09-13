# Slippy Synology Container Stack

Development and staging environment for web, mobile, API, workers, and Supabase self-hosted testing on Synology NAS.

Before migrating an existing stack, read [the Slippy rename runbook](../docs/operations/SLIPPY_RENAME.md). Existing volumes and NAS paths need an explicit migration before redeployment.

## What This Contains

- `docker-compose.yml` for app/tooling containers — runs the **real** `web`
  (Next.js) and `api` (Fastify) apps from this monorepo, not toy placeholders.
- `apps/web/Dockerfile`, `apps/api/Dockerfile` — multi-stage builds; context
  is the repo root (`..`), since this is an npm workspaces monorepo.
- `apps/hello-web`, `apps/hello-api` — the original sample containers, kept
  for reference but no longer wired into `docker-compose.yml`.
- Redis for queues/cache.
- Mailpit for local email testing.
- Caddy reverse proxy for **local-only** hostnames (`web.local`, `api.local`).
- `cloudflared` — Cloudflare Tunnel container for **public** HTTPS access
  (replaces ngrok — no bandwidth cap, stable hostname across restarts).
- `scripts/bootstrap-supabase.sh` to fetch the official Supabase self-hosted Docker project.
- `scripts/deploy-to-nas.sh` — rsyncs the **whole repo** (not just this folder) to the NAS.
- `docs/SYNOLOGY_DEPLOY.md` with NAS deployment steps, including the Cloudflare Tunnel setup.

## Quick Start on Mac

```sh
cd synology-container-stack
cp .env.example .env        # compose-level settings + NEXT_PUBLIC_* build args
cp web.env.example web.env  # web's server-only secrets (real values from web/.env.local)
cp api.env.example api.env  # api's server-only secrets (real values from api/.env)
docker compose up -d --build
```

Open:

```text
Web:     http://localhost:3000
API:     http://localhost:4000/health
Mailpit: http://localhost:8025
```

Leave `CLOUDFLARE_TUNNEL_TOKEN` blank in `.env` for a Mac-only smoke test —
the `cloudflared` container will just fail to authenticate and restart-loop
without affecting `web`/`api`/`redis`/`mailpit`. Set it once you're ready for
LINE/LIFF to reach this stack publicly (see `docs/SYNOLOGY_DEPLOY.md`).

## Add Supabase Self-Hosted

```sh
sh scripts/bootstrap-supabase.sh
cd supabase
sh utils/generate-keys.sh
sh utils/add-new-auth-keys.sh
sh run.sh start
```

See `docs/SYNOLOGY_DEPLOY.md` before running on Synology.

## Recommended Environment Layout

```text
Supabase Cloud
  production

Synology NAS
  staging/dev Supabase self-hosted
  web app staging containers
  API/worker staging containers
  Redis/Mailpit/supporting services

Developer machines
  local coding and tests
```

## Important

Do not use the generated Synology Supabase database as production unless you also own backup, monitoring, patching, HTTPS, SMTP, and disaster recovery.

