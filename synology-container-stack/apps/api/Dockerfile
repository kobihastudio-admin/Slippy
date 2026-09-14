# syntax=docker/dockerfile:1
#
# Real Fastify (api/) container — replaces the apps/hello-api placeholder.
# Build context MUST be the repo root (see docker-compose.yml: `context: ..`),
# same reasoning as web/Dockerfile (npm workspaces lockfile resolution).
#
# Runs via `tsx` directly from TypeScript source — same as `npm run dev` —
# rather than `node dist/index.js`. The `tsc`-compiled output uses
# extensionless relative imports (e.g. `from "../routes/documents"`), which
# plain `node` ESM cannot resolve without an explicit `.js` suffix (it
# throws ERR_MODULE_NOT_FOUND at startup); `tsx` resolves them the same way
# ts-node/bundlers do, matching how this app already runs in dev. `tsc` is
# still run below as a build-time type-check gate — if it fails, the image
# build fails before anything ships — but its `dist/` output isn't used.
#
# Installs graphicsmagick + ghostscript system packages — `pdf2pic`
# (api/src/pipeline/preprocessor.ts, used to rasterize PDF uploads before
# OCR) shells out to GraphicsMagick/Ghostscript rather than using a pure-JS
# PDF renderer; without these the container would build fine but PDF
# uploads would fail silently at runtime.

FROM node:22-bookworm-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY web/package.json ./web/package.json
COPY api/package.json ./api/package.json
RUN npm ci

FROM node:22-bookworm-slim AS typecheck
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY . .
RUN npm run build --workspace=api

# A separate `npm ci --workspace=api` stage was tried here to trim web's
# deps (React, Next.js, etc.) out of the api image, but it broke `sharp` at
# runtime — ERR_MODULE_NOT_FOUND. `sharp` resolves platform-specific native
# binaries via optionalDependencies, and a second, isolated `npm ci` against
# the same lockfile resolved them inconsistently versus the original single
# `npm ci` in `deps` above. Reverted to reusing `deps`'s node_modules — the
# size win there was small anyway (~200MB) next to web's standalone output
# win; not worth a broken production container over.
FROM node:22-bookworm-slim AS runner
WORKDIR /repo/api
ENV NODE_ENV=production

# graphicsmagick + ghostscript: `pdf2pic` (pipeline/preprocessor.ts) shells out
# to them to rasterize PDF uploads before OCR.
#
# chromium + fonts: the PDF export (routes/pdf.ts) lays documents out in headless
# Chrome. The fonts are not optional decoration — trip documents are Thai with
# Japanese place names in them, and without fonts-thai-tlwg every tone mark is a
# box and without fonts-noto-cjk every Japanese character is. A JS PDF library
# with one vendored font was tried first and could not cover both scripts.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        graphicsmagick ghostscript \
        chromium fonts-thai-tlwg fonts-noto-cjk fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# puppeteer-core ships no browser; point it at the one apt just installed.
ENV CHROME_PATH=/usr/bin/chromium

# Depending on the typecheck stage means this stage (and the final image)
# only builds if `tsc` succeeds, even though it copies source, not dist/.
COPY --from=typecheck /repo/node_modules /repo/node_modules
COPY --from=typecheck /repo/api/src ./src
COPY --from=typecheck /repo/api/package.json ./package.json
COPY --from=typecheck /repo/api/tsconfig.json ./tsconfig.json

EXPOSE 4000
CMD ["npx", "tsx", "src/index.ts"]
