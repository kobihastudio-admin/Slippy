/**
 * The trip document, as an HTML string.
 *
 * WHY A STRING BUILDER AND NOT A REACT COMPONENT
 * It was a React component, and the PDF route rendered it with
 * renderToStaticMarkup. Next refuses that: a route handler is compiled under
 * React's `react-server` export condition, and react-dom/server resolves to a
 * stub that throws "react-dom/server is not supported in React Server
 * Components" — for the bare specifier and for react-dom/server.node alike.
 *
 * The alternatives were all worse than this one. Duplicating the layout into a
 * second template would leave a PDF free to drift from the page it claims to
 * copy. Having Chrome load the real /print page would mean carrying the user's
 * session cookie into the api service and giving the renderer network access.
 *
 * A print document is static markup with no interactivity, so a string builder
 * loses nothing, and it can be called from anywhere — a route handler, a page,
 * a verification script — because it imports nothing but data.
 *
 * Everything interpolated goes through esc(). The inputs are user-entered trip
 * titles and machine-read document fields, which is exactly the shape of thing
 * that ends up containing a bracket.
 */
import {
  type JourneyDay, type JourneyParticipant, type ChecklistItem, type TripNote,
  itemSpec, fmtTHB, originalAmount, journeyTotal, spendByCategory,
  fmtDayLabel, fmtWeekday, hhmm,
} from "@/lib/trips/journey"

export interface TripDocumentData {
  trip: {
    id: string
    title: string
    destination: string | null
    description: string | null
    base_currency: string
    started_at: string | null
    ended_at: string | null
  }
  days: JourneyDay[]
  participants: JourneyParticipant[]
  checklist: ChecklistItem[]
  notes: TripNote[]
}

const esc = (v: unknown): string =>
  String(v ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!))

/**
 * "20 พฤศจิกายน 2569 – 27 พฤศจิกายน 2569" from two plain YYYY-MM-DD dates.
 *
 * Takes DATES, not timestamps. life_journeys.started_at is a timestamptz set to
 * midnight in the destination's timezone — 2026-11-20T00:00+09:00 for Japan —
 * and formatting that instant on a server in Bangkok (+07) renders 19 November.
 * The cover said the trip started a day before it does. The itinerary days carry
 * real `date` columns with no timezone attached, which is the honest source.
 */
const fmtRange = (a: string | null, b: string | null): string => {
  if (!a) return ""
  // T00:00:00 with no offset parses as local midnight, so the calendar date
  // survives whatever timezone this renders in.
  const f = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("th-TH",
    { day: "numeric", month: "long", year: "numeric" })
  return b && b !== a ? `${f(a)} – ${f(b)}` : f(a)
}

/** The date part of either a plain date or an ISO timestamp, untouched. */
const dayPart = (v: string | null): string | null => v?.slice(0, 10) ?? null

/** Detail entries worth printing — scalars only, `details` is free-form jsonb. */
const detailBits = (details: Record<string, unknown> | null): string =>
  Object.entries(details ?? {})
    .filter(([, v]) => v != null && v !== "" && typeof v !== "object")
    .map(([k, v]) => `${esc(k.replace(/_/g, " "))}: ${esc(v)}`)
    .join("  ·  ")

export function buildTripDocumentHtml(d: TripDocumentData): string {
  const { trip, days, participants, checklist, notes } = d
  const total   = journeyTotal(days)
  const byCat   = spendByCategory(days)
  const perHead = participants.length ? total / participants.length : total
  const itemCount = days.reduce((s, x) => s + x.trip_itinerary_items.length, 0)
  const doneChecks = checklist.filter(c => c.is_done).length

  const bookings = days.flatMap(x => x.trip_itinerary_items
    .filter(i => i.confirmation_code || i.provider)
    .map(i => ({ item: i, date: x.date })))

  // ── Cover ──
  const cover = `
<section class="print-page">
  <p class="eyebrow">แผนการเดินทาง</p>
  <h1>${esc(trip.title)}</h1>
  ${trip.destination ? `<p class="sub">${esc(trip.destination)}</p>` : ""}
  <p class="muted">${esc(fmtRange(days[0]?.date ?? dayPart(trip.started_at),
                                  days[days.length - 1]?.date ?? dayPart(trip.ended_at)))}</p>
  ${trip.description ? `<p class="lede">${esc(trip.description)}</p>` : ""}

  <div class="stats">
    ${[["จำนวนวัน", `${days.length} วัน`], ["รายการ", String(itemCount)],
       ["ผู้เดินทาง", `${participants.length} คน`], ["งบรวม", fmtTHB(total)]]
      .map(([k, v]) => `<div><p class="statk">${esc(k)}</p><p class="statv">${esc(v)}</p></div>`).join("")}
  </div>

  ${participants.length ? `
  <div class="block">
    <p class="statk">ผู้เดินทาง</p>
    <p>${esc(participants.map(p => p.display_name + (p.is_host ? " (เจ้าภาพ)" : "")).join(" · "))}</p>
  </div>` : ""}

  <table class="summary">
    <thead><tr>
      <th>วัน</th><th>วันที่</th><th>เมือง</th><th>สรุป</th><th class="r">ค่าใช้จ่าย</th>
    </tr></thead>
    <tbody>
    ${days.map(x => {
      const t = x.trip_itinerary_items.reduce((s, i) => s + Number(i.amount_base_currency ?? 0), 0)
      return `<tr>
        <td class="num">${x.day_number}</td>
        <td class="nowrap">${esc(fmtDayLabel(x.date))} ${esc(fmtWeekday(x.date))}</td>
        <td>${esc(x.city ?? "—")}</td>
        <td class="muted">${esc(x.title ?? "")}</td>
        <td class="r num">${t > 0 ? esc(fmtTHB(t)) : "—"}</td>
      </tr>`
    }).join("")}
    </tbody>
  </table>
</section>`

  // ── Bookings — the page you actually need at a counter ──
  const bookingsSection = bookings.length ? `
<section class="print-page pad-top">
  <h2>การจองและรหัสยืนยัน</h2>
  <div class="cards">
  ${bookings.map(({ item, date }) => {
    const bits = detailBits(item.details)
    return `<div class="card keep-together">
      <div class="cardhead">
        <div>
          <p class="strong">${esc(item.title)}</p>
          <p class="tiny muted">${esc(itemSpec(item.type).label)}${date ? ` · ${esc(fmtDayLabel(date))}` : ""}${item.time_from ? ` · ${esc(hhmm(item.time_from))}` : ""}${item.provider ? ` · ${esc(item.provider)}` : ""}</p>
        </div>
        ${item.confirmation_code ? `<p class="code">${esc(item.confirmation_code)}</p>` : ""}
      </div>
      ${item.location || item.end_location
        ? `<p class="tiny">${esc(item.location ?? "")}${item.end_location ? ` → ${esc(item.end_location)}` : ""}</p>` : ""}
      ${bits ? `<p class="tiny muted">${bits}</p>` : ""}
    </div>`
  }).join("")}
  </div>
</section>` : ""

  // ── Day by day ──
  const dayPages = days.map(x => `
<section class="print-page pad-top">
  <div class="dayhead">
    <h2>วันที่ ${x.day_number} · ${esc(fmtDayLabel(x.date))} ${esc(fmtWeekday(x.date))}${x.city ? ` <span class="reg muted">· ${esc(x.city)}</span>` : ""}</h2>
    ${x.title ? `<p class="sub">${esc(x.title)}</p>` : ""}
    ${x.summary ? `<p class="tiny muted">${esc(x.summary)}</p>` : ""}
  </div>
  ${x.trip_itinerary_items.length === 0
    ? `<p class="tiny muted pad-top">ยังไม่มีรายการ</p>`
    : `<table class="itin"><tbody>${x.trip_itinerary_items.map(item => {
        const original = originalAmount(item, trip.base_currency)
        return `<tr class="keep-together">
          <td class="time">${esc(hhmm(item.time_from) || "—")}</td>
          <td>
            <p class="strong">${esc(item.title)}${item.status === "optional" ? ` <span class="chip">ถ้ามีเวลา</span>` : ""}</p>
            ${item.subtitle ? `<p class="tiny muted">${esc(item.subtitle)}</p>` : ""}
            ${item.location || item.end_location
              ? `<p class="tiny muted">${esc(item.location ?? "")}${item.end_location ? ` → ${esc(item.end_location)}` : ""}</p>` : ""}
            ${item.confirmation_code ? `<p class="tiny muted">รหัสจอง <span class="mono strong">${esc(item.confirmation_code)}</span></p>` : ""}
            ${item.notes ? `<p class="tiny note">${esc(item.notes)}</p>` : ""}
          </td>
          <td class="r amt">
            ${Number(item.amount_base_currency) > 0
              ? `<p class="strong num">${esc(fmtTHB(Number(item.amount_base_currency)))}</p>${original ? `<p class="tiny muted num">${esc(original)}</p>` : ""}`
              : ""}
          </td>
        </tr>`
      }).join("")}</tbody></table>`}
</section>`).join("")

  // ── Budget, checklist, notes ──
  const tail = `
<section class="print-page pad-top">
  <h2>ค่าใช้จ่ายและเตรียมตัว</h2>
  <div class="two">
    <div class="keep-together">
      <p class="statk">งบประมาณ</p>
      <table class="budget"><tbody>
        ${byCat.map(([name, amount]) =>
          `<tr><td>${esc(name)}</td><td class="r num">${esc(fmtTHB(amount))}</td></tr>`).join("")}
        <tr class="totalrow"><td>รวม</td><td class="r num">${esc(fmtTHB(total))}</td></tr>
        <tr><td class="muted">ต่อคน (${participants.length})</td><td class="r num">${esc(fmtTHB(perHead))}</td></tr>
      </tbody></table>
    </div>
    ${checklist.length ? `
    <div class="keep-together">
      <p class="statk">Checklist (${doneChecks}/${checklist.length})</p>
      <ul class="checks">
      ${checklist.map(c => `<li><span class="box">${c.is_done ? "✓" : "&nbsp;"}</span><span class="${c.is_done ? "done" : ""}">${esc(c.title)}</span></li>`).join("")}
      </ul>
    </div>` : ""}
  </div>
  ${notes.length ? `
  <div class="block">
    <p class="statk">บันทึก</p>
    ${notes.map(n => `<div class="keep-together note-block">
      <p class="strong">${esc(n.title)}</p>
      ${n.body ? `<p class="tiny muted pre">${esc(n.body)}</p>` : ""}
    </div>`).join("")}
  </div>` : ""}
  <p class="footer">สร้างจาก Slippy · ${esc(new Date().toLocaleDateString("th-TH", { dateStyle: "long" }))} · ตัวเลขบางรายการมาจากการอ่านเอกสารอัตโนมัติ ควรตรวจกับเอกสารตัวจริงก่อนใช้</p>
</section>`

  return `<div class="doc">${cover}${bookingsSection}${dayPages}${tail}</div>`
}
