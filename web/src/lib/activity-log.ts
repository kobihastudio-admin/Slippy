import { createAdminClient } from "@/lib/supabase/admin"
import type { NextRequest } from "next/server"

/**
 * Web-side twin of `api/src/services/activity-log.ts`.
 *
 * The two halves write the same table with the same vocabulary, because most of
 * what is worth watching happens here — logins, opening documents, being
 * refused a trip — while the API only sees the extraction pipeline. Detection
 * queries in the API read whatever both sides wrote.
 *
 * Same three rules: never block a request, never store contents, never keep a
 * full address.
 */

export type ActivityAction =
  | "login"
  | "logout"
  | "document.upload"
  | "document.view"
  | "document.export"
  | "document.delete"
  | "document.rejected"
  | "trip.view"
  | "member.invite"
  | "permission.change"
  | "account.delete"

export type ActivityOutcome = "success" | "denied" | "failed" | "rejected"

/** Keeps the network, drops the host. See the API twin for the reasoning. */
export function truncateIp(ip: string | null | undefined): string | null {
  if (!ip) return null
  const clean = ip.split(",")[0].trim()
  if (clean.includes(":")) {
    const parts = clean.split(":").filter(Boolean)
    return parts.length >= 4 ? `${parts.slice(0, 4).join(":")}::/64` : null
  }
  const octets = clean.split(".")
  if (octets.length !== 4 || octets.some(o => !/^\d{1,3}$/.test(o))) return null
  return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`
}

/**
 * Reads the caller's address from the proxy headers.
 *
 * Everything reaches this app through Cloudflare and Caddy, so the socket
 * address is always the proxy. `cf-connecting-ip` is the only one Cloudflare
 * sets itself and a client cannot forge end-to-end, so it is preferred over
 * `x-forwarded-for`, whose first entry is client-supplied.
 */
export function clientIp(req: NextRequest): string | null {
  return req.headers.get("cf-connecting-ip")
      ?? req.headers.get("x-real-ip")
      ?? req.headers.get("x-forwarded-for")
      ?? null
}

export interface ActivityEvent {
  action:   ActivityAction
  outcome?: ActivityOutcome
  userId?:  string | null
  orgId?:   string | null
  resourceType?: string | null
  resourceId?:   string | null
  detail?:  string | null
  req?:     NextRequest
  metadata?: Record<string, unknown>
}

export async function recordActivity(event: ActivityEvent): Promise<void> {
  try {
    await createAdminClient().from("user_activity_logs").insert({
      user_id:         event.userId ?? null,
      organization_id: event.orgId ?? null,
      action:          event.action,
      outcome:         event.outcome ?? "success",
      resource_type:   event.resourceType ?? null,
      resource_id:     event.resourceId ?? null,
      detail:          event.detail ?? null,
      ip_address:      truncateIp(event.req ? clientIp(event.req) : null),
      user_agent:      event.req?.headers.get("user-agent")?.slice(0, 300) ?? null,
      metadata:        event.metadata ?? {},
    })
  } catch (err) {
    console.warn("[activity] write failed:", (err as Error).message)
  }
}

/**
 * Records an authorization refusal.
 *
 * Separate from `recordActivity` only to make the call sites read as what they
 * are: the single most useful line in this table is the one written when
 * somebody asked for a resource that was not theirs. Enough of those, against
 * enough different ids, is an enumeration sweep — which is exactly what the
 * trip routes were open to while they authenticated the caller but never
 * checked whether the trip was theirs.
 */
export function recordDenied(
  action: ActivityAction,
  opts: { userId?: string | null; resourceType: string; resourceId: string; req?: NextRequest },
): void {
  void recordActivity({
    action,
    outcome: "denied",
    userId: opts.userId,
    resourceType: opts.resourceType,
    resourceId: opts.resourceId,
    req: opts.req,
    detail: "ไม่มีสิทธิ์เข้าถึง",
  })
}
