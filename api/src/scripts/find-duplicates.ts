/**
 * Duplicate report — run with:  npm run report:duplicates [orgId]
 *
 * Reports only; deletes nothing. Which copy to keep is a judgement about the
 * user's own records — one scan may be sharper, or carry corrections someone
 * made by hand — so the choice stays with a person.
 *
 * Groups by the receipt's printed identity rather than by row: vendor, document
 * number, date and total. That is the same evidence the pipeline's own
 * duplicate check uses (validator.ts), so this report and the DUPLICATE flag
 * agree about what "the same receipt" means.
 */
import { supabase } from "../lib/supabase"
import { isValidThaiTaxId } from "../pipeline/tax-id"

interface Doc {
  id: string
  organization_id: string
  vendor_name: string | null
  vendor_tax_id: string | null
  doc_number: string | null
  doc_date: string | null
  total_amount: number | null
  status: string
  created_at: string
  is_duplicate: boolean | null
  overall_confidence: number | null
}

/**
 * Merchant identity. A tax id only counts when its check digit is real — one of
 * the three scans of the same shop read "8105538104313", a leading 0 misread as
 * 8, which would otherwise split one merchant into two.
 */
function merchant(d: Doc): string {
  const tax = (d.vendor_tax_id ?? "").replace(/\D/g, "")
  if (isValidThaiTaxId(tax)) return `tax:${tax}`
  return `name:${(d.vendor_name ?? "").trim().toLowerCase()}`
}

/** Certain: the printed receipt number matches too. */
function exactKey(d: Doc): string {
  return [merchant(d), (d.doc_number ?? "").trim().toLowerCase(), d.doc_date ?? "", d.total_amount ?? ""].join("|")
}

/**
 * Probable: same shop, same day, same amount — but a different receipt number.
 *
 * The receipt number is the smallest print on the page and the least reliably
 * read: three scans of ONE Gateaux House slip produced "86413", "49D" and
 * "45458". Keying on it alone therefore misses exactly the duplicates that
 * matter. Reported separately because this is genuinely ambiguous — buying the
 * same ฿78 pastry twice in one day is a thing people do — so it is a question
 * for a person, not a verdict.
 */
function probableKey(d: Doc): string {
  return [merchant(d), d.doc_date ?? "", d.total_amount ?? ""].join("|")
}

const orgFilter = process.argv[2]

const { data, error } = await supabase
  .from("documents")
  .select("id,organization_id,vendor_name,vendor_tax_id,doc_number,doc_date,total_amount,status,created_at,is_duplicate,overall_confidence")
  .neq("status", "rejected")
  .order("created_at", { ascending: true })

if (error) { console.error(error.message); process.exit(1) }

const docs = (data ?? []).filter(d => !orgFilter || d.organization_id === orgFilter) as Doc[]

function group(keyOf: (d: Doc) => string): Doc[][] {
  const m = new Map<string, Doc[]>()
  for (const d of docs) {
    // A receipt with neither a number nor a total cannot be matched on
    // identity; grouping those would merge unrelated documents.
    if (!d.doc_number && !d.total_amount) continue
    const k = keyOf(d)
    m.set(k, [...(m.get(k) ?? []), d])
  }
  return [...m.values()].filter(g => g.length > 1).sort((a, b) => b.length - a.length)
}

const dupes = group(exactKey)
const exactIds = new Set(dupes.flat().map(d => d.id))
// Only the probable groups the exact pass did not already explain.
const probable = group(probableKey).filter(g => !g.every(d => exactIds.has(d.id)))

const thb = (n: number | null) => (n ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })

console.log(`\nเอกสารทั้งหมด ${docs.length} ใบ`)
// Do NOT exit when the exact tier is empty. It was doing that, and the moment
// the certain duplicates were cleaned up the probable ones became invisible —
// including a pair that turned out to be the same photograph uploaded through
// two channels. An empty exact tier is the point at which the probable tier
// matters most.
if (!dupes.length && !probable.length) { console.log("✅ ไม่พบเอกสารซ้ำ\n"); process.exit(0) }

const wasted = dupes.reduce((s, g) => s + (g.length - 1), 0)
const wastedTHB = dupes.reduce((s, g) => s + (g.length - 1) * (g[0].total_amount ?? 0), 0)

if (dupes.length) console.log(`❗ พบ ${dupes.length} ใบเสร็จที่ถูกอัพซ้ำ — เกินมา ${wasted} ฉบับ (มูลค่าที่นับซ้ำ ฿${thb(wastedTHB)})\n`)

function report(groups: Doc[][], heading: string) {
  if (!groups.length) return
  console.log(heading)
  for (const g of groups) {
  const first = g[0]
  // Which copy to recommend keeping. Age is the tie-breaker, not the rule: a
  // human who approved a copy has already checked it against the paper, and that
  // outranks an older copy nobody has looked at. One pair here was exactly that
  // — the older copy also carried a table label ("กลับบ้าน 1") misread into the
  // document-number field, so "oldest" would have kept the worse record.
  const approved = g.find(d => d.status === "approved")
  const recommended = approved ?? g[0]
  const reason = approved ? "คนตรวจแล้ว (approved)" : "เก่าสุด"
  console.log(`── ${first.vendor_name ?? "(ไม่ทราบชื่อ)"}  เลขที่ ${first.doc_number ?? "-"}  ${first.doc_date ?? "-"}  ฿${thb(first.total_amount)}`)
  console.log(`   ซ้ำ ${g.length} ฉบับ — ควรเก็บ 1 ลบ ${g.length - 1}`)
  g.forEach((d, i) => {
    const flag = d.is_duplicate ? "ระบบตีธงแล้ว" : "ระบบยังไม่ตีธง"
    const keep = d.id === recommended.id ? `  ← ${reason} (แนะนำให้เก็บ)` : ""
    console.log(`     ${d.id.slice(0, 8)}  ${d.created_at.slice(0, 16).replace("T", " ")}  เลขที่ ${String(d.doc_number ?? "-").padEnd(18)} ${d.status.padEnd(10)} conf=${d.overall_confidence ?? "-"}  ${flag}${keep}`)
  })
  console.log()
  }
}

report(dupes, "══ ซ้ำแน่นอน (ร้าน + เลขที่ + วันที่ + ยอด ตรงกันหมด) ══\n")
report(probable, "══ น่าจะซ้ำ (ร้าน + วันที่ + ยอด ตรงกัน แต่เลขที่ต่าง — ต้องดูด้วยตา) ══\n")

// The flag exists so the app can show it; a duplicate the pipeline never
// noticed is invisible to the user, which is the case worth surfacing.
const unflagged = dupes.flatMap(g => g.slice(1)).filter(d => !d.is_duplicate)
if (unflagged.length) {
  console.log(`⚠️  ${unflagged.length} ฉบับเป็นของซ้ำแต่ระบบไม่ได้ตีธง is_duplicate — แอปจะไม่แสดงเตือน`)
  console.log(`   ${unflagged.map(d => d.id.slice(0, 8)).join(", ")}\n`)
}
