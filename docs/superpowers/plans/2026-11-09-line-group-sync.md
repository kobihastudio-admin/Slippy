# Opt-in LINE Group Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Slippy user who types `/syncgroup` in a LINE group gets the slips/images/PDFs **they** post in that group ingested as their own documents; `/stopsync` stops it; `/syncstatus` lists their groups privately. Nobody else's content is read or stored.

**Architecture:** All decisions (command parsing, event classification, the command state machine, "which channel may speak") live in one dependency-free file, `api/src/services/line-group-sync-logic.ts`, tested by a `tsx` verify script like the repo's other `verify:*` scripts. A thin Supabase adapter (`line-group-sync.ts`) implements the store. `routes/line.ts` gets a small dispatch block that replaces the blanket "ignore media outside 1:1" guard, and the existing slip path is reused in place (not extracted) with two injected senders so the group path can only ever speak privately.

**Tech Stack:** TypeScript (Fastify API, ESM, run with `tsx`), Supabase Postgres (service role from the webhook), LINE Messaging API.

**Spec:** `docs/superpowers/specs/2026-11-09-line-group-sync-design.md` (the user asked for this plan after reading it; §8 there records the amendments below).

> **Post-review amendment (supersedes the code samples below where they differ):** the final review found that keying the opt-in on the Slippy `user_id` would sync a second LINE account of the same user without consent. As built: `SyncStore` is keyed on `lineUserId` (`isEnabled(lineUserId, groupId)`, `enable({userId, lineUserId}, groupId)`, `disable(lineUserId, groupId)`, `list(lineUserId)`), `runSyncCommand` takes `lineUserId`, the table has `line_user_id text NOT NULL` and `UNIQUE (line_user_id, line_group_id)`, and a rejected `io.group` counts as "not announced". The code in the repo is authoritative.

## Global Constraints

- Opt-in is **per user, per group**; only the sender's own events are used. Text messages are never stored (only the three command words are read).
- Supported files in a group are exactly what 1:1 supports today: images, and `file` messages ending `.pdf` / `.heic` / `.heif`. Anything else is ignored **silently** in a group.
- **The group is never spoken to** except: the `/syncgroup` announcement and the `/stopsync` confirmation (both via the command event's reply token). The OCR acknowledgement card, quota warning and every error go to the sender with `push` only.
- Webhook signature verification is unchanged. 1:1 behaviour and `/linkgroup`, `/connect` are unchanged.
- `line_synced_groups`: RLS on; authenticated users may `SELECT` only their own rows; every write is by the service role.
- Thai copy exactly as in Task 1 (`SYNC_TEXT`).
- **No `git commit/push`, no migration apply, no NAS deploy, no real-group test without the user's separate explicit approval.** Do not touch the governance repo. The working tree has ~49 unrelated dirty files; stage nothing.

## Decisions made in this plan (spec §8 amendments)

| # | Decision | Why | Cost if wrong |
|---|---|---|---|
| R1 | `/syncgroup` when already on, and `/stopsync` when already off, answer the sender **privately** and do not post in the group | A member could otherwise spam the group by repeating the command | One more private message |
| R2 | `/syncgroup` order: enable → announce in the group → if the announcement fails, **disable again** and tell the sender privately | The announcement is the only consent mitigation; sync must not run unannounced | A failed announce means the user retypes the command |
| R3 | `replyMsg` returns `Promise<boolean>` (true on HTTP ok) | R2 needs to know the announce failed; all existing callers ignore the result | None (additive) |
| R4 | No new rate limiter. Existing plan check + `increment_doc_used` quota apply per sender, before any OCR | Spec left it to the plan; the quota is checked before OCR so cost is bounded per sender | A flood costs storage/download until the quota is reached |
| R5 | If the opt-in lookup throws, treat the sender as **not opted in** (ignore + log) | Privacy-safe default | A DB blip drops an image; the user resends |
| R6 | `file_name`/storage name stays `line_<id>.jpg` as in 1:1 | Spec: file types unchanged | See P2 |

## Pre-existing problems found while planning (NOT changed here; need the user's decision)

- **P1 – the bot already talks in groups.** After the media guard, a text message from anyone in any group that is not a recognised command reaches the final "Default" reply (`line.ts` ~1097) and the bot posts "ส่งรูปสลิปหรือใบเสร็จมาได้เลยครับ…" into the group. A *connected* user's sticker/video hits the "Unsupported message types" reply (~484) the same way. This is existing behaviour for every group the bot is in; the sync feature does not add to it, but it contradicts the spirit of "the group is not spoken to". Recommended follow-up (separate, small, changes production behaviour): silence both fallbacks when `source.type !== "user"`.
- **P2 – PDFs are stored as JPG.** The 1:1 path labels every upload `file_type: "jpg"`, `image/jpeg`, `.jpg`, even a PDF (sharp fails on a PDF, the raw bytes are uploaded under that name). Group sync inherits this. Not verified whether the downstream pipeline copes.
- **P3 – `userId` in group events.** LINE may omit `source.userId` for members who have not consented/added the account; those members are ignored (spec §7). Needs one real test.
- **P4 – private push needs a friend relationship.** `push` to a user who has not added the bot fails. In the group path every private message is sent through a swallow-and-log wrapper, so a failure never throws and never falls back to the group; the sender then simply gets no acknowledgement.

## Review Focus

The inputs the spec implies but no obvious test covers; each has a test in the named task.

1. A group image whose event has **no `source.userId`** must be ignored, never attributed (Task 1: classifier table).
2. **Repeating `/syncgroup`** must not announce again, and a failed announcement must not leave sync on (Task 1: `runSyncCommand`).
3. **Look-alike text** must not be a command: `/syncgroupx`, `/sync`, `ใครพิมพ์ /syncgroup`, and prototype keys `constructor` / `__proto__` / `toString` (Task 1: `parseSyncCommand`).
4. A **failing private push** in the group path must neither throw nor ever call the group reply (Task 1: `makeSenders`).
5. **1:1 is untouched**: a 1:1 image/text classifies as `continue`, `say` still means `replyMsg`, `tell` still means `pushMsg` and still rejects (Task 1 tests + Task 4 diff inspection).

---

### Task 1: Decision logic + verify script (pure, no network, no env)

**Files:**
- Create: `api/src/scripts/verify-line-group-sync.ts`
- Create: `api/src/services/line-group-sync-logic.ts`
- Modify: `api/package.json` (scripts)

**Interfaces:**
- Produces (used by Tasks 3 and 4), all exported from `line-group-sync-logic.ts`:
  - `type LineSource = { type?: string; userId?: string; groupId?: string; roomId?: string }`
  - `type LineMessage = { type?: string; text?: string; fileName?: string }`
  - `type SyncCommand = "sync" | "stop" | "status"`
  - `parseSyncCommand(text: string | undefined): SyncCommand | null`
  - `lineGroupIdOf(source: LineSource | undefined): string | null`
  - `isSupportedGroupFile(fileName: string | undefined): boolean`
  - `type GroupSyncDecision = {action:"continue"} | {action:"ignore"} | {action:"direct-notice"} | {action:"need-connect"} | {action:"command"; command: SyncCommand; groupId: string} | {action:"process-media"; groupId: string}`
  - `classifyGroupSyncEvent(i: { source?: LineSource; message?: LineMessage; connected: boolean; optedIn: boolean }): GroupSyncDecision`
  - `interface SyncStore { isEnabled(userId: string, groupId: string): Promise<boolean>; enable(userId: string, groupId: string): Promise<void>; disable(userId: string, groupId: string): Promise<void>; list(userId: string): Promise<{ name: string | null }[]> }`
  - `interface SyncIO { group(text: string): Promise<boolean>; privately(text: string): Promise<void> }`
  - `runSyncCommand(a: { command: SyncCommand; userId: string; displayName: string; groupId: string; store: SyncStore; io: SyncIO }): Promise<void>`
  - `makeSenders(fromGroup: boolean, io: { reply: (m: object[]) => Promise<unknown>; push: (m: object[]) => Promise<unknown>; onPushError?: (e: unknown) => void }): { say: (m: object[]) => Promise<void>; tell: (m: object[]) => Promise<void> }`
  - `SYNC_TEXT`, `statusText(groups: { name: string | null }[]): string`

- [ ] **Step 1: Write the failing test**

Create `api/src/scripts/verify-line-group-sync.ts`:

```ts
/**
 * LINE group sync — decision logic. Run with:  npm run verify:group-sync
 * No network, no env vars. Spec: docs/superpowers/specs/2026-11-09-line-group-sync-design.md
 */
import assert from "node:assert/strict"
import {
  parseSyncCommand, lineGroupIdOf, isSupportedGroupFile, classifyGroupSyncEvent,
  runSyncCommand, makeSenders, statusText, SYNC_TEXT,
  type SyncStore, type SyncIO, type LineSource,
} from "../services/line-group-sync-logic"

let passed = 0, failed = 0
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (err) { failed++; console.log(`  ❌ ${name}\n     ${(err as Error).message.split("\n")[0]}`) }
}

const grp = (extra: Partial<LineSource> = {}): LineSource => ({ type: "group", groupId: "Cg1", userId: "Uu1", ...extra })
const room = (extra: Partial<LineSource> = {}): LineSource => ({ type: "room", roomId: "Rr1", userId: "Uu1", ...extra })
const user: LineSource = { type: "user", userId: "Uu1" }
const text = (t: string) => ({ type: "text", text: t })

function fakes(o: { enabled?: boolean; announceOk?: boolean; enableThrows?: boolean; disableThrows?: boolean; list?: { name: string | null }[] } = {}) {
  const calls: string[] = [], group: string[] = [], priv: string[] = []
  let enabled = o.enabled ?? false
  const store: SyncStore = {
    async isEnabled() { calls.push("isEnabled"); return enabled },
    async enable() { calls.push("enable"); if (o.enableThrows) throw new Error("db down"); enabled = true },
    async disable() { calls.push("disable"); if (o.disableThrows) throw new Error("db down"); enabled = false },
    async list() { calls.push("list"); return o.list ?? [] },
  }
  const io: SyncIO = {
    async group(t) { calls.push("group"); group.push(t); return o.announceOk ?? true },
    async privately(t) { calls.push("privately"); priv.push(t) },
  }
  return { store, io, calls, group, priv, on: () => enabled }
}
const run = (command: "sync" | "stop" | "status", f: ReturnType<typeof fakes>) =>
  runSyncCommand({ command, userId: "u1", displayName: "พลอย", groupId: "Cg1", store: f.store, io: f.io })

async function main() {
  console.log("\n▶ parseSyncCommand\n")
  await check("the three commands, any case, any spacing, trailing words ignored", () => {
    assert.equal(parseSyncCommand("/syncgroup"), "sync")
    assert.equal(parseSyncCommand("  /SyncGroup  "), "sync")
    assert.equal(parseSyncCommand("/syncgroup   please"), "sync")
    assert.equal(parseSyncCommand("/stopsync"), "stop")
    assert.equal(parseSyncCommand("/syncstatus"), "status")
  })
  await check("look-alikes and mid-sentence mentions are NOT commands", () => {
    for (const t of ["/syncgroupx", "/sync", "syncgroup", "ใครพิมพ์ /syncgroup", "please /stopsync", "", "  "])
      assert.equal(parseSyncCommand(t), null, JSON.stringify(t))
    assert.equal(parseSyncCommand(undefined), null)
  })
  await check("prototype keys are not commands", () => {
    for (const t of ["constructor", "__proto__", "toString", "hasOwnProperty"]) assert.equal(parseSyncCommand(t), null, t)
  })

  console.log("\n▶ lineGroupIdOf / isSupportedGroupFile\n")
  await check("group → groupId, room → roomId, anything else → null", () => {
    assert.equal(lineGroupIdOf(grp()), "Cg1")
    assert.equal(lineGroupIdOf(room()), "Rr1")
    assert.equal(lineGroupIdOf(user), null)
    assert.equal(lineGroupIdOf(undefined), null)
    assert.equal(lineGroupIdOf({ type: "group", roomId: "Rr1" }), null)
    assert.equal(lineGroupIdOf({ type: "group" }), null)
  })
  await check("only pdf / heic / heif files", () => {
    assert.equal(isSupportedGroupFile("a.PDF"), true)
    assert.equal(isSupportedGroupFile("a.heic"), true)
    assert.equal(isSupportedGroupFile("a.HEIF"), true)
    assert.equal(isSupportedGroupFile("a.zip"), false)
    assert.equal(isSupportedGroupFile("a.pdf.exe"), false)
    assert.equal(isSupportedGroupFile(undefined), false)
  })

  console.log("\n▶ classifyGroupSyncEvent — 1:1 and non-sync traffic is untouched\n")
  await check("1:1 image and 1:1 text continue to the existing handlers", () => {
    const base = { connected: true, optedIn: false }
    assert.deepEqual(classifyGroupSyncEvent({ ...base, source: user, message: { type: "image" } }), { action: "continue" })
    assert.deepEqual(classifyGroupSyncEvent({ ...base, source: user, message: text("/summary") }), { action: "continue" })
    assert.deepEqual(classifyGroupSyncEvent({ ...base, connected: false, source: user, message: { type: "image" } }), { action: "continue" })
  })
  await check("group text that is not a sync command, and group stickers, continue unchanged", () => {
    const base = { connected: true, optedIn: true }
    assert.deepEqual(classifyGroupSyncEvent({ ...base, source: grp(), message: text("สวัสดี") }), { action: "continue" })
    assert.deepEqual(classifyGroupSyncEvent({ ...base, source: grp(), message: text("/linkgroup") }), { action: "continue" })
    assert.deepEqual(classifyGroupSyncEvent({ ...base, source: grp(), message: { type: "sticker" } }), { action: "continue" })
  })

  console.log("\n▶ classifyGroupSyncEvent — commands\n")
  await check("a command in 1:1 gets the 'groups only' notice, even if unconnected", () => {
    assert.deepEqual(classifyGroupSyncEvent({ connected: true, optedIn: false, source: user, message: text("/syncgroup") }), { action: "direct-notice" })
    assert.deepEqual(classifyGroupSyncEvent({ connected: false, optedIn: false, source: user, message: text("/stopsync") }), { action: "direct-notice" })
  })
  await check("connected sender in a group/room → command with that chat's id", () => {
    assert.deepEqual(classifyGroupSyncEvent({ connected: true, optedIn: false, source: grp(), message: text("/syncgroup") }), { action: "command", command: "sync", groupId: "Cg1" })
    assert.deepEqual(classifyGroupSyncEvent({ connected: true, optedIn: true, source: room(), message: text("/STOPSYNC") }), { action: "command", command: "stop", groupId: "Rr1" })
    assert.deepEqual(classifyGroupSyncEvent({ connected: true, optedIn: false, source: grp(), message: text("/syncstatus") }), { action: "command", command: "status", groupId: "Cg1" })
  })
  await check("unconnected sender → need-connect for every command (nothing created)", () => {
    for (const c of ["/syncgroup", "/stopsync", "/syncstatus"])
      assert.deepEqual(classifyGroupSyncEvent({ connected: false, optedIn: false, source: grp(), message: text(c) }), { action: "need-connect" }, c)
  })
  await check("command with no userId or no group id is ignored (cannot be attributed)", () => {
    assert.deepEqual(classifyGroupSyncEvent({ connected: true, optedIn: false, source: grp({ userId: undefined }), message: text("/syncgroup") }), { action: "ignore" })
    assert.deepEqual(classifyGroupSyncEvent({ connected: true, optedIn: false, source: { type: "group", userId: "Uu1" }, message: text("/syncgroup") }), { action: "ignore" })
  })

  console.log("\n▶ classifyGroupSyncEvent — media in a group\n")
  await check("opted-in + connected → process (group and room)", () => {
    assert.deepEqual(classifyGroupSyncEvent({ connected: true, optedIn: true, source: grp(), message: { type: "image" } }), { action: "process-media", groupId: "Cg1" })
    assert.deepEqual(classifyGroupSyncEvent({ connected: true, optedIn: true, source: room(), message: { type: "image" } }), { action: "process-media", groupId: "Rr1" })
  })
  await check("not opted in (incl. disabled row), or not connected → ignored", () => {
    assert.deepEqual(classifyGroupSyncEvent({ connected: true, optedIn: false, source: grp(), message: { type: "image" } }), { action: "ignore" })
    assert.deepEqual(classifyGroupSyncEvent({ connected: false, optedIn: true, source: grp(), message: { type: "image" } }), { action: "ignore" })
  })
  await check("no source.userId → ignored even if the flags say yes", () => {
    assert.deepEqual(classifyGroupSyncEvent({ connected: true, optedIn: true, source: grp({ userId: undefined }), message: { type: "image" } }), { action: "ignore" })
  })
  await check("unknown/missing source type → ignored (same as the old blanket guard)", () => {
    assert.deepEqual(classifyGroupSyncEvent({ connected: true, optedIn: true, source: { userId: "Uu1" }, message: { type: "image" } }), { action: "ignore" })
    assert.deepEqual(classifyGroupSyncEvent({ connected: true, optedIn: true, source: undefined, message: { type: "image" } }), { action: "ignore" })
  })
  await check("group files: pdf/heic processed, other types ignored silently", () => {
    const f = (fileName?: string) => classifyGroupSyncEvent({ connected: true, optedIn: true, source: grp(), message: { type: "file", fileName } })
    assert.deepEqual(f("slip.pdf"), { action: "process-media", groupId: "Cg1" })
    assert.deepEqual(f("IMG.HEIC"), { action: "process-media", groupId: "Cg1" })
    assert.deepEqual(f("notes.zip"), { action: "ignore" })
    assert.deepEqual(f(undefined), { action: "ignore" })
  })

  console.log("\n▶ runSyncCommand\n")
  await check("/syncgroup (new): enable, then announce in the group; nothing private", async () => {
    const f = fakes()
    await run("sync", f)
    assert.deepEqual(f.calls, ["isEnabled", "enable", "group"])
    assert.equal(f.on(), true)
    assert.ok(f.group[0].includes("พลอย") && f.group[0].includes("/stopsync") && f.group[0].includes("ข้อความแชทไม่ถูกเก็บ"))
    assert.equal(f.priv.length, 0)
  })
  await check("/syncgroup again: private 'already on', NO second announcement", async () => {
    const f = fakes({ enabled: true })
    await run("sync", f)
    assert.deepEqual(f.calls, ["isEnabled", "privately"])
    assert.equal(f.priv[0], SYNC_TEXT.alreadyOn)
    assert.equal(f.group.length, 0)
  })
  await check("announcement fails → sync is switched back off and the sender is told privately", async () => {
    const f = fakes({ announceOk: false })
    await run("sync", f)
    assert.deepEqual(f.calls, ["isEnabled", "enable", "group", "disable", "privately"])
    assert.equal(f.on(), false)
    assert.equal(f.priv[0], SYNC_TEXT.announceFailed)
  })
  await check("announcement fails AND rollback fails → sender is told loudly to /stopsync", async () => {
    const f = fakes({ announceOk: false, disableThrows: true })
    await run("sync", f)
    assert.equal(f.priv[0], SYNC_TEXT.rollbackFailed)
  })
  await check("enable throws → the error propagates and the group hears nothing", async () => {
    const f = fakes({ enableThrows: true })
    await assert.rejects(run("sync", f), /db down/)
    assert.equal(f.group.length, 0)
  })
  await check("/stopsync (on): disable, confirm in the group", async () => {
    const f = fakes({ enabled: true })
    await run("stop", f)
    assert.deepEqual(f.calls, ["isEnabled", "disable", "group"])
    assert.equal(f.on(), false)
    assert.ok(f.group[0].includes("พลอย"))
  })
  await check("/stopsync (already off): private note only, group silent", async () => {
    const f = fakes({ enabled: false })
    await run("stop", f)
    assert.deepEqual(f.calls, ["isEnabled", "privately"])
    assert.equal(f.priv[0], SYNC_TEXT.notOn)
  })
  await check("/syncstatus answers privately only, never touches the group", async () => {
    const f = fakes({ list: [{ name: "ก๊วนแบด" }, { name: null }] })
    await run("status", f)
    assert.deepEqual(f.calls, ["list", "privately"])
    assert.ok(f.priv[0].includes("1. ก๊วนแบด") && f.priv[0].includes("2. กลุ่ม LINE (ไม่ทราบชื่อ)"))
  })
  await check("statusText with no groups says so", () => {
    assert.ok(statusText([]).includes("ยังไม่ได้ซิงก์"))
  })

  console.log("\n▶ makeSenders — which channel may speak\n")
  await check("1:1: say = reply, tell = push, and a push failure still rejects (old behaviour)", async () => {
    const log: string[] = []
    const s = makeSenders(false, { reply: async () => { log.push("reply") }, push: async () => { log.push("push"); throw new Error("boom") } })
    await s.say([{}])
    await assert.rejects(s.tell([{}]), /boom/)
    assert.deepEqual(log, ["reply", "push"])
  })
  await check("group: say and tell both go to push only; reply is never called", async () => {
    const log: string[] = []
    const s = makeSenders(true, { reply: async () => { log.push("reply") }, push: async () => { log.push("push") } })
    await s.say([{}]); await s.tell([{}])
    assert.deepEqual(log, ["push", "push"])
  })
  await check("group: a failing private push is swallowed (reported), never falls back to reply", async () => {
    const log: string[] = []; let reported = 0
    const s = makeSenders(true, {
      reply: async () => { log.push("reply") },
      push: async () => { throw new Error("not a friend") },
      onPushError: () => { reported++ },
    })
    await s.say([{}]); await s.tell([{}])
    assert.equal(reported, 2)
    assert.deepEqual(log, [])
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  process.exit(failed ? 1 : 0)
}
main()
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/chainimitsakhorn/Documents/Project/Slippy/api && PATH=/usr/local/bin:$PATH npx --no-install tsx src/scripts/verify-line-group-sync.ts 2>&1 | tail -8`
Expected: FAIL — `Cannot find module '../services/line-group-sync-logic'` (nothing ran). If it runs at all, the test is wrong.

- [ ] **Step 3: Write the implementation**

Create `api/src/services/line-group-sync-logic.ts`:

```ts
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
}

export function statusText(groups: { name: string | null }[]): string {
  if (!groups.length) return "ตอนนี้ยังไม่ได้ซิงก์กลุ่ม LINE ไหนเลยครับ\nพิมพ์ /syncgroup ในกลุ่มที่ต้องการ"
  const lines = groups.map((g, i) => `${i + 1}. ${g.name ?? "กลุ่ม LINE (ไม่ทราบชื่อ)"}`)
  return `กลุ่มที่คุณซิงก์อยู่:\n${lines.join("\n")}\n\nหยุดซิงก์: พิมพ์ /stopsync ในกลุ่มนั้น`
}

export interface SyncStore {
  isEnabled(userId: string, groupId: string): Promise<boolean>
  enable(userId: string, groupId: string): Promise<void>
  disable(userId: string, groupId: string): Promise<void>
  list(userId: string): Promise<{ name: string | null }[]>
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
  displayName: string
  groupId: string
  store: SyncStore
  io: SyncIO
}): Promise<void> {
  const { command, userId, displayName, groupId, store, io } = a

  if (command === "status") {
    await io.privately(statusText(await store.list(userId)))
    return
  }

  const on = await store.isEnabled(userId, groupId)

  if (command === "sync") {
    if (on) { await io.privately(SYNC_TEXT.alreadyOn); return }   // R1: no repeat announcement
    await store.enable(userId, groupId)
    const announced = await io.group(SYNC_TEXT.announceOn(displayName))
    if (!announced) {                                             // R2: never leave sync on unannounced
      try { await store.disable(userId, groupId) }
      catch { await io.privately(SYNC_TEXT.rollbackFailed); return }
      await io.privately(SYNC_TEXT.announceFailed)
    }
    return
  }

  // stop
  if (!on) { await io.privately(SYNC_TEXT.notOn); return }
  await store.disable(userId, groupId)
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
```

- [ ] **Step 4: Register the script**

In `api/package.json` add `"verify:group-sync": "tsx src/scripts/verify-line-group-sync.ts",` next to the other `verify:*` entries and append ` && npm run verify:group-sync` to the end of the `"verify"` chain.

- [ ] **Step 5: Run it to verify it passes**

Run: `cd /Users/chainimitsakhorn/Documents/Project/Slippy/api && PATH=/usr/local/bin:$PATH npm run verify:group-sync 2>&1 | tail -45`
Expected: every line `✅`, final `28 passed, 0 failed`, exit 0. Read every ✅/❌ line.

- [ ] **Step 6: Type-check**

Run: `cd /Users/chainimitsakhorn/Documents/Project/Slippy/api && PATH=/usr/local/bin:$PATH npx --no-install tsc --noEmit -p . ; echo exit=$?`
Expected: `exit=0` (baseline before this plan was exit 0).

- [ ] **Step 7: Do not commit.** Leave the files in the working tree; the user approves any commit separately.

---

### Task 2: Migration `line_synced_groups` (written, NOT applied) + static guard

**Files:**
- Modify: `api/src/scripts/verify-line-group-sync.ts` (add a "migration" section)
- Create: `supabase/migrations/20261109130000_line_synced_groups.sql`

**Interfaces:**
- Consumes: nothing from Task 1 except the verify script's `check` helper.
- Produces: table `public.line_synced_groups(id, user_id, line_group_id, group_name, enabled, created_at, updated_at)`, unique `(user_id, line_group_id)`; used by Task 3's adapter.

- [ ] **Step 1: Write the failing test**

In `verify-line-group-sync.ts` add `import { readFileSync } from "node:fs"` and `import path from "node:path"` at the top, and insert this block in `main()` before the final summary `console.log`:

```ts
  console.log("\n▶ migration 20261109130000_line_synced_groups.sql (static; the SQL is not run here)\n")
  const sqlPath = path.resolve(process.cwd(), "../supabase/migrations/20261109130000_line_synced_groups.sql")
  let sql = ""
  try { sql = readFileSync(sqlPath, "utf8").split("\n").filter(l => !l.trim().startsWith("--")).join("\n") } catch { /* asserted below */ }
  await check("the file exists and defines the table with the unique pair and a cascading user FK", () => {
    assert.ok(sql.length > 0, `missing ${sqlPath}`)
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.line_synced_groups/)
    assert.match(sql, /user_id\s+uuid\s+NOT NULL\s+REFERENCES public\.users\(id\) ON DELETE CASCADE/)
    assert.match(sql, /UNIQUE \(user_id, line_group_id\)/)
  })
  await check("RLS on; exactly one policy and it is SELECT-own; no write policy", () => {
    assert.match(sql, /ALTER TABLE public\.line_synced_groups ENABLE ROW LEVEL SECURITY/)
    assert.equal((sql.match(/CREATE POLICY/g) ?? []).length, 1)
    assert.match(sql, /CREATE POLICY line_synced_groups_select_own[\s\S]*?FOR SELECT[\s\S]*?USING \(user_id = auth\.uid\(\)\)/)
    assert.doesNotMatch(sql, /FOR\s+(INSERT|UPDATE|DELETE|ALL)/i)
  })
  await check("clients can only SELECT: everything revoked, SELECT granted to authenticated, service_role keeps full access", () => {
    assert.match(sql, /REVOKE ALL ON public\.line_synced_groups FROM PUBLIC, anon, authenticated/)
    assert.match(sql, /GRANT SELECT ON public\.line_synced_groups TO authenticated/)
    assert.match(sql, /GRANT ALL ON public\.line_synced_groups TO service_role/)
  })
  await check("no column can hold chat content", () => {
    assert.doesNotMatch(sql, /\b(message|content|body|text_content)\b/i)
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/chainimitsakhorn/Documents/Project/Slippy/api && PATH=/usr/local/bin:$PATH npm run verify:group-sync 2>&1 | tail -14`
Expected: the four new checks are ❌ (the first with `missing …`), exit 1.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261109130000_line_synced_groups.sql`:

```sql
-- 20261109130000_line_synced_groups.sql   (NOT APPLIED — gated by D-077; apply only after explicit approval)
-- Per-user, per-group opt-in for ingesting the slips/images/files a user posts in a LINE group.
-- Spec: docs/superpowers/specs/2026-11-09-line-group-sync-design.md
--
-- Only the webhook (service role) writes. A signed-in user may read their OWN rows and nothing else;
-- there is no policy that exposes another user's rows or group ids. No chat content is stored here.

CREATE TABLE IF NOT EXISTS public.line_synced_groups (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  line_group_id text        NOT NULL,            -- LINE groupId or roomId
  group_name    text,                            -- best effort, may stay NULL
  enabled       boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, line_group_id)
);

ALTER TABLE public.line_synced_groups ENABLE ROW LEVEL SECURITY;

-- REVOKE ... FROM PUBLIC alone does not remove grants Supabase gives anon/authenticated by default.
REVOKE ALL ON public.line_synced_groups FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.line_synced_groups TO authenticated;
GRANT ALL    ON public.line_synced_groups TO service_role;

DROP POLICY IF EXISTS line_synced_groups_select_own ON public.line_synced_groups;
CREATE POLICY line_synced_groups_select_own ON public.line_synced_groups
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd /Users/chainimitsakhorn/Documents/Project/Slippy/api && PATH=/usr/local/bin:$PATH npm run verify:group-sync 2>&1 | tail -10`
Expected: `32 passed, 0 failed`, exit 0.

- [ ] **Step 5: Do not apply, do not commit.** No Postgres is available on this Mac (no Docker/psql under the missing Rosetta); the SQL syntax is therefore reviewed by reading only. The gated post-apply check is in "Gated steps" below.

---

### Task 3: Supabase adapter (the real `SyncStore`)

**Files:**
- Create: `api/src/services/line-group-sync.ts`

**Interfaces:**
- Consumes: `SyncStore` from Task 1; table from Task 2.
- Produces: `supabaseSyncStore: SyncStore`, `fetchGroupName(groupId: string): Promise<string | null>`.

This file imports `lib/supabase` (throws without env), so it is **not** imported by the verify script; it is covered by `tsc` and by the gated real test.

- [ ] **Step 1: Write the adapter**

Create `api/src/services/line-group-sync.ts`:

```ts
import { supabase } from "../lib/supabase"
import type { SyncStore } from "./line-group-sync-logic"

const LINE_API = "https://api.line.me/v2/bot"

/** Best effort: group name from the bot's own token. Rooms and failures give null; never throws. */
export async function fetchGroupName(groupId: string): Promise<string | null> {
  try {
    const t = process.env.LINE_CHANNEL_ACCESS_TOKEN
    if (!t) return null
    const res = await fetch(`${LINE_API}/group/${encodeURIComponent(groupId)}/summary`, {
      headers: { Authorization: `Bearer ${t}` },
    })
    if (!res.ok) return null
    const body = (await res.json()) as { groupName?: string }
    return body.groupName?.trim() || null
  } catch {
    return null
  }
}

const TABLE = "line_synced_groups"

export const supabaseSyncStore: SyncStore = {
  async isEnabled(userId, groupId) {
    const { data, error } = await supabase
      .from(TABLE).select("id")
      .eq("user_id", userId).eq("line_group_id", groupId).eq("enabled", true)
      .limit(1).maybeSingle()
    if (error) throw new Error(`[group-sync] isEnabled: ${error.message}`)
    return !!data
  },

  async enable(userId, groupId) {
    const name = await fetchGroupName(groupId)
    const row: Record<string, unknown> = {
      user_id: userId, line_group_id: groupId, enabled: true, updated_at: new Date().toISOString(),
    }
    if (name) row.group_name = name            // never overwrite a known name with null
    const { error } = await supabase.from(TABLE).upsert(row, { onConflict: "user_id,line_group_id" })
    if (error) throw new Error(`[group-sync] enable: ${error.message}`)
  },

  async disable(userId, groupId) {
    const { error } = await supabase
      .from(TABLE).update({ enabled: false, updated_at: new Date().toISOString() })
      .eq("user_id", userId).eq("line_group_id", groupId)
    if (error) throw new Error(`[group-sync] disable: ${error.message}`)
  },

  async list(userId) {
    const { data, error } = await supabase
      .from(TABLE).select("group_name")
      .eq("user_id", userId).eq("enabled", true).order("created_at", { ascending: true })
    if (error) throw new Error(`[group-sync] list: ${error.message}`)
    return (data ?? []).map((r: { group_name: string | null }) => ({ name: r.group_name }))
  },
}
```

- [ ] **Step 2: Type-check**

Run: `cd /Users/chainimitsakhorn/Documents/Project/Slippy/api && PATH=/usr/local/bin:$PATH npx --no-install tsc --noEmit -p . ; echo exit=$?`
Expected: `exit=0`. (There is no unit test for this file: it needs a database. Say so in the report.)

- [ ] **Step 3: Do not commit.**

---

### Task 4: Wire into the webhook (`routes/line.ts`)

**Files:**
- Modify: `api/src/routes/line.ts`

**Interfaces:**
- Consumes: everything from Tasks 1 and 3.
- Produces: the behaviour in the acceptance criteria.

Use `Edit` with these exact anchors (each `old_string` is unique in the file; if an Edit reports non-unique, add the next line of context). Re-read the file region before each edit.

- [ ] **Step 1: `replyMsg` returns a boolean (R3)**

Replace
```ts
async function replyMsg(replyToken: string, messages: object[]) {
  const res = await fetch(`${LINE_API}/message/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
    body:    JSON.stringify({ replyToken, messages }),
  })
  if (!res.ok) {
    const err = await res.text()
    console.error("[LINE:reply] failed", res.status, err.slice(0, 200))
  }
}
```
with the same function typed `Promise<boolean>`: signature `async function replyMsg(replyToken: string, messages: object[]): Promise<boolean> {`, `return false` after the `console.error(...)` line inside the `if (!res.ok)` block, and `return true` before the closing brace.

- [ ] **Step 2: imports** — after the `line-trip` import add:

```ts
import { supabaseSyncStore } from "../services/line-group-sync"
import {
  classifyGroupSyncEvent, lineGroupIdOf, makeSenders, runSyncCommand, SYNC_TEXT,
} from "../services/line-group-sync-logic"
```

- [ ] **Step 3: join greeting** — in the `join` handler replace the line
`"(ถ้ายังไม่ได้เชื่อมบัญชี LINE กับ Slippy ให้พิมพ์ /connect ก่อนครับ)"`
with
```ts
          "(ถ้ายังไม่ได้เชื่อมบัญชี LINE กับ Slippy ให้พิมพ์ /connect ก่อนครับ)\n" +
          "อยากให้สลิป/รูป/ไฟล์ที่คุณส่งในกลุ่มนี้เข้า Slippy ของคุณเอง — พิมพ์ /syncgroup (ซิงก์เฉพาะของคนที่พิมพ์เอง)"
```

- [ ] **Step 4: replace the blanket guard with the dispatch block**

Replace exactly this (after `const displayName = …`):
```ts
  // ── Receipt/document processing only applies to 1:1 chats with Slippy —
  // images/files sent into a group/room chat are ignored (e.g. sport invite
  // photos shared with friends shouldn't trigger OCR for everyone in the group)
  if ((event.message.type === "image" || event.message.type === "file") && event.source?.type !== "user") {
    return
  }
```
with:
```ts
  // ── Opt-in group sync (docs/superpowers/specs/2026-11-09-line-group-sync-design.md) ──
  // Decide from the signed event alone. Media outside 1:1 is still ignored UNLESS the sender opted in to this
  // exact group; everything that is not ours returns "continue" and falls through to the handlers below untouched.
  const syncGroupId = lineGroupIdOf(event.source)
  const isMediaMsg  = event.message.type === "image" || event.message.type === "file"
  const optedIn = isMediaMsg && conn && lineUserId && syncGroupId
    ? await supabaseSyncStore.isEnabled(conn.user_id, syncGroupId).catch((err: Error) => {
        console.error("[line] group-sync lookup failed — treating as not opted in:", err.message)
        return false
      })
    : false
  const syncDecision = classifyGroupSyncEvent({
    source: event.source, message: event.message, connected: !!conn, optedIn,
  })
  // Private messages in the group path must never throw and never fall back to the group.
  const safePush = (to: string, m: object[]) =>
    pushMsg(to, m).catch((err: Error) => console.warn("[line] private push failed (sender may not have added the bot):", err.message))

  if (syncDecision.action === "ignore") return
  if (syncDecision.action === "direct-notice") {
    await replyMsg(replyToken, [txt(SYNC_TEXT.directOnly)])
    return
  }
  if (syncDecision.action === "need-connect") {
    await safePush(lineUserId, [txt(SYNC_TEXT.needConnect)])
    return
  }
  if (syncDecision.action === "command") {
    await runSyncCommand({
      command: syncDecision.command,
      userId: conn.user_id,
      displayName,
      groupId: syncDecision.groupId,
      store: supabaseSyncStore,
      io: {
        group:     (t) => replyMsg(replyToken, [txt(t)]),   // the one allowed message into the group
        privately: async (t) => { await safePush(lineUserId, [txt(t)]) },
      },
    }).catch(async (err: Error) => {
      console.error("[line] group-sync command failed:", err.message)
      await safePush(lineUserId, [txt("❌ ทำรายการไม่สำเร็จ ลองใหม่อีกครั้งครับ")])
    })
    return
  }
  const fromGroup = syncDecision.action === "process-media"
  const { say, tell } = makeSenders(fromGroup, {
    reply: (m) => replyMsg(replyToken, m),
    push:  (m) => pushMsg(lineUserId, m),
    onPushError: (err) => console.warn("[line] private push failed (sender may not have added the bot):", (err as Error).message),
  })
```

- [ ] **Step 5: route the slip path's messages through `say` / `tell`** (inside the `if (event.message.type === "file")` and `image||file` blocks only; do not touch any other `replyMsg`/`pushMsg` in the file)

| old | new |
|---|---|
| `await replyMsg(replyToken, [txt(\n        "❌ ไฟล์ประเภทนี้ยังไม่รองรับครับ\n" +` | `await say([txt(\n        "❌ ไฟล์ประเภทนี้ยังไม่รองรับครับ\n" +` |
| `await replyMsg(replyToken, [txt(\n        "กรุณาเชื่อมบัญชีก่อนครับ\nใช้คำสั่ง /connect CODE จากหน้า Settings ในแอป"` | same with `await say([txt(` |
| `await replyMsg(replyToken, [txt(\n        "⚠️ แผนปัจจุบันไม่รองรับการรับเอกสารผ่าน LINE Bot\n" +` | same with `await say([txt(` |
| `await pushMsg(lineUserId, [txt(\n            "⚠️ โควต้าเอกสารเดือนนี้เต็มแล้วครับ\n" +` | same with `await tell([txt(` |
| `await replyMsg(replyToken, [uploadAckCard(fileName, doc.id)])` | `await say([uploadAckCard(fileName, doc.id)])` |
| `await pushMsg(lineUserId, [txt("❌ อ่านเอกสารไม่สำเร็จ กรุณาลองส่งใหม่อีกครั้งครับ")])` | `await tell([txt("❌ อ่านเอกสารไม่สำเร็จ กรุณาลองส่งใหม่อีกครั้งครับ")])` |
| `console.error("[line] image error:", err.message)\n      await pushMsg(lineUserId, [txt("❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้งครับ")])` | same with `await tell([txt(…)])` |

- [ ] **Step 6: record the origin**

Replace
`source_meta:     { line_user_id: lineUserId, message_id: event.message.id, file_name: fileName },`
with
```ts
          source_meta:     {
            line_user_id: lineUserId, message_id: event.message.id, file_name: fileName,
            ...(fromGroup ? { line_group_id: syncGroupId } : {}),
          },
```

- [ ] **Step 7: Verify — all of these, reading output**

1. `cd /Users/chainimitsakhorn/Documents/Project/Slippy/api && PATH=/usr/local/bin:$PATH npx --no-install tsc --noEmit -p . ; echo exit=$?` → `exit=0`.
2. `PATH=/usr/local/bin:$PATH npm run verify:group-sync 2>&1 | tail -4` → `32 passed, 0 failed`.
3. `cd .. && git diff -U0 api/src/routes/line.ts | grep -E '^-' | grep -vE '^---'` — every removed line must be one of: the 4 comment/guard lines of Step 4 (+ the closing brace), the `replyMsg` signature line, the join greeting line, the 7 call lines of Step 5, the `source_meta` line. **Any other removed line is a regression: stop and report.**
4. `grep -n "replyMsg\|pushMsg" api/src/routes/line.ts | sed -n '1,400p'` and confirm no `replyMsg(replyToken` remains between the dispatch block and the `// ── Unsupported message types` comment other than inside the block of Step 4.
5. `git diff --stat -- api/package.json api/src/routes/line.ts` shows only these two plus the new files in `git status --short api supabase docs | head -20`.

- [ ] **Step 8: Do not commit.** Report: what passed, what is unverified (see below).

---

## Gated steps (each needs the user's separate explicit approval; none is part of the tasks above)

1. **Apply the migration** to the hosted project (`ntzztcnkedcxfjvfxjrf`). After applying, run this read-only check and compare:
   ```sql
   select relrowsecurity from pg_class where oid = 'public.line_synced_groups'::regclass;                -- expect true
   select polname, polcmd, pg_get_expr(polqual, polrelid) from pg_policy
     where polrelid = 'public.line_synced_groups'::regclass;                                             -- expect 1 row: select_own, 'r', (user_id = auth.uid())
   select r, p, has_table_privilege(r, 'public.line_synced_groups', p)
     from unnest(array['anon','authenticated']) r, unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;  -- expect true only for (authenticated, SELECT)
   ```
   This proves structure, not a two-user read test; do not claim the latter.
2. **Deploy `api`** on the NAS (the user runs the docker build) — only after (1).
3. **Real-group test** (needs the real bot, a real group, two real accounts): connected user types `/syncgroup` (announcement appears once, a second `/syncgroup` is silent in the group); that user posts a slip → a `documents` row with `source_meta.line_group_id`, ack arrives in their 1:1 chat, nothing in the group; a second member (not opted in) posts an image → no document; `/stopsync` → next image is ignored; `/syncstatus` answers privately. Also record whether LINE sends `source.userId` for a member who never added the bot (P3) and what happens to the private push for such a user (P4).
4. **Commit** (suggested one commit: `api/` + migration + docs; stage by explicit paths and check `git diff --cached --stat` first — see the doc-hub staging gotcha).

## What this plan does NOT prove

Behaviour inside a real LINE group; `source.userId` availability (P3); the migration's SQL syntax and effect (no Postgres here; static text checks only); the Supabase adapter (typed, not executed); that `line.ts` 1:1 flows still behave identically beyond the diff inspection in Task 4 Step 7 (the handler is not unit-testable without refactoring); P1/P2 as noted above.
