#!/usr/bin/env sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SUPABASE_DIR="$ROOT_DIR/supabase"
TMP_DIR="$ROOT_DIR/.tmp-supabase"

if [ -d "$SUPABASE_DIR" ]; then
  echo "Supabase directory already exists: $SUPABASE_DIR"
  echo "Remove it manually if you want to bootstrap again."
  exit 0
fi

command -v git >/dev/null 2>&1 || {
  echo "git is required. Install Git Server or use Synology Package Center/Entware."
  exit 1
}

rm -rf "$TMP_DIR"
git clone --depth 1 --filter=blob:none --sparse https://github.com/supabase/supabase "$TMP_DIR"
cd "$TMP_DIR"
git sparse-checkout set docker

mkdir -p "$SUPABASE_DIR"
cp -R "$TMP_DIR/docker/." "$SUPABASE_DIR/"
cp "$TMP_DIR/docker/.env.example" "$SUPABASE_DIR/.env"
rm -rf "$TMP_DIR"

cd "$SUPABASE_DIR"

echo ""
echo "Supabase official Docker project created at: $SUPABASE_DIR"
echo ""
echo "Next:"
echo "  1. Edit $SUPABASE_DIR/.env"
echo "  2. Set SUPABASE_PUBLIC_URL=http://<NAS_IP>:8000"
echo "  3. Set API_EXTERNAL_URL=http://<NAS_IP>:8000"
echo "  4. Set SITE_URL=http://<NAS_IP>:3000 or your app URL"
echo "  5. Run: sh utils/generate-keys.sh"
echo "  6. Run: sh utils/add-new-auth-keys.sh"
echo "  7. Run: sh run.sh start"

