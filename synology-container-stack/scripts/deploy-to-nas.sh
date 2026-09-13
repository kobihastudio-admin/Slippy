#!/usr/bin/env sh
set -eu

# Syncs the WHOLE repo (not just this folder) to the NAS — required since
# synology-container-stack/docker-compose.yml builds web/api with
# `context: ..`, i.e. it needs web/, api/, package.json, package-lock.json
# etc. present alongside synology-container-stack/ on the NAS side too.
#
# Uses `tar | ssh ... tar -x` instead of rsync. macOS (Sequoia+) ships
# Apple's `openrsync` instead of GNU rsync — it speaks an older protocol
# (29) that doesn't reliably interop with the GNU rsync on Synology DSM,
# failing with a confusing "Permission denied, please try again" that looks
# like an SSH auth problem but isn't. tar+ssh only needs the things we've
# already confirmed work (plain ssh, plain tar), so it's the more portable
# choice here even though it loses rsync's incremental-transfer speed.
#
# Note: this does NOT delete files on the NAS that no longer exist in the
# source (rsync --delete would). Good enough for this stack's size; if repo
# structure changes significantly, clean the NAS path manually first.

NAS_SSH="${NAS_SSH:-}"
NAS_PATH="${NAS_PATH:-/volume1/docker/slippy}"

if [ -z "$NAS_SSH" ]; then
  echo "Set NAS_SSH first, for example:"
  echo "  NAS_SSH=chainimit@192.168.1.200 NAS_PATH=/volume1/docker/slippy sh scripts/deploy-to-nas.sh"
  exit 1
fi

# NAS_PATH must be the REPO ROOT on the NAS, not this stack's own folder —
# this script tars the whole monorepo (see comment above) and the
# docker-compose.yml lives at "$NAS_PATH/synology-container-stack/...".
# Passing an already-nested path here (e.g. .../slippy/synology-container-stack)
# makes tar extract a second copy of the repo inside itself, one level too
# deep — this happened once and left two live copies of .env/web.env/api.env
# out of sync with each other, silently serving stale config.
case "$NAS_PATH" in
  */synology-container-stack|*/synology-container-stack/)
    echo "NAS_PATH looks like it already points at the synology-container-stack folder: $NAS_PATH" >&2
    echo "Pass the repo ROOT instead (e.g. \${NAS_PATH%/synology-container-stack}) — this script appends synology-container-stack itself." >&2
    exit 1
    ;;
esac

command -v tar >/dev/null 2>&1 || {
  echo "tar is required on this machine."
  exit 1
}

# This script lives at <repo-root>/synology-container-stack/scripts/ —
# resolve <repo-root> relative to it so this works regardless of cwd.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

ssh "$NAS_SSH" "mkdir -p '$NAS_PATH'"

echo "Packing + streaming repo to $NAS_SSH:$NAS_PATH (this can take a minute)..."
# COPYFILE_DISABLE stops macOS's tar from embedding Apple xattr/resource-fork
# metadata that GNU tar on the NAS doesn't understand — without it, every
# file prints a harmless but noisy "Ignoring unknown extended header
# keyword" warning on the remote side.
export COPYFILE_DISABLE=1
tar \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude 'dist' \
  --exclude '.git' \
  --exclude '.turbo' \
  --exclude 'coverage' \
  --exclude 'ios' \
  --exclude 'mobile' \
  --exclude 'android' \
  --exclude '.env' \
  --exclude '.env.local' \
  --exclude '*.env.local' \
  --exclude 'synology-container-stack/.env' \
  --exclude 'synology-container-stack/web.env' \
  --exclude 'synology-container-stack/api.env' \
  --exclude 'synology-container-stack/supabase' \
  --exclude 'synology-container-stack/data' \
  --exclude 'synology-container-stack/logs' \
  -czf - -C "$REPO_ROOT" . \
  | ssh "$NAS_SSH" "tar -xzf - -C '$NAS_PATH'"

echo "Deployed repo to $NAS_SSH:$NAS_PATH"
echo "SSH into the NAS, then run:"
echo "  cd $NAS_PATH/synology-container-stack"
echo "  cp .env.example .env            # if not already set up"
echo "  cp web.env.example web.env      # if not already set up"
echo "  cp api.env.example api.env      # if not already set up"
echo "  export PATH=\$PATH:/usr/local/bin   # docker isn't on PATH by default over SSH"
echo "  sh scripts/bootstrap-supabase.sh   # first time only"
echo "  docker compose up -d --build"
