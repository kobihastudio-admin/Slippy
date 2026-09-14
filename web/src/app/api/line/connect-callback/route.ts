/**
 * GET /api/line/connect-callback
 * LINE Login OAuth callback — เชื่อม LINE account กับ org โดยอัตโนมัติ
 */
import { NextRequest, NextResponse } from "next/server"
import { cookies }            from "next/headers"
import { createAdminClient }  from "@/lib/supabase/admin"
import { findLineConnection, findUserByLineMetadata, hasPlaceholderEmail, mergeLineOnlyAccount } from "@/lib/line-identity"
import { getAppUrl } from "@/lib/app-url"

const LINE_TOKEN_URL   = "https://api.line.me/oauth2/v2.1/token"
const LINE_PROFILE_URL = "https://api.line.me/v2/profile"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code  = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error")

  const appUrl      = getAppUrl()
  const cookieStore = await cookies()
  const savedState  = cookieStore.get("line_connect_state")?.value
  const userId      = cookieStore.get("line_connect_user")?.value

  cookieStore.delete("line_connect_state")
  cookieStore.delete("line_connect_user")

  const redirectBack = `${appUrl}/settings/integrations`

  // Error from LINE
  if (error) {
    return NextResponse.redirect(`${redirectBack}?error=line_cancelled`)
  }

  // CSRF check
  if (!state || !savedState || state !== savedState) {
    return NextResponse.redirect(`${redirectBack}?error=state_mismatch`)
  }

  if (!code || !userId) {
    return NextResponse.redirect(`${redirectBack}?error=missing_params`)
  }

  // Decode orgId from state
  let orgId: string
  try {
    const decoded = JSON.parse(Buffer.from(state, "base64url").toString())
    orgId = decoded.orgId
    if (!orgId) throw new Error("no orgId")
  } catch {
    return NextResponse.redirect(`${redirectBack}?error=invalid_state`)
  }

  const channelId     = process.env.LINE_LOGIN_CHANNEL_ID
  const channelSecret = process.env.LINE_LOGIN_CHANNEL_SECRET
  if (!channelId || !channelSecret) {
    return NextResponse.redirect(`${redirectBack}?error=not_configured`)
  }

  try {
    // ── Exchange code → access token ──────────────────────────────
    const tokenRes = await fetch(LINE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "authorization_code",
        code,
        redirect_uri:  `${appUrl}/api/line/connect-callback`,
        client_id:     channelId,
        client_secret: channelSecret,
      }),
    })
    if (!tokenRes.ok) {
      console.error("[LINE connect-callback] token exchange failed:", await tokenRes.text())
      return NextResponse.redirect(`${redirectBack}?error=token_failed`)
    }
    const { access_token } = await tokenRes.json() as { access_token: string }

    // ── Get LINE profile ──────────────────────────────────────────
    const profileRes = await fetch(LINE_PROFILE_URL, {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    if (!profileRes.ok) {
      return NextResponse.redirect(`${redirectBack}?error=profile_failed`)
    }
    const profile = await profileRes.json() as {
      userId:      string
      displayName: string
      pictureUrl?: string
    }

    // ── Prevent linking this LINE account to more than one Slippy account ──
    // EXCEPTION: if the conflicting account is a LINE-only placeholder
    // account (e.g. created earlier via LINE Login with no email — see
    // line-identity.ts), merge it into the account that's connecting now
    // instead of rejecting. This handles the case where a user first signs
    // in via LINE (placeholder account) and later signs in via Google/
    // Facebook with their real email (a separate account), then connects
    // the same LINE account from Settings.
    const admin = createAdminClient()
    let mergedFrom: string | undefined

    const tryMergeOrReject = async (conflictUserId: string) => {
      const { data } = await admin.auth.admin.getUserById(conflictUserId)
      if (data?.user && hasPlaceholderEmail(data.user.email)) {
        await mergeLineOnlyAccount(admin, conflictUserId, userId)
        mergedFrom = conflictUserId
        console.log(`[LINE connect-callback] 🔀 merged LINE-only account ${conflictUserId.slice(0,8)}… into ${userId.slice(0,8)}…`)
        return true
      }
      return false
    }

    const existingConnection = await findLineConnection(admin, profile.userId)
    if (existingConnection?.user_id && existingConnection.user_id !== userId) {
      if (!(await tryMergeOrReject(existingConnection.user_id))) {
        console.warn(`[LINE connect-callback] ⚠️ ${profile.userId.slice(0,8)}… already linked to a different account`)
        return NextResponse.redirect(`${redirectBack}?error=line_already_linked`)
      }
    }

    const existingMetaUser = await findUserByLineMetadata(admin, profile.userId)
    if (existingMetaUser && existingMetaUser.id !== userId && existingMetaUser.id !== mergedFrom) {
      if (!(await tryMergeOrReject(existingMetaUser.id))) {
        console.warn(`[LINE connect-callback] ⚠️ ${profile.userId.slice(0,8)}… already used by account ${existingMetaUser.id.slice(0,8)}`)
        return NextResponse.redirect(`${redirectBack}?error=line_already_linked`)
      }
    }

    // ── Upsert line_connections ───────────────────────────────────
    const { error: upsertErr } = await admin
      .from("line_connections")
      .upsert({
        line_user_id:    profile.userId,
        user_id:         userId,
        organization_id: orgId,
        display_name:    profile.displayName,
      }, { onConflict: "line_user_id" })

    if (upsertErr) {
      console.error("[LINE connect-callback] upsert failed:", upsertErr)
      return NextResponse.redirect(`${redirectBack}?error=upsert_failed`)
    }

    // ── Mirror onto user_metadata so the LIFF bridge / LINE Login button
    // resolve straight to this account too (keeps all 3 entry points consistent)
    const { data: { user: connectingUser } } = await admin.auth.admin.getUserById(userId)
    if (connectingUser && connectingUser.user_metadata?.line_user_id !== profile.userId) {
      await admin.auth.admin.updateUserById(userId, {
        user_metadata: { ...connectingUser.user_metadata, line_user_id: profile.userId },
      })
    }

    console.log(`[LINE connect-callback] ✅ Connected ${profile.displayName} (${profile.userId.slice(0,8)}…) → org ${orgId.slice(0,8)}`)
    const successParams = new URLSearchParams({ connected: "true", name: profile.displayName })
    if (mergedFrom) successParams.set("merged", "true")
    return NextResponse.redirect(`${redirectBack}?${successParams.toString()}`)

  } catch (err: any) {
    console.error("[LINE connect-callback] unexpected:", err.message)
    return NextResponse.redirect(`${redirectBack}?error=unexpected`)
  }
}
