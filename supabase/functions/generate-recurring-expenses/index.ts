/**
 * generate-recurring-expenses — Daily cron Edge Function
 *
 * Schedule (set in Supabase Dashboard → Edge Functions →
 * generate-recurring-expenses → Schedule):
 *   0 1 * * *   (01:00 UTC every day = 08:00 ICT)
 *
 * The split-calculation logic (resolveExpenseSplits/createTripExpense) lives
 * in web/src/lib/trip-settlement.ts, not here — this function just calls the
 * Next.js app's internal /api/trips/recurring/run endpoint (auth'd with the
 * same CRON_SECRET as reset-org-quotas) so a recurring expense is computed
 * through the exact same code path as one a person adds by hand, instead of
 * reimplementing split math a second time in SQL/Deno.
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

  // Strip any trailing slash — a stray "https://dev.slippyai.app/" in the
  // APP_URL secret would otherwise produce a double-slash "...app//api/..."
  // request URL below.
  const appUrl = (Deno.env.get("APP_URL") ?? "https://dev.slippyai.app").replace(/\/+$/, "")

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )

  try {
    const res = await fetch(`${appUrl}/api/trips/recurring/run`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cronSecret}` },
    })
    const body = await res.json()

    if (!res.ok) {
      throw new Error(`recurring/run returned ${res.status}: ${JSON.stringify(body)}`)
    }

    return new Response(JSON.stringify({ run_at: new Date().toISOString(), status: "ok", ...body }), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    console.error("generate-recurring-expenses failed:", error)
    await logEdgeFunctionError(supabase, {
      functionName: "generate-recurring-expenses",
      error,
    })
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
})
