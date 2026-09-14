/**
 * LINE Login — Step 2: Handle callback from LINE
 */
import { NextRequest, NextResponse } from "next/server"
import { cookies }            from "next/headers"
import { createAdminClient }  from "@/lib/supabase/admin"
import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { resolveOrCreateLineUser, ensureLineLinkage } from "@/lib/line-identity"
import { safeRedirectPath } from "@/lib/safe-redirect"
import { getAppUrl } from "@/lib/app-url"
import { recordActivity }    from "@/lib/activity-log"

const LINE_TOKEN_URL   = "https://api.line.me/oauth2/v2.1/token"
const LINE_PROFILE_URL = "https://api.line.me/v2/profile"
const LINE_USERINFO_URL = "https://api.line.me/oauth2/v2.1/userinfo"

function log(step: string, data?: any) {
  console.log(`[LINE:callback] ${step}`, data ? JSON.stringify(data) : "")
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code  = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error")

  const appUrl      = getAppUrl()
  const cookieStore = await cookies()
  const savedState  = cookieStore.get("line_oauth_state")?.value
  const next        = cookieStore.get("line_oauth_next")?.value ?? "/dashboard"
  const platform    = cookieStore.get("line_oauth_platform")?.value ?? "web"
  const isIOS       = platform === "ios"

  // Clear state cookies
  cookieStore.delete("line_oauth_state")
  cookieStore.delete("line_oauth_next")
  cookieStore.delete("line_oauth_platform")

  // Where to land once Supabase has minted a session for this LINE login.
  // Native (iOS) opens this whole flow inside an ASWebAuthenticationSession
  // listening for the `slippy://` scheme — redirecting the magic-link tokens
  // there lets the app capture the session directly (mirrors how Google/
  // Facebook OAuth completes via `slippy://auth/callback`). Web keeps using
  // the client-side hash-reader page since middleware can't read fragments.
  // Forward `next` (e.g. /liff/sport, /liff/trip) so the client-side
  // hash-reader page can route the user straight back to where they
  // started after auto-link completes. Only forward safe relative paths.
  const safeNext = safeRedirectPath(next, "/dashboard")
  const webRedirectTarget = safeNext !== "/dashboard"
    ? `${appUrl}/auth/line-callback?next=${encodeURIComponent(safeNext)}`
    : `${appUrl}/auth/line-callback`
  const sessionRedirectTarget = isIOS ? "slippy://auth/callback" : webRedirectTarget
  const errorRedirect = (code: string) => {
    // Every failure path in this route funnels through here, so one call
    // records them all. Failed logins are the single most useful row in the
    // activity table — repeated failures from one address is what credential
    // stuffing looks like, and until now nothing recorded them at all.
    // Only the reason CODE ever leaves this route — the raw LINE/Supabase
    // error text stays in the server-side log() calls above each call site.
    // It used to also ride along as a `detail` query param so the login
    // page could render it, which meant internal error text (echoing
    // request contents in some cases) sat in the browser's URL/history for
    // a message nobody stuck on a login screen could act on anyway.
    void recordActivity({
      action: "login", outcome: "failed",
      detail: `LINE login failed: ${code}`,
      req, metadata: { provider: "line", reason: code },
    })
    const qs = new URLSearchParams({ error: code })
    const base = isIOS ? "slippy://auth/callback" : `${appUrl}/login`
    return NextResponse.redirect(`${base}?${qs.toString()}`)
  }

  log("received", { code: code?.slice(0,8), state: state?.slice(0,8), savedState: savedState?.slice(0,8), error })

  if (error) {
    log("LINE returned error", error)
    return errorRedirect("line_cancelled")
  }

  // CSRF check
  if (!state || !savedState || state !== savedState) {
    log("state mismatch", { state: state?.slice(0,8), savedState: savedState?.slice(0,8) })
    // Allow in dev without state (e.g. direct URL test)
    if (process.env.NODE_ENV === "production") {
      return errorRedirect("line_state_mismatch")
    }
    log("⚠️ state mismatch ignored in dev mode")
  }

  if (!code) {
    return errorRedirect("line_no_code")
  }

  const channelId     = process.env.LINE_LOGIN_CHANNEL_ID
  const channelSecret = process.env.LINE_LOGIN_CHANNEL_SECRET

  if (!channelId || !channelSecret) {
    log("ERROR: LINE env vars missing")
    return errorRedirect("line_not_configured")
  }

  const redirectUri = `${appUrl}/api/auth/line/callback`

  try {
    // ── Step 1: Exchange code → access token ────────────────────
    log("exchanging code for token...")
    const tokenRes = await fetch(LINE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "authorization_code",
        code,
        redirect_uri:  redirectUri,
        client_id:     channelId,
        client_secret: channelSecret,
      }),
    })

    const tokenBody = await tokenRes.json()
    log("token response", { ok: tokenRes.ok, status: tokenRes.status, keys: Object.keys(tokenBody) })

    if (!tokenRes.ok) {
      log("token exchange failed", tokenBody)
      return errorRedirect("line_token")
    }

    const accessToken: string = tokenBody.access_token

    // ── Step 2: Fetch LINE profile + extract email ─────────────
    log("fetching LINE profile...")
    const profileRes = await fetch(LINE_PROFILE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!profileRes.ok) {
      log("profile fetch failed", { status: profileRes.status })
      return errorRedirect("line_profile")
    }

    const profile = await profileRes.json()

    const lineUserId  = profile.userId      as string
    const displayName = profile.displayName as string
    const avatarUrl   = profile.pictureUrl  as string | undefined

    // ── Extract email: try 3 sources in priority order ──────────
    // 1. id_token JWT payload (most reliable — included when email scope granted)
    // 2. userinfo endpoint
    // 3. none → placeholder
    let lineEmail: string | undefined

    // Source 1: decode id_token (base64 JWT, no verification needed for email claim)
    const idToken: string | undefined = tokenBody.id_token
    if (idToken) {
      try {
        const [, payloadB64] = idToken.split(".")
        const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"))
        lineEmail = payload.email as string | undefined
        log("id_token email", { email: lineEmail ?? "none" })
      } catch (e) {
        log("id_token decode failed", String(e))
      }
    }

    // Source 2: userinfo endpoint (fallback)
    if (!lineEmail) {
      const userinfoRes = await fetch(LINE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (userinfoRes.ok) {
        const userinfo = await userinfoRes.json()
        lineEmail = userinfo.email as string | undefined
        log("userinfo email", { email: lineEmail ?? "none" })
      }
    }

    log("LINE user", { lineUserId: lineUserId.slice(0,6), displayName, hasEmail: !!lineEmail, email: lineEmail })

    // ── Step 3: Find or create the linked Slippy account ────────
    // Shared resolver — keeps this in sync with the LIFF bridge
    // (/api/auth/liff) and "เชื่อมต่อ LINE" (/api/line/connect-callback).
    const admin = createAdminClient()
    let resolved
    try {
      resolved = await resolveOrCreateLineUser(admin, {
        lineUserId, displayName, avatarUrl, email: lineEmail,
      })
    } catch (err: any) {
      log("resolve user failed", err.message)
      return errorRedirect("line_create")
    }
    const { userId: resolvedUserId, email: targetEmail } = resolved
    log(resolved.isNewUser ? "created new user" : "found existing user", { id: resolvedUserId.slice(0,8) })

    // ── Step 3.5: Ensure org + line_connections exist ────────────
    // This is the "no /connect CODE" path: signing in via LINE Login here
    // (a button on /login, NOT Slippy's main email/password form) is enough
    // to upsert `line_connections`, so that later opening /liff/sport,
    // /liff/trip, etc. inside LINE (via liff.getProfile() — no Slippy
    // session) resolves straight to this user/org without any manual code.
    try {
      const orgId = await ensureLineLinkage(admin, resolvedUserId, lineUserId, displayName)
      if (orgId) log("✅ line_connections linked", { lineUserId: lineUserId.slice(0,6), orgId: orgId.slice(0,8) })
    } catch (linkErr: any) {
      // Non-fatal — the LINE Login session itself still succeeds even if
      // auto-linking fails; user can fall back to /connect CODE.
      log("auto-link error (non-fatal)", linkErr.message)
    }

    // ── Step 4: Create session via generateLink ────────────────
    // Supabase returns tokens as hash fragment (#access_token=...) so we redirect
    // to a CLIENT-SIDE page (/auth/line-callback) that can read the hash,
    // call supabase.auth.onAuthStateChange(), set cookies, then navigate to dashboard.
    // (Server-side middleware cannot read hash fragments)
    log("generating sign-in link", { email: targetEmail, redirectTo: sessionRedirectTarget })
    // NOTE: `sessionRedirectTarget` (either the web hash-reader page or, for
    // iOS, the `slippy://auth/callback` custom scheme) must be present in
    // Supabase Dashboard → Authentication → URL Configuration → Redirect URLs,
    // otherwise `generateLink` will silently fall back / Supabase will refuse
    // to append the session tokens to it.
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type:    "magiclink",
      email:   targetEmail,
      options: { redirectTo: sessionRedirectTarget },
    })

    if (linkErr || !linkData?.properties?.action_link) {
      log("generateLink failed", linkErr?.message)
      return errorRedirect("line_session")
    }

    log("redirecting to action_link")
    void recordActivity({
      action: "login", outcome: "success",
      userId: resolvedUserId,
      detail: "เข้าสู่ระบบด้วย LINE",
      req, metadata: { provider: "line", platform },
    })
    return NextResponse.redirect(linkData.properties.action_link)

  } catch (err: any) {
    log("unexpected error", err.message)
    return errorRedirect("line_unexpected")
  }
}
