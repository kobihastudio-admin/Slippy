/**
 * Opt-in sync of slips/files from LINE groups — decision logic only.
 * No supabase/fetch imports on purpose: api/src/scripts/verify-line-group-sync.ts runs this with no env or network.
 * Spec: docs/superpowers/specs/2026-11-09-line-group-sync-design.md
 */

export type LineSource = { type?: string; userId?: string; groupId?: string; roomId?: string }
export type LineMessage = { type?: string; text?: string; fileName?: string }
export type SyncCommand = "sync" | "stop" | "status"

// A Map, not an object literal: "constructor" / "__proto__" must not look like commands.
const COMMANDS = new Map<string, SyncCommand>([
  ["/syncgroup", "sync"],
  ["/stopsync", "stop"],
  ["/syncstatus", "status"],
])

/** First word only, case-insensitive, extra words ignored: "/SyncGroup  now" → sync. */
export function parseSyncCommand(text: string | undefined): SyncCommand | null {
  const first = (text ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? ""
  return COMMANDS.get(first) ?? null
}

/** The id of the group or room this event came from; null for 1:1 or anything malformed. */
export function lineGroupIdOf(source: LineSource | undefined): string | null {
  if (source?.type === "group") return source.groupId ?? null
  if (source?.type === "room") return source.roomId ?? null
  return null
}

/** Same set the 1:1 path accepts for `file` messages. */
export function isSupportedGroupFile(fileName: string | undefined): boolean {
  return /\.(pdf|heic|heif)$/i.test(fileName ?? "")
}

export type GroupSyncDecision =
  | { action: "continue" }                       // not ours: the existing handlers decide, unchanged
  | { action: "ignore" }                         // drop silently
  | { action: "direct-notice" }                  // a sync command typed in 1:1
  | { action: "need-connect" }                   // a sync command from someone with no Slippy account linked
  | { action: "command"; command: SyncCommand; groupId: string }
  | { action: "process-media"; groupId: string } // run the slip path for this sender, privately

export function classifyGroupSyncEvent(i: {
  source?: LineSource
  message?: LineMessage
  connected: boolean
  optedIn: boolean
}): GroupSyncDecision {
  const { source, message } = i
  const isMedia = message?.type === "image" || message?.type === "file"
  const command = message?.type === "text" ? parseSyncCommand(message.text) : null

  if (command) {
    if (source?.type === "user") return { action: "direct-notice" }
    const groupId = lineGroupIdOf(source)
    if (!groupId || !source?.userId) return { action: "ignore" }
    if (!i.connected) return { action: "need-connect" }
    return { action: "command", command, groupId }
  }

  if (isMedia) {
    if (source?.type === "user") return { action: "continue" }
    const groupId = lineGroupIdOf(source)
    if (!groupId || !source?.userId || !i.connected || !i.optedIn) return { action: "ignore" }
    if (message?.type === "file" && !isSupportedGroupFile(message.fileName)) return { action: "ignore" }
    return { action: "process-media", groupId }
  }

  return { action: "continue" }
}

export const SYNC_TEXT = {
  directOnly: "คำสั่งนี้ใช้ในกลุ่ม LINE เท่านั้นครับ",
  needConnect:
    "ยังไม่ได้เชื่อมบัญชี LINE กับ Slippy ครับ — พิมพ์ /connect CODE ในแชทส่วนตัวกับบอทก่อน แล้วค่อยพิมพ์คำสั่งในกลุ่มอีกครั้ง",
  announceOn: (name: string) =>
    `${name} เปิดซิงก์สลิป/รูป/ไฟล์ที่ ${name} ส่งในกลุ่มนี้เข้า Slippy ของตัวเอง — ` +
    `ข้อความแชทไม่ถูกเก็บ และคนอื่นไม่ได้รับผลกระทบ พิมพ์ /stopsync เพื่อหยุด`,
  alreadyOn: "เปิดซิงก์กลุ่มนี้ไว้อยู่แล้วครับ พิมพ์ /stopsync ในกลุ่มเพื่อหยุด",
  announceFailed: "ส่งประกาศเข้ากลุ่มไม่สำเร็จ จึงยังไม่ได้เปิดซิงก์ ลองพิมพ์ /syncgroup อีกครั้งครับ",
  rollbackFailed: "ส่งประกาศเข้ากลุ่มไม่สำเร็จ และปิดซิงก์อัตโนมัติไม่สำเร็จ — กรุณาพิมพ์ /stopsync ในกลุ่มเพื่อปิดครับ",
  announceOff: (name: string) => `${name} หยุดซิงก์สลิป/รูป/ไฟล์ในกลุ่มนี้แล้ว`,
  notOn: "กลุ่มนี้ยังไม่ได้เปิดซิงก์ไว้ครับ",
  unknownMember: "สมาชิกในกลุ่ม",
}

/**
 * The name shown to the whole group. /connect stores the raw LINE user id as display_name when the profile
 * fetch failed, and that id must never be posted into a group: use a neutral label instead.
 */
export function announceName(displayName: string | null | undefined, lineUserId: string): string {
  const name = (displayName ?? "").trim()
  if (!name || name === lineUserId || /^U[0-9a-f]{32}$/i.test(name)) return SYNC_TEXT.unknownMember
  return name
}

export function statusText(groups: { name: string | null }[]): string {
  if (!groups.length) return "ตอนนี้ยังไม่ได้ซิงก์กลุ่ม LINE ไหนเลยครับ\nพิมพ์ /syncgroup ในกลุ่มที่ต้องการ"
  const lines = groups.map((g, i) => `${i + 1}. ${g.name ?? "กลุ่ม LINE (ไม่ทราบชื่อ)"}`)
  return `กลุ่มที่คุณซิงก์อยู่:\n${lines.join("\n")}\n\nหยุดซิงก์: พิมพ์ /stopsync ในกลุ่มนั้น`
}

/**
 * Opt-in belongs to the LINE SENDER (`lineUserId`), not to the Slippy user: line_connections.user_id is not unique,
 * so several LINE accounts can belong to one Slippy user and only the one who typed /syncgroup consented.
 * `userId` is kept on the row for RLS ("my groups") and attribution.
 */
export interface SyncStore {
  isEnabled(lineUserId: string, groupId: string): Promise<boolean>
  enable(who: { userId: string; lineUserId: string }, groupId: string): Promise<void>
  disable(lineUserId: string, groupId: string): Promise<void>
  list(lineUserId: string): Promise<{ name: string | null }[]>
}

export interface SyncIO {
  /** The ONLY way to speak in the group: the reply to the command event. Resolves true if LINE accepted it. */
  group(text: string): Promise<boolean>
  /** Push to the sender. Must not throw for "not a friend" — the caller wraps it. */
  privately(text: string): Promise<void>
}

export async function runSyncCommand(a: {
  command: SyncCommand
  userId: string
  lineUserId: string
  displayName: string
  groupId: string
  store: SyncStore
  io: SyncIO
}): Promise<void> {
  const { command, userId, lineUserId, groupId, store, io } = a
  const displayName = announceName(a.displayName, lineUserId)

  if (command === "status") {
    await io.privately(statusText(await store.list(lineUserId)))
    return
  }

  const on = await store.isEnabled(lineUserId, groupId)

  if (command === "sync") {
    if (on) { await io.privately(SYNC_TEXT.alreadyOn); return }   // R1: no repeat announcement
    await store.enable({ userId, lineUserId }, groupId)
    // A THROWN announcement (network error) must count as "not announced" exactly like a non-2xx answer.
    let announced = false
    try { announced = await io.group(SYNC_TEXT.announceOn(displayName)) } catch { announced = false }
    if (!announced) {                                             // R2: never leave sync on unannounced
      try { await store.disable(lineUserId, groupId) }
      catch { await io.privately(SYNC_TEXT.rollbackFailed); return }
      await io.privately(SYNC_TEXT.announceFailed)
    }
    return
  }

  // stop
  if (!on) { await io.privately(SYNC_TEXT.notOn); return }
  await store.disable(lineUserId, groupId)
  await io.group(SYNC_TEXT.announceOff(displayName))
}

/**
 * Chooses the channel for the slip path's messages.
 *  - 1:1: say = reply (reply token), tell = push — exactly the old behaviour, failures included.
 *  - group: BOTH go to the sender with push; a failure is reported and swallowed, and the group reply is never used
 *    (a group event's reply token would post into the group).
 */
export function makeSenders(
  fromGroup: boolean,
  io: {
    reply: (m: object[]) => Promise<unknown>
    push: (m: object[]) => Promise<unknown>
    onPushError?: (e: unknown) => void
  },
): { say: (m: object[]) => Promise<void>; tell: (m: object[]) => Promise<void> } {
  if (!fromGroup) {
    return {
      say: async (m) => { await io.reply(m) },
      tell: async (m) => { await io.push(m) },
    }
  }
  const safePush = async (m: object[]) => {
    try { await io.push(m) } catch (e) { io.onPushError?.(e) }
  }
  return { say: safePush, tell: safePush }
}
