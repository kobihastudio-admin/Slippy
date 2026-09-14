import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase"
import { queuePush } from "../queue/setup"
import { ingestDocument } from "../services/ingest"
import type { LocalOcrHint, UserConfirmedFields } from "../pipeline/local-ocr-hint"
import { logServerError } from "../lib/error-log"

export async function documentsRoutes(app: FastifyInstance) {

  // POST /documents/:id/process — trigger extraction pipeline
  // `localOcrHint` (optional) — on-device OCR pre-read from the iOS app
  // (Apple Vision, see ios/Slippy/Services/SlipOCRService.swift), forwarded
  // here via web/src/app/api/documents/[id]/process/route.ts. Used to give
  // the AI pipeline a second, independent reading and to cross-check the
  // final result — see local-ocr-hint.ts.
  // `qrRaw` (optional) — the barcode payload the app decoded from the ORIGINAL
  // capture, before enhancement. Persisted as-is and not acted on: some of
  // these are merchant e-Tax Invoice links, and the first thing worth knowing
  // is what real receipts actually encode.
  app.post<{ Params: { id: string }; Body: { orgId?: string; localOcrHint?: LocalOcrHint; userConfirmed?: UserConfirmedFields; qrRaw?: string } }>(
    "/:id/process",
    async (req, reply) => {
      const { id } = req.params

      const { data: doc, error } = await supabase
        .from("documents")
        .select("id, file_path, file_type, organization_id, status, extracted_at")
        .eq("id", id)
        .single()

      if (error || !doc) return reply.status(404).send({ error: "Document not found" })

      // Charge the quota once per document, not once per pipeline run.
      //
      // This used to skip the increment only for status "failed" or "pending",
      // which covers a retry after a crash but not a RE-processing of a document
      // that already succeeded — those sit at "reviewing"/"approved"/"pushed".
      // Re-reading a receipt after a pipeline fix therefore billed the customer
      // for it again: one organisation's counter read 71 against 44 documents
      // actually uploaded that month, and nothing in the app could explain the
      // gap because the receipts it referred to did not exist.
      //
      // `extracted_at` is the durable signal — it is set the first time a
      // document is read, so its presence means this document has already been
      // paid for whatever happens afterwards.
      // Two different questions, so two different names — conflating them is
      // what produced the bug: the flag below also drives BullMQ de-duplication,
      // where "previously processed" means something else entirely.
      const alreadyCounted = doc.extracted_at != null
        || doc.status === "failed"
        || doc.status === "pending"
      if (!alreadyCounted) {
        const { data: allowed } = await supabase
          .rpc("increment_doc_used", { p_org_id: doc.organization_id })

        if (!allowed) {
          await supabase.from("documents").update({ status: "failed" }).eq("id", id)
          return reply.status(402).send({ error: "Document quota exceeded" })
        }
      }

      // Cap the stored payload: a QR holds at most ~3KB, so anything longer is
      // not a barcode and should not become an unbounded write.
      const qrRaw = typeof req.body?.qrRaw === "string" && req.body.qrRaw.length <= 4096
        ? req.body.qrRaw
        : null

      await supabase.from("documents").update({
        status: "processing",
        notes: null,
        ...(qrRaw ? { qr_payload: qrRaw } : {}),
      }).eq("id", id)

      // Single ingestion contract shared with the LINE bot (services/ingest.ts):
      // durable queue first, inline fallback if the queue is unreachable. Kicked
      // off fire-and-forget so the HTTP response returns immediately — the app
      // polls the document for the result either way.
      void ingestDocument(id, doc.organization_id, {
        localOcrHint:  req.body?.localOcrHint,
        userConfirmed: req.body?.userConfirmed,
        // A retry of a previously-processed doc ("อ่านซ้ำ") needs a fresh job id,
        // otherwise BullMQ de-duplicates it against the finished one.
        // Any document that has been through the pipeline before needs a fresh
        // job id, or BullMQ de-duplicates it against the finished one.
        force:         doc.status === "failed" || doc.status === "pending"
                       || doc.status === "approved" || doc.status === "reviewing",
      }).then(async (r) => {
        if (!r.ok) {
          console.error(`[ingest] ${id} failed (${r.mode}):`, r.error)
          await supabase
            .from("documents")
            .update({ status: "failed", notes: `Pipeline error: ${r.error ?? "unknown"}` })
            .eq("id", id)
          await logServerError({
            errorType: "pipeline_failed",
            error: new Error(r.error ?? "pipeline failed"),
            organizationId: doc.organization_id,
            context: { documentId: id, mode: r.mode },
          })
        }
      })

      return { queued: true, documentId: id }
    }
  )

  // POST /documents/:id/push — push to accounting system
  app.post<{ Params: { id: string }; Body: { integrationId: string } }>(
    "/:id/push",
    async (req, reply) => {
      const { id } = req.params
      const { integrationId } = req.body

      if (!integrationId) return reply.status(400).send({ error: "integrationId required" })

      await queuePush({ documentId: id, integrationId })
      return { queued: true }
    }
  )

  // GET /documents/:id/progress — SSE for real-time progress
  app.get<{ Params: { id: string } }>(
    "/:id/progress",
    async (req, reply) => {
      const { id } = req.params

      reply.raw.setHeader("Content-Type", "text/event-stream")
      reply.raw.setHeader("Cache-Control", "no-cache")
      reply.raw.setHeader("Connection", "keep-alive")

      const send = (data: object) => {
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
      }

      // Poll DB every 2s for status changes (simple, no Redis dep for SSE)
      let polls = 0
      const interval = setInterval(async () => {
        polls++
        const { data } = await supabase
          .from("documents")
          .select("status, overall_confidence")
          .eq("id", id)
          .single()

        if (data) {
          send({ status: data.status, confidence: data.overall_confidence })

          if (["reviewing", "approved", "failed", "rejected"].includes(data.status)) {
            clearInterval(interval)
            reply.raw.end()
            return
          }
        }

        if (polls > 90) {  // 3 min timeout
          clearInterval(interval)
          reply.raw.end()
        }
      }, 2000)

      req.raw.on("close", () => clearInterval(interval))
    }
  )
}
