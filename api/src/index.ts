import { config } from "dotenv"
import { getAppUrl } from "./lib/app-url"
config({ override: true })
import Fastify    from "fastify"
import cors       from "@fastify/cors"
import multipart  from "@fastify/multipart"
import rateLimit  from "@fastify/rate-limit"
import { redisConnection } from "./queue/setup"
import { documentsRoutes }    from "./routes/documents"
import { integrationsRoutes } from "./routes/integrations"
import { stripeRoutes }       from "./routes/stripe"
import { taxRoutes }          from "./routes/tax"
import { lineRoutes }         from "./routes/line"
import { emailRoutes }        from "./routes/email"
import { lifeRoutes }         from "./routes/life"
import { sportNotifyRoutes }  from "./routes/sport-notify"
import { tripNotifyRoutes }   from "./routes/trip-notify"
import { travelDocRoutes }      from "./routes/travel-doc"
import { medicationLabelRoutes } from "./routes/medication-label"
import { medicationPriceRoutes } from "./routes/medication-price"
import { pdfRoutes }            from "./routes/pdf"
import { userAuthedScope }      from "./plugins/supabase-auth"
import { tripPreorderNotifyRoutes } from "./routes/trip-preorder-notify"
import { splitNotifyRoutes }  from "./routes/split-notify"
import sportPlayRoutes        from "./routes/sport-play"
import { logServerError }     from "./lib/error-log"

// bodyLimit: Fastify's default is 1MB, which only ever covers plain JSON
// bodies (multipart uploads go through @fastify/multipart's own `fileSize`
// limit below, and are unaffected by this). Several routes — medication-
// label read chief among them — send a photo as base64 inside a JSON body,
// which inflates by ~33% before the JSON wrapper even gets added; a
// perfectly normal phone photo blows past 1MB long before it's "large."
// 20MB matches the multipart fileSize limit below for one consistent cap.
const app = Fastify({ logger: true, bodyLimit: 20 * 1024 * 1024 })

// ── Global error handler — log every unhandled route error durably ───────
// (previously these only hit Fastify's console logger and were gone for good)
app.setErrorHandler(async (error, request, reply) => {
  await logServerError({
    errorType: "api_unhandled",
    error,
    context: { method: request.method, url: request.url },
  })
  const statusCode = error.statusCode ?? 500
  reply.status(statusCode).send({ error: statusCode === 500 ? "Internal server error" : error.message })
})

// ── Shared plugins ───────────────────────────────────────────────
await app.register(cors, {
  origin: getAppUrl("http://localhost:3000"),
  credentials: true,
})

await app.register(multipart, {
  limits: { fileSize: 20 * 1024 * 1024 },
})

// ── Rate limiting (Redis-backed, shared with the BullMQ connection) ──────
// Skips /stripe — Stripe's own retry/burst behavior on webhook delivery
// must never get throttled by us.
await app.register(rateLimit, {
  global: true,
  max: 120,
  timeWindow: "1 minute",
  redis: redisConnection,
  allowList: (req) => req.url.startsWith("/stripe"),
})

// ── Raw body capture (for LINE/Stripe HMAC verification) ─────────
app.addContentTypeParser(
  "application/json",
  { parseAs: "buffer" },
  (req, body, done) => {
    ;(req as any).rawBody = body
    try { done(null, JSON.parse(body.toString("utf8"))) }
    catch (e: any) { done(e, undefined) }
  }
)

// ── Health check (public) ────────────────────────────────────────
app.get("/health", async () => ({ status: "ok", ts: new Date().toISOString() }))

// Deep health: surfaces a dead queue / missing worker. Without this, a broken
// extraction path is invisible — it only shows up as documents that silently
// never leave "pending" (exactly how the LINE ingestion outage went unnoticed).
app.get("/health/queue", async () => {
  const { queueHealth } = await import("./services/ingest")
  const q = await queueHealth()

  // Optional OCR second opinion. It sat "configured" for months while actually
  // holding placeholder values, and failed silently — report it explicitly.
  const placeholders = ["...", "YOUR_PROCESSOR_ID", "YOUR_PROJECT_ID"]
  const docAiReady = !!process.env.GOOGLE_CLOUD_PROJECT
    && !!process.env.GOOGLE_DOC_AI_PROCESSOR_ID
    && !!(process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CREDENTIALS_JSON)
    && !placeholders.includes(process.env.GOOGLE_CLOUD_PROJECT)
    && !placeholders.includes(process.env.GOOGLE_DOC_AI_PROCESSOR_ID)

  // Documents stuck in `processing` long past any real extraction. A non-zero
  // value here is the signature of a process that died mid-read: the queue
  // looks perfectly healthy while the user stares at a spinner that will never
  // resolve. It stayed invisible until someone thought to query the table.
  let stranded: number | string = "unknown"
  try {
    const { createClient } = await import("./lib/supabase")
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const { count, error } = await createClient()
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("status", "processing")
      .lt("created_at", cutoff)
    if (!error) stranded = count ?? 0
  } catch { /* health must never throw */ }

  return {
    status:  q.reachable ? "ok" : "degraded",
    workers: process.env.RUN_WORKERS !== "0" ? "in-process" : "external",
    queue:   q,
    strandedDocuments: stranded,
    // Token spend since this process started. Cache read ≫ write means the TTL
    // matches how people actually scan; the reverse means we are paying a write
    // premium for a cache nobody reads.
    aiUsage: (await import("./pipeline/usage-meter")).usageTotals(),
    // Abuse patterns in the last 30 minutes. Reports only — an automatic ban
    // built on thresholds nobody has tuned against real traffic locks out
    // paying customers, which is worse than the abuse it prevents.
    abuseSignals: await (await import("./services/activity-log")).detectAbuse(),
    docAiFallback: docAiReady ? "ready" : "not-configured",
    ts:      new Date().toISOString(),
  }
})

// ── Static assets served by API (used in LINE Flex Messages) ─────
// LINE fetches these when rendering Flex Message images
app.get("/icon-192.png", async (_req, reply) => {
  const fs   = await import("node:fs")
  const path = await import("node:path")
  // process.cwd() = api/ directory; icon is in ../web/public/
  const file = path.resolve(process.cwd(), "../web/public/icon-192.png")
  if (!fs.existsSync(file)) {
    return reply.status(404).send({ error: "not found" })
  }
  reply.header("Content-Type", "image/png")
  reply.header("Cache-Control", "public, max-age=86400")
  return reply.send(fs.createReadStream(file))
})

// ── LIFF proxy — redirect /liff/* to Next.js web server ──────────
// ใช้เมื่อ ngrok ชี้ไปที่ API (4000) แต่ LIFF pages อยู่ที่ Web (3000)
const WEB_URL = process.env.WEB_URL ?? "https://localhost:3000"
app.get("/liff", async (_req, reply) => reply.redirect(`${WEB_URL}/liff/places`))
app.get("/liff/*", async (req, reply) => {
  const path = (req.params as any)["*"] ?? ""
  const qs   = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""
  return reply.redirect(`${WEB_URL}/liff/${path}${qs}`)
})

// ── Webhook routes — NO auth (each verifies its own signature) ───
// Registered in root scope so they are NOT affected by the auth hook below.
await app.register(stripeRoutes, { prefix: "/webhooks" })
await app.register(lineRoutes,   { prefix: "/webhooks" })
await app.register(emailRoutes,  { prefix: "/webhooks" })

// ── Protected routes — scoped plugin with auth ───────────────────
// All routes registered inside this plugin require x-internal-key.
await app.register(async (authed) => {
  authed.addHook("preHandler", async (req, reply) => {
    if (req.headers["x-internal-key"] === process.env.INTERNAL_API_KEY) return
    return reply.status(401).send({ error: "Unauthorized" })
  })

  await authed.register(documentsRoutes,    { prefix: "/documents"    })
  await authed.register(integrationsRoutes, { prefix: "/integrations" })
  await authed.register(taxRoutes,          { prefix: "/tax"          })
  await authed.register(lifeRoutes)   // Life Graph routes (no prefix — /life/*)
  await authed.register(sportNotifyRoutes)  // /sport/notify
  await authed.register(tripNotifyRoutes)   // /trip/notify
  await authed.register(travelDocRoutes)    // /travel-doc/read
  await authed.register(medicationLabelRoutes) // /medication-label/read
  await authed.register(medicationPriceRoutes) // /medication-price/lookup
  await authed.register(pdfRoutes)          // /pdf/render
  await authed.register(tripPreorderNotifyRoutes)   // /trips/preorder/notify
  await authed.register(splitNotifyRoutes)  // /split/notify
})

// ── Device-authenticated routes ──────────────────────────────────────────
// Called straight from the iPhone and Apple Watch, which cannot hold the
// internal key — an app bundle is not a secret. These verify the caller's
// Supabase access token instead and set req.userId from it.
//
// sport-play lived in the plugin above until now, which meant every call from
// the watch was answered with 401; its handlers also read req.userId, which
// nothing set. See plugins/supabase-auth.ts.
await app.register(userAuthedScope(async (device) => {
  await device.register(sportPlayRoutes)   // /v1/sport-play/*
}))

// ── Background workers ───────────────────────────────────────────
// The extraction queue had NO consumer in the container deployment: the image
// runs `tsx src/index.ts` only, and there is no separate workers service, so
// every LINE upload was enqueued and then sat in Redis forever. Hosting the
// workers in this process fixes that without a second container on the (small)
// NAS. Set RUN_WORKERS=0 to opt out — e.g. when running `npm run workers`
// standalone — so the two deployments can't double-process a job.
//
// Dynamic import (not a top-level one) because ESM hoists imports above the
// `config({ override: true })` call at the top of this file; the workers must
// only be loaded once env is fully populated. Same reasoning as run-workers.ts.
if (process.env.RUN_WORKERS !== "0") {
  try {
    const { startExtractionWorker } = await import("./queue/workers/extraction.worker")
    const { startPushWorker }       = await import("./queue/workers/push.worker")
    const extractionWorker = startExtractionWorker()
    const pushWorker       = startPushWorker()
    console.log("🚀 Workers started in-process (extraction, push)")

    // Anything the previous process abandoned mid-read (a redeploy kills the
    // container while a scan is in flight) is stuck in `processing` with nobody
    // left to finish it. Sweep those back into the queue now, then periodically.
    const { startStrandedRecovery } = await import("./services/recover-stranded")
    const stopRecovery = startStrandedRecovery()

    const shutdown = async (signal: string) => {
      console.log(`⚠️  ${signal} — closing workers…`)
      stopRecovery()
      await Promise.allSettled([extractionWorker.close(), pushWorker.close()])
      process.exit(0)
    }
    process.on("SIGTERM", () => void shutdown("SIGTERM"))
    process.on("SIGINT",  () => void shutdown("SIGINT"))
  } catch (err) {
    // A worker that fails to boot must not take the API down — ingestDocument()
    // falls back to running the pipeline inline, so documents still get read.
    console.error("[workers] failed to start:", (err as Error)?.message)
    await logServerError({ errorType: "workers_start_failed", error: err })
  }
}

// ── Start ────────────────────────────────────────────────────────
const port = Number(process.env.PORT ?? 4000)
await app.listen({ port, host: "0.0.0.0" })
console.log(`API running on http://localhost:${port}`)
