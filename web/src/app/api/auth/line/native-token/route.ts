/**
 * LINE Native SDK → Supabase session bridge (for iOS / native apps)
 *
 * Flow:
 *   1. iOS calls LINE SDK login → gets IDTokenRaw (JWT)
 *   2. iOS POSTs { idToken } here
 *   3. We verify the ID token with LINE's verify endpoint
 *   4. Find-or-create the linked Supabase user (same as LIFF flow)
 *   5. Generate a magic link → call Supabase verify → extract session tokens
 *   6. Return { access_token, refresh_token, token_type, expires_in } to iOS
 *   7. iOS calls db.auth.setSession(accessToken:, refreshToken:)
 */
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { resolveOrCreateLineUser, ensureLineLinkage } from "@/lib/line-identity"

const LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify"

function log(step: string, data?: any) {
  console.log(`[LINE:native-token] ${step}`, data ? JSON.stringify(data) : "")
}

export async function POST(req: NextRequest) {
  let body: { idToken?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }) }

  const { idToken } = body
  if (!idToken) return NextResponse.json({ error: "id_token_required" }, { status: 400 })

  const channelId = process.env.LINE_LOGIN_CHANNEL_ID ?? process.env.LINE_CHANNEL_ID
  if (!channelId) {
    log("ERROR: LINE_LOGIN_CHANNEL_ID missing")
    return NextResponse.json({ error: "line_not_configured" }, { status: 500 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 500 })
  }

  try {
    // ── Step 1: Verify the LINE ID token ─────────────────────────────────
    log("verifying ID token...")
    const verifyRes = await fetch(LINE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
    })
    const verified = await verifyRes.json()

    if (!verifyRes.ok || verified.aud !== channelId) {
      log("verify failed", { ok: verifyRes.ok, aud: verified.aud, error: verified.error })
      return NextResponse.json({ error: "line_verify_failed", detail: verified.error }, { status: 401 })
    }

    const lineUserId  = verified.sub  as string
    const displayName = (verified.name as string | undefined) ?? "ผู้ใช้ LINE"
    const avatarUrl   = verified.picture as string | undefined
    const lineEmail   = verified.email  as string | undefined

    log("verified", { lineUserId: lineUserId.slice(0, 6), displayName })

    // ── Step 2: Find-or-create the linked Supabase user ───────────────────
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

    // ── Step 2.5: Ensure line_connections linkage ────────────────────────
    try {
      await ensureLineLinkage(admin, resolvedUserId, lineUserId, displayName)
    } catch (linkErr: any) {
      log("auto-link error (non-fatal)", linkErr.message)
    }

    // ── Step 3: Generate magic link ────────────────────────────────────────
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: targetEmail,
      options: { redirectTo: "slippy://auth" },
    })

    if (linkErr || !linkData?.properties?.action_link) {
      log("generateLink failed", linkErr?.message)
      return NextResponse.json({ error: "link_generation_failed", detail: linkErr?.message }, { status: 500 })
    }

    // ── Step 4: Exchange the magic link for a real session ─────────────────
    // Supabase verify endpoint returns 302 → slippy://auth#access_token=...
    const actionUrl   = new URL(linkData.properties.action_link)
    const hashedToken = actionUrl.searchParams.get("token")
    const tokenType   = actionUrl.searchParams.get("type") ?? "magiclink"

    const verifySessionUrl = `${supabaseUrl}/auth/v1/verify?token=${hashedToken}&type=${tokenType}&redirect_to=slippy%3A%2F%2Fauth`
    const sessionRes = await fetch(verifySessionUrl, { redirect: "manual" })

    const location = sessionRes.headers.get("location") ?? ""
    const fragment = location.includes("#") ? location.split("#")[1] : ""
    const params   = new URLSearchParams(fragment)

    const accessToken  = params.get("access_token")
    const refreshToken = params.get("refresh_token")
    const expiresIn    = params.get("expires_in")

    if (!accessToken || !refreshToken) {
      log("session extraction failed", { location, status: sessionRes.status })
      return NextResponse.json({ error: "session_extraction_failed" }, { status: 500 })
    }

    log("session minted ✓", { email: targetEmail })
    return NextResponse.json({
      access_token:  accessToken,
      refresh_token: refreshToken,
      token_type:    "bearer",
      expires_in:    expiresIn ? parseInt(expiresIn) : 3600,
    })

  } catch (err: any) {
    log("unexpected error", err?.message)
    return NextResponse.json({ error: "unexpected", detail: err?.message }, { status: 500 })
  }
}
