import { config } from "dotenv"
config({ override: true, path: new URL("../../.env", import.meta.url).pathname })
import { createClient }    from "../lib/supabase.js"
import { ingestDocument } from "../services/ingest.js"

async function main() {
  const sb = createClient()
  const { data: docs } = await sb
    .from("documents")
    .select("id, file_path, file_type, organization_id, source_meta, overall_confidence, status")
    .or("overall_confidence.eq.0,status.eq.failed")
    .in("status", ["reviewing", "pending", "failed"])

  console.log(`Found ${docs?.length ?? 0} docs to retry`)
  for (const doc of docs ?? []) {
    const lineUserId = (doc.source_meta as any)?.line_user_id
    await sb.from("documents")
      .update({ status: "pending", notes: null, updated_at: new Date().toISOString() })
      .eq("id", doc.id)
    // force: these documents already have a completed job under their normal
    // id; without a fresh one BullMQ would de-duplicate the retry away.
    await ingestDocument(doc.id, doc.organization_id, { lineUserId, force: true })
    console.log(`  🔄 ${doc.id.slice(0,8)} conf=${doc.overall_confidence} status=${doc.status}`)
  }
  console.log("✅ All queued")
  process.exit(0)
}
main()
