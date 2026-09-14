/**
 * Per-call token accounting for the extraction pipeline.
 *
 * Nothing in this codebase recorded a single token until now, which meant every
 * cost question had to be answered by reading code and guessing: does prompt
 * caching help or is it charging a write premium for a cache nobody reads? Does
 * the 46KB system prompt or the sliced images dominate? Was escalating to Sonnet
 * worth 3× the price? Those are all measurable, and optimising without measuring
 * is how you spend a week shrinking the wrong thing.
 *
 * Deliberately in-memory and additive: it never blocks or fails an extraction,
 * and it stores no document content — only counts.
 */

export interface ExtractionUsage {
  input_tokens?:                number
  output_tokens?:               number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?:     number
}

/** USD per million tokens. Cache write/read multiply the input rate. */
interface Rate { input: number; output: number }

/**
 * Rates are approximate and change: they exist to make the RELATIVE cost of
 * cache-write vs cache-read vs fresh input visible in the logs, not to be an
 * invoice. Check Anthropic's pricing page before quoting an absolute number.
 */
const RATES: Record<string, Rate> = {
  "claude-haiku-4-5":  { input: 1,  output: 5  },
  "claude-sonnet-5":  { input: 3,  output: 15 },
  "claude-sonnet-4-5": { input: 3,  output: 15 },
}

/** A 1h cache write costs 2× the input rate; a read costs 0.1×. */
const CACHE_WRITE_MULTIPLIER = 2.0
const CACHE_READ_MULTIPLIER  = 0.1

function rateFor(model: string): Rate {
  for (const [prefix, rate] of Object.entries(RATES)) {
    if (model.startsWith(prefix)) return rate
  }
  return RATES["claude-sonnet-4-5"]   // unknown model: assume the expensive one
}

export interface UsageSnapshot {
  calls:        number
  freshInput:   number
  cacheWrite:   number
  cacheRead:    number
  output:       number
  estimatedUsd: number
}

const totals: Record<string, UsageSnapshot> = {}

export function estimateUsd(model: string, u: ExtractionUsage): number {
  const r = rateFor(model)
  const fresh  = (u.input_tokens ?? 0)                * r.input
  const write  = (u.cache_creation_input_tokens ?? 0) * r.input * CACHE_WRITE_MULTIPLIER
  const read   = (u.cache_read_input_tokens ?? 0)     * r.input * CACHE_READ_MULTIPLIER
  const out    = (u.output_tokens ?? 0)               * r.output
  return (fresh + write + read + out) / 1_000_000
}

/**
 * Logs one call and folds it into the running per-model totals.
 *
 * The cache line is the one to watch: `read` far below `write` means the TTL is
 * shorter than the real gap between scans, and the cache is costing more than it
 * saves. That is exactly the state this pipeline was in at a 5-minute TTL.
 */
export interface UsageContext {
  documentId?:     string | null
  organizationId?: string | null
  /** Which attempt this was, so cost attaches to the decision that caused it. */
  phase?:          "ocr" | "extract" | "escalate" | "docai_retry" | "other"
}

export function recordUsage(
  model: string,
  u: ExtractionUsage | undefined,
  ctx: UsageContext = {},
): void {
  try {
    if (!u) return
    const usd = estimateUsd(model, u)
    const t = (totals[model] ??= {
      calls: 0, freshInput: 0, cacheWrite: 0, cacheRead: 0, output: 0, estimatedUsd: 0,
    })
    t.calls++
    t.freshInput   += u.input_tokens ?? 0
    t.cacheWrite   += u.cache_creation_input_tokens ?? 0
    t.cacheRead    += u.cache_read_input_tokens ?? 0
    t.output       += u.output_tokens ?? 0
    t.estimatedUsd += usd

    console.log(
      `[usage] ${model} in=${u.input_tokens ?? 0} ` +
      `cache(write=${u.cache_creation_input_tokens ?? 0} read=${u.cache_read_input_tokens ?? 0}) ` +
      `out=${u.output_tokens ?? 0} ≈$${usd.toFixed(4)} ` +
      `| session: ${t.calls} calls ≈$${t.estimatedUsd.toFixed(3)}`,
    )

    // Persist, fire-and-forget. The in-memory totals reset on every deploy, and
    // this container restarts often enough that they alone cannot answer "what
    // did last month cost".
    void persist(model, u, usd, ctx)
  } catch {
    // Accounting must never be the reason a document fails to extract.
  }
}

async function persist(
  model: string,
  u: ExtractionUsage,
  usd: number,
  ctx: UsageContext,
): Promise<void> {
  try {
    const { createClient } = await import("../lib/supabase")
    await createClient().from("ai_usage_log").insert({
      document_id:        ctx.documentId ?? null,
      organization_id:    ctx.organizationId ?? null,
      model,
      phase:              ctx.phase ?? "extract",
      input_tokens:       u.input_tokens ?? 0,
      output_tokens:      u.output_tokens ?? 0,
      cache_write_tokens: u.cache_creation_input_tokens ?? 0,
      cache_read_tokens:  u.cache_read_input_tokens ?? 0,
      estimated_usd:      Number(usd.toFixed(6)),
    })
  } catch (err) {
    // A logging failure must never surface as an extraction failure.
    console.warn("[usage] persist failed:", (err as Error).message)
  }
}

/** Snapshot for /health/queue, so cost is visible without reading logs. */
export function usageTotals(): Record<string, UsageSnapshot> {
  return JSON.parse(JSON.stringify(totals))
}
