/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { createAdminClient } from "@/lib/supabase/admin"
import { NextRequest, NextResponse } from "next/server"

/**
 * logServerError — durable record of a Next.js API route failure
 * (source='server' in client_error_logs, the existing logClientError /
 * /api/errors path stays 'browser'). Never throws.
 */
export async function logServerError(params: {
  errorType: string
  error: unknown
  organizationId?: string | null
  userId?: string | null
  context?: Record<string, unknown>
}): Promise<void> {
  const { errorType, error, organizationId, userId, context } = params
  const err = error instanceof Error ? error : new Error(String(error))

  try {
    const admin = createAdminClient()
    await admin.from("client_error_logs").insert({
      source:          "server",
      error_type:      errorType,
      error_name:      err.name,
      error_message:   err.message,
      error_stack:     err.stack?.slice(0, 2000) ?? null,
      organization_id: organizationId ?? null,
      user_id:         userId ?? null,
      context:         context ?? {},
    })
  } catch (loggingErr) {
    console.error("[logServerError] failed to persist error log:", loggingErr)
  }
}

/**
 * withErrorLogging — wraps a Next.js route handler so unhandled throws are
 * logged to client_error_logs before returning a generic 500, instead of
 * disappearing into the container's stdout.
 *
 * Usage: export const POST = withErrorLogging("stripe_checkout", async (req) => { ... })
 */
export function withErrorLogging<T extends (req: NextRequest, ...args: any[]) => Promise<Response>>(
  errorType: string,
  handler: T
): T {
  return (async (req: NextRequest, ...args: any[]) => {
    try {
      return await handler(req, ...args)
    } catch (error) {
      await logServerError({ errorType, error, context: { url: req.url, method: req.method } })
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  }) as T
}
