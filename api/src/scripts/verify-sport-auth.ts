/**
 * Does /v1/sport-play/* actually accept a device? — npm run verify:sport-auth
 *
 * This endpoint was broken twice over and nothing noticed: it sat behind the
 * shared internal-key gate (so the watch got 401) and its handlers read
 * req.userId, which nothing ever set (so a request that got through would have
 * written a row with no owner). Neither failure appears in a server log anyone
 * reads — they appear on a wrist, as a sync that never completes.
 *
 * So this drives a REAL server the way the app does: no token, a junk token,
 * and a valid user token.
 */
import "dotenv/config"
import Fastify from "fastify"
import { supabase } from "../lib/supabase"
import sportPlayRoutes from "../routes/sport-play"
import { userAuthedScope } from "../plugins/supabase-auth"

/** Captured by a hook registered BEFORE ready() — Fastify refuses later ones. */
let lastUserId: string | undefined

const app = Fastify({ logger: false })
await app.register(userAuthedScope(async (device) => {
  // Runs after the auth hook in the same scope, so it observes what the real
  // handlers will see.
  device.addHook("preHandler", async (req) => { lastUserId = req.userId })
  await device.register(sportPlayRoutes)
}))
await app.ready()

let pass = 0, fail = 0
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`) }
}

console.log("\n▶ ประตูตรวจสิทธิ์")

const noAuth = await app.inject({ method: "GET", url: "/v1/sport-play/dashboard?range=7d" })
check("ไม่มีโทเคน → 401", noAuth.statusCode === 401, `ได้ ${noAuth.statusCode}`)

const junk = await app.inject({
  method: "GET", url: "/v1/sport-play/dashboard?range=7d",
  headers: { authorization: "Bearer not-a-real-token" },
})
check("โทเคนมั่ว → 401", junk.statusCode === 401, `ได้ ${junk.statusCode}`)

// A real user token. Minted with the service key so the test needs no password.
const { data: link, error: linkErr } = await supabase.auth.admin.generateLink({
  type: "magiclink", email: "chainimit@gmail.com",
})
if (linkErr || !link) {
  console.log(`  ⚠️  ออกโทเคนทดสอบไม่ได้ (${linkErr?.message}) — ข้ามการทดสอบโทเคนจริง`)
} else {
  const hashed = link.properties.hashed_token
  const { data: sess, error: vErr } = await supabase.auth.verifyOtp({
    type: "magiclink", token_hash: hashed,
  })
  if (vErr || !sess.session) {
    console.log(`  ⚠️  แลกโทเคนไม่สำเร็จ (${vErr?.message}) — ข้าม`)
  } else {
    const token = sess.session.access_token
    const ok = await app.inject({
      method: "GET", url: "/v1/sport-play/dashboard?range=7d",
      headers: { authorization: `Bearer ${token}` },
    })
    check("โทเคนจริง → ผ่านประตู (ไม่ใช่ 401)", ok.statusCode !== 401, `ได้ ${ok.statusCode}`)

    // The second half of the bug: the handler must know WHO is calling.
    check("req.userId ถูกตั้งค่าให้ handler", lastUserId === sess.session.user.id,
          `ได้ ${lastUserId ?? "undefined"} — handler อ่าน req.userId ถ้าว่างจะเขียนแถวที่ไม่มีเจ้าของ`)
  }
}

await app.close()
console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
