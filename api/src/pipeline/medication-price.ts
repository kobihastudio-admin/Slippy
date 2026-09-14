/**
 * A live, sourced estimate of a medication's market price in Thailand and
 * where it tends to sell for less — not a stored fact. Prices move, differ
 * by pharmacy and by brand vs. generic, and a saved number from scan time
 * goes stale the moment it's written. This runs a fresh web search each
 * time it's called instead of ever being cached into the medication row.
 *
 * Uses a raw fetch to the Messages API rather than the pinned
 * @anthropic-ai/sdk (0.24.3, see travel-doc.ts's own note on why this repo
 * hasn't upgraded it) — that version predates the web_search server tool,
 * and this is a plain JSON POST, not worth bumping a shared dependency for.
 */

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages"
const MODEL = process.env.MEDICATION_PRICE_MODEL ?? "claude-sonnet-5"

export interface MedicationPriceResult {
  /** Thai-language summary: typical price range, and where it tends to be cheaper. */
  summary: string
  /** Pages the model actually cited, so a person can go check the number themselves. */
  sources: Array<{ title: string; url: string }>
}

const SYSTEM = `คุณช่วยหาข้อมูลราคาตลาดของยาที่ขายในประเทศไทย จากการค้นเว็บ

- ค้นหาจากร้านขายยาออนไลน์หรือเว็บไซต์ที่น่าเชื่อถือ ให้ความสำคัญกับแหล่งข้อมูลในไทย
- สรุปเป็นภาษาไทย กระชับ ไม่เกิน 4-5 บรรทัด: ช่วงราคาโดยประมาณ (ต่อกล่อง/แผง/ขวด ตามที่เจอ)
  และร้านหรือช่องทางที่ราคามักจะถูกกว่า ถ้าเจอ
- ถ้าเป็นยาที่ต้องใช้ใบสั่งแพทย์ (ไม่ใช่ยาสามัญประจำบ้าน) ให้บอกด้วยว่าต้องมีใบสั่งแพทย์จึงจะซื้อได้
- จบด้วยประโยคเตือนเสมอว่า "ราคาโดยประมาณ ณ ช่วงเวลาที่ค้นหา ควรตรวจสอบกับร้านค้าอีกครั้งก่อนซื้อ"
- ถ้าค้นไม่พบราคาที่น่าเชื่อถือ ให้บอกตรงๆ ว่าหาราคาที่แน่ชัดไม่ได้ แทนที่จะเดา

ตอบเป็นข้อความธรรมดา ไม่ต้องมี JSON หรือ markdown header`

interface AnthropicTextBlock { type: "text"; text: string; citations?: Array<{ url?: string; title?: string }> }
interface AnthropicOtherBlock { type: string; [k: string]: unknown }

export async function lookupMedicationPrice(
  name: string, genericName: string | null, strength: string | null,
): Promise<MedicationPriceResult> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error("ANTHROPIC_API_KEY ยังไม่ได้ตั้งค่า")

  const drugQuery = [name, genericName, strength].filter(Boolean).join(" ")

  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
      messages: [{
        role: "user",
        content: `ช่วยหาราคาตลาดปัจจุบันของยา "${drugQuery}" ที่ขายในประเทศไทย และร้านที่ราคาถูกกว่าที่อื่น`,
      }],
    }),
    // Web search is genuinely variable — up to 3 searches plus synthesis can
    // take well over a minute on a slow run, confirmed live (one query
    // aborted at 45s that would very likely have finished given more room).
    signal: AbortSignal.timeout(100_000),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`)
  }

  const json = await res.json() as { content: Array<AnthropicTextBlock | AnthropicOtherBlock> }

  const textBlocks = json.content.filter((b): b is AnthropicTextBlock => b.type === "text")
  const summary = textBlocks.map(b => b.text).join("\n").trim()

  const sources = new Map<string, string>()
  for (const b of textBlocks) {
    for (const c of b.citations ?? []) {
      if (c.url) sources.set(c.url, c.title ?? c.url)
    }
  }

  if (!summary) throw new Error("ค้นหาราคาไม่สำเร็จ — ลองใหม่อีกครั้ง")

  return {
    summary,
    sources: [...sources.entries()].map(([url, title]) => ({ url, title })),
  }
}
