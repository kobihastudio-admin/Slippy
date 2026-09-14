/**
 * line-bill-cards.ts — shared "KhunThong-style" Flex/text card builders for
 * even-split bill groups (`split_bills` with category 'sport' | 'trip' | ...).
 *
 * Both line-sport.ts and line-trip.ts re-export thin, theme-colored wrappers
 * around these generic builders so the visual language stays identical while
 * each feature keeps its own emoji/category conventions.
 */

function fmtTHB(n: number | null | undefined): string {
  if (!n) return "฿0.00"
  return "฿" + Number(n).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ─── Ranking helper — medals for the first 3 to pay + crown for the collector ──
// Mirrors the KhunThong-style summary: 🥇🥈🥉 for the first three paid_at
// (chronological), 👑 for whoever created/collects the bill, others plain.
export function rankedRows(participants: Array<{ name: string; amount: number; paidAt: string | null; isCollector?: boolean }>) {
  const paidOrder = participants
    .map((p, i) => ({ ...p, i }))
    .filter(p => p.paidAt)
    .sort((a, b) => new Date(a.paidAt!).getTime() - new Date(b.paidAt!).getTime())

  const medal: Record<number, string> = {}
  const MEDALS = ["🥇", "🥈", "🥉"]
  paidOrder.slice(0, 3).forEach((p, idx) => { medal[p.i] = MEDALS[idx] })

  return participants.map((p, i) => ({
    ...p,
    badge: p.isCollector ? "👑" : (medal[i] ?? ""),
  }))
}

// ─── Flex: bill created/finalized — themed summary card with per-person amounts ──
// Mirrors the "ตีแบด 27 May 26 / ฿830 / เรียกเก็บโดย IRONNAN" KhunThong card.
export function billCreatedCard(params: {
  title: string; total: number; collectorName: string
  participants: Array<{ name: string; amount: number; paid: boolean; paidAt: string | null; isCollector?: boolean }>
  payUrl: string; statusUrl?: string; themeColor: string
}): object {
  const { title, total, collectorName, participants, payUrl, statusUrl, themeColor } = params
  const rows = rankedRows(participants.map(p => ({ name: p.name, amount: p.amount, paidAt: p.paidAt, isCollector: p.isCollector })))

  const rowContents: object[] = rows.map((p, idx) => ({
    type: "box", layout: "horizontal", paddingTop: idx === 0 ? "0px" : "8px",
    contents: [
      {
        type: "text",
        text: `${p.badge ? p.badge + " " : ""}${participants[idx].paid ? "" : "@"}${p.name}`,
        size: "sm", wrap: true, flex: 5,
        color: participants[idx].paid ? "#111827" : "#dc2626",
        weight: p.badge ? "bold" : "regular",
      },
      { type: "text", text: String(Math.round(p.amount)), size: "sm", weight: "bold", color: "#111827", align: "end", flex: 2 },
    ]
  }))

  return {
    type: "flex",
    altText: `🧾 บิล "${title}" — รวม ${fmtTHB(total)} เรียกเก็บโดย ${collectorName}`,
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", paddingAll: "18px",
        backgroundColor: themeColor,
        contents: [
          { type: "text", text: title, size: "md", color: "#ffffff", weight: "bold" },
          { type: "text", text: `฿ ${Math.round(total)}`, size: "xxl", color: "#ffffff", weight: "bold", margin: "sm" },
          { type: "text", text: `เรียกเก็บโดย ${collectorName}`, size: "xs", color: "#ffffffd9", margin: "xs" },
        ]
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "16px", spacing: "sm",
        contents: rowContents,
      },
      footer: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "12px",
        contents: [
          ...(statusUrl ? [{ type: "button", style: "link", height: "sm",
            action: { type: "uri", label: "ดูว่าใครจ่ายเงินแล้ว", uri: statusUrl } } as object] : []),
          { type: "button", style: "primary", height: "sm", color: themeColor,
            action: { type: "uri", label: "จ่ายเงิน", uri: payUrl } },
        ]
      }
    }
  }
}

// ─── Text: payment confirmation — posted to the group on each pay ─────────────
// "{badge} {name} จ่ายแล้ว {amount} บาท ให้ {collector}"
// + bill status line "บิล "{title}" จ่ายแล้ว / ค้างอยู่ N คน"
export function paymentConfirmText(params: {
  title: string; payerName: string; amount: number; collectorName: string
  participants: Array<{ name: string; amount: number; paid: boolean; paidAt: string | null; isCollector?: boolean }>
}): object {
  const { title, payerName, amount, collectorName, participants } = params
  const rows = rankedRows(participants.map(p => ({ name: p.name, amount: p.amount, paidAt: p.paidAt, isCollector: p.isCollector })))
  const me   = rows.find(p => p.name === payerName)
  const badge = me?.badge ? `${me.badge} ` : ""

  const unpaidCount = participants.filter(p => !p.paid).length
  const statusLine  = unpaidCount === 0
    ? `🎉 บิล "${title}" จ่ายครบแล้ว`
    : `⏳ บิล "${title}" — ค้างจ่ายอยู่ ${unpaidCount} คน`

  return {
    type: "text",
    text:
      `${badge}${payerName} จ่ายแล้ว ${amount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท ให้ ${collectorName}\n\n` +
      statusLine,
  }
}

// ─── Flex: fully-paid celebration — posted once the last person pays ──────────
export function fullyPaidCard(params: {
  title: string; subtitle?: string; themeColor: string
  participants: Array<{ name: string; amount: number; paidAt: string | null; isCollector?: boolean }>
}): object {
  const { title, subtitle, participants, themeColor } = params
  const rows = rankedRows(participants.map(p => ({ name: p.name, amount: p.amount, paidAt: p.paidAt, isCollector: p.isCollector })))

  const rowContents: object[] = rows.map((p, idx) => ({
    type: "box", layout: "horizontal", paddingTop: idx === 0 ? "0px" : "8px",
    contents: [
      { type: "text", text: `${p.badge ? p.badge + " " : ""}${p.name}`, size: "sm", wrap: true, color: "#111827", weight: p.badge ? "bold" : "regular", flex: 5 },
      { type: "text", text: String(Math.round(p.amount)), size: "sm", weight: "bold", color: "#111827", align: "end", flex: 2 },
    ]
  }))

  return {
    type: "flex",
    altText: `🎉 ${title} — จ่ายครบแล้ว`,
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", paddingAll: "18px",
        backgroundColor: themeColor,
        contents: [
          { type: "text", text: subtitle ? `${title} ${subtitle}` : title, size: "sm", color: "#ffffff", weight: "bold" },
          { type: "text", text: "จ่ายครบแล้ว 🎉", size: "xl", color: "#ffffff", weight: "bold", margin: "sm" },
        ]
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "16px", spacing: "sm",
        contents: rowContents,
      }
    }
  }
}

// ─── Flex: roster update — "ตอนนี้มีใครอยู่บ้าง" posted to the group whenever
// someone joins or a friend is added/removed. Named guests (added via the
// public join-link guest form, or by a host friend-picker) nest under whoever
// added them — same tree shown in the LIFF roster — since their cost is
// folded into that person's amount rather than tracked separately.
export function rosterUpdateCard(params: {
  title: string; themeColor: string; statusUrl: string
  participants: Array<{ name: string; isMe?: boolean; guests: Array<{ name: string }> }>
}): object {
  const { title, themeColor, statusUrl, participants } = params
  const totalCount = participants.reduce((s, p) => s + 1 + p.guests.length, 0)

  const rows: object[] = participants.flatMap(p => [
    {
      type: "box", layout: "horizontal", paddingTop: "6px",
      contents: [
        { type: "text", text: `👤 ${p.name}`, size: "sm", color: "#111827", weight: "bold", wrap: true, flex: 1 },
      ]
    },
    ...p.guests.map(g => ({
      type: "box", layout: "horizontal", paddingTop: "2px", paddingStart: "16px",
      contents: [
        { type: "text", text: `↳ ${g.name}`, size: "xs", color: "#6b7280", wrap: true, flex: 1 },
        { type: "text", text: `รวมกับ ${p.name}`, size: "xxs", color: "#9ca3af", align: "end", flex: 0 },
      ]
    }) as object),
  ])

  return {
    type: "flex",
    altText: `👥 ${title} — ตอนนี้มี ${totalCount} คน`,
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", paddingAll: "16px",
        backgroundColor: themeColor,
        contents: [
          { type: "text", text: title, size: "sm", color: "#ffffffd9", weight: "bold", wrap: true },
          { type: "text", text: `👥 ตอนนี้มี ${totalCount} คน`, size: "lg", color: "#ffffff", weight: "bold", margin: "xs" },
        ]
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "16px", spacing: "sm",
        contents: rows.length > 0 ? rows : [{ type: "text", text: "ยังไม่มีผู้เข้าร่วม", size: "sm", color: "#9ca3af" }],
      },
      footer: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "12px",
        contents: [
          { type: "button", style: "link", height: "sm",
            action: { type: "uri", label: "เปิดดูในแอป", uri: statusUrl } },
        ]
      }
    }
  }
}

// ─── Flex: reminder — periodic "อย่าลืมจ่ายด้วยนะ 📌" for outstanding bills ─────
export function reminderCard(params: {
  bills: Array<{ title: string; unpaid: Array<{ name: string; amount: number }> }>
  statusUrl: string; payUrl: string; themeColor: string
}): object {
  const { bills, statusUrl, payUrl, themeColor } = params
  const totalUnpaid = bills.reduce((s, b) => s + b.unpaid.length, 0)

  const rowContents: object[] = bills.flatMap(b =>
    b.unpaid.map(p => ({
      type: "box", layout: "horizontal", paddingTop: "4px",
      contents: [
        { type: "text", text: `@${p.name}`, size: "sm", color: "#dc2626", weight: "bold", wrap: true, flex: 5 },
        { type: "text", text: String(Math.round(p.amount)), size: "sm", weight: "bold", color: "#111827", align: "end", flex: 2 },
      ]
    }))
  )

  return {
    type: "flex",
    altText: `📌 อย่าลืมจ่ายด้วยนะ — มีค้างจ่ายอยู่ ${totalUnpaid} บิล`,
    contents: {
      type: "bubble",
      body: {
        type: "box", layout: "vertical", paddingAll: "16px", spacing: "sm",
        contents: [
          {
            type: "box", layout: "horizontal",
            contents: [
              { type: "text", text: "อย่าลืมจ่ายด้วยนะ", weight: "bold", size: "md", flex: 5 },
              { type: "text", text: "📌", size: "md", align: "end", flex: 1 },
            ]
          },
          { type: "text", text: `มีค้างจ่ายอยู่ ${totalUnpaid} บิล`, size: "xs", color: "#9ca3af" },
          { type: "separator", margin: "sm" },
          ...rowContents,
        ]
      },
      footer: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "12px",
        contents: [
          { type: "button", style: "link", height: "sm",
            action: { type: "uri", label: "ดูบิลทั้งหมด", uri: statusUrl } },
          { type: "button", style: "primary", height: "sm", color: themeColor,
            action: { type: "uri", label: "จ่ายเงิน", uri: payUrl } },
        ]
      }
    }
  }
}
