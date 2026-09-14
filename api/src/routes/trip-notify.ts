/**
 * trip-notify.ts — internal endpoint that pushes "KhunThong-style" Flex/text
 * cards back into the LINE group/room where a trip group was created,
 * whenever something happens via the LIFF dashboard (pay / unpay / finalize).
 *
 * Mirrors sport-notify.ts but for `category = 'trip'` split_bills, using the
 * sky/blue-themed card builders from line-trip.ts.
 *
 * Called by the web app (web/src/app/api/liff/trip-groups/[id]/route.ts)
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
  tripBillCreatedCard, tripPaymentConfirmText, tripFullyPaidCard,
} from "../services/line-trip"

const APP_URL = getAppUrl("https://slippy-solutionxteams-projects.vercel.app")

function joinUrl(token: string): string {
  const liffId = process.env.LIFF_ID ?? process.env.NEXT_PUBLIC_LIFF_ID ?? ""
  const path = `/liff/join/${token}?type=split`
  return liffId ? `https://liff.line.me/${liffId}${path}` : `${APP_URL}/split/join/${token}`
}

function dashboardUrl(): string {
  const liffId = process.env.LIFF_ID ?? process.env.NEXT_PUBLIC_LIFF_ID ?? ""
  return liffId ? `https://liff.line.me/${liffId}/liff/trip` : `${APP_URL}/liff/trip`
}

export async function tripNotifyRoutes(app: FastifyInstance) {
  // POST /trip/notify { billId, event: "finalize" | "pay" | "unpay", lineUserId? }
  app.post<{
    Body: { billId: string; event: "finalize" | "pay" | "unpay"; lineUserId?: string }
  }>("/trip/notify", async (req, reply) => {
    const { billId, event, lineUserId } = req.body

    const { data: bill } = await supabase
      .from("split_bills")
      .select("id, title, total_amount, status, share_token, line_group_id, category, split_participants(id, name, amount, paid_at, line_user_id, created_at)")
      .eq("id", billId)
      .eq("category", "trip")
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

    if (event === "finalize") {
      messages.push(tripBillCreatedCard({
        title:         bill.title,
        total:         Number(bill.total_amount ?? 0),
        collectorName,
        participants,
        payUrl:        joinUrl(bill.share_token),
        statusUrl:     dashboardUrl(),
      }))
    }

    if (event === "pay" || event === "unpay") {
      const me = parts.find(p => p.line_user_id === lineUserId)
      if (me && event === "pay") {
        messages.push(tripPaymentConfirmText({
          title:         bill.title,
          payerName:     me.name,
          amount:        Number(me.amount ?? 0),
          collectorName,
          participants,
        }))

        const allPaid = participants.every(p => p.paid)
        if (allPaid) {
          messages.push(tripFullyPaidCard({
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
      console.error("[trip-notify] push failed:", err.message)
      return reply.send({ ok: false, error: err.message })
    }

    return reply.send({ ok: true })
  })
}
