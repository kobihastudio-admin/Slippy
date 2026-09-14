/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { createClient }  from "@/lib/supabase/server"
import { getMembership } from "@/lib/get-membership"
import { DashboardView }  from "@/components/dashboard/dashboard-view"
import type { HubDoc }    from "@/components/dashboard/recent-documents-panel"

/**
 * Time-of-day greeting. Computed in Asia/Bangkok on the server so it stays
 * stable between SSR and hydration (a client-side `new Date()` would depend on
 * the viewer's timezone and could mismatch the server render).
 */
function greetingFor(date: Date): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Bangkok",
  }).format(date))
  if (hour >= 5  && hour < 11) return "สวัสดีตอนเช้า"
  if (hour >= 11 && hour < 13) return "สวัสดีตอนเที่ยง"
  if (hour >= 13 && hour < 17) return "สวัสดีตอนบ่าย"
  if (hour >= 17 && hour < 20) return "สวัสดีตอนเย็น"
  return "สวัสดีตอนค่ำ"
}

/** Shape rows coming from Supabase into the panel's view model. */
type RawDoc = {
  id: string
  vendor_name?:      string | null
  doc_number?:       string | null
  file_type?:        string | null
  doc_type?:         string | null
  expense_category?: string | null
  doc_date?:         string | null
  created_at?:       string | null
  total_amount?:     number | null
  status?:           string | null
  source?:           string | null
}
function toHubDoc(d: RawDoc): HubDoc {
  return {
    id:              d.id,
    vendorName:      d.vendor_name      ?? null,
    docNumber:       d.doc_number       ?? null,
    fileType:        d.file_type        ?? null,
    docType:         d.doc_type         ?? null,
    expenseCategory: d.expense_category ?? null,
    docDate:         d.doc_date         ?? null,
    createdAt:       d.created_at       ?? null,
    totalAmount:     d.total_amount     ?? null,
    status:          d.status           ?? "pending",
    source:          d.source           ?? "web",
  }
}

const DOC_SELECT =
  "id, vendor_name, doc_number, file_type, doc_type, expense_category, doc_date, created_at, total_amount, status, source"

// ── Page ───────────────────────────────────────────────────────────────────────
export default async function DashboardPage() {
  const supabase = await createClient()

  const { organization_id: orgId } = await getMembership()

  const { data: { user } } = await supabase.auth.getUser()
  const userId = user?.id ?? ""

  const { data: org } = await supabase
    .from("organizations")
    .select("name, doc_used, doc_quota, plan, slug")
    .eq("id", orgId)
    .single()

  // NOTE: the Life Graph widgets (Life Score spider chart, AI insights, top
  // merchants) are intentionally not on the dashboard yet — parked until the
  // revenue features are in place. components/dashboard/life-radar-card.tsx is
  // still in the repo, so bringing them back is a re-import, not a rewrite.

  const { data: profile } = await supabase
    .from("users")
    .select("full_name")
    .eq("id", userId)
    .single()

  const displayName =
    profile?.full_name?.trim()
    || (user?.user_metadata?.full_name as string | undefined)?.trim()
    || (user?.user_metadata?.name as string | undefined)?.trim()
    || user?.email?.split("@")[0]
    || "เพื่อน Slippy"

  const now        = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const prevStart  = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()

  const [
    { count: totalDocs },
    { count: pendingDocs },
    { count: failedDocs },
    { count: receiptDocs },
    { count: invoiceDocs },
    { count: creditNoteDocs },
    { count: tripCount },
    { data: monthlyExpense },
    { data: prevMonthExpense },
    { data: recentDocs },
    { data: myDocs },
    { data: sharedRows },
    { data: notifications },
    { data: categories },
    { data: categoryRows },
  ] = await Promise.all([
    supabase.from("documents").select("id", { count: "exact", head: true })
      .eq("organization_id", orgId),
    supabase.from("documents").select("id", { count: "exact", head: true })
      .eq("organization_id", orgId).eq("status", "reviewing"),
    supabase.from("documents").select("id", { count: "exact", head: true })
      .eq("organization_id", orgId).eq("status", "failed"),
    supabase.from("documents").select("id", { count: "exact", head: true })
      .eq("organization_id", orgId).in("doc_type", ["receipt", "expense"]),
    supabase.from("documents").select("id", { count: "exact", head: true })
      .eq("organization_id", orgId).in("doc_type", ["invoice", "tax_invoice"]),
    supabase.from("documents").select("id", { count: "exact", head: true })
      .eq("organization_id", orgId).eq("doc_type", "credit_note"),
    supabase.from("life_journeys").select("id", { count: "exact", head: true })
      .eq("organization_id", orgId),
    supabase.from("documents").select("total_amount, vat_amount, expense_category")
      .eq("organization_id", orgId).in("status", ["approved", "pushed"])
      .gte("created_at", monthStart),
    supabase.from("documents").select("total_amount")
      .eq("organization_id", orgId).in("status", ["approved", "pushed"])
      .gte("created_at", prevStart).lt("created_at", monthStart),
    supabase.from("documents").select(DOC_SELECT)
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase.from("documents").select(DOC_SELECT)
      .eq("organization_id", orgId).eq("uploaded_by", userId)
      .order("created_at", { ascending: false })
      .limit(8),
    // Per-document shares — an extra grant beyond org membership
    // (see supabase/migrations/078_document_tags_and_shares.sql)
    supabase.from("document_shares")
      .select(`created_at, documents(${DOC_SELECT})`)
      .eq("shared_with_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase.from("notifications")
      .select("id, type, title, body, read_at, created_at")
      .or(`user_id.eq.${userId},organization_id.eq.${orgId}`)
      .order("created_at", { ascending: false })
      .limit(6),
    // Org-managed category list (068_document_categories.sql)
    supabase.from("document_categories")
      .select("id, name, sort_order")
      .eq("organization_id", orgId)
      .order("sort_order", { ascending: true })
      .limit(12),
    // expense_category of every document, counted in-process for the folder cards
    // (069_expense_category_column.sql — the org's own taxonomy, not the AI one)
    supabase.from("documents").select("expense_category")
      .eq("organization_id", orgId)
      .not("expense_category", "is", null)
      .limit(5000),
  ])

  // ── Derived values ────────────────────────────────────────────────────────────
  const totalExpense = monthlyExpense?.reduce((s, d) => s + (d.total_amount ?? 0), 0) ?? 0
  const totalVat     = monthlyExpense?.reduce((s, d) => s + (d.vat_amount   ?? 0), 0) ?? 0
  const prevExpense  = prevMonthExpense?.reduce((s, d) => s + (d.total_amount ?? 0), 0) ?? 0

  // Spend split by the org's own expense categories, this month, top 4.
  const byCategory = Object.entries(
    (monthlyExpense ?? []).reduce<Record<string, number>>((acc, d) => {
      const key = d.expense_category?.trim() || "ไม่ได้จัดหมวดหมู่"
      acc[key] = (acc[key] ?? 0) + (d.total_amount ?? 0)
      return acc
    }, {}),
  ).sort((a, b) => b[1] - a[1]).slice(0, 4) as [string, number][]

  // Folder cards: the org's category list, with how many documents sit in each.
  const categoryCount = (categoryRows ?? []).reduce<Record<string, number>>((acc, r) => {
    const key = (r.expense_category ?? "").trim()
    if (key) acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
  const folders = (categories ?? [])
    .map(c => ({ id: c.id as string, name: c.name as string, count: categoryCount[c.name] ?? 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  const shared: HubDoc[] = (sharedRows ?? [])
    .map(r => (Array.isArray(r.documents) ? r.documents[0] : r.documents) as RawDoc | null)
    .filter((d): d is RawDoc => Boolean(d?.id))
    .map(toHubDoc)

  return (
    <DashboardView
      greeting={greetingFor(now)}
      displayName={displayName}
      orgId={orgId}
      orgSlug={org?.slug ?? ""}
      org={org ? {
        name:     org.name,
        plan:     org.plan,
        docUsed:  org.doc_used  ?? 0,
        docQuota: org.doc_quota ?? 50,
      } : null}
      counts={{
        total:      totalDocs      ?? 0,
        receipt:    receiptDocs    ?? 0,
        invoice:    invoiceDocs    ?? 0,
        creditNote: creditNoteDocs ?? 0,
        trips:      tripCount      ?? 0,
        pending:    pendingDocs    ?? 0,
        failed:     failedDocs     ?? 0,
      }}
      docs={{
        recent: (recentDocs ?? []).map(toHubDoc),
        mine:   (myDocs     ?? []).map(toHubDoc),
        shared,
      }}
      folders={folders}
      spend={{
        thisMonth: totalExpense,
        prevMonth: prevExpense,
        vat:       totalVat,
        docCount:  monthlyExpense?.length ?? 0,
        byCategory,
      }}
      notifications={notifications ?? []}
    />
  )
}
