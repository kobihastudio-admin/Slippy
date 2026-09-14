/**
 * reset-demo-org — Daily cron Edge Function
 *
 * Schedule (set in Supabase Dashboard → Edge Functions → reset-demo-org → Schedule):
 *   0 2 * * *   (02:00 UTC every day = 09:00 ICT)
 *
 * Wipes and re-seeds documents + vendors for all demo organisations.
 * Calls the SQL function reset_demo_org(org_id) defined in migration 010.
 */

import { createClient } from "jsr:@supabase/supabase-js@2"
import { logEdgeFunctionError } from "../_shared/error-log.ts"

Deno.serve(async (req: Request) => {
  // Allow invocation from Supabase cron (no JWT) or manually with service key
  const authHeader = req.headers.get("Authorization") ?? ""
  const cronSecret  = Deno.env.get("CRON_SECRET") ?? ""

  // If CRON_SECRET is set, require it; otherwise fall through (cron invocation)
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

  // Find all demo orgs
  const { data: demoOrgs, error: fetchErr } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("is_demo", true)

  if (fetchErr) {
    console.error("Failed to fetch demo orgs:", fetchErr.message)
    await logEdgeFunctionError(supabase, {
      functionName: "reset-demo-org",
      error: fetchErr,
      context: { step: "fetch_demo_orgs" },
    })
    return new Response(JSON.stringify({ error: fetchErr.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }

  const results: Array<{ id: string; name: string; status: string; error?: string }> = []

  for (const org of demoOrgs ?? []) {
    const { error: resetErr } = await supabase.rpc("reset_demo_org", { p_org_id: org.id })
    if (resetErr) {
      console.error(`reset_demo_org(${org.id}) failed:`, resetErr.message)
      await logEdgeFunctionError(supabase, {
        functionName: "reset-demo-org",
        error: resetErr,
        context: { step: "reset_demo_org", orgId: org.id, orgName: org.name },
      })
      results.push({ id: org.id, name: org.name, status: "error", error: resetErr.message })
    } else {
      console.log(`reset_demo_org(${org.id}) OK`)
      results.push({ id: org.id, name: org.name, status: "ok" })
    }
  }

  return new Response(
    JSON.stringify({ reset_at: new Date().toISOString(), results }),
    { headers: { "Content-Type": "application/json" } },
  )
})
