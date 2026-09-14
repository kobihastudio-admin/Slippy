/**
 * LINE Split Bill Service
 * Handles /split, /claim, /splitdone, /splitstatus commands
 */

import { supabase } from "../lib/supabase"
import { getAppUrl } from "../lib/app-url"

const APP_URL = getAppUrl()

function fmtTHB(n: number | null | undefined): string {
  if (!n) return "฿0.00"
  return "฿" + Number(n).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ─── Flex: show line items to claim ──────────────────────────────────────────
export function splitItemsCard(params: {
  splitBillId:  string
  docIdShort:   string
  vendorName:   string
  items:        Array<{ id: string; description: string; amount: number; claimed?: string | null }>
  vatAmount:    number
  totalAmount:  number
  shareUrl:     string
}): object {
  const { splitBillId, docIdShort, vendorName, items, vatAmount, totalAmount, shareUrl } = params
  const claimed  = items.filter(i => i.claimed)
  const unclaimed = items.filter(i => !i.claimed)

  const itemRows: object[] = items.map((item, idx) => ({
    type: "box", layout: "horizontal", paddingTop: "8px",
    contents: [
      {
        type: "box", layout: "vertical", flex: 5,
        contents: [
          { type: "text", text: item.description || `รายการ ${idx + 1}`, size: "xs", color: "#111827", wrap: true },
          ...(item.claimed ? [{ type: "text", text: `✓ ${item.claimed}`, size: "xxs", color: "#10b981" }] : [])
        ]
      },
      { type: "text", text: fmtTHB(item.amount), size: "xs", color: "#374151", align: "end", flex: 2 },
      ...(item.claimed ? [] : [{
        type: "button", style: "primary", height: "sm", flex: 2,
        color: "#6366f1",
        action: {
          type: "message",
          label: "ฉันจ่าย",
          text: `/claim ${splitBillId.slice(0,8)} ${idx}`,
        }
      } as object])
    ]
  }))

  return {
    type: "flex",
    altText: `🧾 หารบิล: ${vendorName}`,
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", paddingAll: "0px",
        background: { type: "linearGradient", angle: "135deg", startColor: "#0f172a", endColor: "#1e293b" },
        contents: [{
          type: "box", layout: "horizontal", paddingAll: "16px",
          contents: [
            {
              type: "box", layout: "vertical", flex: 1,
              contents: [
                { type: "text", text: "🔀 หารบิล", size: "xs", color: "rgba(255,255,255,0.6)", weight: "bold", letterSpacing: "2px" },
                { type: "text", text: vendorName, size: "lg", color: "#fff", weight: "bold", wrap: true, margin: "xs" },
              ]
            },
            {
              type: "box", layout: "vertical", justifyContent: "center",
              contents: [
                { type: "text", text: fmtTHB(totalAmount), size: "xl", color: "#fff", weight: "bold", align: "end" },
                { type: "text", text: "ยอดรวม", size: "xxs", color: "rgba(255,255,255,0.5)", align: "end" },
              ]
            }
          ]
        }]
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "14px", spacing: "none",
        contents: [
          // Progress
          {
            type: "box", layout: "horizontal", marginBottom: "10px",
            contents: [
              { type: "text", text: `เลือกแล้ว ${claimed.length}/${items.length} รายการ`, size: "xs", color: "#6b7280" },
              { type: "text", text: `เหลือ ${unclaimed.length}`, size: "xs", color: unclaimed.length > 0 ? "#f59e0b" : "#10b981", weight: "bold", align: "end" },
            ]
          },
          // Progress bar
          {
            type: "box", layout: "vertical", height: "4px", backgroundColor: "#f3f4f6",
            cornerRadius: "2px", margin: "none",
            contents: [{
              type: "box", layout: "vertical", height: "4px", backgroundColor: "#6366f1",
              cornerRadius: "2px",
              contents: [],
              flex: Math.round((claimed.length / Math.max(items.length, 1)) * 100),
            }]
          },
          { type: "separator", margin: "md", color: "#f3f4f6" },
          // Items
          ...itemRows,
          // VAT
          ...(vatAmount > 0 ? [
            { type: "separator", margin: "md", color: "#f3f4f6" } as object,
            {
              type: "box", layout: "horizontal", paddingTop: "8px",
              contents: [
                { type: "text", text: "VAT (ตามสัดส่วน)", size: "xs", color: "#9ca3af", flex: 5 },
                { type: "text", text: fmtTHB(vatAmount), size: "xs", color: "#9ca3af", align: "end", flex: 4 },
              ]
            } as object
          ] : []),
        ]
      },
      footer: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "12px", backgroundColor: "#f9fafb",
        contents: [
          {
            type: "box", layout: "horizontal", spacing: "sm",
            contents: [
              {
                type: "button", style: "primary", height: "sm", flex: 1, color: "#10b981",
                action: { type: "message", label: "📊 สรุป", text: `/splitstatus ${splitBillId.slice(0,8)}` }
              },
              {
                type: "button", style: "secondary", height: "sm", flex: 1,
                action: { type: "uri", label: "🌐 เปิดเว็บ", uri: shareUrl }
              }
            ]
          },
          {
            type: "button", style: "secondary", height: "sm",
            action: { type: "message", label: "✅ ปิดบิล (สรุปยอด)", text: `/splitdone ${splitBillId.slice(0,8)}` }
          }
        ]
      }
    }
  }
}

// ─── Flex: summary of who pays what ──────────────────────────────────────────
export function splitSummaryCard(params: {
  vendorName:  string
  totalAmount: number
  vatAmount:   number
  summary:     Array<{ name: string; items: string[]; subtotal: number; vat: number; total: number }>
  unclaimed:   string[]
  shareUrl:    string
  done:        boolean
}): object {
  const { vendorName, totalAmount, vatAmount, summary, unclaimed, shareUrl, done } = params

  const summaryRows: object[] = summary.map(p => ({
    type: "box", layout: "vertical", paddingAll: "12px",
    backgroundColor: "#f9fafb", cornerRadius: "10px", margin: "sm",
    contents: [
      {
        type: "box", layout: "horizontal",
        contents: [
          { type: "text", text: p.name, size: "sm", color: "#111827", weight: "bold", flex: 1 },
          { type: "text", text: fmtTHB(p.total), size: "md", color: "#6366f1", weight: "bold", align: "end" },
        ]
      },
      { type: "text", text: p.items.join(", "), size: "xxs", color: "#9ca3af", wrap: true, margin: "xs" },
      ...(vatAmount > 0 ? [{ type: "text", text: `รวม VAT ${fmtTHB(p.vat)}`, size: "xxs", color: "#9ca3af", margin: "xs" }] : [])
    ]
  }))

  return {
    type: "flex",
    altText: `💰 สรุปการหารบิล: ${vendorName}`,
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", paddingAll: "0px",
        background: { type: "linearGradient", angle: "135deg", startColor: done ? "#059669" : "#6366f1", endColor: done ? "#047857" : "#4f46e5" },
        contents: [{
          type: "box", layout: "vertical", paddingAll: "18px", alignItems: "center",
          contents: [
            { type: "text", text: done ? "✅ สรุปการหารบิล" : "📊 สถานะการหารบิล", color: "#fff", weight: "bold", size: "md" },
            { type: "text", text: vendorName, color: "rgba(255,255,255,0.8)", size: "xs", margin: "xs" },
          ]
        }]
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "14px", spacing: "none",
        contents: [
          // Total
          {
            type: "box", layout: "horizontal", paddingBottom: "12px",
            contents: [
              { type: "text", text: "ยอดรวมทั้งบิล", size: "sm", color: "#6b7280" },
              { type: "text", text: fmtTHB(totalAmount), size: "sm", color: "#111827", weight: "bold", align: "end" },
            ]
          },
          { type: "separator", color: "#e5e7eb" },
          ...summaryRows,
          // Unclaimed
          ...(unclaimed.length > 0 ? [
            { type: "separator", color: "#e5e7eb", margin: "md" } as object,
            {
              type: "box", layout: "vertical", paddingAll: "10px",
              backgroundColor: "#fef3c7", cornerRadius: "8px", margin: "sm",
              contents: [
                { type: "text", text: `⚠️ ยังไม่มีคนเลือก ${unclaimed.length} รายการ`, size: "xs", color: "#92400e", weight: "bold" },
                { type: "text", text: unclaimed.join(", "), size: "xxs", color: "#b45309", wrap: true, margin: "xs" },
              ]
            } as object
          ] : [])
        ]
      },
      footer: {
        type: "box", layout: "vertical", paddingAll: "12px", backgroundColor: "#f9fafb",
        contents: [{
          type: "button", style: "secondary", height: "sm",
          action: { type: "uri", label: "🌐 เปิดหน้าหารบิล", uri: shareUrl }
        }]
      }
    }
  }
}

// ─── Handle /split command ────────────────────────────────────────────────────
export async function handleSplitCommand(
  docIdPrefix: string,
  orgId:       string,
  lineUserId:  string,
  displayName: string,
): Promise<{ card?: object; text?: string }> {

  // Find document
  const { data: docs } = await supabase
    .from("documents")
    .select("id, vendor_name, total_amount, vat_amount, status")
    .eq("organization_id", orgId)
    .ilike("id", `${docIdPrefix}%`)
    .in("status", ["reviewing","approved","pushed"])
    .limit(1)

  const doc = docs?.[0]
  if (!doc) return { text: `❌ ไม่พบเอกสาร "${docIdPrefix}" หรือยังไม่ได้อ่านข้อมูล\n\nลอง /status เพื่อดูรายการเอกสาร` }

  // Get line items
  const { data: lineItems } = await supabase
    .from("document_line_items")
    .select("id, description, amount")
    .eq("document_id", doc.id)
    .order("sort_order")

  if (!lineItems?.length) {
    return { text: `❌ เอกสาร "${doc.vendor_name}" ไม่มีรายการสินค้า\nไม่สามารถหารบิลได้` }
  }

  // Create split bill
  const { data: bill } = await supabase
    .from("split_bills")
    .insert({
      organization_id: orgId,
      creator_id:      lineUserId,  // store LINE userId as creator
      document_id:     doc.id,
      title:           doc.vendor_name ?? "บิลจาก LINE",
      total_amount:    doc.total_amount ?? 0,
      vat_amount:      doc.vat_amount ?? 0,
      status:          "open",
    })
    .select("id, share_token")
    .single()

  if (!bill) return { text: "❌ สร้างบิลหารไม่สำเร็จ กรุณาลองใหม่" }

  // Auto-add creator as first participant
  await supabase.from("split_participants").insert({
    split_bill_id:   bill.id,
    name:            displayName,
    line_user_id:    lineUserId,
    line_display:    displayName,
    amount:          0,
  })

  const shareUrl = `${APP_URL}/split/join/${bill.share_token}`
  const items = lineItems.map(i => ({ ...i, claimed: null }))

  return {
    card: splitItemsCard({
      splitBillId:  bill.id,
      docIdShort:   doc.id.slice(0, 8),
      vendorName:   doc.vendor_name ?? "บิล",
      items,
      vatAmount:    Number(doc.vat_amount ?? 0),
      totalAmount:  Number(doc.total_amount ?? 0),
      shareUrl,
    })
  }
}

// ─── Handle /claim command ────────────────────────────────────────────────────
export async function handleClaimCommand(
  billIdPrefix: string,
  itemIndex:    number,
  lineUserId:   string,
  displayName:  string,
): Promise<{ card?: object; text?: string }> {

  // Find bill
  const { data: bills } = await supabase
    .from("split_bills")
    .select("id, title, total_amount, vat_amount, share_token, status")
    .ilike("id", `${billIdPrefix}%`)
    .eq("status", "open")
    .limit(1)

  const bill = bills?.[0]
  if (!bill) return { text: "❌ ไม่พบบิลนี้ หรือบิลปิดแล้ว" }

  // Get items
  const { data: docBill } = await supabase
    .from("split_bills").select("document_id").eq("id", bill.id).single()

  const { data: lineItems } = await supabase
    .from("document_line_items")
    .select("id, description, amount")
    .eq("document_id", docBill?.document_id ?? "")
    .order("sort_order")

  if (!lineItems?.[itemIndex]) return { text: "❌ ไม่พบรายการนี้" }
  const item = lineItems[itemIndex]

  // Ensure participant exists
  const { data: existingPart } = await supabase
    .from("split_participants")
    .select("id").eq("split_bill_id", bill.id).eq("line_user_id", lineUserId).single()

  let participantId = existingPart?.id
  if (!participantId) {
    const { data: newPart } = await supabase
      .from("split_participants")
      .insert({ split_bill_id: bill.id, name: displayName, line_user_id: lineUserId, line_display: displayName, amount: 0 })
      .select("id").single()
    participantId = newPart?.id
  }

  // Claim item (upsert)
  const { error } = await supabase.from("split_item_claims").upsert({
    split_bill_id:   bill.id,
    line_item_id:    item.id,
    participant_id:  participantId,
    claimer_name:    displayName,
    claimer_line_id: lineUserId,
  }, { onConflict: "split_bill_id,line_item_id" })

  if (error) return { text: `❌ เกิดข้อผิดพลาด: ${error.message}` }

  // Fetch updated state
  const { data: claims } = await supabase
    .from("split_item_claims")
    .select("line_item_id, claimer_name")
    .eq("split_bill_id", bill.id)

  const claimMap = new Map<string, string>()
  for (const c of claims ?? []) claimMap.set(c.line_item_id, c.claimer_name)

  const items = lineItems.map(i => ({ ...i, claimed: claimMap.get(i.id) ?? null }))
  const shareUrl = `${APP_URL}/split/join/${bill.share_token}`

  return {
    card: splitItemsCard({
      splitBillId: bill.id,
      docIdShort:  bill.id.slice(0, 8),
      vendorName:  bill.title,
      items,
      vatAmount:   Number(bill.vat_amount ?? 0),
      totalAmount: Number(bill.total_amount ?? 0),
      shareUrl,
    })
  }
}

// ─── Handle /splitstatus or /splitdone ───────────────────────────────────────
export async function handleSplitStatus(
  billIdPrefix: string,
  finalize:     boolean,
): Promise<{ card?: object; text?: string }> {

  const { data: bills } = await supabase
    .from("split_bills")
    .select("id, title, total_amount, vat_amount, share_token, status")
    .ilike("id", `${billIdPrefix}%`)
    .limit(1)

  const bill = bills?.[0]
  if (!bill) return { text: "❌ ไม่พบบิลนี้" }

  const { data: docBill } = await supabase
    .from("split_bills").select("document_id").eq("id", bill.id).single()

  const { data: lineItems } = await supabase
    .from("document_line_items")
    .select("id, description, amount")
    .eq("document_id", docBill?.document_id ?? "")
    .order("sort_order")

  const { data: claims } = await supabase
    .from("split_item_claims")
    .select("line_item_id, claimer_name, claimer_line_id")
    .eq("split_bill_id", bill.id)

  const claimMap = new Map<string, { name: string; lineId: string }>()
  for (const c of claims ?? []) {
    claimMap.set(c.line_item_id, { name: c.claimer_name, lineId: c.claimer_line_id })
  }

  // Build per-person summary
  const personMap = new Map<string, { name: string; items: string[]; subtotal: number }>()
  const unclaimed: string[] = []
  const vatRate    = Number(bill.total_amount ?? 0) > 0
    ? Number(bill.vat_amount ?? 0) / Number(bill.total_amount ?? 1) : 0

  for (const item of lineItems ?? []) {
    const claim = claimMap.get(item.id)
    if (!claim) { unclaimed.push(item.description ?? `รายการ ${item.id.slice(0,4)}`); continue }
    const key = claim.lineId ?? claim.name
    const cur = personMap.get(key) ?? { name: claim.name, items: [], subtotal: 0 }
    cur.items.push(item.description ?? "รายการ")
    cur.subtotal += Number(item.amount ?? 0)
    personMap.set(key, cur)
  }

  const summary = Array.from(personMap.values()).map(p => ({
    ...p,
    vat:   p.subtotal * vatRate,
    total: p.subtotal * (1 + vatRate),
  }))

  // Update participant amounts
  for (const [key, p] of personMap.entries()) {
    await supabase.from("split_participants")
      .update({ amount: p.subtotal * (1 + vatRate) })
      .eq("split_bill_id", bill.id)
      .eq("line_user_id", key)
  }

  if (finalize) {
    await supabase.from("split_bills").update({ status: "finalized" }).eq("id", bill.id)
  }

  const shareUrl = `${APP_URL}/split/join/${bill.share_token}`
  return {
    card: splitSummaryCard({
      vendorName:  bill.title,
      totalAmount: Number(bill.total_amount ?? 0),
      vatAmount:   Number(bill.vat_amount ?? 0),
      summary,
      unclaimed,
      shareUrl,
      done: finalize,
    })
  }
}
