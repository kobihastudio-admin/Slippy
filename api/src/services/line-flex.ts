/**
 * LINE Flex Message builders for Slippy Bot — Modern Design
 */
import { getAppUrl } from "../lib/app-url"

// ⚠️ Single source of truth for the public app URL used inside Flex Messages.
// `slippy.ai` is currently DNS-parked at Namecheap (NOT pointing at Vercel) —
// tapping a hardcoded "https://slippy.ai/..." link lands on the registrar's
// parking page, which injects ad/redirect chains (incl. fake Facebook-login
// phishing pages users have reported seeing). Always resolve through APP_URL
// (falls back to the stable Vercel alias) — never hardcode "slippy.ai" below.
const APP_URL = getAppUrl("https://slippy-solutionxteams-projects.vercel.app")
const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID

// "เปิด Slippy App" / "ตรวจสอบในแอป" buttons should land users on a page that's
// already signed in — not the public landing/login page (which then needs an
// email/password form on a phone). Inside LINE the user is ALREADY signed into
// LINE, so route through the LINE-only login gate at `/liff/home`, which mints
// a Slippy session in one tap and forwards into `destPath`.
// See web/src/app/liff/home/page.tsx + web/src/lib/liff.ts → makeLiffGateUrl()
// (kept in sync with api/src/scripts/setup-rich-menu.ts → liffGate()).
function liffGate(destPath: string): string {
  const qs = `?next=${encodeURIComponent(destPath)}`
  if (LIFF_ID) return `https://liff.line.me/${LIFF_ID}/liff/home${qs}`
  return `${APP_URL}${destPath}`   // fallback if LIFF isn't configured
}

const STATUS_TH: Record<string, string> = {
  pending:    "รอดำเนินการ", processing: "กำลังประมวลผล", reviewing: "รอตรวจสอบ",
  approved:   "อนุมัติแล้ว", pushed:     "ส่งเข้าบัญชีแล้ว",
  failed:     "ล้มเหลว",    rejected:   "ปฏิเสธ",
}

// Gradient headers per status
const STATUS_GRAD: Record<string, [string, string]> = {
  reviewing:  ["#f59e0b", "#d97706"],
  approved:   ["#10b981", "#059669"],
  pushed:     ["#6366f1", "#4f46e5"],
  failed:     ["#ef4444", "#dc2626"],
  rejected:   ["#6b7280", "#4b5563"],
  pending:    ["#8b5cf6", "#7c3aed"],
  processing: ["#3b82f6", "#2563eb"],
}

function fmtTHB(n: number | null | undefined): string {
  if (n == null) return "—"
  return "฿" + Number(n).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function gradHeader(title: string, subtitle: string, status: string): object {
  const [c1, c2] = STATUS_GRAD[status] ?? ["#6366f1", "#4f46e5"]
  return {
    type: "box", layout: "vertical", paddingAll: "0px",
    background: { type: "linearGradient", angle: "135deg", startColor: c1, endColor: c2 },
    contents: [{
      type: "box", layout: "horizontal", paddingAll: "18px", paddingBottom: "16px",
      contents: [
        {
          type: "box", layout: "vertical", flex: 1, justifyContent: "center",
          contents: [
            { type: "text", text: "SLIPPY", size: "xxs", color: "#ffffffa6", weight: "bold" },
            { type: "text", text: title, size: "lg", color: "#ffffff", weight: "bold", wrap: true, maxLines: 2, margin: "xs" },
            { type: "text", text: subtitle, size: "xs", color: "#ffffffbf", margin: "xs" },
          ]
        },
        {
          type: "box", layout: "vertical", justifyContent: "center", alignItems: "flex-end",
          contents: [
            { type: "box", layout: "vertical", width: "44px", height: "44px",
              cornerRadius: "22px", backgroundColor: "#ffffff33",
              justifyContent: "center", alignItems: "center",
              contents: [{ type: "text", text: status === "approved" ? "✓" : status === "rejected" ? "✕" : status === "reviewing" ? "👀" : "📄",
                size: "lg", color: "#ffffff", align: "center" }]
            }
          ]
        }
      ]
    }]
  }
}

function dataRow(label: string, value: string, valueColor?: string): object {
  return {
    type: "box", layout: "horizontal", paddingTop: "8px",
    contents: [
      { type: "text", text: label, size: "xs", color: "#9ca3af", flex: 4 },
      { type: "text", text: value, size: "xs", color: valueColor ?? "#1f2937", flex: 5, align: "end", weight: "bold", wrap: true },
    ]
  }
}

function separator(): object {
  return { type: "separator", color: "#f3f4f6", margin: "md" }
}

// ─── Thai helpers ─────────────────────────────────────────────────────────────
const CAT_TH: Record<string, string> = {
  tax_invoice_full:       "ใบกำกับภาษีเต็มรูปแบบ",
  tax_invoice_simplified: "ใบกำกับภาษีอย่างย่อ",
  receipt_with_tax:       "ใบเสร็จ/ใบกำกับภาษี",
  receipt:                "ใบเสร็จรับเงิน",
  consumer_receipt:       "ใบเสร็จจากแอปพลิเคชัน",
  invoice:                "ใบแจ้งหนี้",
  credit_note:            "ใบลดหนี้",
  other:                  "ไม่ระบุประเภท",
}
const VAT_CLAIMABLE_CATS = new Set(["tax_invoice_full","receipt_with_tax","credit_note"])

function fmtDateTH(d: string | null | undefined): string {
  if (!d) return "—"
  const [y, m, day] = d.split("-").map(Number)
  const mon = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."][m - 1]
  return `${day} ${mon ?? "?"} ${y + 543}`
}

function sectionHeader(icon: string, label: string): object {
  return {
    type: "box", layout: "horizontal",
    paddingTop: "16px", paddingBottom: "6px",
    contents: [
      { type: "text", text: `${icon} ${label}`, size: "xs", color: "#6b7280", weight: "bold" },
    ]
  }
}

function detailRow(label: string, value: string, valueColor = "#111827", bold = false): object {
  return {
    type: "box", layout: "horizontal", paddingTop: "5px",
    contents: [
      { type: "text", text: label, size: "sm", color: "#9ca3af", flex: 4, wrap: false },
      { type: "text", text: value, size: "sm", color: valueColor, flex: 5, align: "end",
        weight: bold ? "bold" : "regular", wrap: true },
    ]
  }
}

// ─── Document result card — full details ───────────────────────────────────────
export function docResultCard(params: {
  docId:           string
  vendorName:      string | null
  vendorTaxId?:    string | null
  totalAmount:     number | null
  subtotal?:       number | null
  vatAmount:       number | null
  discountAmount?: number | null
  deliveryFee?:    number | null
  whtAmount?:      number | null
  vatClaimable?:   boolean | null
  docDate:         string | null
  docNumber?:      string | null
  category:        string | null
  confidence:      number | null
  status:          string
  fileName:        string
  paymentMethod?:  string | null
  lineItems?:      Array<{ description: string; quantity: number; unit_price: number; amount: number }>
}): object {
  const {
    docId, vendorName, vendorTaxId, totalAmount, subtotal,
    vatAmount, discountAmount, deliveryFee, whtAmount, vatClaimable,
    docDate, docNumber, category, confidence, status, fileName,
    paymentMethod, lineItems = [],
  } = params

  const confPct     = confidence != null ? `${Math.round(confidence * 100)}%` : null
  // LINE requires non-empty text — fallback to placeholder if both null/empty
  const title       = vendorName?.trim() || fileName?.trim() || "เอกสาร"
  const catTH       = CAT_TH[category ?? ""] ?? category ?? "—"
  const canVat      = vatClaimable ?? (category ? VAT_CLAIMABLE_CATS.has(category) : false)
  const statusLabel = STATUS_TH[status] ?? status

  // Status badge dot color (shown inside the always-Slippy-brand header)
  const STATUS_DOT: Record<string, string> = {
    reviewing:  "#fbbf24",  // amber
    approved:   "#34d399",  // green
    pushed:     "#a5b4fc",  // light indigo
    failed:     "#f87171",  // red
    rejected:   "#9ca3af",  // gray
    processing: "#93c5fd",  // light blue
  }
  const dotColor = STATUS_DOT[status] ?? "#e5e7eb"

  // Confidence visual
  const confBg    = confidence == null ? "#ffffff26"
    : confidence >= 0.85 ? "#d1fae5cc" : confidence >= 0.60 ? "#fef3c7cc" : "#fee2e2cc"
  const confFgCol = confidence == null ? "#ffffff"
    : confidence >= 0.85 ? "#065f46"   : confidence >= 0.60 ? "#92400e"   : "#991b1b"
  const confLabel = confPct
    ? (confidence! >= 0.85 ? `✓ ${confPct}` : confidence! >= 0.60 ? `~ ${confPct}` : `! ${confPct}`)
    : null

  // ── Header — always Slippy brand indigo, status shown via dot badge ──────
  const header = {
    type: "box", layout: "vertical", paddingAll: "0px",
    background: {
      type: "linearGradient", angle: "150deg",
      startColor: "#6366f1",   // Slippy brand indigo — always, regardless of status
      endColor:   "#4f46e5",
    },
    contents: [{
      type: "box", layout: "vertical",
      paddingStart: "18px", paddingEnd: "18px",
      paddingTop: "16px", paddingBottom: "20px",
      contents: [

        // ─ Top row: Slippy icon + brand name + confidence ────────────────
        {
          type: "box", layout: "horizontal", alignItems: "center",
          contents: [
            // Icon box — Slippy logo mark
            {
              type: "box", layout: "vertical",
              width: "44px", height: "44px", cornerRadius: "12px",
              backgroundColor: "#ffffff",
              contents: [{
                type: "image",
                url: `${APP_URL}/icon-192.png`,
                size: "full", aspectRatio: "1:1", aspectMode: "cover",
              }]
            },
            // Brand name + tagline
            {
              type: "box", layout: "vertical", flex: 1,
              paddingStart: "10px", justifyContent: "center",
              contents: [
                { type: "text", text: "Slippy",
                  size: "sm", color: "#ffffff", weight: "bold" },
                { type: "text", text: "ระบบจัดการเอกสาร AI",
                  size: "xxs", color: "#ffffffbf" },
              ]
            },
            // Confidence pill
            ...(confLabel ? [{
              type: "box", layout: "vertical",
              paddingAll: "5px", paddingStart: "10px", paddingEnd: "10px",
              backgroundColor: confBg, cornerRadius: "20px",
              justifyContent: "center",
              contents: [{
                type: "text", text: `✨ ${confLabel}`,
                size: "xxs", color: confFgCol, weight: "bold",
              }]
            } as object] : []),
          ]
        },

        // ─ Vendor name ───────────────────────────────────────────────────
        {
          type: "text", text: title,
          size: "xxl", color: "#ffffff", weight: "bold",
          wrap: true, margin: "lg", maxLines: 2,
        },

        // ─ Status badge (dot + label) ─────────────────────────────────────
        {
          type: "box", layout: "horizontal", margin: "sm", contents: [{
            type: "box", layout: "horizontal",
            paddingAll: "4px", paddingStart: "10px", paddingEnd: "12px",
            backgroundColor: "#ffffff26", cornerRadius: "20px",
            alignItems: "center",
            contents: [
              // Colored dot per status
              {
                type: "box", layout: "vertical",
                width: "8px", height: "8px", cornerRadius: "4px",
                backgroundColor: dotColor, margin: "none",
                contents: []
              },
              {
                type: "text", text: statusLabel,
                size: "xxs", color: "#ffffffcc", weight: "bold", margin: "sm",
              },
            ]
          }]
        },

      ]
    }]
  }

  // ── Body sections ─────────────────────────────────────────────────────────
  const body: object[] = []

  // — Amount hero box —
  body.push({
    type: "box", layout: "vertical",
    paddingAll: "16px", backgroundColor: "#f9fafb", cornerRadius: "12px",
    contents: [
      { type: "text", text: "ยอดที่ต้องชำระ", size: "xxs", color: "#9ca3af", weight: "bold" },
      { type: "text", text: fmtTHB(totalAmount), size: "xxl",
        color: "#111827", weight: "bold", margin: "xs", wrap: true },
    ]
  })

  // — Financial breakdown —
  const hasBreakdown = (subtotal != null && subtotal !== totalAmount)
    || (vatAmount != null && vatAmount > 0)
    || (discountAmount != null && discountAmount !== 0)
    || (deliveryFee != null && deliveryFee !== 0)
    || (whtAmount != null && whtAmount !== 0)

  if (hasBreakdown) {
    body.push(sectionHeader("💰", "รายละเอียดยอดเงิน"))
    if (subtotal != null && subtotal !== totalAmount)
      body.push(detailRow("ราคาก่อน VAT", fmtTHB(subtotal)))
    if (vatAmount != null && vatAmount > 0)
      body.push(detailRow("VAT 7%", fmtTHB(vatAmount)))
    if (deliveryFee != null && deliveryFee !== 0)
      body.push(detailRow("ค่าบริการ/จัดส่ง", fmtTHB(deliveryFee)))
    if (discountAmount != null && discountAmount !== 0)
      body.push(detailRow("ส่วนลด", `-${fmtTHB(discountAmount)}`, "#ef4444"))
    if (whtAmount != null && whtAmount !== 0)
      body.push(detailRow("หัก ณ ที่จ่าย", `-${fmtTHB(whtAmount)}`, "#ef4444"))
    body.push(separator())
    body.push(detailRow("ยอดรวมสุทธิ", fmtTHB(totalAmount), "#111827", true))
  } else if (vatAmount != null && vatAmount > 0) {
    body.push(sectionHeader("💰", "รายละเอียดยอดเงิน"))
    body.push(detailRow("VAT 7%", fmtTHB(vatAmount)))
  }

  // — Document details —
  body.push(separator())
  body.push(sectionHeader("📋", "ข้อมูลเอกสาร"))
  body.push(detailRow("ประเภท", catTH))
  if (docNumber) body.push(detailRow("เลขที่เอกสาร", docNumber))
  body.push(detailRow("วันที่", fmtDateTH(docDate)))
  body.push(detailRow("ขอคืน VAT ได้", canVat ? "✅ ได้" : "❌ ไม่ได้",
    canVat ? "#059669" : "#9ca3af"))
  if (paymentMethod) body.push(detailRow("ชำระด้วย", paymentMethod))

  // — Vendor —
  if (vendorName || vendorTaxId) {
    body.push(separator())
    body.push(sectionHeader("🏪", "ผู้ออกเอกสาร"))
    if (vendorName)  body.push(detailRow("ชื่อ", vendorName))
    if (vendorTaxId) body.push(detailRow("เลขผู้เสียภาษี", vendorTaxId))
  }

  // — Line items (max 5) —
  if (lineItems.length > 0) {
    body.push(separator())
    body.push(sectionHeader("🧾", `รายการสินค้า (${lineItems.length} รายการ)`))
    lineItems.slice(0, 5).forEach(item => {
      const qty = item.quantity !== 1 ? ` ×${item.quantity}` : ""
      body.push({
        type: "box", layout: "horizontal", paddingTop: "5px",
        contents: [
          { type: "text", text: `• ${item.description}${qty}`, size: "sm",
            color: "#374151", flex: 5, wrap: true },
          { type: "text", text: fmtTHB(item.amount), size: "sm",
            color: "#111827", weight: "bold", flex: 3, align: "end" },
        ]
      })
    })
    if (lineItems.length > 5) {
      body.push({ type: "text", text: `+ อีก ${lineItems.length - 5} รายการ…`,
        size: "xxs", color: "#9ca3af", margin: "sm" })
    }
  }

  // — Doc ID footer —
  body.push(separator())
  body.push({
    type: "box", layout: "horizontal", margin: "sm",
    contents: [
      { type: "text", text: `ID: ${docId.slice(0, 8)}…`, size: "xxs", color: "#d1d5db" },
      { type: "text", text: statusLabel, size: "xxs",
        color: status === "approved" ? "#10b981" : status === "rejected" ? "#6b7280" : "#f59e0b",
        align: "end", weight: "bold" },
    ]
  })

  // ── Footer buttons ────────────────────────────────────────────────────────
  const footerContents: object[] = []
  // Use full UUID in button actions — partial prefix caused "uuid ~~ unknown" error
  // because LIKE operator doesn't work on UUID columns in PostgreSQL without text cast
  const shortId = docId   // send full UUID, handler does exact match with .eq()
  const lowConf = confidence != null && confidence < 0.70

  if (status === "reviewing") {
    footerContents.push({
      type: "box", layout: "horizontal", spacing: "sm",
      contents: [
        { type: "button", style: "primary", height: "sm", flex: 1, color: "#10b981",
          action: { type: "message", label: "✓ อนุมัติ", text: `/approve ${shortId}` } },
        { type: "button", style: "primary", height: "sm", flex: 1, color: "#ef4444",
          action: { type: "message", label: "✕ ปฏิเสธ", text: `/reject ${shortId}` } },
      ]
    })
    // Low confidence → also show retry
    if (lowConf) {
      footerContents.push({
        type: "button", style: "secondary", height: "sm", margin: "sm",
        action: { type: "message", label: "🔄 อ่านใหม่อีกครั้ง", text: `/retry ${shortId}` }
      })
    }
  }

  // Failed → show prominent retry button
  if (status === "failed") {
    footerContents.push({
      type: "box", layout: "horizontal", spacing: "sm",
      contents: [
        { type: "button", style: "primary", height: "sm", flex: 1, color: "#6366f1",
          action: { type: "message", label: "🔄 ลองอ่านใหม่", text: `/retry ${shortId}` } },
        { type: "button", style: "secondary", height: "sm", flex: 1,
          action: { type: "message", label: "🗑️ ลบทิ้ง", text: `/delete ${shortId}` } },
      ]
    })
  }

  footerContents.push({
    type: "button", style: "secondary", height: "sm", margin: "sm",
    action: { type: "uri", label: "🌐 ตรวจสอบในแอป",
      uri: liffGate(`/documents/${docId}/review`) }
  })

  return {
    type: "flex",
    altText: `📄 ${title} — ${fmtTHB(totalAmount)} (${statusLabel})`,
    contents: {
      type: "bubble", size: "mega",
      header,
      body: {
        type: "box", layout: "vertical",
        paddingAll: "16px", paddingBottom: "8px", spacing: "none",
        contents: body,
      },
      footer: {
        type: "box", layout: "vertical",
        paddingAll: "12px", backgroundColor: "#f9fafb",
        contents: footerContents,
      }
    }
  }
}

// ─── Monthly summary card ─────────────────────────────────────────────────────
export function summaryCard(params: {
  orgName:     string
  month:       string
  docCount:    number
  grandTotal:  number
  vatTotal:    number
  reviewCount?: number
}): object {
  const { orgName, month, docCount, grandTotal, vatTotal, reviewCount } = params
  const [y, m] = month.split("-")
  const monthTH = ["","ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."][Number(m)] ?? month

  return {
    type: "flex",
    altText: `📊 สรุปเดือน ${monthTH} — ${fmtTHB(grandTotal)}`,
    contents: {
      type: "bubble", size: "kilo",
      header: gradHeader(`${monthTH} ${y}`, orgName, "processing"),
      body: {
        type: "box", layout: "vertical", paddingAll: "16px", spacing: "none",
        contents: [
          {
            type: "box", layout: "vertical", paddingAll: "16px", backgroundColor: "#f9fafb",
            cornerRadius: "12px", margin: "none",
            contents: [
              { type: "text", text: "ค่าใช้จ่ายรวม", size: "xxs", color: "#9ca3af", weight: "bold" },
              { type: "text", text: fmtTHB(grandTotal), size: "xxl", color: "#111827", weight: "bold", margin: "xs" },
            ]
          },
          separator(),
          {
            type: "box", layout: "horizontal", paddingTop: "12px",
            contents: [
              { type: "box", layout: "vertical", flex: 1, alignItems: "center",
                contents: [
                  { type: "text", text: String(docCount), size: "xl", color: "#3b82f6", weight: "bold", align: "center" },
                  { type: "text", text: "เอกสาร", size: "xxs", color: "#9ca3af", align: "center" },
                ]
              },
              { type: "separator", color: "#e5e7eb" },
              { type: "box", layout: "vertical", flex: 1, alignItems: "center",
                contents: [
                  { type: "text", text: fmtTHB(vatTotal), size: "md", color: "#6366f1", weight: "bold", align: "center" },
                  { type: "text", text: "VAT ซื้อ", size: "xxs", color: "#9ca3af", align: "center" },
                ]
              },
              ...(reviewCount != null ? [
                { type: "separator", color: "#e5e7eb" } as object,
                { type: "box", layout: "vertical", flex: 1, alignItems: "center",
                  contents: [
                    { type: "text", text: String(reviewCount), size: "xl",
                      color: reviewCount > 0 ? "#f59e0b" : "#10b981", weight: "bold", align: "center" },
                    { type: "text", text: "รอตรวจ", size: "xxs", color: "#9ca3af", align: "center" },
                  ]
                } as object
              ] : [])
            ]
          }
        ]
      }
    }
  }
}

// ─── Status list card ─────────────────────────────────────────────────────────
export function statusListCard(docs: Array<{
  id: string; vendorName: string | null; status: string
  totalAmount: number | null; docDate: string | null
}>): object {
  const STATUS_DOT: Record<string, string> = {
    approved: "#10b981", reviewing: "#f59e0b", pushed: "#6366f1", failed: "#ef4444", rejected: "#6b7280"
  }
  return {
    type: "flex",
    altText: `📋 เอกสารล่าสุด ${docs.length} รายการ`,
    contents: {
      type: "bubble", size: "kilo",
      header: {
        type: "box", layout: "vertical", paddingAll: "0px",
        background: { type: "linearGradient", angle: "135deg", startColor: "#1e293b", endColor: "#334155" },
        contents: [{
          type: "box", layout: "horizontal", paddingAll: "16px",
          contents: [
            { type: "text", text: "📋 เอกสารล่าสุด", color: "#ffffff", weight: "bold", size: "md" },
            { type: "box", layout: "vertical", paddingStart: "8px", paddingEnd: "8px", paddingTop: "3px", paddingBottom: "3px",
              backgroundColor: "#ffffff26", cornerRadius: "12px",
              contents: [{ type: "text", text: `${docs.length}`, color: "#ffffff", size: "xs", weight: "bold" }]
            }
          ]
        }]
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "12px", spacing: "sm",
        contents: docs.flatMap((d, i) => {
          const row: object[] = []
          if (i > 0) row.push({ type: "separator", color: "#f3f4f6" })
          row.push({
          type: "box", layout: "horizontal", spacing: "md",
          paddingTop: i === 0 ? "0px" : "10px",
          contents: [
            {
              type: "box", layout: "vertical", justifyContent: "center",
              contents: [{
                type: "box", width: "10px", height: "10px", cornerRadius: "5px",
                backgroundColor: STATUS_DOT[d.status] ?? "#9ca3af",
                contents: []
              }]
            },
            {
              type: "box", layout: "vertical", flex: 1,
              contents: [
                { type: "text", text: d.vendorName ?? "—", size: "sm", weight: "bold", color: "#111827", maxLines: 1 },
                { type: "text", text: d.docDate ?? STATUS_TH[d.status] ?? d.status, size: "xxs", color: "#9ca3af", margin: "xs" },
              ]
            },
            { type: "text", text: fmtTHB(d.totalAmount), size: "sm", weight: "bold", color: "#374151", align: "end" },
          ]
          })
          return row
        })
      }
    }
  }
}

// ─── Welcome card ─────────────────────────────────────────────────────────────
export function welcomeCard(): object {
  const commands = [
    { cmd: "/connect CODE", desc: "เชื่อมบัญชี" },
    { cmd: "/summary",      desc: "สรุปค่าใช้จ่าย" },
    { cmd: "/status",       desc: "เอกสารล่าสุด" },
    { cmd: "/approve ID",   desc: "อนุมัติเอกสาร" },
    { cmd: "/reject ID",    desc: "ปฏิเสธเอกสาร" },
    { cmd: "/help",         desc: "คำสั่งทั้งหมด" },
  ]
  return {
    type: "flex",
    altText: "ยินดีต้อนรับสู่ Slippy Bot! 🎉",
    contents: {
      type: "bubble", size: "kilo",
      header: {
        type: "box", layout: "vertical", paddingAll: "0px",
        background: { type: "linearGradient", angle: "135deg", startColor: "#6366f1", endColor: "#8b5cf6" },
        contents: [{
          type: "box", layout: "vertical", paddingAll: "20px", alignItems: "center",
          contents: [
            { type: "text", text: "🧾", size: "3xl", align: "center" },
            { type: "text", text: "Slippy Bot", size: "xl", color: "#ffffff", weight: "bold", align: "center", margin: "sm" },
            { type: "text", text: "ระบบจัดการเอกสารบัญชี AI", size: "xs", color: "#ffffffbf", align: "center" },
          ]
        }]
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "16px", spacing: "none",
        contents: [
          {
            type: "box", layout: "vertical", backgroundColor: "#f9fafb", cornerRadius: "12px",
            paddingAll: "14px", margin: "none",
            contents: [
              { type: "text", text: "วิธีเริ่มต้นใช้งาน", size: "xs", color: "#6b7280", weight: "bold" },
              { type: "text", text: "1. สร้าง Code จาก Settings → LINE Bot", size: "xs", color: "#374151", margin: "sm" },
              { type: "text", text: "2. พิมพ์ /connect CODE ในแชทนี้", size: "xs", color: "#374151", margin: "xs" },
              { type: "text", text: "3. ส่งรูปสลิปหรือใบเสร็จมาได้เลย", size: "xs", color: "#374151", margin: "xs" },
            ]
          },
          separator(),
          { type: "text", text: "คำสั่งที่ใช้ได้", size: "xs", color: "#6b7280", weight: "bold", margin: "md" },
          ...commands.map(c => ({
            type: "box", layout: "horizontal", margin: "sm",
            contents: [
              { type: "text", text: c.cmd, size: "xs", color: "#6366f1", weight: "bold", flex: 4, wrap: true },
              { type: "text", text: c.desc, size: "xs", color: "#6b7280", flex: 3, align: "end" },
            ]
          }) as object),
        ]
      },
      footer: {
        type: "box", layout: "vertical", paddingAll: "12px", backgroundColor: "#f9fafb",
        contents: [{
          type: "button", style: "primary", color: "#6366f1",
          action: { type: "uri", label: "เปิด Slippy App", uri: liffGate("/dashboard") }
        }]
      }
    }
  }
}

// ─── Command Menu Card (Carousel) ────────────────────────────────────────────
/**
 * A 3-bubble carousel shown when user taps "เมนู" or types /menu
 * Bubble 1: เอกสาร  — scan, status, summary, approve/reject
 * Bubble 2: หารบิล  — split, claim, status, done
 * Bubble 3: ตั้งค่า  — connect, open app, help
 */
export function commandMenuCard(): object {
  // ── Slippy brand palette (matches <LogoMark/> squircle gradient) ─────────
  // violet → indigo → pink. Every bubble below is a tint drawn from this
  // SAME family (instead of mismatched per-card colors) so the carousel
  // reads as one cohesive, modern, "cute mascot" world — Slippy Universe.
  const BRAND = { violet: "#8b5cf6", indigo: "#6366f1", pink: "#ec4899" }

  // Cute little mascot chip — a soft circle "face" that echoes the LogoMark
  // (paper-slip with friendly eyes/blush/smile) used as a recurring brand cue.
  function mascotChip(bg: string): object {
    return {
      type: "box", layout: "vertical", width: "30px", height: "30px", cornerRadius: "15px",
      backgroundColor: bg, justifyContent: "center", alignItems: "center",
      contents: [{ type: "text", text: "🫧", size: "xs", align: "center" }]
    }
  }

  function menuHeader(emoji: string, title: string, subtitle: string, c1: string, c2: string): object {
    return {
      type: "box", layout: "vertical", paddingAll: "0px",
      background: { type: "linearGradient", angle: "135deg", startColor: c1, endColor: c2 },
      contents: [{
        type: "box", layout: "vertical", paddingAll: "18px", paddingBottom: "16px",
        contents: [
          // top row — mascot chip + sparkle, gives a friendly "face peeking in" feel
          {
            type: "box", layout: "horizontal", alignItems: "center",
            contents: [
              mascotChip("#ffffff33"),
              { type: "text", text: "Slippy ✨", size: "xxs", color: "#ffffffd0", weight: "bold", align: "end", flex: 1 },
            ]
          },
          { type: "box", layout: "vertical", alignItems: "center", margin: "md",
            contents: [
              { type: "text", text: emoji, size: "3xl", align: "center" },
              { type: "text", text: title, size: "lg", color: "#ffffff", weight: "bold", align: "center", margin: "sm" },
              { type: "text", text: subtitle, size: "xxs", color: "#ffffffcc", align: "center", margin: "xs", wrap: true },
            ]
          },
        ]
      }]
    }
  }

  function menuBtn(label: string, emoji: string, cmd: string, desc: string, tint: string, isPrimary = false): object {
    return {
      type: "box", layout: "horizontal",
      paddingTop: "10px", paddingBottom: "10px",
      paddingStart: "0px", paddingEnd: "0px",
      action: { type: "message", label, text: cmd },
      contents: [
        {
          type: "box", layout: "vertical", width: "38px", height: "38px",
          cornerRadius: "19px",
          backgroundColor: tint,
          justifyContent: "center", alignItems: "center",
          contents: [{ type: "text", text: emoji, size: "sm", align: "center" }]
        },
        {
          type: "box", layout: "vertical", flex: 1, paddingStart: "10px", justifyContent: "center",
          contents: [
            { type: "text", text: label,  size: "sm", color: "#1f2937", weight: isPrimary ? "bold" : "regular" },
            { type: "text", text: desc,   size: "xxs", color: "#9ca3af", margin: "xs", wrap: true },
          ]
        },
        { type: "text", text: "›", size: "lg", color: "#d1d5db", align: "end", gravity: "center" }
      ]
    }
  }

  function uriBtn(label: string, emoji: string, uri: string, desc: string, tint: string, arrowColor: string): object {
    return {
      type: "box", layout: "horizontal",
      paddingTop: "10px", paddingBottom: "10px",
      paddingStart: "0px", paddingEnd: "0px",
      action: { type: "uri", label, uri },
      contents: [
        {
          type: "box", layout: "vertical", width: "38px", height: "38px",
          cornerRadius: "19px", backgroundColor: tint,
          justifyContent: "center", alignItems: "center",
          contents: [{ type: "text", text: emoji, size: "sm", align: "center" }]
        },
        {
          type: "box", layout: "vertical", flex: 1, paddingStart: "10px", justifyContent: "center",
          contents: [
            { type: "text", text: label, size: "sm", color: "#1f2937", weight: "bold" },
            { type: "text", text: desc,  size: "xxs", color: "#9ca3af", margin: "xs", wrap: true },
          ]
        },
        { type: "text", text: "↗", size: "sm", color: arrowColor, align: "end", gravity: "center", weight: "bold" }
      ]
    }
  }

  // Cute pastel "tip" footer — soft tinted bubble instead of flat grey,
  // keeps the friendly/rounded vibe going all the way to the bottom edge.
  function tipFooter(text: string, tint: string, textColor: string): object {
    return {
      type: "box", layout: "vertical", paddingAll: "12px", backgroundColor: tint,
      contents: [{ type: "text", align: "center", size: "xxs", color: textColor, wrap: true, text }]
    }
  }

  const docBubble = {
    type: "bubble", size: "kilo",
    header: menuHeader("📄", "เอกสาร", "แปลงสลิปให้เป็นบัญชีอัตโนมัติ", BRAND.violet, BRAND.indigo),
    body: {
      type: "box", layout: "vertical", paddingAll: "14px", spacing: "none",
      contents: [
        menuBtn("ส่งสลิป / ใบเสร็จ", "📸", "/scan",       "ถ่ายภาพหรือเลือกรูปจากอัลบั้ม", "#ede9fe", true),
        menuBtn("เอกสารล่าสุด",       "📋", "/status",     "ดูรายการ 5 ล่าสุด", "#ede9fe"),
        menuBtn("สรุปค่าใช้จ่าย",     "📊", "/summary",    "สรุปยอดและ VAT เดือนนี้", "#ede9fe"),
        menuBtn("อนุมัติเอกสาร",      "✅", "/approve",    "พิมพ์ /approve [ID]", "#ede9fe"),
        menuBtn("ปฏิเสธเอกสาร",      "❌", "/reject",     "พิมพ์ /reject [ID]", "#ede9fe"),
      ]
    }
  }

  const splitBubble = {
    type: "bubble", size: "kilo",
    header: menuHeader("🤝", "หารบิล", "แบ่งจ่ายกับเพื่อนแบบไม่มีดราม่า", BRAND.indigo, BRAND.pink),
    body: {
      type: "box", layout: "vertical", paddingAll: "14px", spacing: "none",
      contents: [
        uriBtn("เปิดแดชบอร์ดหารบิล", "🧾", `https://liff.line.me/${process.env.NEXT_PUBLIC_LIFF_ID ?? ""}/liff/split`,
          "สร้างบิลหารยอดเท่าๆ กัน แชร์ลิงก์ให้เพื่อนกดเข้าร่วม", "#e0e7ff", BRAND.indigo),
        menuBtn("หารบิลจากใบเสร็จ", "🆕", "/split",       "พิมพ์ /split [DocID]", "#e0e7ff", true),
        menuBtn("เลือกรายการ",     "☝️", "/claim",       "พิมพ์ /claim [BillID] [เลขรายการ]", "#e0e7ff"),
        menuBtn("ดูสถานะบิล",     "👀", "/splitstatus", "พิมพ์ /splitstatus [BillID]", "#e0e7ff"),
        menuBtn("ปิดบิล & สรุป",  "🏁", "/splitdone",   "พิมพ์ /splitdone [BillID]", "#e0e7ff"),
        uriBtn("เปิดลิงก์บิล",    "🌐", APP_URL, "สำหรับเพื่อนที่ไม่มี LINE", "#fce7f3", BRAND.pink),
      ]
    }
  }

  const sportBubble = {
    type: "bubble", size: "kilo",
    header: menuHeader("🏸", "กลุ่มกีฬา", "ตั้งกลุ่ม หารบิล ติดตามยอด ในที่เดียว", BRAND.violet, BRAND.pink),
    body: {
      type: "box", layout: "vertical", paddingAll: "14px", spacing: "none",
      contents: [
        uriBtn("เปิดแดชบอร์ดกีฬา", "🏸", `https://liff.line.me/${process.env.NEXT_PUBLIC_LIFF_ID ?? ""}/liff/sport`,
          "ดู/สร้าง/หาร/ติดตามยอด ครบในที่เดียว — แบบ KhunThong", "#f3e8ff", BRAND.violet),
        menuBtn("ตั้งกลุ่มใหม่ (พิมพ์)", "🆕", "/sportgroup",  "พิมพ์ /sportgroup [กีฬา] [ค่าใช้จ่าย] [สถานที่]\nเช่น /sportgroup แบด 400 สนามบางนา", "#f3e8ff"),
        menuBtn("ดูสถานะกลุ่ม",     "📊", "/sportstatus", "พิมพ์ /sportstatus [รหัสกลุ่ม]", "#f3e8ff"),
        menuBtn("แจ้งจ่ายแล้ว",     "✅", "/sportpay",    "พิมพ์ /sportpay [รหัสกลุ่ม]", "#f3e8ff"),
        menuBtn("ปิดกลุ่ม & สรุป",  "🔒", "/sportdone",   "พิมพ์ /sportdone [รหัสกลุ่ม]", "#f3e8ff"),
      ]
    },
    footer: tipFooter("💡 หารค่าสนาม/อุปกรณ์เท่าๆ กันอัตโนมัติ — แชร์ลิงก์ให้เพื่อนกดเข้าร่วมได้เลย (เหมือน KhunThong)", "#f3e8ff", "#7c3aed")
  }

  const tripBubble = {
    type: "bubble", size: "kilo",
    header: menuHeader("✈️", "กลุ่มทริป", "ตั้งกลุ่ม หารบิล ติดตามยอด ในที่เดียว", BRAND.indigo, BRAND.violet),
    body: {
      type: "box", layout: "vertical", paddingAll: "14px", spacing: "none",
      contents: [
        uriBtn("เปิดแดชบอร์ดทริป", "✈️", `https://liff.line.me/${process.env.NEXT_PUBLIC_LIFF_ID ?? ""}/liff/trip`,
          "ดู/สร้าง/หาร/ติดตามยอด ครบในที่เดียว — แบบ KhunThong", "#e0e7ff", BRAND.indigo),
        menuBtn("ตั้งกลุ่มใหม่ (พิมพ์)", "🆕", "/tripgroup",  "พิมพ์ /tripgroup [ธีมทริป] [ค่าใช้จ่าย] [จุดหมาย]\nเช่น /tripgroup เที่ยวทะเล 3000 ภูเก็ต", "#e0e7ff"),
        menuBtn("ดูสถานะกลุ่ม",     "📊", "/tripstatus", "พิมพ์ /tripstatus [รหัสกลุ่ม]", "#e0e7ff"),
        menuBtn("แจ้งจ่ายแล้ว",     "✅", "/trippay",    "พิมพ์ /trippay [รหัสกลุ่ม]", "#e0e7ff"),
        menuBtn("ปิดกลุ่ม & สรุป",  "🔒", "/tripdone",   "พิมพ์ /tripdone [รหัสกลุ่ม]", "#e0e7ff"),
      ]
    },
    footer: tipFooter("💡 หารค่าทริปเท่าๆ กันอัตโนมัติ — แชร์ลิงก์ให้เพื่อนกดเข้าร่วมได้เลย (เหมือน KhunThong)", "#e0e7ff", "#4f46e5")
  }

  const settingsBubble = {
    type: "bubble", size: "kilo",
    header: menuHeader("⚙️", "ตั้งค่า", "เชื่อมต่อบัญชีและปรับแต่ง Slippy", BRAND.pink, BRAND.violet),
    body: {
      type: "box", layout: "vertical", paddingAll: "14px", spacing: "none",
      contents: [
        menuBtn("เชื่อมต่อบัญชี",    "🔗", "/connect",    "พิมพ์ /connect [CODE]", "#fce7f3", true),
        menuBtn("คำสั่งทั้งหมด",     "📖", "/help",       "ดูรายการคำสั่งทั้งหมด", "#fce7f3"),
        uriBtn("เปิด Slippy App",   "🚀", liffGate("/dashboard"), "จัดการเอกสารบนเว็บ", "#f3e8ff", BRAND.violet),
        uriBtn("ตั้งค่า LINE Bot",   "💬", liffGate("/settings/line"), "สร้าง code เชื่อมต่อ", "#f3e8ff", BRAND.violet),
      ]
    },
    footer: tipFooter("🫧 Slippy — ผู้ช่วย AI ที่เก็บทุกสลิป ทุกทริป ทุกเรื่องราวของคุณ", "#fce7f3", "#db2777")
  }

  return {
    type: "flex",
    altText: "📱 เมนูคำสั่ง Slippy",
    contents: {
      type: "carousel",
      contents: [docBubble, splitBubble, sportBubble, tripBubble, settingsBubble]
    }
  }
}

// ─── Quick Reply helper ───────────────────────────────────────────────────────
/**
 * Wraps any LINE message object with quick reply buttons at the bottom.
 * Use quickReplyMenu() to append the standard 4-button nav to any message.
 */
export function withQuickReply<T extends Record<string, unknown>>(message: T, items: Array<{ label: string; text: string; imageUrl?: string }>): T {
  return {
    ...message,
    quickReply: {
      items: items.map(item => ({
        type:   "action",
        ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
        action: { type: "message", label: item.label, text: item.text }
      }))
    }
  }
}

/** Standard 4-button quick reply for main navigation */
export function mainQuickReply(): Array<{ label: string; text: string }> {
  return [
    { label: "🧭 เมนู",    text: "/menu" },
    { label: "📄 สถานะ",  text: "/status" },
    { label: "📈 สรุป",   text: "/summary" },
    { label: "💸 หารบิล", text: "/split" },
  ]
}

// ─── Upload acknowledgement card ──────────────────────────────────────────────
export function uploadAckCard(fileName: string, docId: string): object {
  return {
    type: "flex",
    altText: "📤 รับสลิปแล้ว กำลังประมวลผล...",
    contents: {
      type: "bubble", size: "micro",
      body: {
        type: "box", layout: "vertical", alignItems: "center", spacing: "sm",
        paddingAll: "18px",
        contents: [
          {
            type: "box", layout: "vertical", width: "52px", height: "52px",
            cornerRadius: "26px", backgroundColor: "#ede9fe",
            justifyContent: "center", alignItems: "center",
            contents: [{ type: "text", text: "📤", size: "xl", align: "center" }]
          },
          { type: "text", text: "รับสลิปแล้วครับ", weight: "bold", size: "sm", align: "center", color: "#111827", margin: "sm" },
          { type: "text", text: "AI กำลังวิเคราะห์...", size: "xs", color: "#6b7280", align: "center" },
          {
            type: "box", layout: "vertical", paddingAll: "8px", paddingStart: "12px", paddingEnd: "12px",
            backgroundColor: "#f3f4f6", cornerRadius: "8px", margin: "sm",
            contents: [{ type: "text", text: `ID: ${docId.slice(0, 8)}…`, size: "xxs", color: "#9ca3af", align: "center", wrap: true }]
          }
        ]
      }
    }
  }
}
