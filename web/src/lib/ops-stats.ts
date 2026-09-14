/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { Queue } from "bullmq"
import { createAdminClient } from "@/lib/supabase/admin"

// Read-only views onto the same BullMQ queues api/src/queue/setup.ts owns —
// same Redis (see docker-compose), same queue names. We only ever call
// getJobCounts() here, never add/process jobs.
//
// Passed as a plain connection config (not a shared ioredis instance) —
// web/ and api/ each resolve their own copy of ioredis under npm workspaces,
// and bullmq's `connection` option type-checks against ITS OWN copy, so a
// cross-package Redis instance fails structural typing even though it works
// at runtime. A config object sidesteps that entirely.
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379")
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
}

const QUEUE_NAMES = ["extraction", "push", "sync"] as const

export interface QueueStat {
  name: string
  waiting: number
  active: number
  failed: number
  completed: number
  error?: string
}

export interface OpsStats {
  orgCount: number
  userCount: number
  docsLast24h: { status: string; count: number }[]
  unresolvedErrorCount: number
  unresolvedStripeWebhookFailures: number
  stuckDocumentCount: number
  recentErrors: {
    id: string
    error_type: string
    error_message: string | null
    source: string
    created_at: string
  }[]
  queues: QueueStat[]
}

export async function getOpsStats(): Promise<OpsStats> {
  const admin = createAdminClient()

  const [{ count: orgCount }, { count: userCount }, docsResult, errorCountResult, stripeFailureCountResult, stuckDocsResult, recentErrorsResult] =
    await Promise.all([
      admin.from("organizations").select("*", { count: "exact", head: true }),
      admin.from("users").select("*", { count: "exact", head: true }),
      admin
        .from("documents")
        .select("status")
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
      admin
        .from("client_error_logs")
        .select("*", { count: "exact", head: true })
        .eq("resolved", false),
      admin
        .from("client_error_logs")
        .select("*", { count: "exact", head: true })
        .eq("resolved", false)
        .eq("error_type", "stripe_webhook"),
      admin
        .from("documents")
        .select("*", { count: "exact", head: true })
        .in("status", ["pending", "processing"])
        .lt("updated_at", new Date(Date.now() - 15 * 60 * 1000).toISOString()),
      admin
        .from("client_error_logs")
        .select("id, error_type, error_message, source, created_at")
        .order("created_at", { ascending: false })
        .limit(10),
    ])

  const docsByStatus = new Map<string, number>()
  for (const row of docsResult.data ?? []) {
    docsByStatus.set(row.status, (docsByStatus.get(row.status) ?? 0) + 1)
  }

  const queues: QueueStat[] = await Promise.all(
    QUEUE_NAMES.map(async (name) => {
      try {
        const queue = new Queue(name, { connection })
        const counts = await queue.getJobCounts("waiting", "active", "failed", "completed")
        return {
          name,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          failed: counts.failed ?? 0,
          completed: counts.completed ?? 0,
        }
      } catch (err) {
        return {
          name, waiting: 0, active: 0, failed: 0, completed: 0,
          error: (err as Error).message,
        }
      }
    })
  )

  return {
    orgCount: orgCount ?? 0,
    userCount: userCount ?? 0,
    docsLast24h: Array.from(docsByStatus, ([status, count]) => ({ status, count })),
    unresolvedErrorCount: errorCountResult.count ?? 0,
    unresolvedStripeWebhookFailures: stripeFailureCountResult.count ?? 0,
    stuckDocumentCount: stuckDocsResult.count ?? 0,
    recentErrors: recentErrorsResult.data ?? [],
    queues,
  }
}
