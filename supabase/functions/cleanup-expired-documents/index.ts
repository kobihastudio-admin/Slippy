/**
 * cleanup-expired-documents — Monthly cron Edge Function
 *
 * Schedule (set in Supabase Dashboard → Edge Functions → cleanup-expired-documents → Schedule):
 *   0 3 1 * *   (03:00 UTC on 1st of every month = 10:00 ICT)
 *
 * Soft-archives documents older than each org's data_retention_years setting,
 * then hard-deletes rows that have been archived for >= 30 days.
 * Defined in migration 011_data_retention.sql.
 */

import { createClient } from "jsr:@supabase/supabase-js@2"
import { logEdgeFunctionError } from "../_shared/error-log.ts"

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get("Authorization") ?? ""
  const cronSecret  = Deno.env.get("CRON_SECRET") ?? ""

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )

  // Step 1: Soft-archive expired documents
  const { data: archiveResult, error: archiveErr } = await supabase
    .rpc("cleanup_expired_documents")

  if (archiveErr) {
    console.error("cleanup_expired_documents failed:", archiveErr.message)
    await logEdgeFunctionError(supabase, {
      functionName: "cleanup-expired-documents",
      error: archiveErr,
      context: { step: "cleanup_expired_documents" },
    })
    return new Response(JSON.stringify({ error: archiveErr.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }

  const archivedByOrg = archiveResult ?? []
  const totalArchived = archivedByOrg.reduce(
    (sum: number, row: { archived_count: number }) => sum + (row.archived_count ?? 0),
    0,
  )
  console.log(`Archived ${totalArchived} documents across ${archivedByOrg.length} orgs`)

  // Step 2: Hard-delete rows archived >= 30 days ago
  const { data: deletedCount, error: deleteErr } = await supabase
    .rpc("hard_delete_archived_documents")

  if (deleteErr) {
    console.error("hard_delete_archived_documents failed:", deleteErr.message)
    await logEdgeFunctionError(supabase, {
      functionName: "cleanup-expired-documents",
      error: deleteErr,
      context: { step: "hard_delete_archived_documents" },
    })
    // Don't fail — archiving succeeded, deletion can retry next run
  }

  console.log(`Hard-deleted ${deletedCount ?? 0} previously-archived documents`)

  return new Response(
    JSON.stringify({
      run_at:           new Date().toISOString(),
      archived_total:   totalArchived,
      archived_by_org:  archivedByOrg,
      hard_deleted:     deletedCount ?? 0,
    }),
    { headers: { "Content-Type": "application/json" } },
  )
})
