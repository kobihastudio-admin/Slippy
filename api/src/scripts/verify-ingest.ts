/**
 * Ingestion-contract verification — run with:  npm run verify:ingest
 *
 * Covers the guarantee every channel (LINE, web, iOS, email) now depends on:
 * a document handed to ingestDocument() is ALWAYS processed — via the durable
 * queue when it's healthy, and inline when it isn't — and the call never throws
 * back at the channel handler. No Redis, no DB, no LLM: the queue and pipeline
 * are injected.
 */
import assert from "node:assert/strict"
import { ingestDocument, type IngestDeps } from "../services/ingest"

let passed = 0, failed = 0
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✅ ${name}`) })
    .catch(err => { failed++; console.log(`  ❌ ${name}\n     ${(err as Error).message.split("\n")[0]}`) })
}

const DOC = "doc-123"
const ORG = "org-456"

/** Builds injectable deps plus a call log to assert against. */
function makeDeps(opts: {
  enqueueFails?: boolean
  enqueueHangs?: boolean
  inlineResult?: { success: boolean; error?: string }
  inlineThrows?: boolean
} = {}) {
  const calls = { enqueued: 0, inline: 0, lastEnqueue: null as any, lastInline: null as any[] | null }
  const deps: IngestDeps = {
    enqueue: (async (payload: any) => {
      calls.enqueued++
      calls.lastEnqueue = payload
      if (opts.enqueueHangs) await new Promise(() => {})       // never settles
      if (opts.enqueueFails) throw new Error("redis unreachable")
    }) as IngestDeps["enqueue"],
    runInline: (async (...args: any[]) => {
      calls.inline++
      calls.lastInline = args
      if (opts.inlineThrows) throw new Error("pipeline exploded")
      return {
        success: opts.inlineResult?.success ?? true,
        documentId: DOC,
        confidence_score: 0.9,
        auto_approved: false,
        warnings: [],
        error: opts.inlineResult?.error,
      }
    }) as unknown as IngestDeps["runInline"],
  }
  return { deps, calls }
}

async function main() {
  console.log("\n▶ Healthy queue → job is queued, pipeline NOT run inline\n")

  await check("returns mode=queued and does not run the pipeline in-request", async () => {
    const { deps, calls } = makeDeps()
    const r = await ingestDocument(DOC, ORG, {}, deps)
    assert.equal(r.ok, true)
    assert.equal(r.mode, "queued")
    assert.equal(calls.enqueued, 1)
    assert.equal(calls.inline, 0, "must not double-process")
  })

  await check("channel context (lineUserId, hint, confirmed, force) reaches the job", async () => {
    const { deps, calls } = makeDeps()
    await ingestDocument(DOC, ORG, {
      lineUserId: "U-abc",
      localOcrHint: { vendorName: "ร้านทดสอบ" } as any,
      userConfirmed: { vendor_tax_id: "0105561207571" } as any,
      force: true,
    }, deps)
    assert.equal(calls.lastEnqueue.orgId, ORG)
    assert.equal(calls.lastEnqueue.lineUserId, "U-abc")
    assert.equal(calls.lastEnqueue.localOcrHint.vendorName, "ร้านทดสอบ")
    assert.equal(calls.lastEnqueue.userConfirmed.vendor_tax_id, "0105561207571")
    assert.equal(calls.lastEnqueue.force, true, "reprocess must be flagged so BullMQ can't de-dupe it away")
  })

  console.log("\n▶ Broken queue → inline fallback (a receipt is never dropped)\n")

  await check("enqueue throws → pipeline runs inline and reports success", async () => {
    const { deps, calls } = makeDeps({ enqueueFails: true })
    const r = await ingestDocument(DOC, ORG, {}, deps)
    assert.equal(r.mode, "inline")
    assert.equal(r.ok, true)
    assert.equal(calls.inline, 1, "the document must still be processed")
  })

  await check("inline fallback receives the same hint/confirmed values", async () => {
    const { deps, calls } = makeDeps({ enqueueFails: true })
    const hint = { vendorName: "ร้าน ก" } as any
    const confirmed = { vendor_tax_id: "0105561207571" } as any
    await ingestDocument(DOC, ORG, { localOcrHint: hint, userConfirmed: confirmed }, deps)
    assert.equal(calls.lastInline![0], DOC)
    assert.equal(calls.lastInline![1], ORG)
    assert.deepEqual(calls.lastInline![2], hint)
    assert.deepEqual(calls.lastInline![3], confirmed)
  })

  console.log("\n▶ Failure reporting — never throw at the channel handler\n")

  await check("pipeline returns success=false → ok=false with the error, no throw", async () => {
    const { deps } = makeDeps({ enqueueFails: true, inlineResult: { success: false, error: "bad image" } })
    const r = await ingestDocument(DOC, ORG, {}, deps)
    assert.equal(r.ok, false)
    assert.equal(r.mode, "inline")
    assert.equal(r.error, "bad image")
  })

  await check("pipeline throws → caught, ok=false (handler can still answer the user)", async () => {
    const { deps } = makeDeps({ enqueueFails: true, inlineThrows: true })
    const r = await ingestDocument(DOC, ORG, {}, deps)
    assert.equal(r.ok, false)
    assert.match(r.error ?? "", /exploded/)
  })

  await check("documentId is echoed back on every path", async () => {
    const { deps: okDeps } = makeDeps()
    const { deps: badDeps } = makeDeps({ enqueueFails: true, inlineThrows: true })
    assert.equal((await ingestDocument(DOC, ORG, {}, okDeps)).documentId, DOC)
    assert.equal((await ingestDocument(DOC, ORG, {}, badDeps)).documentId, DOC)
  })

  console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main()
