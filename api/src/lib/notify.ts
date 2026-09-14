import { supabase } from "./supabase"

/**
 * createNotification — inserts a row into `notifications` for an org (and/or
 * a specific user). This table has had a full schema/API/UI (web bell +
 * /notifications page, iOS NotificationsView) since migration 006, but
 * nothing ever called insert on it until this. Billing events (Stripe
 * webhook) are the first real caller — see routes/stripe.ts.
 *
 * organizationId with no userId targets the whole org — GET /api/notifications
 * already ORs on organization_id, so every member sees it. Never throws:
 * a notification failing to insert must not break the webhook/pipeline that
 * triggered it.
 */
export async function createNotification(params: {
  type: string
  title: string
  body?: string
  organizationId?: string | null
  userId?: string | null
  metadata?: Record<string, unknown>
}): Promise<void> {
  const { type, title, body, organizationId, userId, metadata } = params
  try {
    await supabase.from("notifications").insert({
      organization_id: organizationId ?? null,
      user_id:         userId ?? null,
      type,
      title,
      body:            body ?? null,
      metadata:        metadata ?? {},
    })
  } catch (err) {
    console.error("[createNotification] failed to insert:", err)
  }
}
