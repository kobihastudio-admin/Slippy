/**
 * Does this Document AI processor read Thai?  — run with:
 *   npm run test:docai            (tests the one in api.env)
 *   npm run test:docai <id>       (tests a candidate before switching to it)
 *   npm run test:docai <id> <loc> (…in a different region)
 *
 * Exists because the answer is not knowable from the Console: a processor that
 * cannot read Thai does not fail, it returns confident Latin transliteration.
 * The one configured for this project returns "3 Quwwa lugj" for
 * "3 สุกี้ บุฟเฟต์ ผู้ใหญ่" and "24 ningnaw 2569" for "24 กรกฎาคม 2569" — every
 * number perfect, every Thai word invented. Nothing anywhere surfaced that.
 *
 * So this runs a REAL receipt whose text is known, and grades the result.
 */
import "dotenv/config"
import { supabase } from "../lib/supabase"
import { downloadFile, normalizeImage, sliceTallReceipt } from "../pipeline/preprocessor"

/**
 * A production receipt with large, sharp, unambiguous Thai — chosen because a
 * human reads it without effort, so a failure here is the processor's, not the
 * photograph's. Verified by eye against the image.
 */
const SAMPLE = {
  documentPrefix: "27ac9e3d",
  /** Words that MUST appear if Thai is being read at all. */
  expected: ["สุกี้", "บุฟเฟต์", "ผู้ใหญ่", "น้ำใส", "ยอดรวม", "กรกฎาคม"],
  /** Figures the current processor already gets right — the control. */
  expectedFigures: ["657.00", "117.00", "774.00", "828.18"],
}

const processorId = process.argv[2] ?? process.env.GOOGLE_DOC_AI_PROCESSOR_ID!
const location    = process.argv[3] ?? process.env.GOOGLE_DOC_AI_LOCATION!
const project     = process.env.GOOGLE_CLOUD_PROJECT!

const { data } = await supabase.from("documents").select("id,file_path,vendor_name")
  .gte("created_at", "2026-08-15T00:00:00Z")
const doc = (data ?? []).find(d => d.id.startsWith(SAMPLE.documentPrefix))
if (!doc) {
  console.error(`ไม่พบเอกสารตัวอย่าง ${SAMPLE.documentPrefix} — แก้ SAMPLE ในไฟล์นี้ให้ชี้ใบที่มีอยู่`)
  process.exit(1)
}

const { buffer } = await downloadFile(doc.file_path)
const slices = await sliceTallReceipt(await normalizeImage(buffer, "jpg"))
const page = slices[Math.min(1, slices.length - 1)]

const { DocumentProcessorServiceClient } = await import("@google-cloud/documentai")
const client = new DocumentProcessorServiceClient({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON!),
  apiEndpoint: `${location}-documentai.googleapis.com`,
})

console.log(`\nโปรเจกต์ ${project} · ภูมิภาค ${location} · processor ${processorId}`)
console.log(`ทดสอบกับ: ${doc.vendor_name} (${doc.id.slice(0, 8)})\n`)

let text = ""
let shape = ""
try {
  const [res] = await client.processDocument({
    name: `projects/${project}/locations/${location}/processors/${processorId}`,
    rawDocument: { content: page.toString("base64"), mimeType: "image/jpeg" },
  })
  text = res.document?.text ?? ""

  // The response SHAPE identifies the processor type without needing
  // documentai.processors.get, which a least-privilege service account will not
  // have. `detectedLanguages` is the sharpest tell of all: a processor that
  // cannot read Thai does not report Thai with low confidence — it reports
  // Latin-script languages, because transliteration is what it produced.
  const p0 = res.document?.pages?.[0]
  const langs = (p0?.detectedLanguages ?? []).map(l => l.languageCode).filter(Boolean)
  shape = [
    `entities=${res.document?.entities?.length ?? 0} (specialized parser)`,
    `formFields=${p0?.formFields?.length ?? 0} (form parser)`,
    `symbols=${p0?.symbols?.length ?? 0}`,
    `imageQualityScores=${p0?.imageQualityScores ? "yes (enterprise OCR)" : "no"}`,
    `ภาษาที่ตรวจพบ: ${langs.join(",") || "—"}${langs.includes("th") ? "" : "  ← ไม่มี th"}`,
  ].join("\n   ")
} catch (err) {
  console.error(`❌ เรียก processor ไม่สำเร็จ: ${(err as Error).message.split("\n")[0]}`)
  process.exit(1)
}

const foundWords   = SAMPLE.expected.filter(w => text.includes(w))
const foundFigures = SAMPLE.expectedFigures.filter(f => text.includes(f))

console.log("── ชนิดของ processor (อนุมานจากรูปร่าง response) ──")
console.log("   " + shape + "\n")
console.log("── ตัวอย่างข้อความที่อ่านได้ ──")
console.log(text.split("\n").filter(l => l.trim()).slice(0, 12).map(l => "   " + l).join("\n"))

console.log(`\n── คะแนน ──`)
console.log(`   ตัวเลข:    ${foundFigures.length}/${SAMPLE.expectedFigures.length}  ${foundFigures.join(" ") || "—"}`)
console.log(`   คำไทย:     ${foundWords.length}/${SAMPLE.expected.length}  ${foundWords.join(" ") || "—"}`)

if (foundWords.length === 0) {
  console.log(`\n❌ processor นี้อ่านภาษาไทยไม่ได้เลย`)
  console.log(`   ตัวเลขถูกแต่ตัวอักษรถูกถอดเป็นอักษรอื่น — ห้ามใช้ข้อความจากมันเป็นแหล่งอ้างอิงคำ`)
  console.log(`   (pipeline กรองเหลือเฉพาะตัวเลขอยู่แล้ว — ดู numericOnlyOcr ใน extractor.ts)`)
} else if (foundWords.length < SAMPLE.expected.length) {
  console.log(`\n⚠️  อ่านไทยได้บางส่วน — ดีกว่าเดิมแต่ยังไม่ครบ ตัดสินใจเองว่าคุ้มค่าใช้จ่ายไหม`)
} else {
  console.log(`\n✅ อ่านไทยได้ครบ — ตัวนี้ใช้แทนได้`)
  console.log(`   ขั้นตอนถัดไป: ตั้ง GOOGLE_DOC_AI_PROCESSOR_ID=${processorId} ใน <stack>/api.env`)
  console.log(`   แล้วเปิด DOCAI_THAI_GROUNDING=1 เพื่อให้ยิงทุกเอกสารที่มีภาษาไทย`)
}
console.log()
