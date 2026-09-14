/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 *
 * Unified document ingestion
 * =====================================================================
 * ONE entry point that every channel (LINE bot, web app, iOS app) uses to hand
 * a stored document to the extraction pipeline. Before this existed the channels
 * diverged and one of them silently broke:
 *
 *   • LINE  → queueExtraction() … but no worker process was ever started in the
 *             Docker deployment, so LINE uploads sat in Redis forever.
 *   • Web   → runPipeline() inline inside the HTTP request.
 *   • iOS   → same inline route as web.
 *
 * The contract here is deliberately boring and durable:
 *
 *   ingestDocument(documentId, orgId, opts)
 *      ├─ enqueue on BullMQ  → retries, survives a restart, idempotent per doc
 *      └─ if the queue is unreachable → run the pipeline INLINE instead
 *
 * The inline fallback is the important part: a receipt must never be accepted
 * from a user and then silently dropped because Redis was down. Callers get
 * back which path ran, so they can tailor their response ("processing…" vs
 * "done"), and every channel now behaves identically.
 */
import { extractionQueue, queueExtraction } from "../queue/setup"
import { runPipeline } from "../pipeline"
import type { LocalOcrHint, UserConfirmedFields } from "../pipeline/local-ocr-hint"
import { logServerError } from "../lib/error-log"

/** Hard ceiling for an inline run so a hung upstream can't wedge the request. */
const INLINE_TIMEOUT_MS = 5 * 60 * 1000

/** How long to wait on the queue itself before deciding it's unhealthy. */
const ENQUEUE_TIMEOUT_MS = 3000

export interface IngestOptions {
  /** On-device OCR pre-read (iOS Vision) forwarded to the pipeline as a hint. */
  localOcrHint?: LocalOcrHint | null
  /** Values the user (or a deterministic source such as a bill-payment QR) confirmed. */
  userConfirmed?: UserConfirmedFields | null
  /** LINE user to notify when extraction finishes (LINE channel only). */
  lineUserId?: string | null
  /**
   * Re-processing an already-extracted document ("อ่านซ้ำ"). BullMQ keeps a
   * completed job's id around (removeOnComplete.age), so without a fresh id the
   * retry would be silently de-duplicated and nothing would happen.
   */
  force?: boolean
}

export interface IngestResult {
  documentId: string
  /** "queued" = a worker will run it; "inline" = it already ran in this call. */
  mode: "queued" | "inline"
  ok: boolean
  error?: string
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms),
    ),
  ])
}

/**
 * Hand a stored document to the extraction pipeline.
 *
 * Never throws: any failure is reported through the returned result (and logged
 * durably), so a channel handler can always answer its user.
 */
export interface IngestDeps {
  enqueue:   typeof queueExtraction
  runInline: typeof runPipeline
}

/** Real dependencies; overridden in unit tests (scripts/verify-ingest.ts). */
const defaultDeps: IngestDeps = { enqueue: queueExtraction, runInline: runPipeline }

export async function ingestDocument(
  documentId: string,
  organizationId: string,
  opts: IngestOptions = {},
  deps: IngestDeps = defaultDeps,
): Promise<IngestResult> {
  const { localOcrHint, userConfirmed, lineUserId, force } = opts

  // ── Preferred path: durable queue ────────────────────────────────────────
  try {
    await withTimeout(
      deps.enqueue({
        documentId,
        orgId: organizationId,
        lineUserId: lineUserId ?? undefined,
        localOcrHint: localOcrHint ?? undefined,
        userConfirmed: userConfirmed ?? undefined,
        force,
      }),
      ENQUEUE_TIMEOUT_MS,
      `Enqueue ${documentId}`,
    )
    return { documentId, mode: "queued", ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[ingest] queue unavailable for ${documentId} (${msg}) — running inline`)
    void logServerError({
      errorType: "ingest_queue_unavailable",
      error: err,
      organizationId,
      context: { documentId },
    })
  }

  // ── Fallback: run it here and now, so nothing is lost ────────────────────
  try {
    const result = await withTimeout(
      deps.runInline(documentId, organizationId, localOcrHint ?? null, userConfirmed ?? null),
      INLINE_TIMEOUT_MS,
      `Pipeline for document ${documentId}`,
    )
    return { documentId, mode: "inline", ok: result.success, error: result.error }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    void logServerError({
      errorType: "ingest_inline_failed",
      error: err,
      organizationId,
      context: { documentId },
    })
    return { documentId, mode: "inline", ok: false, error: msg }
  }
}

/**
 * Is the extraction queue reachable? Used by the health endpoint so a dead
 * Redis / missing worker is visible in monitoring instead of only showing up as
 * documents that never leave "pending".
 */
export async function queueHealth(): Promise<{
  reachable: boolean
  counts?: Record<string, number>
  error?: string
}> {
  try {
    const counts = await withTimeout(
      extractionQueue.getJobCounts("wait", "active", "delayed", "failed"),
      ENQUEUE_TIMEOUT_MS,
      "Queue health",
    )
    return { reachable: true, counts: counts as unknown as Record<string, number> }
  } catch (err) {
    return { reachable: false, error: err instanceof Error ? err.message : String(err) }
  }
}
