import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isRegistrationClosed, rebalance } from "../sport-groups/_lib"
import { liffUnauthorized, verifyClaimedLineUser } from "@/lib/liff-auth"

// Pushes a "ตอนนี้มีใครอยู่บ้าง" roster card into the bill's LINE group
// (no-op server-side if it has no line_group_id). Routed to the sport vs.
// general/trip notify endpoint depending on the bill's category. Returns a
// diagnostic result instead of swallowing everything — fetch() only rejects
// on network-level failures, never on non-2xx HTTP responses, so a
// misconfigured INTERNAL_API_KEY or a Fastify-side error would otherwise
// fail completely silently.
type NotifyResult = { attempted: boolean; ok?: boolean; status?: number; skipped?: string; error?: string }
// `leftName` (self-initiated "ไม่เข้าร่วม"/cancel) is worded differently from
// `removedName` (an admin or the person who added them took them off the
// list) — same underlying roster-refresh event, different announcement text.
async function notifyRoster(
  category: string, billId: string,
  addedName?: string, removedName?: string, leftName?: string,
): Promise<NotifyResult> {
  if (!process.env.API_BASE_URL || !process.env.INTERNAL_API_KEY) {
    return { attempted: false, skipped: "API_BASE_URL or INTERNAL_API_KEY not set on the web server" }
  }
  const path = category === "sport" ? "/sport/notify" : "/split/notify"
  try {
    const res = await fetch(`${process.env.API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-key": process.env.INTERNAL_API_KEY },
      body: JSON.stringify({ billId, event: "rosterUpdate", addedName, removedName, leftName }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      console.error("[join-split:notifyRoster] non-OK response:", res.status, data)
      return { attempted: true, ok: false, status: res.status, error: data?.error ?? `HTTP ${res.status}` }
    }
    return { attempted: true, ok: true, skipped: data?.skipped }
  } catch (err: any) {
    console.error("[join-split:notifyRoster] failed:", err.message)
    return { attempted: true, ok: false, error: err.message }
  }
}

// Checks LINE's Group Member API directly — used to let people who are
// already in the bill's source LINE group chat add a named guest, even
// before they've tapped "เข้าร่วม" themselves (e.g. they opened the invite
// link from the group but haven't joined yet). Returns false (not true) on
// any error so an API hiccup fails closed rather than silently granting
// access.
async function isLineGroupMember(groupId: string, lineUserId: string): Promise<boolean> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) return false
  try {
    const res = await fetch(`https://api.line.me/v2/bot/group/${groupId}/member/${lineUserId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    return res.ok
  } catch {
    return false
  }
}

// Loads the current roster as a tree — top-level participants with any named
// guests (added via this same guest form) nested underneath. Returned to the
// client so the join/guest-add success screen can show "who's in now"
// without a separate round-trip. `viewerLineUserId` (if given) is resolved to
// the viewer's own participant row id so the client can tell which "ลบ"
// buttons to show — only yourself and friends *you* added, never someone
// else's entry (LIFF page has no concept of "admin" the way the dashboard does).
async function loadRoster(admin: ReturnType<typeof createAdminClient>, billId: string, viewerLineUserId?: string | null) {
  const { data: parts } = await admin.from("split_participants")
    .select("id, name, guest_count, added_by_participant_id, line_user_id")
    .eq("split_bill_id", billId)
    .order("created_at")

  const all = parts ?? []
  const guestsByParent = new Map<string, { id: string; name: string }[]>()
  for (const p of all) {
    if (!p.added_by_participant_id) continue
    const list = guestsByParent.get(p.added_by_participant_id) ?? []
    list.push({ id: p.id, name: p.name })
    guestsByParent.set(p.added_by_participant_id, list)
  }
  const topLevel = all.filter(p => !p.added_by_participant_id)
  const me = viewerLineUserId ? all.find(p => p.line_user_id === viewerLineUserId) : undefined
  return {
    totalCount: all.reduce((s, p) => s + 1 + (p.guest_count ?? 0), 0),
    meParticipantId: me?.id ?? null,
    participants: topLevel.map(p => ({
      id: p.id as string,
      name: p.name as string,
      guests: guestsByParent.get(p.id) ?? [],
    })),
  }
}

// POST — Join a split bill via LIFF, or (if `guestName`/`friendUserId` is
// given) register a friend on the caller's behalf — either a name typed by
// hand, or someone picked from the caller's in-app friends list. Guests no
// longer get their own tracked amount — their share folds into whoever added
// them, who settles up with that friend directly ("จัดการกันเอาเอง").
export async function POST(req: NextRequest) {
  const { token, lineUserId, displayName, pictureUrl, guestName, friendUserId, removeParticipantId } = await req.json() as {
    token:        string
    lineUserId:   string
    displayName:  string
    pictureUrl?:  string
    guestName?:   string
    friendUserId?: string  // pick from the adder's in-app friends instead of typing a name
    removeParticipantId?: string  // ยกเลิก/ลบผู้เข้าร่วมที่เพิ่มเข้ามา
  }

  const isGuestRegistration = !!guestName || !!friendUserId
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 })
  if (!isGuestRegistration && !removeParticipantId && !displayName) {
    return NextResponse.json({ error: "displayName required" }, { status: 400 })
  }
  if (removeParticipantId) {
    const verifiedLineUserId = await verifyClaimedLineUser(req, lineUserId)
    if (!verifiedLineUserId) return liffUnauthorized("Valid LINE identity required to remove a participant")
  } else if (!isGuestRegistration) {
    const verifiedLineUserId = await verifyClaimedLineUser(req, lineUserId)
    if (!verifiedLineUserId) return liffUnauthorized("Valid LINE identity required")
  } else if (friendUserId) {
    // Picking from the friends list requires knowing who's picking, to check
    // they're actually friends with that person.
    const verifiedLineUserId = await verifyClaimedLineUser(req, lineUserId)
    if (!verifiedLineUserId) return liffUnauthorized("Valid LINE identity required to add from your friends list")
  } else if (lineUserId) {
    const verifiedLineUserId = await verifyClaimedLineUser(req, lineUserId)
    if (!verifiedLineUserId) return liffUnauthorized("LINE identity mismatch")
  }

  const admin = createAdminClient()

  const { data: bill } = await admin.from("split_bills")
    .select("id, status, organization_id, category, total_amount, booking_date, start_time, end_time, max_players, creator_id, line_group_id")
    .eq("share_token", token)
    .single()

  if (!bill) return NextResponse.json({ error: "Bill not found" }, { status: 404 })
  if (bill.status === "finalized") return NextResponse.json({ error: "Bill is finalized" }, { status: 400 })
  if (bill.category === "sport" && isRegistrationClosed(bill.booking_date, bill.start_time, bill.end_time)) {
    return NextResponse.json({ error: "เกินกำหนดการลงทะเบียนแล้วครับ" }, { status: 400 })
  }

  // ยกเลิก/ลบผู้เข้าร่วม — ทำได้แค่ 2 กรณีเท่านั้น: (1) คนที่เพิ่มเข้ามาเอง
  // (added_by_participant_id ตรงกับเรา) หรือ (2) เจ้าตัวเอง ("ยกเลิกการเข้าร่วม")
  // คนที่เข้าร่วมเอง (ไม่มีคนเพิ่ม) — ใครก็ลบแทนไม่ได้ แม้แต่ผู้สร้างบิล
  if (removeParticipantId) {
    const { data: target } = await admin.from("split_participants")
      .select("id, name, line_user_id, added_by_participant_id")
      .eq("id", removeParticipantId).eq("split_bill_id", bill.id).maybeSingle()
    if (!target) return NextResponse.json({ error: "ไม่พบผู้เข้าร่วม" }, { status: 404 })

    const [{ data: me }, { data: removerConn }] = await Promise.all([
      admin.from("split_participants")
        .select("id").eq("split_bill_id", bill.id).eq("line_user_id", lineUserId).maybeSingle(),
      admin.from("line_connections").select("user_id").eq("line_user_id", lineUserId).maybeSingle(),
    ])

    const isSelf    = target.line_user_id === lineUserId
    const isMyGuest = !!target.added_by_participant_id && target.added_by_participant_id === me?.id
    // The group's creator ("admin") can remove anyone — e.g. a no-show or a
    // duplicate entry — not just their own added guests.
    const isAdmin   = !!removerConn?.user_id && removerConn.user_id === bill.creator_id
    if (!isSelf && !isMyGuest && !isAdmin) {
      return NextResponse.json({ error: "ลบได้แค่ตัวเอง หรือคนที่คุณเพิ่มเข้ามาเท่านั้น — คนที่เข้าร่วมเองไม่มีสิทธิ์ลบ" }, { status: 403 })
    }

    const { error: deleteError } = await admin.from("split_participants").delete().eq("id", removeParticipantId)
    if (deleteError) {
      console.error("[join-split] delete failed:", deleteError.message)
      return NextResponse.json({ error: `ลบไม่สำเร็จ: ${deleteError.message}` }, { status: 500 })
    }

    await rebalance(admin, bill.id, Number(bill.total_amount ?? 0))
    // Notify the group either way — a self-cancel ("ไม่เข้าร่วม") gets its
    // own wording (leftName) distinct from being removed by someone else
    // (removedName), but the group hears about both now instead of only
    // the latter.
    const [lineNotify, roster] = await Promise.all([
      isSelf
        ? notifyRoster(bill.category, bill.id, undefined, undefined, target.name as string)
        : notifyRoster(bill.category, bill.id, undefined, target.name as string),
      loadRoster(admin, bill.id, lineUserId),
    ])
    return NextResponse.json({ ok: true, removed: true, lineNotify, ...roster })
  }

  // Guest registration — add a friend nested under whoever added them. Their
  // share folds into the adder's amount; the guest's own amount stays 0.
  if (isGuestRegistration) {
    const { count } = await admin.from("split_participants")
      .select("id", { count: "exact", head: true })
      .eq("split_bill_id", bill.id)

    if (bill.max_players && (count ?? 0) >= bill.max_players) {
      return NextResponse.json({ error: "ครบจำนวนผู้เข้าร่วมแล้วครับ" }, { status: 400 })
    }

    let adderId: string | null = null
    let adderUserId: string | null = null
    if (lineUserId) {
      const [{ data: adder }, { data: adderConn }] = await Promise.all([
        admin.from("split_participants")
          .select("id").eq("split_bill_id", bill.id).eq("line_user_id", lineUserId).maybeSingle(),
        admin.from("line_connections").select("user_id").eq("line_user_id", lineUserId).maybeSingle(),
      ])
      adderId = adder?.id ?? null
      adderUserId = adderConn?.user_id ?? null
    }

    // Only let someone add a friend if they're already part of this circle —
    // already a participant, a registered Slippy user, or a member of the
    // LINE group this bill was created from. A total stranger who just has
    // the share link (and isn't in the group) shouldn't be able to pad the
    // roster with names.
    const isEligibleAdder = !!adderId || !!adderUserId
      || (!!bill.line_group_id && !!lineUserId && await isLineGroupMember(bill.line_group_id, lineUserId))
    if (!isEligibleAdder) {
      return NextResponse.json(
        { error: "ต้องเข้าร่วมกลุ่มนี้ หรือเป็นสมาชิกในระบบ Slippy/LINE Group ก่อน ถึงจะเพิ่มเพื่อนได้ครับ" },
        { status: 403 },
      )
    }

    let name = guestName ?? ""
    let friendLineUserId: string | null = null
    if (friendUserId) {
      if (!adderUserId) return NextResponse.json({ error: "เชื่อมต่อบัญชี Slippy ก่อนเพิ่มเพื่อนจากระบบ" }, { status: 400 })

      // Labeling someone as a guest on a bill is low-stakes (just a name +
      // optional LINE link for nicer display) — unlike the dashboard's
      // host-driven "เพิ่มเพื่อนใน Slippy" picker, this doesn't require an
      // already-accepted friendship. Any existing system user can be picked.
      const [{ data: friendUser }, { data: friendConn }] = await Promise.all([
        admin.from("users").select("full_name").eq("id", friendUserId).maybeSingle(),
        admin.from("line_connections").select("line_user_id, display_name").eq("user_id", friendUserId).maybeSingle(),
      ])
      if (!friendUser) return NextResponse.json({ error: "ไม่พบผู้ใช้นี้ในระบบ" }, { status: 400 })
      // Prefer the LINE display name (always current) over users.full_name
      // (only ever set from signup metadata, commonly null for LINE-first accounts).
      name = friendConn?.display_name ?? friendUser?.full_name ?? "เพื่อน"
      friendLineUserId = friendConn?.line_user_id ?? null
    }
    if (!name.trim()) return NextResponse.json({ error: "กรุณาระบุชื่อ" }, { status: 400 })

    const { error: insertError } = await admin.from("split_participants").insert({
      split_bill_id: bill.id,
      name,
      line_user_id:  friendLineUserId,
      line_display:  name,
      is_non_line:   !friendLineUserId,
      amount:        0,
      added_by_participant_id: adderId,
    })
    if (insertError) {
      console.error("[join-split] insert failed:", insertError.message)
      return NextResponse.json({ error: `เพิ่มเพื่อนไม่สำเร็จ: ${insertError.message}` }, { status: 500 })
    }

    await rebalance(admin, bill.id, Number(bill.total_amount ?? 0))
    const [lineNotify, roster] = await Promise.all([
      notifyRoster(bill.category, bill.id, name),
      loadRoster(admin, bill.id, lineUserId),
    ])
    return NextResponse.json({
      ok: true, joined: true,
      addedName: name,
      nestedUnderAdder: !!adderId,
      lineNotify,
      ...roster,
    })
  }

  // Check if already joined — still re-send the roster card to the LINE
  // group and return the current participant list, instead of silently
  // no-op'ing. Tapping "เข้าร่วม" again is a reasonable way to ask "who's in
  // right now?", especially after the chat history has scrolled past the
  // last card.
  const { data: existing } = await admin.from("split_participants")
    .select("id, amount").eq("split_bill_id", bill.id).eq("line_user_id", lineUserId).maybeSingle()

  if (existing) {
    const [lineNotify, roster] = await Promise.all([
      notifyRoster(bill.category, bill.id),
      loadRoster(admin, bill.id, lineUserId),
    ])
    return NextResponse.json({ ok: true, alreadyJoined: true, amount: Number(existing.amount), lineNotify, ...roster })
  }

  const { error: joinInsertError } = await admin.from("split_participants").insert({
    split_bill_id: bill.id,
    name:          displayName,
    line_user_id:  lineUserId,
    line_display:  displayName,
    is_non_line:   false,
    amount:        0,
  })
  if (joinInsertError) {
    console.error("[join-split] insert failed:", joinInsertError.message)
    return NextResponse.json({ error: `เข้าร่วมไม่สำเร็จ: ${joinInsertError.message}` }, { status: 500 })
  }

  // Sport/Trip/General groups (category='sport'|'trip'|'general') split a flat
  // fee EVENLY per head across whoever has joined so far, folding any guests'
  // shares onto their adder — recompute now that the headcount changed.
  // (Receipt-based /split bills keep their item-claim-derived amounts as-is.)
  let myAmount = 0
  if (bill.category === "sport" || bill.category === "trip" || bill.category === "general") {
    await rebalance(admin, bill.id, Number(bill.total_amount ?? 0))
    const { data: me } = await admin.from("split_participants")
      .select("amount").eq("split_bill_id", bill.id).eq("line_user_id", lineUserId).maybeSingle()
    myAmount = Number(me?.amount ?? 0)
  }

  const [lineNotify, roster] = await Promise.all([
    notifyRoster(bill.category, bill.id, displayName),
    loadRoster(admin, bill.id, lineUserId),
  ])
  return NextResponse.json({ ok: true, joined: true, amount: myAmount, lineNotify, ...roster })
}
