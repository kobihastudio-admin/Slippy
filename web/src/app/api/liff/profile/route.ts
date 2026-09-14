import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getVerifiedLineUserId, liffUnauthorized } from "@/lib/liff-auth"

async function resolveConn(admin: ReturnType<typeof createAdminClient>, lineUserId: string) {
  const { data } = await admin
    .from("line_connections")
    .select("user_id, organization_id, display_name, picture_url, created_at")
    .eq("line_user_id", lineUserId)
    .maybeSingle()
  return data
}

// GET /api/liff/profile?lineUserId=X
export async function GET(req: NextRequest) {
  const lineUserId = req.nextUrl.searchParams.get("lineUserId")
  if (!lineUserId) return NextResponse.json({ error: "lineUserId required" }, { status: 400 })

  const admin = createAdminClient()
  const conn = await resolveConn(admin, lineUserId)
  if (!conn) return NextResponse.json({ needsConnect: true }, { status: 200 })

  // Org name
  const { data: org } = await admin
    .from("organizations")
    .select("id, name, settings")
    .eq("id", conn.organization_id)
    .maybeSingle()

  // Docs this month
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()

  const { count: docsThisMonth } = await admin
    .from("documents")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", conn.organization_id)
    .gte("created_at", monthStart)
    .lt("created_at", nextMonth)

  const { count: docsAllTime } = await admin
    .from("documents")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", conn.organization_id)

  const MONTHLY_QUOTA = 50
  const settings = (org?.settings as Record<string, unknown>) ?? {}
  const promptpayId    = (settings.promptpay_id as string)  ?? null
  const language       = (settings.language     as string)  ?? "th"
  const notifications  = (settings.notifications as Record<string, boolean>) ?? {
    bills: true, medications: true, trips: true, community: true,
  }

  return NextResponse.json({
    profile: {
      lineUserId,
      displayName: conn.display_name ?? "",
      pictureUrl: conn.picture_url ?? null,
      organizationId: conn.organization_id,
      organizationName: org?.name ?? "",
      connectedAt: conn.created_at,
    },
    usage: {
      docsThisMonth: docsThisMonth ?? 0,
      docsAllTime: docsAllTime ?? 0,
      monthlyQuota: MONTHLY_QUOTA,
    },
    settings: {
      promptpayId,
      language,
      notifications,
    },
    plan: {
      name: "Free",
      monthlyQuota: MONTHLY_QUOTA,
      features: [
        "อัปโหลดสลิป 50 ใบ/เดือน",
        "หารบิล",
        "สร้างทริป",
      ],
    },
  })
}

// PATCH /api/liff/profile — update settings
export async function PATCH(req: NextRequest) {
  const body = await req.json() as {
    lineUserId: string
    promptpayId?: string
    language?: string
    displayName?: string
    pictureUrl?: string
    notifications?: {
      bills?: boolean
      medications?: boolean
      trips?: boolean
      community?: boolean
    }
  }
  const { promptpayId, language, displayName, pictureUrl, notifications } = body
  const lineUserId = getVerifiedLineUserId(req, body.lineUserId)
  if (!lineUserId) return liffUnauthorized("LINE identity mismatch")

  if (!lineUserId) return NextResponse.json({ error: "lineUserId required" }, { status: 400 })

  const admin = createAdminClient()
  const conn = await resolveConn(admin, lineUserId)
  if (!conn) return NextResponse.json({ needsConnect: true, error: "กรุณาเชื่อมบัญชี LINE ก่อน" }, { status: 403 })

  // Update display_name and/or picture_url from LIFF profile
  const lineUpdate: Record<string, string> = {}
  if (displayName) lineUpdate.display_name = displayName
  if (pictureUrl)  lineUpdate.picture_url  = pictureUrl
  if (Object.keys(lineUpdate).length) {
    await admin.from("line_connections").update(lineUpdate).eq("line_user_id", lineUserId)
  }

  if (promptpayId !== undefined || language !== undefined || notifications !== undefined) {
    const { data: org } = await admin
      .from("organizations")
      .select("settings")
      .eq("id", conn.organization_id)
      .maybeSingle()

    const currentSettings = (org?.settings as Record<string, unknown>) ?? {}
    const updates: Record<string, unknown> = { ...currentSettings }

    if (promptpayId !== undefined)  updates.promptpay_id  = promptpayId
    if (language    !== undefined)  updates.language      = language
    if (notifications !== undefined) {
      const current = (currentSettings.notifications as Record<string, boolean>) ?? {}
      updates.notifications = { ...current, ...notifications }
    }

    await admin
      .from("organizations")
      .update({ settings: updates })
      .eq("id", conn.organization_id)
  }

  return NextResponse.json({ ok: true })
}
