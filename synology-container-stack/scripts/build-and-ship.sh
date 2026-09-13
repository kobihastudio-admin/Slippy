#!/usr/bin/env sh
set -eu

# Builds web + api on THIS machine (cross-compiled for the NAS's linux/amd64
# — Apple Silicon Macs are arm64, most Synology NAS are amd64) and ships the
# built images to the NAS as a tarball, instead of building on the NAS
# itself. Use this when the NAS doesn't have enough RAM/CPU to build
# in-place (`docker compose up -d --build` OOM-killing the stack).
#
# Requires: Docker Desktop (buildx + QEMU emulation for the cross-arch
# build), and the passwordless-sudo NOPASSWD rule for `docker` already set
# up on the NAS (see docs/SYNOLOGY_DEPLOY.md) so the final remote step
# doesn't hang waiting for a password over non-interactive SSH.
#
# Usage:
#   NAS_SSH=chainimit@192.168.1.200 NAS_PATH=/volume1/docker/slippy sh scripts/build-and-ship.sh
#   # add "web" or "api" as an extra arg to build/ship just one:
#   NAS_SSH=chainimit@192.168.1.200 NAS_PATH=/volume1/docker/slippy sh scripts/build-and-ship.sh web

NAS_SSH="${NAS_SSH:-}"
NAS_PATH="${NAS_PATH:-/volume1/docker/slippy}"
STACK_DIR="$NAS_PATH/synology-container-stack"
TARGET="${1:-all}"

if [ -z "$NAS_SSH" ]; then
  echo "Set NAS_SSH first, for example:"
  echo "  NAS_SSH=chainimit@192.168.1.200 NAS_PATH=/volume1/docker/slippy sh scripts/build-and-ship.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$STACK_ROOT/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# The NEXT_PUBLIC_* values get baked into the web image at build time, and
# they only live in the NAS's own .env right now (this repo checkout has no
# local .env — see .env.example). Pull it down temporarily just to source
# the build args; nothing here is written back or committed.
echo "==> Fetching build args from $NAS_SSH:$STACK_DIR/.env"
ssh "$NAS_SSH" "cat '$STACK_DIR/.env'" > "$TMP_DIR/.env.remote"
set -a
# shellcheck disable=SC1091
. "$TMP_DIR/.env.remote"
set +a

build_web() {
  echo "==> Building web (linux/amd64)"
  docker buildx build \
    --platform linux/amd64 \
    -f "$STACK_ROOT/apps/web/Dockerfile" \
    --build-arg NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-}" \
    --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" \
    --build-arg NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-}" \
    --build-arg NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-}" \
    --build-arg NEXT_PUBLIC_LIFF_ID="${NEXT_PUBLIC_LIFF_ID:-}" \
    --build-arg NEXT_PUBLIC_LINE_BOT_ID="${NEXT_PUBLIC_LINE_BOT_ID:-}" \
    --build-arg NEXT_PUBLIC_LINE_CHANNEL_ID="${NEXT_PUBLIC_LINE_CHANNEL_ID:-}" \
    --build-arg NEXT_PUBLIC_GOOGLE_MAPS_KEY="${NEXT_PUBLIC_GOOGLE_MAPS_KEY:-}" \
    --build-arg NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:-}" \
    --build-arg NEXT_PUBLIC_STRIPE_PRICE_PACK_100="${NEXT_PUBLIC_STRIPE_PRICE_PACK_100:-}" \
    --build-arg NEXT_PUBLIC_STRIPE_PRICE_PACK_300="${NEXT_PUBLIC_STRIPE_PRICE_PACK_300:-}" \
    --build-arg NEXT_PUBLIC_STRIPE_PRICE_PACK_500="${NEXT_PUBLIC_STRIPE_PRICE_PACK_500:-}" \
    -t slippy-web:latest \
    --load \
    "$REPO_ROOT"
}

build_api() {
  echo "==> Building api (linux/amd64)"
  docker buildx build \
    --platform linux/amd64 \
    -f "$STACK_ROOT/apps/api/Dockerfile" \
    -t slippy-api:latest \
    --load \
    "$REPO_ROOT"
}

IMAGES=""
case "$TARGET" in
  web)  build_web; IMAGES="slippy-web:latest" ;;
  api)  build_api; IMAGES="slippy-api:latest" ;;
  all)  build_web; build_api; IMAGES="slippy-web:latest slippy-api:latest" ;;
  *)    echo "Unknown target: $TARGET (expected web, api, or all)" >&2; exit 1 ;;
esac

echo "==> Saving image(s) to tarball"
# shellcheck disable=SC2086
docker save $IMAGES -o "$TMP_DIR/images.tar"
ls -lh "$TMP_DIR/images.tar"

echo "==> Shipping tarball to $NAS_SSH:$STACK_DIR"
# -O forces the legacy SCP protocol — modern macOS scp defaults to the
# SFTP-based protocol, which fails against Synology's sshd with a cryptic
# "subsystem request failed on channel 0" / "Connection closed".
scp -O "$TMP_DIR/images.tar" "$NAS_SSH:$STACK_DIR/images.tar"

echo "==> Loading + recreating containers on the NAS"
ssh "$NAS_SSH" "export PATH=\$PATH:/usr/local/bin && cd '$STACK_DIR' && \
  sudo -n docker load -i images.tar && \
  rm images.tar && \
  sudo -n docker compose up -d $( [ "$TARGET" = all ] && echo 'web api' || echo "$TARGET" )"

echo ""
echo "Done. Tail logs with:"
echo "  ssh $NAS_SSH 'export PATH=\$PATH:/usr/local/bin && cd $STACK_DIR && sudo -n docker compose logs --tail=50 web api'"
