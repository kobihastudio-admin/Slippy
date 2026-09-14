/**
 * reset-org-quotas — Daily cron Edge Function
 *
 * Schedule (set in Supabase Dashboard → Edge Functions → reset-org-quotas → Schedule):
 *   0 1 * * *   (01:00 UTC every day = 08:00 ICT)
 *
 * Must run daily (not monthly) because each org's billing cycle ends on a
 * different day — paid orgs reset on their Stripe current_period_end, free
 * orgs reset monthly from their signup date. Calls the SQL function
 * reset_due_org_quotas(org_id) defined in migration 061, which only resets
 * orgs whose next_quota_reset_at boundary has actually passed.
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

  const { error } = await supabase.rpc("reset_due_org_quotas")

  if (error) {
    console.error("reset_due_org_quotas failed:", error.message)
    await logEdgeFunctionError(supabase, {
      functionName: "reset-org-quotas",
      error,
      context: { step: "reset_due_org_quotas" },
    })
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }

  return new Response(
    JSON.stringify({ run_at: new Date().toISOString(), status: "ok" }),
    { headers: { "Content-Type": "application/json" } },
  )
})
