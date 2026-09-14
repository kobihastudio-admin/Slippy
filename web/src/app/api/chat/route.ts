/**
 * POST /api/chat
 * Slippy AI Life Assistant — powered by Claude + Life Graph
 *
 * Architecture (CLAUDE.md): AI Assistant queries Life Graph first,
 * then uses AI Memory as context for personalized responses.
 */
import { NextRequest, NextResponse } from "next/server"
import Anthropic           from "@anthropic-ai/sdk"
import { createClient }    from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { hasFeature }      from "@/lib/plans"

const client = new Anthropic()

const BASE_SYSTEM = `คุณคือ "Slippy AI Life Assistant" — AI ส่วนตัวที่รู้จักชีวิตทางการเงินของผู้ใช้อย่างลึกซึ้ง

## บทบาทหลัก
- ตอบคำถามเกี่ยวกับค่าใช้จ่าย ร้านค้า เอกสาร และพฤติกรรมการเงิน
- วิเคราะห์แพทเทิร์นการใช้จ่ายและให้คำแนะนำ
- ช่วยหาเอกสารและข้อมูลที่ต้องการ
- อธิบายและแนะนำการใช้งาน Slippy

## ข้อมูลระบบ Slippy
- อัปโหลดเอกสาร: drag & drop, LINE Bot, หรือ Ctrl+V
- รูปแบบ: PDF, JPG, PNG, HEIC (สูงสุด 20MB)
- LINE Bot: /connect CODE เพื่อเชื่อมต่อ
- ภาษี: VAT (ภ.พ.30) และ WHT (ภ.ง.ด.3/53)
- หารบิล: /split DOCID ใน LINE หรือผ่านหน้าเว็บ

## แนวทางการตอบ
- ตอบภาษาไทยเป็นหลัก กระชับ ชัดเจน เป็นกันเอง
- ถ้ามีข้อมูล Life Graph ให้อ้างอิงข้อมูลจริงของผู้ใช้
- ถ้าไม่มีข้อมูลให้แจ้งตรงๆ ว่ายังไม่มีในระบบ
- ใช้ markdown ได้ (bold, bullet, table)
- ถ้าไม่แน่ใจให้แนะนำ support@slippy.app`

// ── Build Life Graph context for AI ─────────────────────────────────────────
async function buildLifeContext(orgId: string): Promise<string> {
  const admin = createAdminClient()
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString()

  const [eventsRes, merchantsRes, memoriesRes, insightsRes] = await Promise.all([
    admin.from("life_events")
      .select("amount, doc_category, description, occurred_at, life_merchants(name)")
      .eq("organization_id", orgId)
      .eq("event_type", "expense")
      .gte("occurred_at", since30)
      .order("occurred_at", { ascending: false })
      .limit(20),

    admin.from("life_merchants")
      .select("name, category, visit_count, total_spent")
      .eq("organization_id", orgId)
      .order("total_spent", { ascending: false })
      .limit(5),

    admin.from("life_memories")
      .select("memory_type, key, value")
      .eq("organization_id", orgId)
      .limit(10),

    admin.from("life_insights")
      .select("title, body")
      .eq("organization_id", orgId)
      .eq("is_read", false)
      .limit(3),
  ])

  const events    = eventsRes.data ?? []
  const merchants = merchantsRes.data ?? []
  const memories  = memoriesRes.data ?? []
  const insights  = insightsRes.data ?? []

  if (!events.length && !merchants.length) return ""

  const totalSpent = events.reduce((s, e) => s + Number(e.amount ?? 0), 0)
  const byCat: Record<string, number> = {}
  for (const e of events) {
    const c = e.doc_category ?? "other"
    byCat[c] = (byCat[c] ?? 0) + Number(e.amount ?? 0)
  }

  let ctx = `\n\n## ข้อมูล Life Graph ของผู้ใช้ (ใช้ข้อมูลนี้ในการตอบ)\n`
  ctx += `**30 วันที่ผ่านมา:**\n`
  ctx += `- ค่าใช้จ่ายรวม: ฿${totalSpent.toLocaleString()}\n`
  ctx += `- จำนวนรายการ: ${events.length} รายการ\n`

  if (Object.keys(byCat).length) {
    ctx += `- แยกตามประเภท: ${Object.entries(byCat).sort((a,b) => b[1]-a[1]).slice(0,3).map(([c,a]) => `${c} ฿${a.toLocaleString()}`).join(", ")}\n`
  }

  if (merchants.length) {
    ctx += `\n**ร้านค้าที่ใช้บ่อย:**\n`
    for (const m of merchants.slice(0, 3)) {
      ctx += `- ${m.name}: ${m.visit_count} ครั้ง รวม ฿${Number(m.total_spent).toLocaleString()}\n`
    }
  }

  if (insights.length) {
    ctx += `\n**AI Insights ล่าสุด:**\n`
    for (const i of insights) {
      ctx += `- ${i.title}: ${i.body}\n`
    }
  }

  if (memories.length) {
    ctx += `\n**AI Memory:**\n`
    for (const m of memories.slice(0, 5)) {
      if (m.value && typeof m.value === "object") {
        const v = m.value as any
        if (v.name) ctx += `- ${m.memory_type}: ${v.name}\n`
      }
    }
  }

  return ctx
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      messages: Array<{ role: "user" | "assistant"; content: string }>
      orgId?:   string
    }

    const { messages, orgId } = body
    if (!messages?.length) return NextResponse.json({ error: "messages required" }, { status: 400 })
    if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 })

    // This endpoint used to only *optionally* attach Life Graph context when
    // a session existed, but called Claude regardless either way — meaning
    // anyone could POST here with no session at all and get free, unlimited
    // AI chat completions. Both checks below are required, not optional.
    //
    // Two auth paths: web sends the Supabase session via cookies; the iOS
    // app (ChatViewModel.swift) has no cookie jar shared with a browser, so
    // it sends `Authorization: Bearer <access_token>` instead (same pattern
    // as notifyDocumentSource() in Extensions.swift) — verified here via the
    // service-role client's getUser(token), which validates the JWT directly.
    const admin = createAdminClient()
    const bearer = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1]
    const user = bearer
      ? (await admin.auth.getUser(bearer)).data.user
      : (await (await createClient()).auth.getUser()).data.user
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: membership } = await admin
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("organization_id", orgId)
      .maybeSingle()
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const { data: org } = await admin
      .from("organizations")
      .select("plan")
      .eq("id", orgId)
      .single()
    if (!org || !hasFeature(org.plan, "aiAssistant")) {
      return NextResponse.json(
        { error: "AI Assistant ต้องอัปเกรดเป็นแผน Pro ขึ้นไป", upgradeRequired: true },
        { status: 403 }
      )
    }

    let lifeContext = ""
    try {
      lifeContext = await buildLifeContext(orgId)
    } catch {
      // Life Graph context is optional — chat still works without it
    }

    // Also search AI Memory for relevant context
    let memoryContext = ""
    if (orgId && messages.length > 0) {
      const lastUserMsg = [...messages].reverse().find(m => m.role === "user")?.content ?? ""
      try {
        const memRes = await fetch(`${process.env.INTERNAL_API_URL ?? "http://localhost:4000"}/life/memory-context`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-internal-key": process.env.INTERNAL_API_KEY ?? "" },
          body: JSON.stringify({ orgId, query: lastUserMsg }),
        })
        if (memRes.ok) memoryContext = (await memRes.json()).context ?? ""
      } catch { /* optional — non-blocking */ }
    }

    const systemWithContext = BASE_SYSTEM + lifeContext + memoryContext

    const response = await client.messages.create({
      model:      "claude-haiku-4-5",
      max_tokens: 800,
      system:     systemWithContext,
      messages,
    })

    const text = (response.content[0] as { text: string }).text

    // Extract and store memories from this conversation (background)
    if (orgId && messages.length > 0) {
      const lastUser = [...messages].reverse().find(m => m.role === "user")?.content ?? ""
      fetch(`${process.env.INTERNAL_API_URL ?? "http://localhost:4000"}/life/extract-memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-key": process.env.INTERNAL_API_KEY ?? "" },
        body: JSON.stringify({ orgId, userMessage: lastUser, aiResponse: text }),
      }).catch(() => {})
    }

    return NextResponse.json({ message: text })

  } catch (err: any) {
    console.error("[chat] error:", err.message)
    return NextResponse.json(
      { message: "ขอโทษครับ ระบบขัดข้องชั่วคราว กรุณาลองใหม่หรือติดต่อ support@slippy.app" },
      { status: 200 }
    )
  }
}
