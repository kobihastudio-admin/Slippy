import { NextRequest, NextResponse } from "next/server"
import { createClient }       from "@/lib/supabase/server"
import { createAdminClient }  from "@/lib/supabase/admin"
import { isOrgMember }        from "@/lib/require-org-member"
import Anthropic              from "@anthropic-ai/sdk"

const anthropic = new Anthropic()

// GET — fetch insights (unread + all)
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const orgId  = req.nextUrl.searchParams.get("orgId")
  const unread = req.nextUrl.searchParams.get("unread") === "true"
  if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 })

  let q = supabase.from("life_insights")
    .select("id, insight_type, title, body, data, priority, is_read, created_at")
    .eq("organization_id", orgId)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(20)

  if (unread) q = q.eq("is_read", false)

  const { data: insights } = await q
  return NextResponse.json({ insights: insights ?? [] })
}

// POST — generate new insights using AI
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { orgId } = await req.json()
  if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 })
  if (!(await isOrgMember(user.id, orgId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const admin = createAdminClient()
  const since = new Date(Date.now() - 30 * 86400000).toISOString()

  // Gather data for insight generation
  const [eventsRes, merchantsRes, budgetRes] = await Promise.all([
    admin.from("life_events")
      .select("amount, category, doc_category, occurred_at")
      .eq("organization_id", orgId)
      .eq("event_type", "expense")
      .gte("occurred_at", since),

    admin.from("life_merchants")
      .select("name, category, visit_count, total_spent")
      .eq("organization_id", orgId)
      .order("visit_count", { ascending: false })
      .limit(5),

    admin.from("organizations")
      .select("metadata")
      .eq("id", orgId)
      .single(),
  ])

  const events    = eventsRes.data ?? []
  const merchants = merchantsRes.data ?? []
  const meta      = (budgetRes.data?.metadata as any) ?? {}
  const budgets   = meta?.budgets ?? {}
  const thisMonth = new Date().toISOString().slice(0, 7)
  const monthBudget = budgets[thisMonth] ?? {}

  // Aggregate spending
  const byCat: Record<string, number> = {}
  let totalSpent = 0
  for (const e of events) {
    const c = e.doc_category ?? "other"
    byCat[c] = (byCat[c] ?? 0) + Number(e.amount ?? 0)
    totalSpent += Number(e.amount ?? 0)
  }

  // Ask Claude to generate personalized insights
  const dataContext = JSON.stringify({
    period: "30 วันที่ผ่านมา",
    total_spent: totalSpent,
    by_category: byCat,
    top_merchants: merchants.slice(0, 3).map(m => ({ name: m.name, visits: m.visit_count, spent: m.total_spent })),
    budget: monthBudget,
    transaction_count: events.length,
  }, null, 2)

  let aiInsights: Array<{ type: string; title: string; body: string }> = []
  try {
    const res = await anthropic.messages.create({
      model:      "claude-haiku-4-5",
      max_tokens: 800,
      system: `คุณเป็น AI Life Assistant ที่วิเคราะห์พฤติกรรมทางการเงินของผู้ใช้
สร้าง 2-3 insights ที่มีประโยชน์และ actionable จากข้อมูลที่ให้มา
ตอบเป็น JSON array เท่านั้น รูปแบบ: [{"type":"spending|habit|anomaly|recommendation","title":"...","body":"..."}]
ใช้ภาษาไทย กระชับ น่าสนใจ มี emoji`,
      messages: [{ role: "user", content: `ข้อมูล: ${dataContext}` }],
    })
    const raw = (res.content[0] as any).text?.trim() ?? "[]"
    const cleaned = raw.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim()
    aiInsights = JSON.parse(cleaned)
  } catch (err) {
    console.warn("[insights] AI generation failed, using rule-based")
    // Rule-based fallback
    if (totalSpent > 0) {
      const topCat = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0]
      if (topCat) {
        aiInsights.push({
          type:  "spending",
          title: `💰 ใช้จ่ายรวม ฿${totalSpent.toLocaleString()} ใน 30 วัน`,
          body:  `หมวดที่ใช้มากสุด: ${topCat[0]} (฿${topCat[1].toLocaleString()})`,
        })
      }
    }
  }

  // Save insights to DB
  if (aiInsights.length > 0) {
    const now = new Date()
    const rows = aiInsights.map(ins => ({
      organization_id: orgId,
      insight_type:    ins.type ?? "spending",
      title:           ins.title,
      body:            ins.body,
      data:            { source: "ai", period_days: 30 },
      period_start:    since.slice(0, 10),
      period_end:      now.toISOString().slice(0, 10),
      priority:        1,
      expires_at:      new Date(now.getTime() + 7 * 86400000).toISOString(),
    }))
    await admin.from("life_insights").insert(rows)
  }

  return NextResponse.json({ ok: true, count: aiInsights.length })
}

// PATCH — mark insight as read
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { insightId, markAllRead, orgId } = await req.json()
  const admin = createAdminClient()

  if (markAllRead && orgId) {
    if (!(await isOrgMember(user.id, orgId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    await admin.from("life_insights").update({ is_read: true }).eq("organization_id", orgId)
  } else if (insightId) {
    // No orgId supplied for a single insight — look up which org it belongs
    // to and check membership before touching it, same as the batch branch.
    const { data: insight } = await admin.from("life_insights").select("organization_id").eq("id", insightId).single()
    if (!insight || !(await isOrgMember(user.id, insight.organization_id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    await admin.from("life_insights").update({ is_read: true }).eq("id", insightId)
  }
  return NextResponse.json({ ok: true })
}
