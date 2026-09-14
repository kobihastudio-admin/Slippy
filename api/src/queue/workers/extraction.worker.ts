import { Worker, UnrecoverableError, type Job } from "bullmq"
import { redisConnection }  from "../setup"
import { runPipeline }      from "../../pipeline"
import { createClient }     from "../../lib/supabase"
import { notifyLineAfterExtraction } from "../../routes/line"
import { logServerError }            from "../../lib/error-log"
import { classifyFailure } from "../../pipeline/failure-kind"

export interface ExtractionJobData {
  documentId:  string
  orgId:       string
  lineUserId?: string   // passed from LINE webhook so we skip a DB round-trip
  /**
   * Channel-supplied extras, forwarded verbatim to runPipeline: the iOS
   * on-device OCR pre-read, and fields a user (or a deterministic bill-payment
   * QR) already confirmed. Previously the worker dropped these, so anything
   * ingested through the queue lost them.
   */
  localOcrHint?:  unknown
  userConfirmed?: unknown
  /** @deprecated use orgId */
  organizationId?: string
}

export function startExtractionWorker() {
  const worker = new Worker<ExtractionJobData>(
    "extraction",
    async (job: Job<ExtractionJobData>) => {
      const { documentId } = job.data
      const orgId = job.data.orgId ?? job.data.organizationId ?? ""
      console.log(`[extraction] ▶ Processing ${documentId}  org=${orgId}`)

      const result = await runPipeline(
        documentId,
        orgId,
        (job.data.localOcrHint ?? null) as Parameters<typeof runPipeline>[2],
        (job.data.userConfirmed ?? null) as Parameters<typeof runPipeline>[3],
      )

      if (!result.success) {
        const message = result.error ?? "Pipeline failed"
        // A billing or credentials failure will fail identically on attempts 2
        // and 3, five and ten seconds later. Retrying it just delays the moment
        // the document lands in `failed` where the recovery sweep can replay it
        // properly once the account is topped up.
        if (classifyFailure(message) === "provider") {
          console.error(`[extraction] provider unavailable for ${documentId} — not retrying:`, message)
          throw new UnrecoverableError(message)
        }
        throw new Error(message)
      }

      console.log(
        `[extraction] ✅ Done ${documentId} — score=${result.confidence_score.toFixed(2)} auto_approved=${result.auto_approved}`
      )
      return result
    },
    // Concurrency is deliberately modest: the worker now shares a container with
    // the API on a 3.8GB NAS, and each job holds decoded page images in memory
    // while it waits on the model. Tune with EXTRACTION_CONCURRENCY.
    { connection: redisConnection, concurrency: Number(process.env.EXTRACTION_CONCURRENCY ?? 2) }
  )

  // ── Job completed — notify LINE user ────────────────────────────────────────
  worker.on("completed", async (job, result) => {
    const { documentId, lineUserId } = job.data
    const orgId = job.data.orgId ?? job.data.organizationId ?? ""
    console.log(`[extraction] 📤 Notifying LINE for ${documentId}  lineUserId=${lineUserId ?? "unknown"}`)

    try {
      await notifyLineAfterExtraction(documentId, orgId, result, lineUserId)
      console.log(`[extraction] 📬 LINE notification sent for ${documentId}`)
    } catch (err: any) {
      // Log clearly — never rethrow (notification failure ≠ job failure)
      console.error(`[extraction] ❌ LINE notification failed for ${documentId}:`, err.message)
    }
  })

  // ── Job permanently failed — notify LINE user of failure ────────────────────
  worker.on("failed", async (job, err) => {
    if (!job) return
    const { documentId, lineUserId } = job.data
    console.error(`[extraction] ❌ Job ${job.id} failed (attempt ${job.attemptsMade}):`, err.message)

    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      const orgId = job.data.orgId ?? job.data.organizationId ?? ""

      await logServerError({
        errorType: "worker_job_failed",
        error: err,
        organizationId: orgId || null,
        context: { queue: "extraction", documentId, attemptsMade: job.attemptsMade, jobId: job.id },
      })

      const supabase = createClient()
      supabase
        .from("documents")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", documentId)
        .then(({ error }) => { if (error) console.error("[extraction] DB status update failed:", error.message) })
      try {
        await notifyLineAfterExtraction(
          documentId, orgId,
          { success: false, error: err.message },
          lineUserId
        )
      } catch (ne: any) {
        console.error(`[extraction] ❌ Failure notification failed for ${documentId}:`, ne.message)
      }
    }
  })

  console.log("[extraction] Worker started ✓")
  return worker
}
