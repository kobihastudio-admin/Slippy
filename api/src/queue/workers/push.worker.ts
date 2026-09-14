import { Worker, type Job }      from "bullmq"
import { redisConnection }       from "../setup"
import { pushToFlowAccount }     from "../../connectors/flowaccount/push"
import { createClient }          from "../../lib/supabase"

export interface PushJobData {
  documentId:    string
  integrationId: string
  provider:      "flowaccount" | "peak" | "express"
}

export function startPushWorker() {
  const worker = new Worker<PushJobData>(
    "push",
    async (job: Job<PushJobData>) => {
      const { documentId, integrationId, provider } = job.data

      console.log(`[push] Pushing document ${documentId} → ${provider}`)

      let result: { success: boolean; externalId?: string; externalRef?: string; error?: string }

      switch (provider) {
        case "flowaccount":
          result = await pushToFlowAccount(documentId, integrationId)
          break

        // PEAK and Express connectors can be added here following the same pattern
        case "peak":
        case "express":
          result = { success: false, error: `Provider "${provider}" not yet implemented` }
          break

        default:
          result = { success: false, error: `Unknown provider "${provider}"` }
      }

      if (!result.success) {
        throw new Error(result.error ?? "Push failed")
      }

      console.log(`[push] Document ${documentId} pushed successfully — ext ref: ${result.externalRef}`)
      return result
    },
    {
      connection:  redisConnection,
      concurrency: 5,
    }
  )

  worker.on("failed", async (job, err) => {
    if (!job) return
    console.error(`[push] Job ${job.id} failed after all retries:`, err.message)

    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      const supabase = createClient()

      await supabase.from("document_push_logs").insert({
        document_id:    job.data.documentId,
        integration_id: job.data.integrationId,
        status:         "failed",
        error_message:  err.message,
        pushed_at:      new Date().toISOString(),
      })

      await supabase.from("document_audit_logs").insert({
        document_id: job.data.documentId,
        action:      "push_failed",
        actor:       "system",
        metadata:    { provider: job.data.provider, error: err.message },
      })
    }
  })

  worker.on("completed", job => {
    console.log(`[push] Job ${job.id} completed`)
  })

  console.log("[push] Worker started")
  return worker
}
