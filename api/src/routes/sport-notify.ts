/**
 * sport-notify.ts — internal endpoint that pushes "KhunThong-style" Flex/text
 * cards back into the LINE group/room where a sport group was created,
 * whenever something happens via the LIFF dashboard (pay / unpay / finalize).
 *
 * Called by the web app (web/src/app/api/liff/sport-groups/[id]/route.ts)
 * with the shared `x-internal-key` (already enforced by the parent plugin
 * in src/index.ts — this route does NOT re-check it).
 *
 * No-op (200 OK) if the bill has no `line_group_id` (e.g. created entirely
 * via LIFF, never inside a group chat) — nothing to push to.
 */
import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase"
import { pushMsg } from "../services/line-push"
import { getAppUrl } from "../lib/app-url"
import {
  sportBillCreatedCard, sportPaymentConfirmText, sportFullyPaidCard,
} from "../services/line-sport"
import { rosterUpdateCard } from "../services/line-bill-cards"

const SPORT_THEME = "#6366f1"

const APP_URL = getAppUrl("https://slippy-solutionxteams-projects.vercel.app")

// "ดูว่าใครจ่ายเงินแล้ว" — deep-links into this session's detail page on the
// dashboard, scrolled to the roster section.
function sessionStatusUrl(billId: string): string {
  const liffId = process.env.LIFF_ID ?? process.env.NEXT_PUBLIC_LIFF_ID ?? ""
  const path = `/liff/sport?session=${billId}&focus=roster`
  return liffId ? `https://liff.line.me/${liffId}${path}` : `${APP_URL}${path}`
}

// "จ่ายเงิน" — opens the dedicated payment page (QR + pay button scoped to
// the user who pressed it), instead of the full dashboard.
function sessionPayUrl(billId: string): string {
  const liffId = process.env.LIFF_ID ?? process.env.NEXT_PUBLIC_LIFF_ID ?? ""
  const path = `/liff/sport/pay/${billId}`
  return liffId ? `https://liff.line.me/${liffId}${path}` : `${APP_URL}${path}`
}

export async function sportNotifyRoutes(app: FastifyInstance) {
  // POST /sport/notify { billId, event: "finalize" | "pay" | "unpay" | "sendBill", lineUserId? }
  app.post<{
    Body: { billId: string; event: "finalize" | "pay" | "unpay" | "sendBill" | "rosterUpdate"; lineUserId?: string; addedName?: string; removedName?: string; leftName?: string }
  }>("/sport/notify", async (req, reply) => {
    const { billId, event, lineUserId, addedName, removedName, leftName } = req.body

    const { data: bill } = await supabase
      .from("split_bills")
      .select("id, title, total_amount, status, share_token, line_group_id, booking_date, category, split_participants(id, name, amount, paid_at, line_user_id, created_at, added_by_participant_id)")
      .eq("id", billId)
      .eq("category", "sport")
      .maybeSingle()

    if (!bill) return reply.send({ ok: true, skipped: "bill not found" })
    if (!bill.line_group_id) return reply.send({ ok: true, skipped: "no line_group_id — created via LIFF only" })

    const parts = (bill.split_participants as any[]).slice()
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

    const collector = parts[0]
    const collectorName = collector?.name ?? "ผู้สร้างกลุ่ม"

    const participants = parts.map(p => ({
      name:     p.name as string,
      amount:   Number(p.amount ?? 0),
      paid:     !!p.paid_at,
      paidAt:   p.paid_at as string | null,
      isCollector: p.id === collector?.id,
    }))

    const messages: object[] = []

    if (event === "rosterUpdate") {
      if (addedName) {
        messages.push({ type: "text", text: `✅ เพิ่ม ${addedName} เข้าร่วม "${bill.title}" แล้วครับ` })
      }
      if (removedName) {
        messages.push({ type: "text", text: `❌ ลบ ${removedName} ออกจาก "${bill.title}" แล้วครับ` })
      }
      if (leftName) {
        messages.push({ type: "text", text: `🙅 ${leftName} ไม่เข้าร่วม "${bill.title}" ครับ` })
      }
      const guestsByParent = new Map<string, { name: string }[]>()
      for (const p of parts) {
        if (!p.added_by_participant_id) continue
        const list = guestsByParent.get(p.added_by_participant_id) ?? []
        list.push({ name: p.name })
        guestsByParent.set(p.added_by_participant_id, list)
      }
      const topLevel = parts.filter(p => !p.added_by_participant_id)
      messages.push(rosterUpdateCard({
        title:     bill.title,
        themeColor: SPORT_THEME,
        statusUrl: sessionStatusUrl(bill.id),
        participants: topLevel.map(p => ({
          name: p.name as string,
          guests: guestsByParent.get(p.id) ?? [],
        })),
      }))
    }

    if (event === "finalize" || event === "sendBill") {
      messages.push(sportBillCreatedCard({
        title:         bill.title,
        total:         Number(bill.total_amount ?? 0),
        collectorName,
        participants,
        payUrl:        sessionPayUrl(bill.id),
        statusUrl:     sessionStatusUrl(bill.id),
      }))
    }

    if (event === "pay" || event === "unpay") {
      const me = parts.find(p => p.line_user_id === lineUserId)
      if (me && event === "pay") {
        messages.push(sportPaymentConfirmText({
          title:         bill.title,
          payerName:     me.name,
          amount:        Number(me.amount ?? 0),
          collectorName,
          participants,
        }))

        const allPaid = participants.every(p => p.paid)
        if (allPaid) {
          messages.push(sportFullyPaidCard({
            title: bill.title,
            participants,
          }))
        }
      }
    }

    if (messages.length === 0) return reply.send({ ok: true, skipped: "nothing to send" })

    try {
      await pushMsg(bill.line_group_id, messages)
    } catch (err: any) {
      console.error("[sport-notify] push failed:", err.message)
      return reply.send({ ok: false, error: err.message })
    }

    return reply.send({ ok: true })
  })
}
