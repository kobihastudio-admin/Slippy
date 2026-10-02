# Deployment Architecture

Status: **derived from code** (`synology-container-stack/docker-compose.yml`, its `scripts/*.sh`, `apps/*/Dockerfile`, `docs/SYNOLOGY_DEPLOY.md`). Where this document and the code disagree, the code is right.

Production runs on a Synology NAS as a small Docker Compose stack. The database is **Supabase cloud**, not on the NAS — the NAS has no Postgres container; it only runs the application and a cache.

## Services (`synology-container-stack/docker-compose.yml`)

| Service | Image | Role |
|---|---|---|
| `web` | built from repo root, `apps/web/Dockerfile` (`node:20-bookworm-slim`) | Next.js app, port 3000 |
| `api` | built from repo root, `apps/api/Dockerfile` (`node:22-bookworm-slim`) | Fastify API, port 4000. Workers run **in-process** here, not as a separate container — see document-ingestion.md |
| `redis` | `redis:7.4-alpine` | BullMQ queue + rate-limit backing store |
| `caddy` | `caddy:2.8-alpine` | Local-only reverse proxy (`auto_https off`, local domains like `web.local`); not on the public path |
| `mailpit` | `axllent/mailpit:v1.20` | Local SMTP catcher for dev |
| `cloudflared` | `cloudflare/cloudflared:latest` | The actual public path — see below |

Both app images are built with `context: ..` (the monorepo root), because the Docker build needs the root `package.json`/lockfile plus every workspace, not just `apps/web` or `apps/api` in isolation.

## Public access: Cloudflare Tunnel, not Caddy

Production traffic reaches the NAS through a Cloudflare Tunnel, configured once in the Cloudflare Zero Trust dashboard with two "Public Hostnames" pointing **directly** at the containers — `http://web:3000` and `http://api:4000` — bypassing Caddy entirely. Caddy only serves local-domain dev traffic inside the compose network. The `cloudflared` container runs with `--protocol http2` instead of the default `quic`: QUIC (UDP) was dropping/timing out on this NAS's network, so the tunnel is forced onto TCP. **The API hostname is the one registered as the LINE webhook URL** (`.../webhooks/line` — see API_SPEC.md) — LINE calls the API container directly, not through the web app.

## Build and ship — `scripts/deploy-from-mac.sh [web|api]`

The NAS does not build its own images (its CPU/RAM are too limited — `docker compose up -d --build` in place is prone to OOM, especially for `web`). Instead, building happens on the developer's Mac and the result is shipped:

1. **Sync** (`deploy-to-nas.sh`) — the whole monorepo, via `tar | ssh ... tar -x`, not `rsync`. macOS's bundled `openrsync` speaks an old protocol that fails against Synology's GNU rsync with a misleading "Permission denied" that looks like an auth problem; plain `ssh`+`tar` sidesteps it. This does not delete files that no longer exist in the source.
2. **Build** (`build-and-ship.sh`) — cross-compiled for the NAS's `linux/amd64` via `docker buildx` (Apple Silicon Macs are `arm64`). The `NEXT_PUBLIC_*` build args are baked into the `web` image at build time, pulled live from the NAS's own `.env` over SSH rather than kept locally.
3. **Ship** — the built image(s) are saved to a tarball and copied with `scp -O` (the legacy SCP protocol; modern macOS `scp` defaults to an SFTP-based mode that Synology's sshd rejects outright).
4. **Load + recreate** — `sudo -n docker load` then `sudo -n docker compose up -d <service>` over a non-interactive SSH session, which needs passwordless sudo for `docker` specifically (a scoped `NOPASSWD` sudoers rule, documented in `docs/SYNOLOGY_DEPLOY.md`) — without it, this step hangs waiting for a password that non-interactive SSH can never supply.
5. **Health check** — the driving script polls `http://<nas>:<port>/health` after shipping.

An NAS-side build alternative exists (`scripts/deploy.sh`, plain `docker compose build` run on the NAS itself), documented for completeness, but is explicitly the fallback — slow and prone to failure under the NAS's own resource limits, especially for `web`.

## Data and secrets

- **Database**: Supabase cloud project (see DATABASE_SCHEMA.md) — not deployed by this stack at all.
- **`web.env` / `api.env`**: per-service secrets on the NAS, `env_file`-mounted into their containers; `.example` versions are checked into the repo as templates, the real files are not.
- **Volumes**: only `redis_data` (and Caddy's own `caddy_data`/`caddy_config`) persist — there is no application database volume here.

## Known gaps

- This document does not reproduce the full `docs/SYNOLOGY_DEPLOY.md` walkthrough (initial NAS setup, the sudoers rule, Cloudflare Tunnel creation) — read that directly for first-time setup.
- NAS hostname/IP, SSH user, and real tunnel hostnames are environment-specific and intentionally not restated here; see the operator's own deployment notes.
- Rollback procedure (reverting to a previous image) was not traced in this pass.
