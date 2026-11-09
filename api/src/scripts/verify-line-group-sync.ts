/**
 * LINE group sync — decision logic. Run with:  npm run verify:group-sync
 * No network, no env vars. Spec: docs/superpowers/specs/2026-11-09-line-group-sync-design.md
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
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

// Opt-in is keyed on the LINE sender (lineUserId), NOT the Slippy user: several LINE accounts can share one user_id.
function fakes(o: { enabled?: boolean; announceOk?: boolean; groupThrows?: boolean; enableThrows?: boolean; disableThrows?: boolean; list?: { name: string | null }[] } = {}) {
  const calls: string[] = [], group: string[] = [], priv: string[] = []
  const on = new Set<string>(o.enabled ? ["L1|Cg1"] : [])
  const key = (lineUserId: string, groupId: string) => `${lineUserId}|${groupId}`
  const store: SyncStore = {
    async isEnabled(lineUserId, groupId) { calls.push("isEnabled"); return on.has(key(lineUserId, groupId)) },
    async enable(who, groupId) { calls.push("enable"); if (o.enableThrows) throw new Error("db down"); on.add(key(who.lineUserId, groupId)) },
    async disable(lineUserId, groupId) { calls.push("disable"); if (o.disableThrows) throw new Error("db down"); on.delete(key(lineUserId, groupId)) },
    async list() { calls.push("list"); return o.list ?? [] },
  }
  const io: SyncIO = {
    async group(t) { calls.push("group"); group.push(t); if (o.groupThrows) throw new Error("network down"); return o.announceOk ?? true },
    async privately(t) { calls.push("privately"); priv.push(t) },
  }
  return { store, io, calls, group, priv, on: () => on.has(key("L1", "Cg1")), has: (lineUserId: string) => on.has(key(lineUserId, "Cg1")) }
}
const run = (command: "sync" | "stop" | "status", f: ReturnType<typeof fakes>, lineUserId = "L1") =>
  runSyncCommand({ command, userId: "u1", lineUserId, displayName: "พลอย", groupId: "Cg1", store: f.store, io: f.io })

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
  await check("announcement THROWS (network error) → sync is switched back off, sender told privately", async () => {
    const f = fakes({ groupThrows: true })
    await run("sync", f)
    assert.deepEqual(f.calls, ["isEnabled", "enable", "group", "disable", "privately"])
    assert.equal(f.on(), false)
    assert.equal(f.priv[0], SYNC_TEXT.announceFailed)
  })
  await check("a raw LINE user id (what /connect stores when the profile fetch failed) is never posted into the group", async () => {
    const rawId = "U" + "0123456789abcdef0123456789abcdef"
    for (const name of [rawId, rawId.toUpperCase().replace(/^U/, "U"), "L1", "   ", ""]) {
      const f = fakes()
      await runSyncCommand({ command: "sync", userId: "u1", lineUserId: "L1", displayName: name, groupId: "Cg1", store: f.store, io: f.io })
      assert.ok(!f.group[0].includes(rawId) && !f.group[0].includes(rawId.toUpperCase()), `leaked id for ${JSON.stringify(name)}`)
      assert.ok(f.group[0].includes(SYNC_TEXT.unknownMember), `no neutral label for ${JSON.stringify(name)}`)
      const g = fakes({ enabled: true })
      await runSyncCommand({ command: "stop", userId: "u1", lineUserId: "L1", displayName: name, groupId: "Cg1", store: g.store, io: g.io })
      assert.ok(g.group[0].includes(SYNC_TEXT.unknownMember), `stop: no neutral label for ${JSON.stringify(name)}`)
    }
  })
  await check("a real display name is announced unchanged", async () => {
    const f = fakes()
    await run("sync", f)
    assert.ok(f.group[0].startsWith("พลอย "))
  })
  await check("two LINE accounts of ONE Slippy user: B is not synced by A's opt-in, and B's /stopsync does not stop A", async () => {
    const f = fakes()
    await run("sync", f, "L1")
    assert.equal(f.has("L1"), true)
    assert.equal(f.has("L2"), false)          // B's images would be ignored: isEnabled is keyed on the LINE sender
    await run("stop", f, "L2")
    assert.equal(f.priv.at(-1), SYNC_TEXT.notOn)
    assert.equal(f.has("L1"), true)           // A is untouched
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

  console.log("\n▶ migration 20261109130000_line_synced_groups.sql (static; the SQL is not run here)\n")
  const sqlPath = path.resolve(process.cwd(), "../supabase/migrations/20261109130000_line_synced_groups.sql")
  let sql = ""
  try { sql = readFileSync(sqlPath, "utf8").split("\n").filter(l => !l.trim().startsWith("--")).join("\n") } catch { /* asserted below */ }
  await check("the file exists and defines the table with the unique pair and a cascading user FK", () => {
    assert.ok(sql.length > 0, `missing ${sqlPath}`)
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.line_synced_groups/)
    assert.match(sql, /user_id\s+uuid\s+NOT NULL\s+REFERENCES public\.users\(id\) ON DELETE CASCADE/)
    assert.match(sql, /UNIQUE \(line_user_id, line_group_id\)/)
    assert.match(sql, /line_user_id\s+text\s+NOT NULL/)
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
    assert.match(sql, /GRANT ALL\s+ON public\.line_synced_groups TO service_role/)
  })
  await check("no column can hold chat content", () => {
    assert.doesNotMatch(sql, /\b(message|content|body|text_content)\b/i)
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  process.exit(failed ? 1 : 0)
}
main()
