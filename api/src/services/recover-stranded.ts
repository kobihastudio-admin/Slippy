import { createClient } from "../lib/supabase"
import { ingestDocument } from "./ingest"
import { logServerError } from "../lib/error-log"
import { classifyFailure, PROVIDER_OUTAGE_NOTE } from "../pipeline/failure-kind"

/**
 * Rescues documents stranded in `processing`.
 *
 * A document is flipped to `processing` the moment ingestion starts, and only
 * something running in THIS process ever moves it out again — the worker's
 * `completed`/`failed` handlers, or the inline fallback's `.then()`. Every one
 * of those lives in memory, so if the process goes away mid-flight (a deploy,
 * an OOM kill on the 3.8GB NAS, a crash) there is nobody left to write the
 * final status. The row sits in `processing` forever, the queue is empty, and
 * no error is ever logged: from the outside it looks exactly like the AI is
 * still thinking.
 *
 * That is precisely what the app shows — an endless "AI กำลังอ่าน" with no
 * result — and it reappeared after each `docker compose up -d api`, because a
 * redeploy kills the container while a scan is in flight.
 *
 * BullMQ's stalled-job handling does not cover this. It only recovers jobs that
 * were still ACTIVE in Redis, and it cannot help at all when the document was
 * being read through the inline fallback, which never had a job to begin with.
 *
 * So the invariant is enforced here instead: anything sitting in `processing`
 * past `STRANDED_AFTER_MS` had its owner die, and gets re-ingested.
 */

/** Comfortably longer than a real extraction (observed: 60–90s, worst ~4 min). */
const STRANDED_AFTER_MS = 10 * 60 * 1000
/** Cap per sweep so a backlog can't stampede the model API or the NAS's RAM. */
const MAX_PER_SWEEP = 20
const SWEEP_INTERVAL_MS = 5 * 60 * 1000

/** How far back to keep replaying documents that failed for provider reasons. */
const OUTAGE_REPLAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export async function recoverStrandedDocuments(): Promise<number> {
  const cutoff = new Date(Date.now() - STRANDED_AFTER_MS).toISOString()

  try {
    const supabase = createClient()
    const [stuck, outaged] = await Promise.all([
      supabase
        .from("documents")
        .select("id, organization_id, created_at")
        .eq("status", "processing")
        .lt("created_at", cutoff)
        .order("created_at", { ascending: true })
        .limit(MAX_PER_SWEEP),
      // Documents that failed because OUR AI provider was unavailable — an
      // out-of-credit account, a bad key. The file is already uploaded and
      // perfectly readable, so making the user photograph the receipt again is
      // both pointless and impossible to explain. Replay them instead, and they
      // come back on their own the moment billing is fixed.
      supabase
        .from("documents")
        .select("id, organization_id, created_at")
        .eq("status", "failed")
        .is("extracted_at", null)
        .eq("notes", PROVIDER_OUTAGE_NOTE)
        .gt("created_at", new Date(Date.now() - OUTAGE_REPLAY_WINDOW_MS).toISOString())
        .order("created_at", { ascending: true })
        .limit(MAX_PER_SWEEP),
    ])

    const error = stuck.error ?? outaged.error
    if (error) {
      console.error("[recover] lookup failed:", error.message)
      return 0
    }
    const data = [...(stuck.data ?? []), ...(outaged.data ?? [])].slice(0, MAX_PER_SWEEP)
    if (!data.length) return 0

    console.log(`[recover] ${stuck.data?.length ?? 0} stranded + ${outaged.data?.length ?? 0} provider-failed — re-ingesting`)

    let recovered = 0
    for (const doc of data) {
      const ageMin = Math.round((Date.now() - new Date(doc.created_at).getTime()) / 60000)
      // force: a previous run may have left a finished job under this
      // document's normal id, and BullMQ would de-duplicate against it.
      // Quota is deliberately NOT incremented — this document was already
      // counted when it was first submitted.
      const result = await ingestDocument(doc.id, doc.organization_id, { force: true })
      if (result.ok) {
        recovered++
        console.log(`[recover] ✅ ${doc.id} (stuck ${ageMin}m) re-ingested via ${result.mode}`)
        continue
      }

      console.error(`[recover] ❌ ${doc.id} (stuck ${ageMin}m) failed: ${result.error}`)

      if (classifyFailure(result.error ?? "") === "provider") {
        // Still down. Keep the marker exactly as it is so this document stays
        // eligible for the next sweep — overwriting notes here would erase the
        // only thing that makes it findable and strand it permanently. Then
        // stop: the rest of the batch would fail identically, and hammering a
        // billing error every five minutes helps nobody.
        console.warn("[recover] provider still unavailable — deferring the rest of this sweep")
        break
      }

      await supabase
        .from("documents")
        .update({ status: "failed", notes: `Recovery failed: ${result.error ?? "unknown"}` })
        .eq("id", doc.id)
    }
    return recovered

  } catch (err) {
    // Recovery is a safety net; it must never be the thing that takes the API down.
    console.error("[recover] sweep failed:", (err as Error).message)
    await logServerError({ errorType: "recover_stranded_failed", error: err })
    return 0
  }
}

/**
 * Sweeps on boot (catching everything the previous process abandoned as it
 * died) and then periodically, for crashes that leave the process alive.
 * Returns a stop function for shutdown.
 */
export function startStrandedRecovery(): () => void {
  void recoverStrandedDocuments()
  const timer = setInterval(() => void recoverStrandedDocuments(), SWEEP_INTERVAL_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}
