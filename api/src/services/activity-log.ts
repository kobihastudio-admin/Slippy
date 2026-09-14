import { createClient } from "../lib/supabase"

/**
 * Records what people do, so abuse is detectable and questions like "who
 * deleted that" have an answer.
 *
 * The table and a user-facing page that reads it both already existed; nothing
 * had ever written to it. That gap is why an id-enumeration attempt against the
 * trip routes — which use the service-role client and until recently skipped
 * membership checks entirely — would have left no trace at all.
 *
 * Three rules hold everywhere in this file:
 *   • Writing is fire-and-forget. Logging must never fail a user's request.
 *   • Contents are never stored. What happened, not what was in it.
 *   • Addresses are truncated. Enough to correlate an attack, less than is
 *     needed to follow a person around.
 */

/** The events worth recording. Closed set so queries can rely on the values. */
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

export interface ActivityEvent {
  action:   ActivityAction
  outcome?: ActivityOutcome
  userId?:  string | null
  orgId?:   string | null
  resourceType?: string | null
  resourceId?:   string | null
  /** Short human-readable line, shown on the user's own privacy page. */
  detail?:  string | null
  ip?:      string | null
  userAgent?: string | null
  /** Structured, non-sensitive. Never put extracted values in here. */
  metadata?: Record<string, unknown>
}

/**
 * Drops the last octet of an IPv4 address / the interface half of an IPv6 one.
 *
 * A /24 still groups a burst of attempts from one source, which is what
 * detection needs, without retaining an identifier precise enough to follow a
 * particular person's browsing.
 */
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

export async function recordActivity(event: ActivityEvent): Promise<void> {
  try {
    await createClient().from("user_activity_logs").insert({
      user_id:         event.userId ?? null,
      organization_id: event.orgId ?? null,
      action:          event.action,
      outcome:         event.outcome ?? "success",
      resource_type:   event.resourceType ?? null,
      resource_id:     event.resourceId ?? null,
      detail:          event.detail ?? null,
      ip_address:      truncateIp(event.ip),
      user_agent:      event.userAgent?.slice(0, 300) ?? null,
      metadata:        event.metadata ?? {},
    })
  } catch (err) {
    console.warn("[activity] write failed:", (err as Error).message)
  }
}

// ── Detection ───────────────────────────────────────────────────────────────

export interface AbuseSignal {
  kind:    "credential_stuffing" | "id_enumeration" | "quota_burn" | "junk_uploads"
  subject: string
  count:   number
  detail:  string
}

/** Thresholds are starting points — tune them once real traffic exists. */
const WINDOW_MINUTES        = 30
const FAILED_LOGIN_LIMIT    = 10
const DENIED_ACCESS_LIMIT   = 8
const REJECTED_UPLOAD_LIMIT = 5

/**
 * Looks for the four patterns that actually matter for this product.
 *
 * Read-only and cheap enough to run from a health endpoint or a cron job. It
 * reports; it never blocks — an automatic ban built on untuned thresholds locks
 * out real customers, and there is no traffic history yet to tune against.
 */
export async function detectAbuse(): Promise<AbuseSignal[]> {
  const signals: AbuseSignal[] = []
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString()

  try {
    const { data } = await createClient()
      .from("user_activity_logs")
      .select("user_id, ip_address, action, outcome, resource_id")
      .gte("created_at", since)
      .in("outcome", ["denied", "failed", "rejected"])
      .limit(2000)

    const rows = data ?? []

    // Many failed logins from one address — somebody is trying passwords.
    const byIpLogin = new Map<string, number>()
    // Many refusals for one account — somebody is walking through ids. Counts
    // DISTINCT resources: eight refusals for the same document is a confused
    // client, eight for eight different ones is a sweep.
    const byUserDenied = new Map<string, Set<string>>()
    // Repeatedly uploading things that are not financial documents.
    const byUserRejected = new Map<string, number>()

    for (const r of rows as Array<Record<string, string | null>>) {
      if (r.action === "login" && r.outcome === "failed" && r.ip_address) {
        byIpLogin.set(r.ip_address, (byIpLogin.get(r.ip_address) ?? 0) + 1)
      }
      if (r.outcome === "denied" && r.user_id) {
        const set = byUserDenied.get(r.user_id) ?? new Set<string>()
        set.add(r.resource_id ?? "?")
        byUserDenied.set(r.user_id, set)
      }
      if (r.action === "document.rejected" && r.user_id) {
        byUserRejected.set(r.user_id, (byUserRejected.get(r.user_id) ?? 0) + 1)
      }
    }

    for (const [ip, n] of byIpLogin) {
      if (n >= FAILED_LOGIN_LIMIT) {
        signals.push({ kind: "credential_stuffing", subject: ip, count: n,
          detail: `${n} failed logins from ${ip} in ${WINDOW_MINUTES}m` })
      }
    }
    for (const [user, set] of byUserDenied) {
      if (set.size >= DENIED_ACCESS_LIMIT) {
        signals.push({ kind: "id_enumeration", subject: user, count: set.size,
          detail: `refused access to ${set.size} different resources in ${WINDOW_MINUTES}m` })
      }
    }
    for (const [user, n] of byUserRejected) {
      if (n >= REJECTED_UPLOAD_LIMIT) {
        signals.push({ kind: "junk_uploads", subject: user, count: n,
          detail: `${n} uploads rejected as non-financial in ${WINDOW_MINUTES}m` })
      }
    }
  } catch (err) {
    console.warn("[activity] detection failed:", (err as Error).message)
  }

  return signals
}
