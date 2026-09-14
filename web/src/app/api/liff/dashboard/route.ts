import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

async function resolveConnection(admin: ReturnType<typeof createAdminClient>, lineUserId: string) {
  const { data } = await admin.from("line_connections")
    .select("user_id, organization_id")
    .eq("line_user_id", lineUserId)
    .maybeSingle()
  return data
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return "เมื่อกี้"
  if (m < 60) return `${m} นาทีที่แล้ว`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ชม.ที่แล้ว`
  const d = Math.floor(h / 24)
  return d === 1 ? "เมื่อวาน" : `${d} วันที่แล้ว`
}

// GET /api/liff/dashboard?lineUserId=Uxxx — full dashboard data for LIFF
export async function GET(req: NextRequest) {
  const lineUserId = req.nextUrl.searchParams.get("lineUserId")
  if (!lineUserId) return NextResponse.json({ error: "lineUserId required" }, { status: 400 })

  const admin = createAdminClient()
  const conn  = await resolveConnection(admin, lineUserId)
  if (!conn) return NextResponse.json({ needsConnect: true, error: "ยังไม่ได้เชื่อมบัญชี LINE" }, { status: 404 })

  const orgId   = conn.organization_id
  const now     = new Date()
  const month0  = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const today   = now.toISOString().slice(0, 10)
  const tomorrow = new Date(now.getTime() + 86400000).toISOString().slice(0, 10)

  // 6-month expense trend
  const months6 = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)
    return { start: d.toISOString(), label: `${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}` }
  })

  const [
    { count: totalDocs },
    { count: pendingDocs },
    { data: monthlyExpense },
    { data: recentDocs },
    { data: notifications },
    { data: lifeScore },
    { data: openBills },
    { data: trips },
    { data: todayMeds },
    { data: recentScans },
    { data: sixMonthDocs },
  ] = await Promise.all([
    admin.from("documents").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    admin.from("documents").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "reviewing"),
    admin.from("documents").select("total_amount, vendor_name")
      .eq("organization_id", orgId).in("status", ["approved", "pushed"]).gte("created_at", month0),
    admin.from("documents")
      .select("id, vendor_name, total_amount, status, doc_date, created_at")
      .eq("organization_id", orgId).order("created_at", { ascending: false }).limit(5),
    admin.from("notifications")
      .select("id, type, title, body, read_at, created_at")
      .or(`user_id.eq.${conn.user_id},organization_id.eq.${orgId}`)
      .order("created_at", { ascending: false }).limit(5),
    admin.from("life_score_snapshots")
      .select("wealth_score, lifestyle_score, journey_score, social_score, overall_score")
      .eq("organization_id", orgId).order("snapshot_date", { ascending: false }).limit(1).maybeSingle(),
    // Open split bills the user is participant in
    admin.from("split_participants")
      .select("split_bill_id, amount, paid_at, split_bills!inner(id, title, total_amount, status, category)")
      .eq("line_user_id", lineUserId)
      .eq("split_bills.status", "open")
      .is("paid_at", null),
    // Upcoming trips
    admin.from("split_bills")
      .select("id, title, total_amount, status, created_at, split_participants(count)")
      .eq("organization_id", orgId).eq("category", "trip").eq("status", "open")
      .order("created_at", { ascending: false }).limit(3),
    // Today's medications (pending logs)
    admin.from("medication_logs")
      .select("id, status, scheduled_at, medications(name)")
      .eq("user_id", conn.user_id)
      .gte("scheduled_at", today).lt("scheduled_at", tomorrow)
      .eq("status", "pending").limit(5),
    // Recent scans
    admin.from("scan_uploads")
      .select("id, receipt_url, status, created_at")
      .eq("organization_id", orgId).neq("status", "dismissed")
      .order("created_at", { ascending: false }).limit(3),
    // 6-month document totals for trend chart
    admin.from("documents")
      .select("total_amount, created_at")
      .eq("organization_id", orgId)
      .in("status", ["approved", "pushed"])
      .gte("created_at", months6[0].start),
  ])

  const monthlyTotal = monthlyExpense?.reduce((s, d) => s + (Number(d.total_amount) ?? 0), 0) ?? 0

  // Compute 6-month bar chart data
  const barData = months6.map(({ start, label }, i) => {
    const end = months6[i + 1]?.start ?? now.toISOString()
    const total = (sixMonthDocs ?? [])
      .filter(d => d.created_at >= start && d.created_at < end)
      .reduce((s, d) => s + (Number(d.total_amount) ?? 0), 0)
    return { label, total: Math.round(total) }
  })

  // Category donut from monthly expense
  const catMap: Record<string, number> = {}
  ;(monthlyExpense ?? []).forEach(d => {
    const v = d.vendor_name ?? "อื่นๆ"
    catMap[v] = (catMap[v] ?? 0) + (Number(d.total_amount) ?? 0)
  })
  const donutData = Object.entries(catMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, value]) => ({ name, value: Math.round(value) }))

  // Open bills summary
  const unpaidBillsCount = openBills?.length ?? 0
  const unpaidTotal = (openBills ?? []).reduce((s, p) => s + (Number((p as any).amount) ?? 0), 0)

  return NextResponse.json({
    totalDocs:    totalDocs ?? 0,
    pendingDocs:  pendingDocs ?? 0,
    monthlyCount: monthlyExpense?.length ?? 0,
    monthlyTotal,
    recentDocs: (recentDocs ?? []).map(d => ({
      id: d.id, vendorName: d.vendor_name, totalAmount: d.total_amount,
      status: d.status, docDate: d.doc_date, createdAt: d.created_at,
    })),
    notifications: (notifications ?? []).map(n => ({
      id: n.id, type: n.type, title: n.title, body: n.body,
      read: !!n.read_at, relTime: relTime(n.created_at),
    })),
    lifeScore: lifeScore ?? null,
    // New fields
    unpaidBillsCount,
    unpaidTotal: Math.round(unpaidTotal * 100) / 100,
    upcomingTrips: (trips ?? []).map(t => ({
      id: t.id, title: t.title, memberCount: (t as any).split_participants?.[0]?.count ?? 0,
    })),
    todayMedCount: todayMeds?.length ?? 0,
    todayMeds: (todayMeds ?? []).map((m: any) => ({ id: m.id, name: m.medications?.name, scheduledAt: m.scheduled_at })),
    recentScans:  (recentScans ?? []).map(s => ({ id: s.id, url: s.receipt_url, status: s.status, createdAt: s.created_at })),
    barData,
    donutData,
  })
}
