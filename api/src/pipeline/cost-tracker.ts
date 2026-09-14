import { createClient } from "../lib/supabase"

/**
 * AI Cost Tracker — ติดตามต้นทุน AI ต่อ document และต่อ org
 *
 * ใช้สำหรับ:
 *   1. Alert เมื่อ org ใช้ quota ใกล้หมด
 *   2. Monitor ต้นทุนจริง vs ราคาที่เก็บ
 *   3. ตัดสินใจ model routing (ถ้า org ใกล้ quota → ใช้ Haiku มากขึ้น)
 */

// ── Pricing constants (USD per token) ─────────────────────────────────────────
// อัพเดตตาม Anthropic pricing page
const PRICING = {
  "claude-sonnet-5":  { input: 3.0 / 1_000_000,  output: 15.0 / 1_000_000  },
  "claude-sonnet-4-5": { input: 3.0 / 1_000_000,  output: 15.0 / 1_000_000  },
  "claude-haiku-4-5-20251001": { input: 0.8 / 1_000_000, output: 4.0 / 1_000_000 },
  // cache_read is 10% of input price
}

const USD_TO_THB = 34   // อัพเดตตามอัตราแลกเปลี่ยน

export interface ModelUsage {
  model:        string
  inputTokens:  number
  outputTokens: number
  cacheRead:    number   // tokens read from cache (10% cost)
}

export interface DocCost {
  totalUsd: number
  totalThb: number
  passes:   ModelUsage[]
  usedHaiku: boolean   // true = cost-optimized path was taken
}

export function calculateDocCost(usages: ModelUsage[]): DocCost {
  let totalUsd = 0
  const passes = usages

  for (const u of usages) {
    const p = PRICING[u.model as keyof typeof PRICING]
    if (!p) continue

    const inputCost  = u.inputTokens  * p.input
    const outputCost = u.outputTokens * p.output
    const cacheCost  = u.cacheRead    * p.input * 0.1   // cache read = 10% of input
    totalUsd += inputCost + outputCost + cacheCost
  }

  return {
    totalUsd,
    totalThb: totalUsd * USD_TO_THB,
    passes,
    usedHaiku: usages.some(u => u.model.includes("haiku")),
  }
}

/**
 * Log AI cost for a document (fire-and-forget).
 * Stores in document_audit_logs as metadata.
 */
export async function logDocCost(
  documentId: string,
  cost:       DocCost,
): Promise<void> {
  try {
    const supabase = createClient()
    await supabase.from("document_audit_logs").insert({
      document_id: documentId,
      action:      "ai_cost_logged",
      actor:       "pipeline",
      metadata: {
        cost_usd:    +cost.totalUsd.toFixed(5),
        cost_thb:    +cost.totalThb.toFixed(3),
        used_haiku:  cost.usedHaiku,
        model_passes: cost.passes.map(p => ({
          model:  p.model,
          tokens: p.inputTokens + p.outputTokens,
        })),
      },
    })
  } catch { /* never block */ }
}

/**
 * Get monthly AI spend for an org (for admin dashboard).
 */
export async function getMonthlyAiSpend(organizationId: string): Promise<{
  costUsd: number
  costThb: number
  docCount: number
  avgCostPerDoc: number
}> {
  try {
    const supabase = createClient()
    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)

    // Join documents with audit_logs to get cost_usd for this org's docs this month
    const { data: docs } = await supabase
      .from("documents")
      .select("id")
      .eq("organization_id", organizationId)
      .gte("created_at", startOfMonth.toISOString())

    if (!docs?.length) return { costUsd: 0, costThb: 0, docCount: 0, avgCostPerDoc: 0 }

    const docIds = docs.map(d => d.id)
    const { data: logs } = await supabase
      .from("document_audit_logs")
      .select("metadata")
      .eq("action", "ai_cost_logged")
      .in("document_id", docIds)

    let totalUsd = 0
    for (const log of logs ?? []) {
      totalUsd += Number((log.metadata as any)?.cost_usd ?? 0)
    }

    return {
      costUsd:       +totalUsd.toFixed(4),
      costThb:       +(totalUsd * USD_TO_THB).toFixed(2),
      docCount:      docs.length,
      avgCostPerDoc: docs.length ? +(totalUsd / docs.length).toFixed(5) : 0,
    }
  } catch {
    return { costUsd: 0, costThb: 0, docCount: 0, avgCostPerDoc: 0 }
  }
}
