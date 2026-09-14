/**
 * split-notify.ts — internal endpoint for LINE push notifications on
 * manual split bills (หารบิล) created via Web or iOS app.
 *
 * Events:
 *   "created" — pushes a summary Flex card to the LINE group that triggered
 *               bill creation (if line_group_id is set)
 *   "paid"    — pushes a personal confirmation to the participant's LINE DM
 *               (if line_user_id is set on the participant)
 *   "finalize"— pushes a final summary to the group
 *
 * Called by:
 *   - web/src/app/api/split/route.ts  (POST — bill created)
 *   - web/src/app/api/split/[id]/route.ts (PATCH mark_paid / finalize)
 *
 * Protected by x-internal-key checked in src/index.ts.
 */
import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase"
import { pushMsg }  from "../services/line-push"
import { getAppUrl } from "../lib/app-url"
import { rosterUpdateCard } from "../services/line-bill-cards"

const APP_URL  = getAppUrl()
const LIFF_ID  = process.env.LIFF_ID ?? process.env.NEXT_PUBLIC_LIFF_ID ?? ""
const SPLIT_THEME = "#6366f1"

function fmtTHB(n: number) {
  return "฿" + Number(n).toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function joinUrl(token: string) {
  const path = `/split/join/${token}`
  return LIFF_ID ? `https://liff.line.me/${LIFF_ID}${path}` : `${APP_URL}${path}`
}

function billCreatedCard(params: {
  title:        string
  totalAmount:  number
  shareUrl:     string
  participants: { name: string; amount: number }[]
}): object {
  const { title, totalAmount, shareUrl, participants } = params
  const rows = participants.slice(0, 8).map(p => ({
    type: "box", layout: "horizontal", paddingTop: "6px",
    contents: [
      { type: "text", text: p.name,           size: "sm", color: "#111827", flex: 3 },
      { type: "text", text: fmtTHB(p.amount), size: "sm", color: "#6366f1", align: "end", flex: 2, weight: "bold" },
    ]
  }))

  return {
    type: "flex",
    altText: `🔀 หารบิล: ${title} — ${fmtTHB(totalAmount)}`,
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", paddingAll: "0px",
        background: { type: "linearGradient", angle: "135deg", startColor: "#4f46e5", endColor: "#7c3aed" },
        contents: [{
          type: "box", layout: "horizontal", paddingAll: "16px",
          contents: [
            {
              type: "box", layout: "vertical", flex: 1,
              contents: [
                { type: "text", text: "🔀 หารบิลใหม่", size: "xs", color: "rgba(255,255,255,0.7)", weight: "bold" },
                { type: "text", text: title, size: "lg", color: "#fff", weight: "bold", wrap: true, margin: "xs" },
              ]
            },
            {
              type: "box", layout: "vertical", justifyContent: "center",
              contents: [
                { type: "text", text: fmtTHB(totalAmount), size: "xl", color: "#fff", weight: "bold", align: "end" },
                { type: "text", text: "ยอดรวม", size: "xxs", color: "rgba(255,255,255,0.6)", align: "end" },
              ]
            }
          ]
        }]
      },
      body: {
        type: "box", layout: "vertical", spacing: "none", paddingAll: "16px",
        contents: [
          { type: "text", text: "รายละเอียดการแบ่ง", size: "xs", color: "#6b7280", weight: "bold", margin: "none" },
          ...rows,
          ...(participants.length > 8 ? [{ type: "text", text: `+${participants.length - 8} คน`, size: "xs", color: "#9ca3af", margin: "sm" } as object] : []),
          {
            type: "separator", margin: "lg",
          },
          {
            type: "box", layout: "horizontal", margin: "lg", paddingBottom: "0",
            contents: [
              { type: "text", text: "แชร์ลิงก์ให้เพื่อนกด 👇", size: "xs", color: "#374151", wrap: true },
            ]
          }
        ]
      },
      footer: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "12px",
        contents: [{
          type: "button", style: "primary", color: "#6366f1",
          action: { type: "uri", label: "เปิดบิล / ยืนยันการชำระ", uri: shareUrl },
        }]
      }
    }
  }
}

function paidConfirmText(name: string, amount: number, billTitle: string): string {
  return `✅ ยืนยันการชำระเงิน\n\nคุณ ${name} ชำระ ${fmtTHB(amount)} สำหรับบิล "${billTitle}" เรียบร้อยแล้วครับ 🎉`
}

function finalizeCard(params: {
  title:        string
  totalAmount:  number
  participants: { name: string; amount: number; paid: boolean }[]
}): object {
  const { title, totalAmount, participants } = params
  const paidAll = participants.every(p => p.paid)

  return {
    type: "flex",
    altText: `${paidAll ? "✅" : "🧾"} ${title} — ปิดบิลแล้ว`,
    contents: {
      type: "bubble",
      body: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "16px",
        contents: [
          { type: "text", text: paidAll ? "✅ ชำระครบแล้ว!" : "🧾 ปิดบิลแล้ว", weight: "bold", size: "lg", color: paidAll ? "#10b981" : "#6366f1" },
          { type: "text", text: title, size: "md", color: "#111827", wrap: true },
          { type: "text", text: `ยอดรวม ${fmtTHB(totalAmount)}`, size: "sm", color: "#6b7280" },
          { type: "separator", margin: "md" },
          ...participants.map(p => ({
            type: "box", layout: "horizontal", margin: "sm",
            contents: [
              { type: "text", text: `${p.paid ? "✓" : "○"} ${p.name}`, size: "sm", color: p.paid ? "#10b981" : "#374151", flex: 3 },
              { type: "text", text: fmtTHB(p.amount), size: "sm", color: "#111827", align: "end", flex: 2 },
            ]
          }) as object)
        ]
      }
    }
  }
}

export async function splitNotifyRoutes(app: FastifyInstance) {
  app.post<{
    Body: {
      billId:          string
      event:           "created" | "paid" | "finalize" | "rosterUpdate"
      lineUserId?:     string
      participantName?: string
      amount?:         number
      billTitle?:      string
      addedName?:      string
      removedName?:    string
      leftName?:       string
    }
  }>("/split/notify", async (req, reply) => {
    const { billId, event, lineUserId, participantName, amount, billTitle, addedName, removedName, leftName } = req.body

    // For "paid" event — push personal DM to participant
    if (event === "paid" && lineUserId && participantName && amount !== undefined && billTitle) {
      try {
        await pushMsg(lineUserId, [{ type: "text", text: paidConfirmText(participantName, amount, billTitle) }])
      } catch (e: any) {
        console.error("[split-notify:paid]", e.message)
      }
      return reply.send({ ok: true })
    }

    // For "created" / "finalize" / "rosterUpdate" — push to the bill's LINE group
    const { data: bill } = await supabase
      .from("split_bills")
      .select("id, title, total_amount, status, share_token, line_group_id, split_participants(id, name, amount, paid_at, line_user_id, added_by_participant_id)")
      .eq("id", billId)
      .maybeSingle()

    if (!bill) return reply.send({ ok: true, skipped: "bill not found" })
    if (!bill.line_group_id) return reply.send({ ok: true, skipped: "no line_group_id" })

    const parts = (bill.split_participants as any[])

    try {
      if (event === "rosterUpdate") {
        if (addedName) {
          await pushMsg(bill.line_group_id, [{ type: "text", text: `✅ เพิ่ม ${addedName} เข้าร่วม "${bill.title}" แล้วครับ` }])
        }
        if (removedName) {
          await pushMsg(bill.line_group_id, [{ type: "text", text: `❌ ลบ ${removedName} ออกจาก "${bill.title}" แล้วครับ` }])
        }
        if (leftName) {
          await pushMsg(bill.line_group_id, [{ type: "text", text: `🙅 ${leftName} ไม่เข้าร่วม "${bill.title}" ครับ` }])
        }
        const guestsByParent = new Map<string, { name: string }[]>()
        for (const p of parts) {
          if (!p.added_by_participant_id) continue
          const list = guestsByParent.get(p.added_by_participant_id) ?? []
          list.push({ name: p.name })
          guestsByParent.set(p.added_by_participant_id, list)
        }
        const topLevel = parts.filter(p => !p.added_by_participant_id)
        const card = rosterUpdateCard({
          title:      bill.title,
          themeColor: SPLIT_THEME,
          statusUrl:  joinUrl(bill.share_token),
          participants: topLevel.map(p => ({
            name: p.name as string,
            guests: guestsByParent.get(p.id) ?? [],
          })),
        })
        await pushMsg(bill.line_group_id, [card])

      } else if (event === "created") {
        const shareUrl = joinUrl(bill.share_token)
        const card = billCreatedCard({
          title:        bill.title,
          totalAmount:  Number(bill.total_amount),
          shareUrl,
          participants: parts.map(p => ({ name: p.name, amount: Number(p.amount) })),
        })
        await pushMsg(bill.line_group_id, [card])

      } else if (event === "finalize") {
        const card = finalizeCard({
          title:        bill.title,
          totalAmount:  Number(bill.total_amount),
          participants: parts.map(p => ({ name: p.name, amount: Number(p.amount), paid: !!p.paid_at })),
        })
        await pushMsg(bill.line_group_id, [card])
      }
    } catch (e: any) {
      console.error("[split-notify]", e.message)
    }

    return reply.send({ ok: true })
  })
}
