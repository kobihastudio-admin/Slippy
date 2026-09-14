import { supabase } from "./supabase"

/**
 * Durable server-side error logging — fire-and-forget insert into
 * client_error_logs (source='server'). Never throws: a logging failure must
 * never mask or replace the original error being reported.
 *
 * Use at the boundary of anything that previously only console.log'd a
 * failure: Fastify route/global error handlers, queue worker permanent
 * failures, Stripe webhook handler catch blocks.
 */
export async function logServerError(params: {
  errorType: string                 // e.g. "api_unhandled" | "worker_job_failed" | "stripe_webhook"
  error: unknown
  organizationId?: string | null
  userId?: string | null
  context?: Record<string, unknown>
}): Promise<void> {
  const { errorType, error, organizationId, userId, context } = params
  const err = error instanceof Error ? error : new Error(String(error))

  try {
    await supabase.from("client_error_logs").insert({
      source:          "server",
      error_type:      errorType,
      error_name:      err.name,
      error_message:   err.message,
      error_stack:     err.stack ?? null,
      organization_id: organizationId ?? null,
      user_id:         userId ?? null,
      context:         context ?? {},
    })
  } catch (loggingErr) {
    // Logging the logging failure would loop — just console.error and move on.
    console.error("[logServerError] failed to persist error log:", loggingErr)
  }
}
