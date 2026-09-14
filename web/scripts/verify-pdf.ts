/**
 * Renders the real trip document to a PDF through real Chrome — run with:
 *   npx tsx scripts/verify-pdf.ts <journeyId> <out.pdf>
 *
 * Exists because every part of this path can compile perfectly and still
 * produce an unreadable file: a missing font turns Thai tone marks into boxes
 * and Japanese into tofu, and nothing errors. The only check that means
 * anything is opening the PDF and looking at it.
 *
 * Uses the same component, the same stylesheet and the same puppeteer options
 * as the production route, so a pass here is evidence about production rather
 * than about a parallel implementation.
 */
// web/ keeps its env in .env.local, which dotenv does not read by default.
import { config } from "dotenv"
config({ path: ".env.local" })
config()
import { createClient } from "@supabase/supabase-js"
import { writeFileSync, existsSync } from "fs"
import { buildTripDocumentHtml } from "../src/lib/trips/trip-document-html"
import { PRINT_CSS } from "../src/lib/trips/print-css"

async function main() {
  const journeyId = process.argv[2]
  const outPath   = process.argv[3] ?? "trip.pdf"
  if (!journeyId) { console.error("ต้องระบุ journeyId"); process.exit(1) }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  if (!url || !key) { console.error("ต้องมี NEXT_PUBLIC_SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY"); process.exit(1) }
  const db = createClient(url, key)

  const { data: trip } = await db.from("life_journeys")
    .select(`id, title, destination, description, status, started_at, ended_at,
             base_currency, cover_emoji, notes,
             trip_participants(id, display_name, is_host, amount_owed, amount_paid)`)
    .eq("id", journeyId).single()
  if (!trip) { console.error("ไม่พบทริป"); process.exit(1) }

  const { data: days } = await db.from("trip_itinerary_days")
    .select(`id, day_number, date, title, city, summary,
             trip_itinerary_items(id, sort_order, type, title, subtitle, location, lat, lng,
               end_location, end_lat, end_lng, time_from, time_to, starts_at, ends_at,
               status, provider, confirmation_code, notes,
               amount, currency, exchange_rate, amount_base_currency, details, expense_id)`)
    .eq("journey_id", journeyId).order("day_number")
    .order("sort_order", { referencedTable: "trip_itinerary_items" })

  const [{ data: checklist }, { data: notes }] = await Promise.all([
    db.from("trip_checklist_items").select("id, title, category, is_done, sort_order")
      .eq("journey_id", journeyId).order("sort_order"),
    db.from("trip_notes").select("id, title, body, tag, is_pinned")
      .eq("journey_id", journeyId).order("is_pinned", { ascending: false }).order("created_at"),
  ])

  const { trip_participants, ...journeyTrip } = trip as any
  const markup = buildTripDocumentHtml({
    trip: journeyTrip, days: (days ?? []) as any,
    participants: trip_participants ?? [], checklist: (checklist ?? []) as any,
    notes: (notes ?? []) as any,
  })
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8">
  <title>${trip.title}</title>
  <style>html,body{margin:0;padding:0;background:#fff}${PRINT_CSS}</style>
  </head><body>${markup}</body></html>`

  // HTML-only mode: writes the exact document Chrome would be handed, for
  // inspecting layout and font coverage where a browser cannot be launched
  // (a sandboxed CI shell, this repo's dev container). The PDF step after it is
  // mechanical; what is worth looking at is the page.
  if (outPath.endsWith(".html")) {
    writeFileSync(outPath, html)
    console.log(`HTML ${html.length.toLocaleString()} ตัวอักษร → ${outPath}`)
    return
  }

  const CHROME_PATHS = [
    process.env.CHROME_PATH, "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter((p): p is string => !!p)
  const executablePath = CHROME_PATHS.find(p => existsSync(p))
  if (!executablePath) { console.error("ไม่พบ Chrome"); process.exit(1) }

  const puppeteer = await import("puppeteer-core")
  const { mkdtemp } = await import("fs/promises")
  const { tmpdir } = await import("os")
  const { join } = await import("path")
  // Its own profile — see the same fix in api/src/routes/pdf.ts. Without it a
  // Chrome already running on the default profile swallows the launch and
  // puppeteer waits for a WS endpoint that never appears.
  const userDataDir = await mkdtemp(join(tmpdir(), "slippy-verify-pdf-"))

  const browser = await puppeteer.launch({
    executablePath, headless: true, userDataDir, timeout: 45_000,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  })
  const page = await browser.newPage()
  await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 30_000 })
  await page.evaluateHandle("document.fonts.ready")
  const pdf = await page.pdf({
    format: "A4", printBackground: true,
    margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" },
  })
  await browser.close()

  writeFileSync(outPath, pdf)
  const items = (days ?? []).reduce((s: number, d: any) => s + d.trip_itinerary_items.length, 0)
  console.log(`${trip.title}`)
  console.log(`  ${days?.length} วัน · ${items} รายการ · checklist ${checklist?.length} · โน้ต ${notes?.length}`)
  console.log(`  HTML ${html.length.toLocaleString()} ตัวอักษร → PDF ${(pdf.length / 1024).toFixed(0)} KB`)
  console.log(`  เขียนไปที่ ${outPath}`)
}

main().catch(err => { console.error(err); process.exit(1) })
