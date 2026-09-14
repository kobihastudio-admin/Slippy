/**
 * GET /api/line/connect-login?orgId=xxx
 * เริ่ม LINE Login OAuth เพื่อเชื่อมต่อ LINE account กับ org
 * ไม่ต้องพิมพ์ /connect CODE — ทำทุกอย่างอัตโนมัติ
 */
import { NextRequest, NextResponse } from "next/server"
import { createClient }  from "@/lib/supabase/server"
import { cookies }       from "next/headers"
import crypto            from "node:crypto"
import { getAppUrl } from "@/lib/app-url"

const LINE_AUTH_URL = "https://access.line.me/oauth2/v2.1/authorize"

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL("/login", req.url))

  const orgId = req.nextUrl.searchParams.get("orgId")
  if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 })

  const channelId = process.env.LINE_LOGIN_CHANNEL_ID
  if (!channelId) return NextResponse.json({ error: "LINE_LOGIN_CHANNEL_ID not configured" }, { status: 500 })

  const appUrl = getAppUrl()

  // CSRF state — encode orgId inside so callback knows what to do
  const nonce = crypto.randomBytes(12).toString("hex")
  const state = Buffer.from(JSON.stringify({ nonce, orgId, action: "connect_bot" })).toString("base64url")

  const cookieStore = await cookies()
  cookieStore.set("line_connect_state", state, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   600,
    path:     "/",
  })
  // Store userId so callback can use it
  cookieStore.set("line_connect_user", user.id, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   600,
    path:     "/",
  })

  const params = new URLSearchParams({
    response_type: "code",
    client_id:     channelId,
    redirect_uri:  `${appUrl}/api/line/connect-callback`,
    state,
    scope:         "profile openid",
    nonce:         crypto.randomBytes(8).toString("hex"),
    prompt:        "consent",
  })

  return NextResponse.redirect(`${LINE_AUTH_URL}?${params}`)
}
