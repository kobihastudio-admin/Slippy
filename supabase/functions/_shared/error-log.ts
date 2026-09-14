// Shared by all Edge Functions — durable error logging into
// client_error_logs (source='server'), since a failed cron run otherwise
// only lives in the Supabase dashboard's ephemeral function logs.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "jsr:@supabase/supabase-js@2"

export async function logEdgeFunctionError(
  supabase: ReturnType<typeof createClient>,
  params: { functionName: string; error: unknown; context?: Record<string, unknown> },
): Promise<void> {
  const { functionName, error, context } = params
  const err = error instanceof Error ? error : new Error(String(error))

  try {
    await supabase.from("client_error_logs").insert({
      source:        "server",
      error_type:    `edge_function:${functionName}`,
      error_name:    err.name,
      error_message: err.message,
      error_stack:   err.stack ?? null,
      context:       context ?? {},
    })
  } catch (loggingErr) {
    console.error(`[logEdgeFunctionError] failed to persist log for ${functionName}:`, loggingErr)
  }
}
