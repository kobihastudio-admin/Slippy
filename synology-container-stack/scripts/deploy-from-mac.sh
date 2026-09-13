#!/usr/bin/env sh
set -eu

# One-shot deploy from this Mac: sync repo -> build web/api locally
# (cross-compiled for the NAS's linux/amd64) -> ship + load + recreate on
# the NAS. This is the "build on the NAS is too heavy" alternative to
# scripts/deploy.sh (which builds ON the NAS itself).
#
# Usage:
#   sh scripts/deploy-from-mac.sh            # sync + build + ship both web and api
#   sh scripts/deploy-from-mac.sh web        # only web
#   sh scripts/deploy-from-mac.sh api         # only api
#
# Override defaults via env vars if needed:
#   NAS_SSH=chainimit@192.168.1.200 NAS_PATH=/volume1/docker/slippy sh scripts/deploy-from-mac.sh

NAS_SSH="${NAS_SSH:-chainimit@192.168.1.200}"
NAS_PATH="${NAS_PATH:-/volume1/docker/slippy}"
NAS_HOST="${NAS_HOST:-192.168.1.200}"
WEB_PORT="${WEB_PORT:-3000}"
API_PORT="${API_PORT:-4000}"
TARGET="${1:-all}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> 1/3  Syncing repo to $NAS_SSH:$NAS_PATH"
NAS_SSH="$NAS_SSH" NAS_PATH="$NAS_PATH" sh "$SCRIPT_DIR/deploy-to-nas.sh"

echo ""
echo "==> 2/3  Building on this Mac (linux/amd64) and shipping to the NAS"
NAS_SSH="$NAS_SSH" NAS_PATH="$NAS_PATH" sh "$SCRIPT_DIR/build-and-ship.sh" "$TARGET"

echo ""
echo "==> 3/3  Waiting for services to come up..."
ATTEMPTS=30
i=0
api_ok=0
web_ok=0
# Skip a check entirely if we only shipped the other service this round.
[ "$TARGET" = "web" ] && api_ok=1
[ "$TARGET" = "api" ] && web_ok=1
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
  echo "  ssh $NAS_SSH 'export PATH=\$PATH:/usr/local/bin && cd $NAS_PATH/synology-container-stack && sudo -n docker compose logs --tail=80 web api'"
  exit 1
fi

echo ""
echo "Deploy complete."
