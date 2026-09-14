/**
 * LIFF → Supabase session bridge
 *
 * Lets a user who is ALREADY signed into LINE inside the LIFF mini-app log
 * into Slippy with a single tap — no separate web login form, no password.
 * This powers the new mobile-optimized "เข้าสู่ระบบด้วยบัญชี LINE" screen at
 * `/liff/home` that every Rich Menu pillar card (Health/Wealth/Lifestyle/
 * Dashboard/Community/...) now routes through.
 *
 * Flow:
 *   1. Client calls `liff.getIDToken()` (already signed in — LIFF handled it)
 *   2. POST { idToken, next? } here
 *   3. We verify the ID token directly with LINE (`/oauth2/v2.1/verify`)
 *   4. Find-or-create the linked Supabase user (same logic as the OAuth
 *      callback at /api/auth/line/callback — keeps both flows consistent)
 *   5. Mint a Supabase magic-link session and return the action_link —
 *      the client redirects to it, landing on /auth/line-callback?next=...
 *      which sets cookies and forwards to the destination pillar page.
 */
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient }         from "@/lib/supabase/admin"
import { resolveOrCreateLineUser, ensureLineLinkage } from "@/lib/line-identity"
import { safeRedirectPath } from "@/lib/safe-redirect"
import { getAppUrl } from "@/lib/app-url"

const LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify"

function log(step: string, data?: any) {
  console.log(`[LIFF:auth-bridge] ${step}`, data ? JSON.stringify(data) : "")
}

export async function POST(req: NextRequest) {
  const appUrl = getAppUrl()

  let body: { idToken?: string; next?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }) }

  const { idToken } = body
  if (!idToken) return NextResponse.json({ error: "id_token_required" }, { status: 400 })

  // Only same-origin relative paths are honoured for `next` (avoid open redirects)
  const next = body.next ? safeRedirectPath(body.next, "") || null : null

  const channelId = process.env.LINE_LOGIN_CHANNEL_ID ?? process.env.LINE_CHANNEL_ID
  if (!channelId) {
    log("ERROR: LINE_LOGIN_CHANNEL_ID missing")
    return NextResponse.json({ error: "line_not_configured" }, { status: 500 })
  }

  try {
    // ── Step 1: Verify the LIFF ID token directly with LINE ───────────────
    log("verifying ID token...")
    const verifyRes = await fetch(LINE_VERIFY_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    new URLSearchParams({ id_token: idToken, client_id: channelId }),
    })
    const verified = await verifyRes.json()

    if (!verifyRes.ok || verified.aud !== channelId) {
      log("verify failed", { ok: verifyRes.ok, aud: verified.aud, error: verified.error })
      return NextResponse.json({ error: "line_verify_failed", detail: verified.error }, { status: 401 })
    }

    const lineUserId  = verified.sub  as string
    const displayName = verified.name as string | undefined ?? "ผู้ใช้ LINE"
    const avatarUrl   = verified.picture as string | undefined
    const lineEmail   = verified.email as string | undefined

    log("verified", { lineUserId: lineUserId.slice(0, 6), displayName, hasEmail: !!lineEmail })

    // ── Step 2: Find-or-create the linked Supabase user ───────────────────
    // Shared resolver — keeps this in sync with /api/auth/line/callback and
    // /api/line/connect-callback.
    const admin = createAdminClient()
    let resolved
    try {
      resolved = await resolveOrCreateLineUser(admin, {
        lineUserId, displayName, avatarUrl, email: lineEmail,
      })
    } catch (err: any) {
      log("resolve user failed", err.message)
      return NextResponse.json({ error: "line_create", detail: err.message }, { status: 500 })
    }
    const { userId: resolvedUserId, email: targetEmail } = resolved
    log(resolved.isNewUser ? "created new user" : "found existing user", { id: resolvedUserId.slice(0, 8) })

    // ── Step 2.5: Ensure org + line_connections exist ─────────────────────
    // A brand-new LINE-only account (first time tapping the Rich Menu, never
    // used the website's "เข้าสู่ระบบด้วย LINE" button) otherwise has no
    // organization, which breaks every LIFF pillar page that depends on one.
    try {
      const orgId = await ensureLineLinkage(admin, resolvedUserId, lineUserId, displayName)
      if (orgId) log("✅ line_connections linked", { lineUserId: lineUserId.slice(0, 6), orgId: orgId.slice(0, 8) })
    } catch (linkErr: any) {
      log("auto-link error (non-fatal)", linkErr.message)
    }

    // ── Step 3: Mint a Supabase session (magic-link action_link) ──────────
    const redirectTo = next
      ? `${appUrl}/auth/line-callback?next=${encodeURIComponent(next)}`
      : `${appUrl}/auth/line-callback`

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink", email: targetEmail, options: { redirectTo },
    })

    if (linkErr || !linkData?.properties?.action_link) {
      log("generateLink failed", linkErr?.message)
      return NextResponse.json({ error: "line_session", detail: linkErr?.message }, { status: 500 })
    }

    log("session minted ✓", { email: targetEmail, next })
    return NextResponse.json({ actionLink: linkData.properties.action_link })

  } catch (err: any) {
    log("unexpected error", err?.message)
    return NextResponse.json({ error: "unexpected", detail: err?.message }, { status: 500 })
  }
}
