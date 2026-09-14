#!/usr/bin/env sh
set -u   # not -e — we want every check to run even if earlier ones fail

# Pre-flight checks to run over the LAN (by NAS IP) BEFORE wiring up the
# Cloudflare Tunnel — catches container/networking problems while they're
# still easy to diagnose (SSH + curl), instead of discovering them later
# disguised as "the tunnel isn't working."
#
# Usage:
#   sh scripts/smoke-test.sh                              # defaults to 192.168.1.200
#   NAS_HOST=192.168.1.200 sh scripts/smoke-test.sh
#   NAS_SSH=chainimit@192.168.1.200 sh scripts/smoke-test.sh   # adds the internal web→api check

NAS_HOST="${NAS_HOST:-192.168.1.200}"
NAS_SSH="${NAS_SSH:-}"
NAS_PATH="${NAS_PATH:-/volume1/docker/slippy}"
WEB_PORT="${WEB_PORT:-3000}"
API_PORT="${API_PORT:-4000}"
MAILPIT_PORT="${MAILPIT_PORT:-8025}"

PASS=0
FAIL=0

ok()   { PASS=$((PASS + 1)); echo "  ✓ $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  ✗ $1"; }

echo "Smoke-testing $NAS_HOST (LAN, no Cloudflare yet)"
echo ""

# ── 1. Reachability ─────────────────────────────────────────────────────────
echo "1) Is $NAS_HOST reachable at all?"
if command -v ping >/dev/null 2>&1 && ping -c 1 -W 2 "$NAS_HOST" >/dev/null 2>&1; then
  ok "ping reached $NAS_HOST"
else
  bad "ping failed — check you're on the same network as the NAS, or that ICMP isn't blocked (some NAS firewalls block ping but still serve HTTP — not fatal on its own, keep going)"
fi
echo ""

# ── 2. api /health ───────────────────────────────────────────────────────────
echo "2) api container — GET /health"
API_BODY="$(curl -fsS -m 4 "http://$NAS_HOST:$API_PORT/health" 2>&1)"
if [ $? -eq 0 ] && echo "$API_BODY" | grep -q '"status":"ok"'; then
  ok "api responded: $API_BODY"
else
  bad "api did not respond cleanly on port $API_PORT — output: $API_BODY"
  echo "    → check: ssh $NAS_SSH 'export PATH=\$PATH:/usr/local/bin && cd $NAS_PATH/synology-container-stack && sudo -n docker compose logs api'"
fi
echo ""

# ── 3. web root page ─────────────────────────────────────────────────────────
echo "3) web container — GET / (expect HTTP 200/30x, not connection refused)"
WEB_CODE="$(curl -sS -m 6 -o /dev/null -w '%{http_code}' "http://$NAS_HOST:$WEB_PORT/" 2>&1)"
if [ "$WEB_CODE" = "200" ] || [ "$WEB_CODE" = "307" ] || [ "$WEB_CODE" = "308" ]; then
  ok "web responded HTTP $WEB_CODE"
else
  bad "web responded HTTP $WEB_CODE (expected 200/307/308)"
  echo "    → check: ssh $NAS_SSH 'export PATH=\$PATH:/usr/local/bin && cd $NAS_PATH/synology-container-stack && sudo -n docker compose logs web'"
fi
echo ""

# ── 4. mailpit (optional but easy to confirm) ───────────────────────────────
echo "4) mailpit UI"
if curl -fsS -m 4 -o /dev/null "http://$NAS_HOST:$MAILPIT_PORT/"; then
  ok "mailpit UI reachable"
else
  bad "mailpit UI not reachable on port $MAILPIT_PORT (non-critical — only affects local email testing)"
fi
echo ""

# ── 5. internal web → api connectivity (the most common silent failure) ────
# This is the check that catches a misconfigured API_BASE_URL or a Docker
# network issue — both web and api can be "up" individually and this can
# still be broken, which would otherwise look exactly like a Cloudflare
# Tunnel problem once you get that far.
echo "5) internal web→api connectivity (container network, not the LAN)"
if [ -z "$NAS_SSH" ]; then
  echo "  – skipped (set NAS_SSH=admin@$NAS_HOST to enable this check)"
else
  # Debian-slim images (what web/api build on) don't ship wget or curl —
  # node's built-in fetch (Node 18+) is guaranteed present instead.
  INTERNAL_BODY="$(ssh "$NAS_SSH" "export PATH=\$PATH:/usr/local/bin && cd '$NAS_PATH/synology-container-stack' && sudo -n docker compose exec -T web node -e \"fetch('http://api:4000/health').then(r=>r.text()).then(console.log).catch(e=>{console.error(e.message);process.exit(1)})\"" 2>&1)"
  if echo "$INTERNAL_BODY" | grep -q '"status":"ok"'; then
    ok "web can reach api over the internal docker network"
  else
    bad "web cannot reach api internally — output: $INTERNAL_BODY"
    echo "    → check API_BASE_URL is set to http://api:4000 (not localhost) in docker-compose.yml's web service"
  fi
fi
echo ""

# ── 6. container health / restart loops ─────────────────────────────────────
echo "6) container status (looking for restart loops)"
if [ -z "$NAS_SSH" ]; then
  echo "  – skipped (set NAS_SSH=admin@$NAS_HOST to enable this check)"
else
  # Plain `docker compose ps` (no --format) — the Go-template --format
  # syntax isn't parsed the same way on every Compose version (broke
  # outright on Compose v2.20.1), so just grep the default table output.
  PS_OUT="$(ssh "$NAS_SSH" "export PATH=\$PATH:/usr/local/bin && cd '$NAS_PATH/synology-container-stack' && sudo -n docker compose ps" 2>&1)"
  echo "$PS_OUT" | sed 's/^/    /'
  # slippy-cloudflared restart-looping is EXPECTED until
  # CLOUDFLARE_TUNNEL_TOKEN is set in .env (see docs/SYNOLOGY_DEPLOY.md
  # section 5) — exclude it so this check only flags real problems.
  if echo "$PS_OUT" | grep -v "slippy-cloudflared" | grep -qi "restarting"; then
    bad "one or more containers are restart-looping — see output above"
  else
    ok "no containers reported as restarting (besides cloudflared, if it's not configured yet — see below)"
  fi
  if echo "$PS_OUT" | grep "slippy-cloudflared" | grep -qi "restarting"; then
    echo "    ℹ cloudflared is restart-looping — expected if CLOUDFLARE_TUNNEL_TOKEN is still blank in .env"
  fi
fi

echo ""
echo "──────────────────────────────────────────"
echo "Result: $PASS passed, $FAIL failed"
echo "──────────────────────────────────────────"

if [ "$FAIL" -eq 0 ]; then
  echo ""
  echo "All good on the LAN. Safe to move on to the Cloudflare Tunnel step"
  echo "(docs/SYNOLOGY_DEPLOY.md, section 5)."
else
  echo ""
  echo "Fix the failed checks above before wiring up Cloudflare — a tunnel"
  echo "just forwards traffic, it won't fix anything that's broken on the LAN."
  exit 1
fi
