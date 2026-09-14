/**
 * liff.ts — LINE Front-end Framework utilities
 *
 * LIFF allows web pages to open inside LINE app and automatically
 * receive the user's LINE profile (userId, displayName, pictureUrl)
 * without requiring a separate /connect flow.
 *
 * Use case: bill/trip participants join via LIFF link instead of /connect CODE
 *
 * Setup required (one-time):
 *   1. LINE Developers Console → LINE Login channel → LIFF tab
 *   2. Add LIFF app with endpoint = the BARE app origin, e.g.
 *        https://slippy-solutionxteams-projects.vercel.app
 *      ⚠️ Do NOT append "/liff" to the endpoint — every helper below
 *      (makeLiffGateUrl/makeLiffSportUrl/makeLiffTripUrl/makeLiffJoinUrl)
 *      already builds links like `https://liff.line.me/{liffId}/liff/home`.
 *      LINE appends that trailing path onto whatever Endpoint URL is
 *      registered, so an endpoint of ".../liff" produces a broken
 *      ".../liff/liff/home" (404) which then bounces to the desktop
 *      `/login` page — exactly the "redirects to the main login" symptom.
 *   3. Copy LIFF ID → NEXT_PUBLIC_LIFF_ID in .env.local
 */
import { getAppUrl } from "@/lib/app-url"

export interface LiffProfile {
  userId:      string
  displayName: string
  pictureUrl:  string | undefined
  statusMessage: string | undefined
}

let _liff: any = null

export async function initLiff(): Promise<boolean> {
  if (typeof window === "undefined") return false

  const liffId = process.env.NEXT_PUBLIC_LIFF_ID
  if (!liffId) {
    console.warn("[LIFF] NEXT_PUBLIC_LIFF_ID not set — LIFF features disabled")
    return false
  }

  try {
    if (!_liff) {
      const mod = await import("@line/liff")
      _liff = mod.default
    }
    await _liff.init({ liffId })
    return true
  } catch (err: any) {
    console.error("[LIFF] init failed:", err.message)
    return false
  }
}

export async function getLiffProfile(): Promise<LiffProfile | null> {
  try {
    const ok = await initLiff()
    if (!ok || !_liff) return null

    if (!_liff.isLoggedIn()) {
      _liff.login({ redirectUri: window.location.href })
      return null  // will redirect
    }

    const profile = await _liff.getProfile()
    return {
      userId:        profile.userId,
      displayName:   profile.displayName,
      pictureUrl:    profile.pictureUrl,
      statusMessage: profile.statusMessage,
    }
  } catch (err: any) {
    console.error("[LIFF] getProfile failed:", err.message)
    return null
  }
}

export function isInLineApp(): boolean {
  if (typeof window === "undefined") return false
  return _liff?.isInClient() ?? false
}

export function closeLiff(): void {
  _liff?.closeWindow()
}

/** Generate LIFF deep link for joining a bill/trip */
export function makeLiffJoinUrl(token: string, type: "trip" | "split" = "trip"): string {
  const liffId  = process.env.NEXT_PUBLIC_LIFF_ID
  const appUrl  = getAppUrl()
  const path    = `/liff/join/${token}?type=${type}`

  if (liffId) {
    // LIFF URL opens inside LINE app → auto-identifies user
    return `https://liff.line.me/${liffId}${path}`
  }
  // Fallback: regular web URL (user enters name manually)
  return `${appUrl}${type === "trip" ? "/trips" : "/split"}/join/${token}`
}

/** Generate LIFF deep link for the sport-groups dashboard (à la KhunThong) */
export function makeLiffSportUrl(): string {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID
  if (liffId) return `https://liff.line.me/${liffId}/liff/sport`
  return `${getAppUrl()}/liff/sport`
}

/** Generate LIFF deep link for the trip-groups dashboard (à la KhunThong, travel-themed) */
export function makeLiffTripUrl(): string {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID
  if (liffId) return `https://liff.line.me/${liffId}/liff/trip`
  return `${getAppUrl()}/liff/trip`
}

/**
 * Generate a LIFF deep link that lands on the LINE-only login gate
 * (`/liff/home`) and then forwards into `destPath` once a Slippy session has
 * been minted from the user's existing LINE login — no Supabase email/
 * password form, mobile-optimized. This is what every "Slippy Universe"
 * pillar card on the Rich Menu (Health/Wealth/Lifestyle/Dashboard/
 * Community/...) should open instead of a bare `${APP_URL}${destPath}` link.
 */
export function makeLiffGateUrl(destPath: string): string {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID
  const appUrl = getAppUrl()
  const qs     = `?next=${encodeURIComponent(destPath)}`
  if (liffId) return `https://liff.line.me/${liffId}/liff/home${qs}`
  // Outside LIFF context (no LIFF ID configured) — fall back to a direct link;
  // the destination page's own (web) auth gate will handle the login.
  return `${appUrl}${destPath}`
}
