/**
 * trip-preorder-notify.ts — internal endpoint for LINE push notifications on
 * pre-order sessions (สั่งอาหาร/ซื้อของเป็นกลุ่ม — see supabase/migrations/074)
 * belonging to the multi-payer trip system (life_journeys). Named distinctly
 * from trip-notify.ts, which is a separate, older handler for the legacy
 * `category='trip'` split_bills flow — same-sounding but different table,
 * different route path (/trips/preorder/notify vs /trip/notify).
 *
 * Events:
 *   "item_added"   — someone added an item to an open pre-order session
 *   "item_removed" — someone removed their own item
 *   "closed"       — the session was finalized into a real trip_expense
 *
 * Called by web/src/app/api/trips/preorder/[sessionId]/route.ts, fire-and-
 * forget — a failed push here shouldn't fail the actual add/remove/close
 * action itself.
 *
 * Protected by x-internal-key checked in src/index.ts.
 */
import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase"
import { pushMsg }  from "../services/line-push"

function fmtTHB(n: number) {
  return "฿" + Number(n).toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export async function tripPreorderNotifyRoutes(app: FastifyInstance) {
  app.post<{
    Body: {
      sessionId:        string
      event:            "item_added" | "item_removed" | "closed"
      participantName?: string
      itemName?:        string
      price?:           number
      totalAmount?:     number
    }
  }>("/trips/preorder/notify", async (req, reply) => {
    const { sessionId, event, participantName, itemName, price, totalAmount } = req.body

    const { data: session } = await supabase
      .from("preorder_sessions")
      .select("id, title, kind, journey_id, life_journeys(line_group_id)")
      .eq("id", sessionId)
      .maybeSingle()

    if (!session) return reply.send({ ok: true, skipped: "session not found" })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const groupId = (session.life_journeys as any)?.line_group_id
    if (!groupId) return reply.send({ ok: true, skipped: "no line_group_id" })

    const kindLabel = session.kind === "shopping" ? "ซื้อของ" : "สั่งอาหาร"

    try {
      if (event === "item_added" && participantName && itemName && price !== undefined) {
        await pushMsg(groupId, [{
          type: "text",
          text: `🛒 "${session.title}"\n${participantName} เพิ่ม: ${itemName} (${fmtTHB(price)})`,
        }])
      } else if (event === "item_removed" && participantName && itemName) {
        await pushMsg(groupId, [{
          type: "text",
          text: `🗑️ "${session.title}"\n${participantName} ลบรายการ: ${itemName}`,
        }])
      } else if (event === "closed" && totalAmount !== undefined) {
        await pushMsg(groupId, [{
          type: "text",
          text: `✅ ปิดรับ${kindLabel} "${session.title}" แล้ว\nยอดรวม ${fmtTHB(totalAmount)} — เพิ่มเป็นรายจ่ายในทริปเรียบร้อย เช็คยอดที่ต้องจ่ายได้ในแอปเลยครับ`,
        }])
      }
    } catch (e: any) {
      console.error("[trip-preorder-notify]", e.message)
    }

    return reply.send({ ok: true })
  })
}
