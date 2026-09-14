import type { NextConfig } from "next"
import createNextIntlPlugin from "next-intl/plugin"

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts")

// ── Content-Security-Policy ───────────────────────────────────────────────────
// Builds the CSP header string from a structured object so each directive
// is easy to read, audit, and extend.
const supabaseHost = "https://*.supabase.co"

/**
 * Google Maps JS API — the bootstrap loader, tiles, marker icons and place
 * data all come from these hosts. A missing origin here fails SILENTLY — a
 * blocked tile/script request does not throw, the map (or parts of it) just
 * never draws — which is why every host is spelled out rather than left
 * implicit (this exact class of bug already shipped once with the old OSM
 * raster setup, and again with MapTiler before this).
 */
const googleMapsOrigins = [
  "https://maps.googleapis.com",   // bootstrap loader + Maps/Places/Directions libraries
  "https://maps.gstatic.com",      // tiles, marker/UI sprites
  "https://*.googleapis.com",      // library sub-requests (fonts, static assets)
  "https://*.gstatic.com",
  "https://*.ggpht.com",           // Street View / Places photos, if ever embedded
]

const cspDirectives: Record<string, string[]> = {
  "default-src":     ["'self'"],
  "script-src":      ["'self'", "'unsafe-inline'", "'unsafe-eval'",
                      // Next.js inline scripts + Vercel Analytics
                      "https://va.vercel-scripts.com",
                      // The Maps JS API bootstrap loader injects its own
                      // <script src="https://maps.googleapis.com/..."> tag —
                      // without this line CSP silently blocks it and the map
                      // never appears, no console error pointing at CSP either.
                      "https://maps.googleapis.com"],
  "style-src":       ["'self'", "'unsafe-inline'",
                      // Google Fonts stylesheet
                      "https://fonts.googleapis.com"],
  "font-src":        ["'self'", "https://fonts.gstatic.com", "data:"],
  "img-src":         ["'self'", "data:", "blob:",
                      supabaseHost,
                      "https://lh3.googleusercontent.com",
                      // DiceBear avatar presets (profile picture picker)
                      "https://api.dicebear.com",
                      ...googleMapsOrigins],
  "media-src":       ["'self'", "blob:", supabaseHost],
  "connect-src":     ["'self'",
                      supabaseHost,
                      // Supabase auth (project-specific URL also matched above)
                      "https://*.supabase.io",
                      // Vercel Speed Insights
                      "https://vitals.vercel-insights.com",
                      "https://va.vercel-scripts.com",
                      // LiveKit Cloud voice-call rooms — a project's URL is a
                      // subdomain of livekit.cloud, both the wss:// signaling
                      // connection and the https:// token/API surface.
                      "wss://*.livekit.cloud",
                      "https://*.livekit.cloud",
                      ...googleMapsOrigins],
  "worker-src":      ["'self'", "blob:"],
  "frame-src":       ["'none'"],
  "frame-ancestors": ["'none'"],
  "object-src":      ["'none'"],
  "base-uri":        ["'self'"],
  "form-action":     ["'self'"],
  "upgrade-insecure-requests": [],
}

const cspHeader = Object.entries(cspDirectives)
  .map(([key, values]) => `${key} ${values.join(" ")}`.trim())
  .join("; ")

// ── Relaxed CSP for /liff/* (LINE Front-end Framework) routes ─────────────────
// `liff.init()` loads additional "client features" (scripts + iframes) from
// LINE's CDN/auth domains. The default CSP above (frame-src: 'none', no LINE
// domains in script-src/connect-src) blocks this with the generic SDK error
// "Unable to load client features." — these routes need LINE's domains added.
const liffCspDirectives: Record<string, string[]> = {
  ...cspDirectives,
  "script-src":  [...cspDirectives["script-src"], "https://*.line-scdn.net", "https://*.line.me"],
  "connect-src": [...cspDirectives["connect-src"], "https://*.line-scdn.net", "https://*.line.me", "https://*.line.naver.jp"],
  "img-src":     [...cspDirectives["img-src"], "https://*.line-scdn.net", "https://*.line.me"],
  "frame-src":   ["https://*.line.me", "https://*.line-scdn.net"],
  "frame-ancestors": ["'self'", "https://*.line.me"],
}

const liffCspHeader = Object.entries(liffCspDirectives)
  .map(([key, values]) => `${key} ${values.join(" ")}`.trim())
  .join("; ")

// ─────────────────────────────────────────────────────────────────────────────

const securityHeaders = [
  // Prevent embedding in iframes (clickjacking)
  { key: "X-Frame-Options",            value: "DENY" },
  // Block MIME-type sniffing
  { key: "X-Content-Type-Options",     value: "nosniff" },
  // Limit referrer info sent to third-party domains
  { key: "Referrer-Policy",            value: "strict-origin-when-cross-origin" },
  // Enforce HTTPS for 1 year (incl. subdomains)
  { key: "Strict-Transport-Security",  value: "max-age=31536000; includeSubDomains; preload" },
  // Restrict browser features
  {
    // camera=(self) — allows this page to use camera, blocks third-party iframes
    // microphone=(self) — trip voice calling (LiveKit) needs mic access
    // geolocation=(self) — trip live location sharing needs the Geolocation API
    key:   "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=(self), payment=(), usb=()",
  },
  // Block legacy XSS auditor (old browsers)
  { key: "X-XSS-Protection",           value: "1; mode=block" },
  // Content-Security-Policy
  { key: "Content-Security-Policy",    value: cspHeader },
]

const nextConfig: NextConfig = {
  // Lets a verification build run without clobbering the .next a dev server is
  // already using. Unset in normal builds, so production output is unchanged.
  ...(process.env.NEXT_BUILD_DIST_DIR ? { distDir: process.env.NEXT_BUILD_DIST_DIR } : {}),
  // Traces only the dependencies actually reachable from server code into
  // .next/standalone, instead of the Docker runner stage copying the whole
  // (workspace-hoisted, web+api combined) root node_modules — this is the
  // main lever for image size. See synology-container-stack/apps/web/Dockerfile.
  output: "standalone",
  eslint: {
    // ESLint is enforced separately via `npm run lint` / CI.
    // Keeping it out of the build step avoids blocking deploys from
    // pre-existing warn-level `any` violations while real errors are fixed.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // `tsc`'s whole-project type check ("Checking validity of types") is the
    // memory spike that OOM-kills (SIGKILL) `next build` on the 3.8GB NAS.
    // Types are still validated locally and in CI (`npm run build` without the
    // flag runs the check normally) — this only skips it in the memory-
    // constrained container build, where SKIP_TYPECHECK=1 is set in the web
    // Dockerfile. Without this, the deploy cannot complete on the NAS at all.
    ignoreBuildErrors: process.env.SKIP_TYPECHECK === "1",
  },
  // pdf2pic is an api-only dependency (api/src/pipeline/preprocessor.ts) —
  // not used by web, so it isn't listed here.
  serverExternalPackages: ["@anthropic-ai/sdk", "sharp"],
  experimental: {
    // src/middleware.ts runs on nearly every route (see its matcher) to check
    // auth and rate-limit — it never reads a request's body. But Next.js
    // clones every request body in front of ANY middleware regardless of
    // whether that middleware touches it, capped by default at exactly 10MiB
    // (DEFAULT_BODY_CLONE_SIZE_LIMIT in next/dist/server/body-streams.js).
    // A multipart upload over that gets silently truncated mid-file before
    // it ever reaches the route handler, which then can't find a `file`
    // field in the corrupted body and reports "attach a file" — not the
    // route's own, larger MAX_BYTES check, and not a timeout either: the
    // request just completes fast with a confusing error, or in the client
    // UI (whose upload handlers don't catch this) reads as the button
    // hanging forever. Raised past every route's own limit (the largest is
    // liff/scan's 20MB) rather than per-route, since the cap is enforced
    // here regardless of what any individual route declares.
    middlewareClientMaxBodySize: "25mb",
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
  async headers() {
    return [
      {
        // LIFF routes need a relaxed CSP that allows LINE's domains —
        // must be listed before the catch-all so it takes precedence.
        source:  "/liff/:path*",
        headers: securityHeaders.map(h =>
          h.key === "Content-Security-Policy" ? { ...h, value: liffCspHeader } : h
        ),
      },
      {
        // Apply security headers to all other routes. Next.js applies ALL
        // matching header rules (merging/intersecting CSPs), so /liff/* is
        // excluded here to avoid conflicting with the relaxed CSP above.
        source:  "/((?!liff/).*)",
        headers: securityHeaders,
      },
    ]
  },
}

export default withNextIntl(nextConfig)
