/**
 * setup-rich-menu.ts — Slippy Rich Menu v7 "Slippy Universe v3" (literal mockup artwork)
 *
 * v7 — swaps in a polished, numbered mockup (1. ส่งสลิป … 8. Dashboard) whose
 * 8 cards point at the group-creation features (นัดกีฬา / หารบิล / สร้างทริป /
 * สร้างกลุ่มอื่นๆ) instead of the old pillar-navigation layout. Source file
 * lives at:
 *   api/src/assets/richmenu-slippy-universe-v3-mockup.png  (1536×1024, 4×2 card
 *   grid + bottom branding bar)
 *
 * The image is resized to LINE's required 2500×1686 canvas and uploaded as-is;
 * tap-area `bounds` below are mapped proportionally onto the same 4-col × 2-row
 * grid + footer bar visible in the artwork:
 *
 *   Row 1:  📸 ส่งสลิป | 🏸 นัดกีฬา   | 🤝 หารบิล      | ✈️ สร้างทริป
 *   Row 2:  💊 สุขภาพ/ยา | 📊 Dashboard | ⋯  เมนูอื่นๆ   | 🆕 สร้างกลุ่ม (อื่นๆ)
 *   Footer: branding bar (Slippy · "Every Slip Tells Your Life Story") → opens app
 *
 * วิธีรัน:  cd api && npm run setup:richmenu
 */

import { config } from "dotenv"
import { getAppUrl } from "../lib/app-url"
config({ override: true, path: new URL("../../.env", import.meta.url).pathname })

import sharp from "sharp"
import path  from "node:path"
import fs    from "node:fs"
import os    from "node:os"

// Source artwork — the literal AI-generated mockup image (not a recreation)
const SOURCE_IMAGE = new URL("../assets/richmenu-slippy-universe-v3-mockup.png", import.meta.url).pathname

const LINE_API      = "https://api.line.me/v2/bot"
const LINE_DATA_API = "https://api-data.line.me/v2/bot"
const TOKEN         = process.env.LINE_CHANNEL_ACCESS_TOKEN

if (!TOKEN) { console.error("❌ LINE_CHANNEL_ACCESS_TOKEN ไม่พบใน .env"); process.exit(1) }

const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }

// NOTE: the กลุ่มกีฬา/กลุ่มทริป LIFF dashboards (formerly tap-areas on v3) now
// live inside the "/menu" command-menu carousel (see "More" card below) —
// freeing up the grid for the broader "Slippy Universe" pillar navigation.
const APP_URL = getAppUrl()
const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID

// All Rich Menu destinations are standalone LIFF pages (sport/split/trip/
// places/health/dashboard) that handle their own LINE login (liff.login()) —
// open them directly instead of routing through the `/liff/home` gate.
function liffUrl(destPath: string): string {
  if (LIFF_ID) return `https://liff.line.me/${LIFF_ID}${destPath}`
  return `${APP_URL}${destPath}`   // fallback if LIFF isn't configured
}

// ─── Dimensions ────────────────────────────────────────────────────────────────
// v5 — canvas matches LINE's required full-menu size; tap areas are mapped onto
// the 4×2 card grid + bottom branding bar that are VISIBLE in the source artwork
// (source is 1536×1024 — grid occupies the top ~86.5%, footer bar the bottom ~13.5%)
const W      = 2500
const H      = 1686
const FOOTER = Math.round(H * 0.135)            // ≈ 228 — branding bar height (bottom)
const GRID_H = H - FOOTER                        // ≈ 1458 — card-grid height
const CW     = Math.floor(W / 4)                 // 625 — card column width  (4 cols)
const CH     = Math.floor(GRID_H / 2)            // ≈ 729 — card row height  (2 rows)

// ─── Rich Menu hit areas ───────────────────────────────────────────────────────
// 8-card grid (matches the artwork: ส่งสลิป · นัดกีฬา · หารบิล · สร้างทริป /
// สุขภาพ/ยา · Dashboard · เมนูอื่นๆ · สร้างกลุ่ม (อื่นๆ)) + a footer brand-bar tap area
const RICH_MENU_BODY = {
  size:        { width: W, height: H },
  selected:    true,
  name:        "Slippy Universe Menu v7 (mockup artwork v3)",
  chatBarText: "📱 เมนู Slippy",
  areas: [
    // ── Row 1 ──────────────────────────────────────────────────────────────
    // 📸 ส่งสลิป → Document Scanner LIFF (camera + multi-upload)
    { bounds: { x: 0,          y: 0,           width: CW, height: CH }, action: { type: "uri", uri: liffUrl("/liff/scan") } },
    // 🏸 นัดกีฬา → open/create sport-meetup groups (LIFF handles its own login)
    { bounds: { x: CW,         y: 0,           width: CW, height: CH }, action: { type: "uri", uri: liffUrl("/liff/sport") } },
    // 🤝 หารบิล → create a generic split-bill group
    { bounds: { x: CW * 2,     y: 0,           width: CW, height: CH }, action: { type: "uri", uri: liffUrl("/liff/split") } },
    // ✈️ สร้างทริป → open/create trip groups
    { bounds: { x: CW * 3,     y: 0,           width: W - CW * 3, height: CH }, action: { type: "uri", uri: liffUrl("/liff/trip") } },

    // ── Row 2 ──────────────────────────────────────────────────────────────
    // 💊 สุขภาพ/ยา → standalone LIFF health dashboard (own login flow)
    { bounds: { x: 0,          y: CH,          width: CW, height: GRID_H - CH }, action: { type: "uri", uri: liffUrl("/liff/health") } },
    // 👥 สร้างกลุ่ม (อื่นๆ) [NEW] → Community Groups LIFF  (ตำแหน่ง 6 ในรูป)
    { bounds: { x: CW,         y: CH,          width: CW, height: GRID_H - CH }, action: { type: "uri", uri: liffUrl("/liff/community") } },
    // ⋯ เมนูอื่นๆ → Profile & Package LIFF  (ตำแหน่ง 7 ในรูป)
    { bounds: { x: CW * 2,     y: CH,          width: CW, height: GRID_H - CH }, action: { type: "uri", uri: liffUrl("/liff/profile") } },
    // 📊 Dashboard → standalone LIFF dashboard  (ตำแหน่ง 8 ในรูป)
    { bounds: { x: CW * 3,     y: CH,          width: W - CW * 3, height: GRID_H - CH }, action: { type: "uri", uri: liffUrl("/liff/dashboard") } },

    // ── Footer branding bar → standalone LIFF dashboard (own login flow) ──
    { bounds: { x: 0,          y: GRID_H,      width: W, height: FOOTER }, action: { type: "uri", uri: liffUrl("/liff/dashboard") } },
  ],
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("🔧 Slippy Rich Menu Setup (marketing template style)\n")

  // 1. ลบ Rich Menu เดิม
  console.log("1️⃣  ลบ Rich Menu เดิม...")
  const existRes = await fetch(`${LINE_API}/user/all/richmenu`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  })
  if (existRes.ok) {
    const d = await existRes.json() as { richMenuId?: string }
    if (d.richMenuId) {
      await fetch(`${LINE_API}/richmenu/${d.richMenuId}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${TOKEN}` }
      })
      console.log(`   ลบ ${d.richMenuId}`)
    } else console.log("   ไม่มีเดิม")
  }

  // 2. สร้าง structure
  console.log("2️⃣  สร้าง Rich Menu structure...")
  const createRes = await fetch(`${LINE_API}/richmenu`, {
    method: "POST", headers, body: JSON.stringify(RICH_MENU_BODY)
  })
  if (!createRes.ok) {
    console.error("❌", await createRes.text()); process.exit(1)
  }
  const { richMenuId } = await createRes.json() as { richMenuId: string }
  console.log(`   richMenuId: ${richMenuId}`)

  // 3. Resize source artwork → JPEG (literal mockup image, not a recreation)
  //    LINE caps Rich Menu images at 1 MB — the source re-encodes to ~6 MB as
  //    PNG at full size, so emit JPEG instead (LINE accepts image/jpeg too).
  console.log("3️⃣  Resize mockup artwork → JPEG...")
  console.log(`   source: ${SOURCE_IMAGE}`)
  const tmpImg = path.join(os.tmpdir(), "slippy-richmenu.jpg")

  await sharp(SOURCE_IMAGE)
    .resize(W, H, { fit: "fill" })   // stretch to LINE's required canvas (aspect ratios are close: 1.5 vs 1.483)
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(tmpImg)

  const meta = await sharp(tmpImg).metadata()
  const kb   = (fs.statSync(tmpImg).size / 1024).toFixed(0)
  console.log(`   ${meta.width}×${meta.height} px — ${kb} KB`)

  if (meta.width !== W || meta.height !== H) {
    const fixed = tmpImg.replace(".jpg", "-f.jpg")
    await sharp(tmpImg).resize(W, H, { fit: "fill" }).jpeg({ quality: 82, mozjpeg: true }).toFile(fixed)
    fs.renameSync(fixed, tmpImg)
    console.log("   ✓ resized")
  }

  // 4. อัปโหลด
  console.log("4️⃣  Upload image (api-data.line.me)...")
  const uploadRes = await fetch(`${LINE_DATA_API}/richmenu/${richMenuId}/content`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "image/jpeg" },
    body: fs.readFileSync(tmpImg),
  })
  if (!uploadRes.ok) {
    console.error(`❌ HTTP ${uploadRes.status}:`, await uploadRes.text()); process.exit(1)
  }
  console.log("   อัปโหลดสำเร็จ ✓")

  // 5. Set default
  console.log("5️⃣  ตั้ง Default...")
  const defRes = await fetch(`${LINE_API}/user/all/richmenu/${richMenuId}`, {
    method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }
  })
  if (!defRes.ok) {
    console.error("❌", await defRes.text()); process.exit(1)
  }

  fs.unlinkSync(tmpImg)
  console.log(`\n✅ Rich Menu พร้อมใช้งาน!`)
  console.log(`   richMenuId: ${richMenuId}`)
  console.log(`   เปิดแชท LINE เพื่อดูเมนูใหม่ 👇`)
}

main().catch(err => { console.error("❌", err); process.exit(1) })
