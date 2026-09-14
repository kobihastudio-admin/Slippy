/**
 * POST /api/documents/[id]/notify-line
 * Sends LINE Bot notification for all document activities.
 * Only sends if document originated from LINE (source = "line").
 */
import { NextRequest, NextResponse } from "next/server"
import { getAppUrl } from "@/lib/app-url"
import { createClient }       from "@/lib/supabase/server"
import { createAdminClient }  from "@/lib/supabase/admin"

type Action = "approved" | "approved_pushed" | "rejected" | "draft_saved" | "retrying" | "deleted"

const LINE_API  = "https://api.line.me/v2/bot"
const lineToken = () => process.env.LINE_CHANNEL_ACCESS_TOKEN ?? ""

async function pushMsg(to: string, messages: object[]): Promise<{ ok: boolean; error?: string }> {
  const token = lineToken()
  if (!token) {
    const msg = "LINE_CHANNEL_ACCESS_TOKEN is not set in web server environment"
    console.error("[notify-line] ❌", msg)
    return { ok: false, error: msg }
  }
  const res = await fetch(`${LINE_API}/message/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages }),
  })
  const body = await res.text()
  if (!res.ok) {
    console.error(`[notify-line] ❌ push failed ${res.status} to ${to.slice(0, 8)}:`, body)
    return { ok: false, error: `LINE push ${res.status}: ${body}` }
  }
  console.log(`[notify-line] ✅ push OK → ${to.slice(0, 8)} action sent`)
  return { ok: true }
}

function fmtTHB(n: number | null | undefined) {
  if (!n) return "—"
  return `฿${Number(n).toLocaleString("th-TH", { minimumFractionDigits: 2 })}`
}

function buildMessage(action: Action, vendorName: string, amount: string, vatAmount: string | null, docId: string): object[] {
  const reviewUrl = `${getAppUrl()}/documents/${docId}/review`

  switch (action) {
    case "approved":
      return [{
        type: "flex", altText: `✅ อนุมัติ "${vendorName}" แล้ว`,
        contents: {
          type: "bubble", size: "kilo",
          header: {
            type: "box", layout: "vertical", backgroundColor: "#10b981", paddingAll: "14px",
            contents: [
              { type: "text", text: "✅ อนุมัติแล้ว", color: "#ffffff", weight: "bold", size: "sm" },
              { type: "text", text: vendorName, color: "#ffffff", size: "md", weight: "bold", wrap: true },
            ]
          },
          body: {
            type: "box", layout: "vertical", spacing: "sm", paddingAll: "14px",
            contents: [
              { type: "box", layout: "horizontal", contents: [
                { type: "text", text: "ยอดรวม", size: "xs", color: "#6b7280", flex: 2 },
                { type: "text", text: amount, size: "xs", color: "#111827", weight: "bold", flex: 3, align: "end" },
              ]},
              ...(vatAmount ? [{ type: "box", layout: "horizontal", contents: [
                { type: "text", text: "VAT", size: "xs", color: "#6b7280", flex: 2 },
                { type: "text", text: vatAmount, size: "xs", color: "#111827", flex: 3, align: "end" },
              ]} as object] : []),
              { type: "separator" },
              { type: "text", text: "เอกสารพร้อมใช้งานแล้วครับ 🎉", size: "xs", color: "#6b7280", wrap: true },
            ]
          }
        }
      }]

    case "approved_pushed":
      return [{
        type: "flex", altText: `✅ อนุมัติและส่งเข้าบัญชี "${vendorName}" แล้ว`,
        contents: {
          type: "bubble", size: "kilo",
          header: {
            type: "box", layout: "vertical", backgroundColor: "#6366f1", paddingAll: "14px",
            contents: [
              { type: "text", text: "✅ อนุมัติและส่งเข้าระบบบัญชีแล้ว", color: "#ffffff", weight: "bold", size: "sm", wrap: true },
              { type: "text", text: vendorName, color: "#ffffff", size: "md", weight: "bold", wrap: true },
            ]
          },
          body: {
            type: "box", layout: "vertical", spacing: "sm", paddingAll: "14px",
            contents: [
              { type: "box", layout: "horizontal", contents: [
                { type: "text", text: "ยอดรวม", size: "xs", color: "#6b7280", flex: 2 },
                { type: "text", text: amount, size: "xs", color: "#111827", weight: "bold", flex: 3, align: "end" },
              ]},
              { type: "separator" },
              { type: "text", text: "📤 ส่งเข้าโปรแกรมบัญชีเรียบร้อยแล้วครับ", size: "xs", color: "#6b7280", wrap: true },
            ]
          }
        }
      }]

    case "rejected":
      return [{
        type: "flex", altText: `🚫 ปฏิเสธเอกสาร "${vendorName}"`,
        contents: {
          type: "bubble", size: "kilo",
          header: {
            type: "box", layout: "vertical", paddingAll: "16px",
            backgroundColor: "#ef4444",
            contents: [
              { type: "text", text: "Slippy", size: "xxs", color: "#ffffff99", weight: "bold" },
              { type: "text", text: "🚫 ปฏิเสธเอกสารแล้ว", size: "md", color: "#ffffff", weight: "bold", wrap: true, margin: "xs" },
              { type: "text", text: vendorName, size: "sm", color: "#ffffffcc", wrap: true, margin: "xs" },
            ]
          },
          body: {
            type: "box", layout: "vertical", paddingAll: "16px", spacing: "none",
            contents: [
              {
                type: "box", layout: "vertical", paddingAll: "14px",
                backgroundColor: "#fef2f2", cornerRadius: "10px",
                contents: [
                  { type: "text", text: "สาเหตุที่อาจเกิดขึ้น", size: "xs", color: "#991b1b", weight: "bold" },
                  { type: "text", text: "• ภาพไม่ชัดหรือมัว\n• เอกสารไม่ใช่สลิปหรือใบเสร็จ\n• ข้อมูลไม่ครบถ้วน", size: "xs", color: "#7f1d1d", margin: "sm", wrap: true },
                ]
              },
              { type: "separator", margin: "md" },
              { type: "text", text: "📸 ส่งรูปใหม่อีกครั้งเพื่อลองใหม่ได้เลยครับ", size: "xs", color: "#6b7280", wrap: true, margin: "md" },
            ]
          },
          footer: {
            type: "box", layout: "vertical", paddingAll: "12px", backgroundColor: "#f9fafb",
            contents: [{
              type: "button", style: "primary", height: "sm",
              color: "#ef4444",
              action: { type: "message", label: "📸 ส่งสลิปใหม่อีกครั้ง", text: "ส่งสลิปใหม่" }
            }]
          }
        }
      }]

    case "draft_saved":
      return [{
        type: "text",
        text: `📝 บันทึกร่าง "${vendorName}" เรียบร้อยแล้วครับ\nยอด: ${amount}\nรอการตรวจสอบและอนุมัติ`,
      }]

    case "retrying":
      return [{
        type: "text",
        text: `🔄 กำลังส่งเอกสาร "${vendorName}" ให้ AI อ่านใหม่อีกครั้งครับ`,
      }]

    case "deleted":
      return [{
        type: "flex", altText: `🗑️ ลบเอกสาร "${vendorName}" แล้ว`,
        contents: {
          type: "bubble", size: "kilo",
          header: {
            type: "box", layout: "vertical", paddingAll: "16px",
            backgroundColor: "#6b7280",
            contents: [
              { type: "text", text: "Slippy", size: "xxs", color: "#ffffff99", weight: "bold" },
              { type: "text", text: "🗑️ ลบเอกสารแล้ว", size: "md", color: "#ffffff", weight: "bold", margin: "xs" },
              { type: "text", text: vendorName, size: "sm", color: "#ffffffcc", wrap: true, margin: "xs" },
            ]
          },
          body: {
            type: "box", layout: "vertical", paddingAll: "16px", spacing: "none",
            contents: [
              {
                type: "box", layout: "horizontal", paddingAll: "12px",
                backgroundColor: "#f9fafb", cornerRadius: "10px",
                contents: [
                  { type: "text", text: "ยอดที่ลบ", size: "xs", color: "#9ca3af", flex: 3 },
                  { type: "text", text: amount, size: "sm", color: "#374151", weight: "bold", flex: 4, align: "end" },
                ]
              },
              { type: "separator", margin: "md" },
              { type: "text", text: "เอกสารถูกลบออกจากระบบแล้วครับ\nหากต้องการบันทึกใหม่ ส่งรูปมาได้เลย 📸", size: "xs", color: "#6b7280", wrap: true, margin: "md" },
            ]
          },
          footer: {
            type: "box", layout: "vertical", paddingAll: "12px", backgroundColor: "#f9fafb",
            contents: [{
              type: "button", style: "secondary", height: "sm",
              action: { type: "message", label: "📸 ส่งสลิปใหม่", text: "ส่งสลิปใหม่" }
            }]
          }
        }
      }]

    default:
      return []
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { action } = await req.json() as { action: Action }

  const admin = createAdminClient()
  const { data: doc } = await admin
    .from("documents")
    .select("id, vendor_name, total_amount, vat_amount, source, source_meta")
    .eq("id", id)
    .single()

  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (doc.source !== "line") return NextResponse.json({ ok: true, skipped: "not from LINE" })

  const lineUserId = (doc.source_meta as any)?.line_user_id as string | undefined
  if (!lineUserId) return NextResponse.json({ ok: true, skipped: "no line_user_id" })

  const vendorName = doc.vendor_name ?? "เอกสาร"
  const amount     = fmtTHB(doc.total_amount)
  const vatAmount  = doc.vat_amount ? fmtTHB(doc.vat_amount) : null

  const messages = buildMessage(action, vendorName, amount, vatAmount, id)
  if (messages.length > 0) {
    const result = await pushMsg(lineUserId, messages)
    if (!result.ok) {
      // Return 500 so the caller can log/display the actual error
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true, action })
}
