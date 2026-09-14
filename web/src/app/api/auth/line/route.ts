/**
 * LINE Login — Step 1: Redirect to LINE Authorization URL
 *
 * GET /api/auth/line
 * GET /api/auth/line?next=/dashboard  (optional redirect after login)
 *
 * LINE Login Channel (different from Messaging API Bot!) must be configured:
 *   LINE Developers Console → Create Channel → LINE Login
 *   Required env vars:
 *     LINE_LOGIN_CHANNEL_ID     = numeric channel ID
 *     LINE_LOGIN_CHANNEL_SECRET = channel secret
 */
import { NextRequest, NextResponse } from "next/server"
import { getAppUrl } from "@/lib/app-url"
import crypto from "node:crypto"
import { cookies } from "next/headers"

const LINE_AUTH_URL = "https://access.line.me/oauth2/v2.1/authorize"

export async function GET(req: NextRequest) {
  const channelId = process.env.LINE_LOGIN_CHANNEL_ID
  if (!channelId) {
    return NextResponse.json(
      { error: "LINE_LOGIN_CHANNEL_ID is not configured" },
      { status: 500 }
    )
  }

  const { searchParams } = new URL(req.url)
  const next  = searchParams.get("next") ?? "/dashboard"
  // The iOS app opens this endpoint inside an ASWebAuthenticationSession with
  // `?platform=ios` so the callback route knows to hand the session back via
  // the `slippy://auth/callback` custom URL scheme instead of redirecting to
  // a web page (see `line/callback/route.ts`).
  const platform = searchParams.get("platform") === "ios" ? "ios" : "web"
  const appUrl = getAppUrl()

  // CSRF protection: random state stored in cookie
  const state = crypto.randomBytes(16).toString("hex")
  const cookieStore = await cookies()
  cookieStore.set("line_oauth_state", state, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   600, // 10 minutes
    path:     "/",
  })
  // Store intended redirect destination
  cookieStore.set("line_oauth_next", next, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   600,
    path:     "/",
  })
  cookieStore.set("line_oauth_platform", platform, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   600,
    path:     "/",
  })

  const params = new URLSearchParams({
    response_type: "code",
    client_id:     channelId,
    redirect_uri:  `${appUrl}/api/auth/line/callback`,
    state,
    scope:         "profile openid email",  // email requires user consent
    nonce:         crypto.randomBytes(8).toString("hex"),
    // prompt=consent forces LINE to show the permission screen every time
    // so user can explicitly grant email access if their account has one
    prompt:        "consent",
  })

  return NextResponse.redirect(`${LINE_AUTH_URL}?${params.toString()}`)
}
