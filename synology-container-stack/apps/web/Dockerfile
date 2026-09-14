# syntax=docker/dockerfile:1
#
# Real Next.js (web/) container — replaces the apps/hello-web placeholder.
# Build context MUST be the repo root (see docker-compose.yml: `context: ..`)
# because this is an npm workspaces monorepo — `npm ci` needs every
# workspace's package.json present to resolve against the root lockfile,
# even though this image only runs the `web` workspace.
#
# Debian-slim (not Alpine) — `sharp` ships prebuilt glibc binaries; Alpine's
# musl libc means it would have to compile from source, which is slower and
# occasionally breaks on arm64 Synology models.

# Node 20 is the active LTS line and is materially more reliable than Node 22
# under the linux/amd64 emulator used by the Mac-to-NAS release pipeline.
# Keep every stage on the same ABI to ensure Next's standalone output runs on
# the NAS exactly as it was built.
FROM node:20-bookworm-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY web/package.json ./web/package.json
COPY api/package.json ./api/package.json
RUN npm ci

FROM node:20-bookworm-slim AS builder
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1

# NEXT_PUBLIC_* vars get inlined into the JS bundle at build time, not read
# at runtime — must be passed as build args (see docker-compose.yml's
# `build.args`, sourced from this stack's own .env). Server-only secrets
# (SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, etc.) must NEVER go here — they
# stay runtime-only env vars on the `api`/`web` services below.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_LIFF_ID
ARG NEXT_PUBLIC_LINE_BOT_ID
ARG NEXT_PUBLIC_LINE_CHANNEL_ID
ARG NEXT_PUBLIC_GOOGLE_MAPS_KEY
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_STRIPE_PRICE_PACK_100
ARG NEXT_PUBLIC_STRIPE_PRICE_PACK_300
ARG NEXT_PUBLIC_STRIPE_PRICE_PACK_500
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_LIFF_ID=$NEXT_PUBLIC_LIFF_ID \
    NEXT_PUBLIC_LINE_BOT_ID=$NEXT_PUBLIC_LINE_BOT_ID \
    NEXT_PUBLIC_LINE_CHANNEL_ID=$NEXT_PUBLIC_LINE_CHANNEL_ID \
    NEXT_PUBLIC_GOOGLE_MAPS_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_KEY \
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_STRIPE_PRICE_PACK_100=$NEXT_PUBLIC_STRIPE_PRICE_PACK_100 \
    NEXT_PUBLIC_STRIPE_PRICE_PACK_300=$NEXT_PUBLIC_STRIPE_PRICE_PACK_300 \
    NEXT_PUBLIC_STRIPE_PRICE_PACK_500=$NEXT_PUBLIC_STRIPE_PRICE_PACK_500

COPY --from=deps /repo/node_modules ./node_modules
COPY . .
RUN npm run build --workspace=web

# `output: "standalone"` (web/next.config.ts) makes Next.js trace the actual
# server-side dependency graph — including serverExternalPackages like sharp —
# and emit a minimal node_modules under .next/standalone, instead of shipping
# the whole workspace-hoisted root node_modules (which includes api's
# dependencies too) into the image.
FROM node:20-bookworm-slim AS runner
WORKDIR /repo/web
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

COPY --from=builder /repo/web/.next/standalone ./
COPY --from=builder /repo/web/.next/static ./web/.next/static
COPY --from=builder /repo/web/public ./web/public

EXPOSE 3000
CMD ["node", "web/server.js"]
