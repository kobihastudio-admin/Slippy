import { Queue, Worker, QueueEvents } from "bullmq"
import { Redis } from "ioredis"
import "dotenv/config"

const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
})

export const extractionQueue = new Queue("extraction", { connection })
export const pushQueue       = new Queue("push",       { connection })
export const syncQueue       = new Queue("sync",       { connection })

export { connection as redisConnection }

export async function queueExtraction(payload: {
  documentId:  string
  orgId:       string
  filePath?:   string
  fileType?:   string
  lineUserId?: string   // optional — passed so worker can notify without re-querying DB
  /** Forwarded to runPipeline (iOS on-device OCR hint / QR-confirmed fields). */
  localOcrHint?:  unknown
  userConfirmed?: unknown
  /**
   * Re-processing an already-extracted document. A completed job's id lingers
   * (removeOnComplete.age below), so reusing it would make BullMQ silently drop
   * the retry — "อ่านซ้ำ" would appear to do nothing. Force gets a unique id.
   */
  force?: boolean
}) {
  const jobId = payload.force
    ? `extract-${payload.documentId}-${Date.now()}`
    : `extract-${payload.documentId}`

  await extractionQueue.add("extract", payload, {
    jobId,
    priority:         1,
    attempts:         3,
    backoff:          { type: "exponential", delay: 5000 },
    removeOnComplete: { age: 86400 },
    removeOnFail:     { age: 7 * 86400 },
  })
}

export async function queuePush(payload: {
  documentId:    string
  integrationId: string
}) {
  await pushQueue.add("push", payload, {
    jobId:    `push-${payload.documentId}-${payload.integrationId}`,
    attempts: 3,
    backoff:  { type: "exponential", delay: 2000 },
    removeOnComplete: { age: 86400 },
    removeOnFail:     { age: 7 * 86400 },
  })
}
