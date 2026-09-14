#!/usr/bin/env sh
set -eu

# One-shot deploy: rsync the repo to the NAS, then bring the stack up there
# over SSH, then wait for /health to actually respond before declaring
# success. This is the "make deploy"/`npm run deploy`-equivalent for this
# stack — see Makefile for the short form.
#
# Defaults match the NAS at 192.168.1.200 — override any of these via env
# vars if your NAS uses a different IP/path/user:
#   NAS_SSH=chainimit@192.168.1.200
#   NAS_PATH=/volume1/docker/slippy
#   NAS_HOST=192.168.1.200   (used only for the post-deploy health check)

NAS_SSH="${NAS_SSH:-chainimit@192.168.1.200}"
NAS_PATH="${NAS_PATH:-/volume1/docker/slippy}"
NAS_HOST="${NAS_HOST:-192.168.1.200}"
WEB_PORT="${WEB_PORT:-3000}"
API_PORT="${API_PORT:-4000}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> 1/3  Syncing repo to $NAS_SSH:$NAS_PATH"
NAS_SSH="$NAS_SSH" NAS_PATH="$NAS_PATH" sh "$SCRIPT_DIR/deploy-to-nas.sh"

echo ""
echo "==> 2/3  Building and starting containers on the NAS"
# Synology's non-interactive SSH PATH doesn't include /usr/local/bin, where
# Container Manager symlinks the `docker` binary — `docker: command not
# found` over ssh even though it works fine in an interactive DSM terminal.
# Export PATH explicitly rather than relying on the remote shell's default.
#
# `sudo` — DSM's Container Manager doesn't create a normal Linux `docker`
# group; the socket is root:root-only. Requires a one-time NOPASSWD sudoers
# rule for the docker binary specifically (see docs/SYNOLOGY_DEPLOY.md) —
# without it this hangs forever waiting for a password on a non-interactive
# SSH session.
ssh "$NAS_SSH" "export PATH=\$PATH:/usr/local/bin && cd '$NAS_PATH/synology-container-stack' && \
  if [ ! -f .env ]; then echo 'Missing .env — copy .env.example first, then re-run.' >&2; exit 1; fi && \
  if [ ! -f web.env ]; then echo 'Missing web.env — copy web.env.example first, then re-run.' >&2; exit 1; fi && \
  if [ ! -f api.env ]; then echo 'Missing api.env — copy api.env.example first, then re-run.' >&2; exit 1; fi && \
  sudo -n docker compose up -d --build"

echo ""
echo "==> 3/3  Waiting for services to come up..."
ATTEMPTS=30
i=0
api_ok=0
web_ok=0
while [ "$i" -lt "$ATTEMPTS" ]; do
  if [ "$api_ok" -eq 0 ] && curl -fsS -m 2 "http://$NAS_HOST:$API_PORT/health" >/dev/null 2>&1; then
    api_ok=1
    echo "    api  is up  (http://$NAS_HOST:$API_PORT/health)"
  fi
  if [ "$web_ok" -eq 0 ] && curl -fsS -m 2 -o /dev/null "http://$NAS_HOST:$WEB_PORT" 2>&1; then
    web_ok=1
    echo "    web  is up  (http://$NAS_HOST:$WEB_PORT)"
  fi
  [ "$api_ok" -eq 1 ] && [ "$web_ok" -eq 1 ] && break
  i=$((i + 1))
  sleep 2
done

if [ "$api_ok" -eq 0 ] || [ "$web_ok" -eq 0 ]; then
  echo ""
  echo "Timed out waiting for services. Check logs:"
  echo "  ssh $NAS_SSH 'export PATH=\$PATH:/usr/local/bin && cd $NAS_PATH/synology-container-stack && sudo -n docker compose logs -f web api'"
  exit 1
fi

echo ""
echo "Deploy complete. Run the smoke test next:"
echo "  NAS_HOST=$NAS_HOST sh scripts/smoke-test.sh"
