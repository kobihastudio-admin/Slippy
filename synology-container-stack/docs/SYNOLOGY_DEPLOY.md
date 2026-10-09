# Deploy to Synology NAS

This project is designed for Synology Container Manager or SSH-based Docker Compose.

> **Known DSM quirk:** SSH sessions on Synology (interactive *and*
> non-interactive) often don't have `/usr/local/bin` on `$PATH`, where
> Container Manager symlinks the `docker` binary — you'll hit `docker:
> command not found` even though `docker --version` works fine from DSM's
> own desktop Terminal app. `scripts/deploy.sh`/`scripts/smoke-test.sh`
> already export the PATH fix for you; if you're typing commands by hand
> over SSH, run this once per session first:
> ```sh
> export PATH="$PATH:/usr/local/bin"
> ```

> **Known DSM quirk #2 — `docker.sock` is root-only:** unlike most Linux
> distros, DSM's Container Manager doesn't create a `docker` group — the
> socket is `root:root` mode `660`, so a regular (non-root) account gets
> `permission denied` on every `docker`/`docker compose` command, even as a
> DSM "administrator". One-time fix — SSH in and run:
> ```sh
> echo "$(whoami) ALL=(ALL) NOPASSWD: /usr/local/bin/docker" | sudo tee /etc/sudoers.d/$(whoami)-docker
> sudo chmod 440 /etc/sudoers.d/$(whoami)-docker
> sudo -n docker compose version   # should work with no password prompt now
> ```
> This is scoped to only the `docker` binary, not full root. After this,
> `scripts/deploy.sh`/`scripts/smoke-test.sh` (which already run `sudo -n
> docker compose ...` under the hood) will work non-interactively over SSH.
> If typing commands by hand, prefix them with `sudo -n` too.

## 1. Copy Project to NAS

Recommended NAS path:

```sh
/volume1/docker/slippy
```

From your Mac:

```sh
cd /Users/chainimitsakhorn/Documents/Project/Slippy/synology-container-stack
NAS_SSH=chainimit@192.168.1.200 NAS_PATH=/volume1/docker/slippy sh scripts/deploy-to-nas.sh
```

Or copy the folder manually with Synology File Station.

## 2. Prepare Environment

SSH into Synology:

```sh
ssh chainimit@192.168.1.200
cd /volume1/docker/slippy/synology-container-stack
cp .env.example .env
cp web.env.example web.env
cp api.env.example api.env
vi .env
```

Edit at least:

```env
NAS_HOST=192.168.1.200
SUPABASE_PUBLIC_URL=http://192.168.1.200:8000
```

Then fill in `web.env` and `api.env` with the real secrets from your local
`web/.env.local` and `api/.env` (Supabase service role key, Anthropic key,
LINE channel secret/token, etc. — see the comments in each `*.env.example`
for which file each value belongs in). Also fill in the `NEXT_PUBLIC_*`
section of `.env` — those get baked into the `web` image at build time.

## 3. Bootstrap Supabase

This pulls the official Supabase Docker configuration into `./supabase`.

```sh
sh scripts/bootstrap-supabase.sh
cd supabase
vi .env
```

Set these values in `supabase/.env`:

```env
SUPABASE_PUBLIC_URL=http://192.168.1.200:8000
API_EXTERNAL_URL=http://192.168.1.200:8000
SITE_URL=http://192.168.1.200:3000
DASHBOARD_USERNAME=supabase
DASHBOARD_PASSWORD=change_this_password
```

Generate keys:

```sh
sh utils/generate-keys.sh
sh utils/add-new-auth-keys.sh
```

Start Supabase:

```sh
sh run.sh start
```

Open:

```text
http://192.168.1.200:8000
```

## 4. Start App/Tooling Stack

Still inside `synology-container-stack/`:

```sh
docker compose up -d --build
docker compose ps
```

The first build takes a while — it's compiling the real `web`/`api` apps,
not pulling pre-built images. Watch for errors with `docker compose logs -f
web api`.

Open:

```text
Web:     http://192.168.1.200:3000
API:     http://192.168.1.200:4000/health
Mailpit: http://192.168.1.200:8025
Redis:   192.168.1.200:6379
```

## 5. Cloudflare Tunnel — public HTTPS (replaces ngrok)

This is what lets LINE actually reach your NAS — ngrok's free-tier
bandwidth cap and random-URL-on-every-restart both go away here, since the
tunnel is a long-lived, named resource tied to your own domain.

1. In the [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com/),
   go to **Networks → Tunnels → Create a tunnel**.
2. Choose connector type **Docker**. Cloudflare shows a `cloudflared tunnel
   run --token <TOKEN>` command — copy just the token into this stack's
   `.env` as `CLOUDFLARE_TUNNEL_TOKEN`.
3. Still in that tunnel's settings, add two **Public Hostnames**:
   - `dev.yourdomain.com` → Service `HTTP`, URL `web:3000`
   - `api.yourdomain.com` → Service `HTTP`, URL `api:4000`
4. Set `NEXT_PUBLIC_APP_URL`/`NEXT_PUBLIC_API_URL` in `.env` to those same
   hostnames (with `https://`), then rebuild: `docker compose up -d --build web`.
5. Register `https://api.yourdomain.com/webhooks/line` as the LINE
   webhook URL in the LINE Developers Console — that's handled by `api`
   directly (`api/src/routes/line.ts`), not proxied through `web`.
6. Restart `cloudflared`: `docker compose up -d cloudflared`.

## 6. Synology Container Manager

In Synology DSM:

1. Open Container Manager.
2. Go to Project.
3. Create.
4. Select `Create docker-compose.yml`.
5. Project path: `/volume1/docker/slippy/synology-container-stack`.
6. Use the existing `docker-compose.yml`.
7. Build and start.

Run Supabase from SSH first because the official Supabase project includes helper scripts for secret generation and service management.

## 7. Mobile App Notes

For mobile testing on real devices, do not use `localhost`.

Use:

```env
EXPO_PUBLIC_SUPABASE_URL=http://192.168.1.200:8000
NEXT_PUBLIC_SUPABASE_URL=http://192.168.1.200:8000
```

For LINE/LIFF specifically, use the Cloudflare Tunnel hostnames from step 5
instead — LINE requires real public HTTPS, a LAN IP won't work there
regardless of network.

