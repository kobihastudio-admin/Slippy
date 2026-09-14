import Anthropic from "@anthropic-ai/sdk"
import { runOcr, type DocAiFields } from "./ocr"

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

let _client: Anthropic | null = null
const getClient = () => {
  if (!_client) _client = new Anthropic()  // read env at call time, not module load
  return _client
}

// ── Model tiers ───────────────────────────────────────────────────────────────
// Cost: Sonnet ~฿0.91/doc, Haiku ~฿0.22/doc
// Smart routing cuts avg cost to ~฿0.43/doc (53% savings)
// Sonnet 5, not 4.5. On hand-verified receipts 4.5 returned "G7ชุดเปาปั้งมี
// เสี้ยงขยาโบเดย" where the paper reads "G7ชุดปังจิ้มสังขยาใบเตย"; Sonnet 5
// returns it character-for-character. Same list price ($3/$15), and it accepts
// 2576px images instead of 1568 — see MODEL_LONG_EDGE.
const MODEL_SONNET = "claude-sonnet-5"            // complex docs, low confidence
const MODEL_HAIKU  = "claude-haiku-4-5-20251001"  // simple receipts, high-confidence path

// Doc types that are "simple" enough for Haiku-only extraction:
//   consumer_receipt (LINE MAN, Grab), receipt (ใบเสร็จธรรมดา)
// These have predictable layouts and few fields — Haiku handles them well.
// Complex types (tax_invoice_full, receipt_with_tax, credit_note) → always Sonnet.
const HAIKU_ELIGIBLE_CATEGORIES = new Set([
  "consumer_receipt",
  "receipt",
])

// Max tokens per model pass
const MAX_TOKENS_HAIKU  = 1500   // consumer receipts don't need much
// Sonnet 5 runs adaptive thinking by DEFAULT (4.5 did not), and max_tokens caps
// thinking plus the answer together — a budget tuned for answer-only truncates
// mid-JSON on the new model. Output tokens are billed on what is used, so the
// headroom is free unless it is needed.
const MAX_TOKENS_SONNET = 8192   // full tax invoices can be dense
const MAX_PAGES = 3                              // receipts/invoices are almost always 1-2 pages
/**
 * Slices are pieces of ONE page, so the page cap is the wrong limit for them —
 * and it was silently capping the fix for Thai legibility: a 1:6 supermarket
 * receipt needs five slices to reach the model at full width, and being cut to
 * three handed it pieces twice as tall as they are wide (≈780px of usable
 * width, well under the readable floor). Costs a little more per long receipt;
 * the alternative is paying for a read that returns invented words.
 */
const MAX_SLICE_IMAGES = 5

// ── Document category ─────────────────────────────────────────────────────────
//
//  Thai tax law classifies documents for VAT input credit as follows:
//
//  vat_claimable = true
//    tax_invoice_full      ใบกำกับภาษีเต็มรูปแบบ   — must have all 5 statutory fields
//    receipt_with_tax      ใบเสร็จรับเงิน/ใบกำกับภาษี (combined form)
//    credit_note           ใบลดหนี้                — reduces input VAT
//
//  vat_claimable = false  (can still be used as expense evidence)
//    tax_invoice_simplified  ใบกำกับภาษีอย่างย่อ   — retail (7-Eleven, Lotus, Makro …)
//    receipt                 ใบเสร็จรับเงินทั่วไป   — no VAT breakdown
//    consumer_receipt        ใบเสร็จแอป            — LINE MAN, Grab, Shopee Food …
//    invoice                 ใบแจ้งหนี้             — not yet paid / no VAT receipt
//    other                   ไม่สามารถระบุได้

export type DocCategory =
  | "tax_invoice_full"
  | "tax_invoice_simplified"
  | "receipt_with_tax"
  | "receipt"
  | "consumer_receipt"
  | "invoice"
  | "credit_note"
  | "other"

// ── Legacy doc_type mapping (keeps existing DB enum working) ──────────────────
const CATEGORY_TO_DOC_TYPE: Record<DocCategory, string> = {
  tax_invoice_full:       "tax_invoice",
  tax_invoice_simplified: "tax_invoice",
  receipt_with_tax:       "tax_invoice",
  receipt:                "receipt",
  consumer_receipt:       "receipt",
  invoice:                "invoice",
  credit_note:            "credit_note",
  other:                  "unknown",
}

// ── Business-use notes (Thai) ─────────────────────────────────────────────────
const BUSINESS_USE_NOTE: Record<DocCategory, string> = {
  tax_invoice_full:
    "ใบกำกับภาษีเต็มรูปแบบ — ใช้หักภาษีซื้อได้ และใช้เป็นหลักฐานค่าใช้จ่ายได้",
  tax_invoice_simplified:
    "ใบกำกับภาษีอย่างย่อ — ไม่สามารถใช้หักภาษีซื้อได้ แต่ใช้เป็นหลักฐานค่าใช้จ่ายได้",
  receipt_with_tax:
    "ใบเสร็จรับเงิน/ใบกำกับภาษี — ใช้หักภาษีซื้อได้ และใช้เป็นหลักฐานค่าใช้จ่ายได้",
  receipt:
    "ใบเสร็จรับเงิน — ไม่สามารถใช้หักภาษีซื้อได้ แต่ใช้เป็นหลักฐานค่าใช้จ่ายได้",
  consumer_receipt:
    "ใบเสร็จจากแอปพลิเคชัน — ไม่สามารถใช้หักภาษีซื้อได้ แต่ใช้เป็นหลักฐานค่าใช้จ่ายได้",
  invoice:
    "ใบแจ้งหนี้ — ยังไม่ได้ชำระเงิน ไม่สามารถใช้หักภาษีซื้อได้",
  credit_note:
    "ใบลดหนี้ — ใช้ลดยอดภาษีซื้อได้ตามจำนวนที่ระบุ",
  other:
    "ไม่สามารถระบุประเภทเอกสารได้ กรุณาตรวจสอบและจำแนกด้วยตนเอง",
}

const VAT_CLAIMABLE = new Set<DocCategory>([
  "tax_invoice_full",
  "receipt_with_tax",
  "credit_note",
])
const EXPENSE_CLAIMABLE = new Set<DocCategory>([
  "tax_invoice_full",
  "tax_invoice_simplified",
  "receipt_with_tax",
  "receipt",
  "consumer_receipt",
  "credit_note",
  "invoice",
])

// ── Types ─────────────────────────────────────────────────────────────────────
export interface LineItem {
  description: string
  quantity:    number
  unit_price:  number
  amount:      number
  confidence:  number
}

export interface ExtractedDocument {
  // Classification
  doc_category:      DocCategory
  doc_type:          string           // legacy enum value for DB
  vat_claimable:     boolean
  expense_claimable: boolean
  business_use_note: string

  // Vendor / issuer
  vendor_name:       string          // shop/branch as printed — what the user recognises
  company_name:      string | null   // registered juristic entity behind the shop
  vendor_tax_id:     string | null   // belongs to the company
  vendor_address:    string | null   // branch address
  company_address:   string | null   // registered/HQ address, when it differs
  vendor_phone:      string | null

  // Document identifiers
  doc_number:        string | null
  doc_date:          string | null    // YYYY-MM-DD
  due_date:          string | null    // YYYY-MM-DD

  // Amounts
  subtotal:          number
  discount_amount:   number           // ส่วนลด
  delivery_fee:      number           // ค่าจัดส่ง / ค่าบริการ
  vat_amount:        number
  wht_amount:        number
  total_amount:      number
  /** Amount actually tendered/charged, from the receipt's payment line. 0 if absent. */
  paid_amount:       number
  currency:          string

  // Consumer-platform specific
  platform_name:     string | null    // "LINE MAN" | "Grab" | "Shopee Food" | …
  platform_ref:      string | null    // delivery/order ref: LMF-xxx, GrabOrder-xxx …
  customer_name:     string | null    // ชื่อลูกค้า / ผู้รับ
  staff_name:        string | null    // ชื่อพนักงาน / แคชเชียร์

  // Other
  payment_method:    string | null
  notes:             string | null
  line_items:        LineItem[]

  // Confidence
  confidence_score:  number
  field_confidence:  Record<string, number>

  // Issues reported by Claude (empty array = no issues)
  extraction_issues: string[]
}

// ── System prompt ─────────────────────────────────────────────────────────────
/**
 * Resolves the date placeholders in SYSTEM_PROMPT.
 *
 * Must run per request, not once at module load: this API stays up for weeks at
 * a time, and a prompt that froze "today" on boot day would drift straight back
 * into the bug it exists to prevent.
 */
export function systemPrompt(): string {
  const now = new Date()
  return SYSTEM_PROMPT
    .replace("{{TODAY_CE}}", now.toISOString().slice(0, 10))
    .replace("{{TODAY_BE}}", String(now.getFullYear() + 543))
}

const SYSTEM_PROMPT = `\
You are an expert Thai accounting document parser with deep knowledge of Thai tax law.
Analyse the document image(s) and return ONLY valid JSON — absolutely no markdown code fences,
no \`\`\`json blocks, no explanatory text before or after, no comments. Just raw JSON.

## Document classification

| doc_category | Thai name | vat_claimable | Key identifier |
|---|---|---|---|
| tax_invoice_full | ใบกำกับภาษีเต็มรูปแบบ | true | Has BOTH issuer AND buyer name+address+tax ID printed |
| tax_invoice_simplified | ใบกำกับภาษีอย่างย่อ | false | Has issuer tax ID but NO buyer details |
| receipt_with_tax | ใบเสร็จรับเงิน/ใบกำกับภาษี | true | Combined form with buyer details |
| receipt | ใบเสร็จรับเงินทั่วไป | false | No VAT breakdown, no tax ID |
| consumer_receipt | ใบเสร็จจากแอปพลิเคชัน | false | Digital/app receipt |
| invoice | ใบแจ้งหนี้ | false | Bill not yet paid |
| credit_note | ใบลดหนี้ | true | Reduces previous purchase |
| other | ไม่ทราบ | false | Cannot determine |

## Critical classification rules

### tax_invoice_full requires ALL FIVE of:
1. The words "ใบกำกับภาษี" on the document
2. Issuer: name + address + 13-digit tax ID
3. Document number (เลขที่ใบกำกับภาษี)
4. Issue date
5. **Buyer: name + address** (ชื่อ/ที่อยู่ผู้ซื้อ) — THIS IS THE KEY DIFFERENTIATOR
→ If buyer name/address is missing → use tax_invoice_simplified or receipt

### Shop vs company — these are TWO different things, never merge them
A Thai receipt usually prints the shop at the top and the juristic entity below:

    KOFUKU                                  ← brand
    KOFUKU Silom Complex                    → vendor_name  (the branch you visited)
    บริษัท สยาม อัลเตอร์ กรุ๊ป จำกัด          → company_name (the legal entity)
    TAX ID: 0105562046201                   → vendor_tax_id (belongs to the COMPANY)
    เลขที่ 2 ซอยงามวงศ์วาน 6 … นนทบุรี        → company_address (registered office —
                                              note it is a different province from
                                              the Silom branch)

Rules:
- **vendor_name = the shop as the customer knows it** (brand + branch). NEVER
  replace it with the legal name; "KOFUKU Silom Complex" is what the user
  recognises in their own records.
- **company_name = the name carrying บริษัท / ห้างหุ้นส่วน / จำกัด / มหาชน / Co.,Ltd
  / PCL**, i.e. the entity the tax ID belongs to. null if the receipt shows none.
- If the receipt prints only ONE name, decide by form: a legal-entity name goes
  in BOTH fields; a plain shop name goes in vendor_name with company_name null.
- **vendor_address = the branch** you bought from; **company_address = the
  registered office** when a different one is printed. If only one address
  appears, put it in vendor_address and leave company_address null.

### The venue is NOT the merchant
Small shops inside a supermarket or mall print the shop first and the HOST STORE
underneath, in smaller type:

    ยอดชา คาเฟ่          ← the merchant (bold, larger)  ─┐
    โลตัสรามอินทรา        ← the venue it sits inside      ─┴→ vendor_name = "ยอดชา คาเฟ่ โลตัสรามอินทรา"

Returning only the second line loses the business entirely: the customer bought
tea from ยอดชา คาเฟ่, not from Lotus's. **Never output a venue name on its own.**
If the larger name above it is legible, vendor_name MUST contain it; append the
venue as the branch.

Names that are venues, essentially never the merchant: โลตัส / Lotus's, บิ๊กซี,
เทสโก้, แม็คโคร, เซ็นทรัล, โรบินสัน, เดอะมอลล์, ซีคอน, ฟิวเจอร์พาร์ค, เมกาบางนา,
เทอร์มินอล 21, ไอคอนสยาม, เอ็มควอเทียร์, สยามพารากอน, 7-Eleven, ปั๊ม ปตท./บางจาก.
Spell them as written here — โลตัส has ต, not ค.

### Gas station bills (บิลน้ำมัน) — ALWAYS tax_invoice_simplified
Vendors: PTT, Shell, Bangchak, Esso, Caltex, OR (โออาร์), Susco, Punthai Oil, IRPC, etc.
- They print "ใบกำกับภาษีอย่างย่อ" or just the station's tax ID
- They do NOT print buyer details → never tax_invoice_full
- line_items: fuel type (Diesel/Gasohol/E20/E85/Gasoline 95/91) + liters + price/liter
- Extract: vendor_name = station brand (e.g. "PTT"), doc_number = receipt no. if visible

### Retail stores — ALWAYS tax_invoice_simplified
7-Eleven, Lotus's (เทสโก้), Makro, BigC, HomePro, Global House, B2S, OfficeMate,
Tops, Villa Market, Gourmet Market, Family Mart, Lawson, CJ Express, etc.

### Consumer-receipt platforms — ALWAYS consumer_receipt
LINE MAN (ไลน์แมน), Grab/GrabFood/GrabExpress, Shopee Food (ช้อปปี้ฟู้ด),
Robinhood (โรบินฮู้ด), FoodPanda, Bolt Food, True Food, Lazada, Shopee (shopping),
Kerry Express, Flash Express, J&T Express, SCG Express, Thailand Post (ไปรษณีย์ไทย)

For consumer_receipt documents:
- platform_ref = the unique delivery/order reference code printed on the receipt
  • LINE MAN: "LMF-YYMMDD-XXXXXXXXX" pattern (e.g. LMF-260523-562610273)
  • Grab: "GrabOrder-XXXXXX" or similar
  • Shopee/Lazada: order number printed on label
  • This field is CRITICAL for duplicate detection — extract it precisely
- customer_name = ชื่อลูกค้า / Customer field (e.g. "กบ")
- staff_name = ชื่อพนักงาน / Staff field (e.g. "น้ำ พรโภชนา")

### General receipts without tax info → receipt
Parking lots (ที่จอดรถ), toll booths (ด่านทางพิเศษ), small street vendors,
wet markets, coffee carts, hospitals (OPD receipts), etc.

## Parsing rules
- TODAY IS {{TODAY_CE}} (Buddhist year {{TODAY_BE}}).
  Use THIS date — never your own sense of the current year — to decide whether a
  date is in the past or the future. Without it the model "corrected" a receipt
  printed 04/08/2026 down to 2023 because 2026 felt like the future, silently
  moving the document three accounting years. A receipt date within the last few
  days is completely normal: transcribe it, do not adjust it.
- Only a year that is ALREADY unambiguous as Buddhist (≥ 2500) gets 543
  subtracted. A 4-digit year at or below the current CE year is already CE —
  leave it alone. Never invent any other offset.
- Thai Buddhist calendar: subtract 543 (e.g. "2567" → 2024, "15 ม.ค. 2566" → "2023-01-15")
- Thai month names: ม.ค./มกราคม=01, ก.พ.=02, มี.ค.=03, เม.ย.=04, พ.ค.=05, มิ.ย.=06,
  ก.ค.=07, ส.ค.=08, ก.ย.=09, ต.ค.=10, พ.ย.=11, ธ.ค.=12
- Date formats to recognize (any = YYYY-MM-DD output):
  • "02/06/2569", "2/6/69", "06-02-69" → date fields with / - separators
  • "02 มิ.ย. 2569", "2 มิถุนายน 2569" → Thai month name
  • "20250602", "250602" → compact YYYYMMDD or YYMMDD
  • Time printed next to date "12:17" is NOT the date — look for DD/MM/YYYY pattern
  • Hospital receipts: look for วันที่, Date, เวลา fields
- VAT = 7%. WHT rates: 1%, 1.5%, 3%, 5%
- For consumer_receipt: delivery_fee = ค่าจัดส่ง, discount_amount = ส่วนลด/คูปอง
- SERVICE CHARGE → delivery_fee. Matches on the WORD, at any percentage, with or
  without the word "charge": "Service Charge(10%)", "Service (7%)", "ค่าบริการ",
  "เซอร์วิสชาร์จ", "SC 10%". A Ramen Osaka bill printing "Service (7%) 41.86" was
  missed because this line used to name only the "Service Charge(10%)" spelling.
  It is part of the VAT base: total = subtotal + service charge (VAT-included), or
  + VAT on top (VAT-excluded). Dropping it makes the arithmetic disagree with a
  total that was printed correctly.

- READ the printed totals. Do NOT assemble them from the line items.
  Receipts print their own arithmetic — Subtotal, Total, Grand Total, ยอดสุทธิ,
  รวมทั้งสิ้น, Before VAT, VAT 7% — and those lines are what the customer actually
  paid. They outrank any sum you build yourself, because a single misread digit in
  one item silently moves the total, while the printed total is one number you
  either read or you do not.
  If your line items do not add up to the printed total, the ITEMS are what you
  misread. Keep the printed total, keep the printed subtotal, and lower the
  confidence on the items instead.
  A faded café bill printed "Subtotal 295.00 / Total 295.00 / Before VAT 275.70 /
  VAT 19.30" — four mutually consistent lines. Two item prices were misread
  (145→445, 150→120) and the totals were rebuilt from them as ฿584.30. The paper
  said ฿295. Any one of those four printed lines would have caught it.
  "Before VAT" and "VAT" printed together give you the base directly: use them.
- paid_amount = the amount actually handed over or charged, as printed on the
  tender line: "เงินสด 100.00", "M/C 1,039.00", "Credit Card HomePro 957.39",
  "VISA 523.00". NOT the change (เงินทอน) and NOT a points/loyalty figure.
  0 if the receipt shows no tender line. This is the strongest confirmation of
  the total, so read it exactly and never infer it.
- If image appears rotated, try to read text at correct orientation. Look for numbers in all directions.
- Unknown fields → null. Unknown amounts → 0
- Confidence 0.0–1.0 reflects actual certainty. Never fabricate data.

## Thai line-item names — transcribe, do not translate into something likelier
Copy the characters that are on the page. Do not replace a reading with a word
that "makes more sense for this kind of shop", and do not smooth spacing: if the
receipt prints "B4น้ำเต้าหู้4ขวด100" with no spaces and an item code, that is the
description.

This instruction used to say the opposite. When the reader could not resolve Thai
at all, telling it to pick the nearest real word turned noise into something
usable, and a vocabulary list of frequent menu words helped. On a reader that CAN
resolve the glyphs, the same instruction overwrites correct readings with
plausible ones: on a hand-checked receipt it turned "ชุดปังจิ้มสังขยาใบเตย" into
"ชุดปาท่องโก๋จิ้มสังขยาใบเตย" — both real bakery words, only one of them printed.

Measured on two receipts read by eye first: the same model scored CER 0.000 with a
bare transcribe-only instruction and 0.457 with the coaching below it. The
knowledge of which glyph pairs blur (ท↔ก, ม↔บ, ย↔บ, ข↔ช, น↔ม, เ↔แ, ใ↔ไ, ั↔ิ, ่↔ี)
is kept, because knowing where to look is not the same as being told what to
conclude.

A product name ending in a province or district (เชียงใหม่, ภูเก็ต, หาดใหญ่) is
naming its ORIGIN — keep it attached to the item, do not split it into its own
line item.

If you genuinely cannot resolve a character, lower that item's confidence. A
low-confidence exact reading is worth more than a high-confidence plausible one:
a person can check the first against the paper, and has no way to catch the second.`

// ── Shared JSON schema string ──────────────────────────────────────────────────
const DOC_SCHEMA = `{
  "doc_category": "tax_invoice_full"|"tax_invoice_simplified"|"receipt_with_tax"|"receipt"|"consumer_receipt"|"invoice"|"credit_note"|"other",
  "vendor_name": string,
  "company_name": string|null,
  "vendor_tax_id": string|null,
  "vendor_address": string|null,
  "company_address": string|null,
  "vendor_phone": string|null,
  "platform_name": string|null,
  "platform_ref": string|null,
  "customer_name": string|null,
  "staff_name": string|null,
  "doc_number": string|null,
  "doc_date": "YYYY-MM-DD"|null,
  "due_date": "YYYY-MM-DD"|null,
  "subtotal": number,
  "discount_amount": number,
  "delivery_fee": number,
  "vat_amount": number,
  "wht_amount": number,
  "total_amount": number,
  "paid_amount": number,
  "currency": "THB",
  "payment_method": string|null,
  "notes": string|null,
  "line_items": [
    // EXTRACT EVERY purchased product/dish as its own row — never summarise or skip.
    // A receipt with a subtotal/total almost always HAS itemized products above it;
    // if you see items, you MUST return them. Faint/blurry item? Still transcribe
    // your best reading and lower THAT item's confidence — do not omit it.
    // ONLY real products/services the customer bought. Each row = one purchased item.
    // NEVER put these in line_items (they belong in their own fields or nowhere):
    //   • เงินสด/Cash, เงินทอน/Change, บัตร/โอน/PromptPay → payment_method
    //   • Subtotal/ยอดก่อนภาษี → subtotal ; Total/ยอดรวมทั้งสิ้น → total_amount
    //   • VAT/ภาษี → vat_amount ; ส่วนลด → discount_amount ; ค่าส่ง → delivery_fee
    //   • "Items: N" count lines, บรรทัดสรุปจำนวน
    //   • คะแนน/points/สะสม/สมัครสมาชิก/reward (loyalty — not money), โปรโมชั่น/marketing text
    // A product name may wrap onto 2+ printed lines — join them into ONE item, do
    // not split into separate rows.
    //
    // ฿0 ROWS ARE STILL ITEMS. A dish the customer received but was not charged
    // for — ของแถม, ฟรี, complimentary, ออร์เดิร์ฟ, ของทานเล่น, แลกคะแนน/redeemed,
    // a 0.00 or blank price — is a PRODUCT and MUST be returned with amount 0.
    // Do not drop it just because it costs nothing: the "loyalty" exclusion above
    // is about points/membership BALANCE lines (คะแนนสะสม 250 คะแนน), never about
    // a dish whose name happens to sit next to the word คะแนน.
    // Before you finish: count the product rows printed in the item block of the
    // receipt, then confirm you are returning exactly that many. A missing free
    // starter is a bug, not a tidy-up.
    { "description": string, "quantity": number, "unit_price": number, "amount": number, "confidence": number }
  ],
  "confidence_score": number,
  "field_confidence": {
    "vendor_name": number, "doc_number": number, "doc_date": number,
    "total_amount": number, "vat_amount": number, "wht_amount": number, "vendor_tax_id": number
  },
  "extraction_issues": []
}`

// ── Pre-classifier: ตัดสินใจ model tier ก่อน extraction ─────────────────────
/**
 * Quick doc-type classifier using Haiku (~0.05 วินาที, ถูกมาก).
 * Returns the likely doc_category so we can decide whether to use Haiku or Sonnet.
 * Combined with OCR pass — does both in one call to save one round-trip.
 */
interface OcrAndCategory {
  ocrText:     string
  category:    string   // doc_category guess
  useHaiku:    boolean  // true = safe to use Haiku for extraction
  /** The OCR pass saw Thai script. Free — it reads text this pass already has. */
  hasThai:     boolean
}

/**
 * Thai script anywhere in the transcribed text.
 *
 * U+0E00–U+0E7F is the Thai block. One Thai character is enough: a receipt with
 * a Thai shop name and English item names still fails in the way that matters,
 * because the shop name is what identifies the expense.
 */
export function containsThai(text: string): boolean {
  return /[\u0E00-\u0E7F]/.test(text)
}

async function ocrAndClassify(
  imageBlocks: Anthropic.ImageBlockParam[],
  usage: UsageContext = {},
): Promise<OcrAndCategory> {
  try {
    const res = await getClient().messages.create({
      model:      MODEL_HAIKU,
      max_tokens: 2200,
      messages: [{
        role:    "user",
        content: [
          ...imageBlocks,
          {
            type: "text",
            text: `Read ALL text in this Thai receipt/invoice image AND classify it.

CRITICAL — OCR errors to avoid:
- Digits: never confuse 1↔7, 3↔8, 0↔6, 6↔5 — check curves carefully
- Thai chars: น vs ม, เ vs แ, ใ vs ไ, ท vs ก, ม vs บ, ย vs บ, ข vs ช — look carefully
- Tax IDs: always 13 digits
- Dates: Buddhist year 2567=2024, 2568=2025, 2569=2026 — transcribe as-is
- Menu/item names should form REAL Thai words — if your reading produces a non-word
  (e.g. "ตับบำรุง" for what should be "ต้มยำกุ้ง"), re-examine the strokes and pick
  the real word that matches

Output in this EXACT format (two sections):
CATEGORY: <one of: tax_invoice_full|tax_invoice_simplified|receipt_with_tax|receipt|consumer_receipt|invoice|credit_note|other>
OCR:
<all visible text in order: store name, address, tax ID, doc number, date, items, amounts, payment method>`,
          },
        ],
      }],
    })

    const text = (res.content as Anthropic.ContentBlock[])
      .filter((c): c is Anthropic.TextBlock => c.type === "text")
      .map(c => c.text).join("").trim()

    // This pass runs on every single document and was never metered, so the
    // recorded cost of a scan has always been short by one full Haiku call.
    recordUsage(MODEL_HAIKU, res.usage as unknown as ExtractionUsage, { ...usage, phase: "ocr" })

    // Parse CATEGORY: line
    const catMatch = text.match(/^CATEGORY:\s*(\S+)/m)
    const category = catMatch?.[1]?.trim() ?? "other"

    // Parse OCR section
    const ocrMatch = text.match(/^OCR:\s*\n?([\s\S]+)/m)
    const ocrText  = ocrMatch?.[1]?.trim() ?? text

    const useHaiku = HAIKU_ELIGIBLE_CATEGORIES.has(category)

    return { ocrText, category, useHaiku, hasThai: containsThai(ocrText) }
  } catch {
    // Unknown text means unknown language — assume Thai and take the safe model.
    return { ocrText: "", category: "other", useHaiku: false, hasThai: true }
  }
}

// ── Pass 1: OCR — extract raw text ────────────────────────────────────────────
/**
 * First pass: read all visible text from the image using Haiku (fast + cheap).
 * Returns raw transcribed text that Pass 2 uses alongside the image.
 * Two-pass dramatically improves accuracy: Claude doesn't have to OCR + structure
 * simultaneously — it can focus on each task independently.
 */
async function ocrPass(imageBlocks: Anthropic.ImageBlockParam[]): Promise<string> {
  try {
    const res = await getClient().messages.create({
      model:      "claude-haiku-4-5-20251001",   // pinned snapshot for consistency
      max_tokens: 2048,
      messages: [{
        role:    "user",
        content: [
          ...imageBlocks,
          {
            type: "text",
            text: `Read ALL text visible in this Thai receipt/invoice image. Transcribe every character exactly as printed.

CRITICAL — Thai thermal receipt OCR errors to avoid:
- Digits: never confuse 1↔7, 3↔8, 0↔6, 6↔5 — look carefully at curves and strokes
- Thai chars: น vs ม (different right stroke), เ vs แ (แ has extra stroke), ใ vs ไ (different left curve),
  ท vs ก, ม vs บ, ย vs บ, ข vs ช, ั vs ิ, ่ vs ี — look carefully at low-res dot-matrix shapes
- Prices: always read all digits e.g. "1,234.56" not "1,23.56" — never drop digits
- Tax IDs: always 13 digits — if you see fewer, recount
- Dates: Buddhist year 2567=2024, 2568=2025, 2569=2026 — do NOT convert, transcribe as-is
- Store names: copy exactly including ห้าง/บมจ/บจก prefixes
- Menu/item names (รายการสินค้า): transcribe exactly what is printed, including item
  codes and the receipt's own spacing. Do not substitute a likelier word — see the
  section above for why that instruction was removed.

Output sections in this order (skip if absent):
1. ชื่อร้าน/บริษัท (store/company name + branch)
2. ที่อยู่ (address)
3. เลขประจำตัวผู้เสียภาษี (tax ID — 13 digits)
4. เลขที่เอกสาร (doc number)
5. วันที่ (date as printed)
6. รายการสินค้า (line items with qty × price = amount)
7. ยอดรวม subtotal / VAT / ส่วนลด / ค่าจัดส่ง / ยอดสุทธิ
8. วิธีชำระเงิน (payment method)
9. ข้อความอื่นๆ (other visible text)

Output ONLY the transcribed text, no commentary.`,
          },
        ],
      }],
    })
    return (res.content as Anthropic.ContentBlock[])
      .filter((c): c is Anthropic.TextBlock => c.type === "text")
      .map(c => c.text)
      .join("")
      .trim()
  } catch {
    return ""   // if OCR pass fails, continue with image-only pass 2
  }
}

// Row classification (item vs discount/total/tax/tender/points/…) lives in its
// own module so it's one source of truth and independently unit-tested.
export { classifyReceiptRow, isNonItemRow, reclassifyLineItems } from "./receipt-rows"
import { isNonItemRow, reclassifyLineItems } from "./receipt-rows"
import { recordUsage, type ExtractionUsage, type UsageContext } from "./usage-meter"
import {
  vatModel, totalEvidence,
  lineItemSumCheck as coreLineItemSumCheck, type LineItemSumCheck,
} from "./amounts"

/** Re-exported so existing importers keep one import site. */
export type { LineItemSumCheck }
import { classifyFailure } from "./failure-kind"

// ── Amount reconciliation ────────────────────────────────────────────────────
/**
 * Derives/repairs subtotal, VAT and total in place.
 *
 * Exported (and pure apart from the in-place mutation) so the money logic can be
 * exercised directly — see `scripts/verify-amounts.ts`. Extraction bugs here are
 * silent and expensive, so they need to be provable without a live LLM call.
 */
export interface ReconcilableAmounts {
  subtotal:          number
  discount_amount:   number
  delivery_fee:      number
  vat_amount:        number
  wht_amount:        number
  total_amount:      number
  /**
   * What the receipt says was actually handed over or charged — the cash
   * tendered, or the amount on the card line ("M/C 1,039.00", "Credit Card
   * HomePro 957.39"). It is the one figure on the page produced by a machine
   * that had to agree with reality, which makes it the best available witness
   * to the total. 0 when the receipt does not print one.
   */
  paid_amount?:      number
  confidence_score:  number
  doc_category?:     string | null
  line_items?:       Array<{ amount?: unknown }>
  extraction_issues?: string[]
}

/**
 * Did the receipt print a tender/charge line that agrees with the total?
 *
 * If so, the total is confirmed by something outside the arithmetic this
 * function reasons about, and no amount of internal inconsistency justifies
 * overwriting it — the missing piece is one of the OTHER figures. Both live
 * wrong-total bugs (doc 67156d80's cash line, doc 37c7f466's card line) had
 * this confirmation sitting on the page while the total was rewritten anyway.
 */
function totalIsPaidConfirmed(parsed: ReconcilableAmounts): boolean {
  return totalEvidence(parsed).paidConfirmsTotal
}

export function reconcileAmounts(parsed: ReconcilableAmounts): ReconcilableAmounts {
  // ── Normalize the two subtotal conventions ─────────────────────────────────
  // Thai receipts print one of two layouts:
  //   (A) "Subtotal" = gross line-item sum, then Discount, then VAT
  //         total = subtotal + VAT − discount
  //   (B) "ยอดก่อนภาษี / Before TAX" = ALREADY net of the discount
  //         total = subtotal + VAT
  // Everything below assumes (A). Handing it a (B) subtotal subtracts the
  // discount a second time: on a real KOFUKU bill the model read the receipt
  // perfectly (net 1046, discount 80, VAT 73.22, total 1119.22) and this
  // function "corrected" the right answer down to 1039.22.
  //
  // Decide by asking which formula the model's own total already agrees with,
  // and normalize (B) into (A) by folding the discount back into subtotal.
  if (parsed.discount_amount > 0 && parsed.subtotal > 0 && parsed.total_amount > 0) {
    const common  = parsed.vat_amount + parsed.delivery_fee - parsed.wht_amount
    const asGross = Math.abs(parsed.subtotal + common - parsed.discount_amount - parsed.total_amount)
    const asNet   = Math.abs(parsed.subtotal + common - parsed.total_amount)

    if (asNet < asGross && asNet <= Math.max(1, parsed.total_amount * 0.01)) {
      const gross = +(parsed.subtotal + parsed.discount_amount).toFixed(2)
      parsed.extraction_issues = [
        ...(parsed.extraction_issues ?? []),
        `subtotal ${parsed.subtotal} เป็นยอดหลังหักส่วนลดแล้ว — ปรับเป็นยอดก่อนหักส่วนลด ${gross}`,
      ]
      parsed.subtotal = gross
    }
  }

  // ── Math auto-correction ───────────────────────────────────────────────────
  // If total_amount exists but subtotal is missing, derive subtotal from total
  if (parsed.total_amount > 0 && parsed.subtotal === 0 && parsed.vat_amount > 0) {
    parsed.subtotal = +(parsed.total_amount - parsed.vat_amount + parsed.discount_amount).toFixed(2)
  }
  // If subtotal exists but total is missing, derive total
  if (parsed.subtotal > 0 && parsed.total_amount === 0) {
    parsed.total_amount = +(parsed.subtotal + parsed.vat_amount + parsed.delivery_fee
      - parsed.discount_amount - parsed.wht_amount).toFixed(2)
  }

  // ── Mislabeled net-as-total (an unread discount line) ──────────────────────
  // Seen on a VAT-excluded receipt whose discount row was missed: items summed
  // to 1126, a -80 discount went unread, and the model put the *net* 1046 into
  // total_amount while subtotal kept the pre-discount 1126. The block below
  // can't catch it, because it only ever tests VAT against `subtotal` — and
  // 1126 * 7/107 = 73.66 sits deceptively close to the real VAT of 73.22, so it
  // would "confirm" a VAT-inclusive reading and lock in the wrong total.
  //
  // The giveaway is that the VAT matches 7% of the value sitting in
  // total_amount *exactly* (1046 * 0.07 = 73.22), better than either subtotal
  // model. When that holds and total < subtotal, total_amount is really the
  // pre-VAT net: the true total is net + VAT, and the gap up to the line-item
  // sum is the discount nobody read.
  //
  // Guarded by the tender line like every other rewrite site. It was not, and
  // that was a hole in the safeguard rather than an exception to it: this block
  // would still turn a card-confirmed ฿950 into ฿1,112.15 and invent a discount
  // to justify it. The rule is now uniform — if the receipt says what was
  // actually paid and it matches the total, nothing here may rewrite the total.
  let netAsTotalFixed = false
  if (!totalIsPaidConfirmed(parsed)
      && parsed.subtotal > 0 && parsed.vat_amount > 0 && parsed.total_amount > 0
      && parsed.total_amount < parsed.subtotal) {
    // Bases come from the core so the service charge is included here too.
    // This block kept its own `subtotal * 7/107` long after the block below
    // learned about fees — the same defect, sixty lines apart, which is the
    // argument for there being exactly one definition of "the VAT base".
    const model = vatModel(parsed)
    const dNet = Math.abs(parsed.vat_amount - parsed.total_amount * 0.07)
    const dInc = Math.abs(parsed.vat_amount - model.inclusive)
    const dExc = Math.abs(parsed.vat_amount - model.exclusive)

    // Must be a tight match AND strictly the best explanation of the VAT.
    if (dNet <= Math.max(0.5, parsed.total_amount * 0.005) && dNet < dInc && dNet < dExc) {
      const net      = parsed.total_amount
      const newTotal = +(net + parsed.vat_amount + parsed.delivery_fee - parsed.wht_amount).toFixed(2)
      const gap      = +(parsed.subtotal - net).toFixed(2)

      // Only claim a discount when the line items back the larger figure up —
      // otherwise the gap is just a bad subtotal read, and inventing a discount
      // would be worse than leaving it out.
      const items   = Array.isArray(parsed.line_items) ? parsed.line_items : []
      const lineSum = +items.reduce(
        (s: number, i: { amount?: unknown }) => s + (Number(i.amount) || 0), 0
      ).toFixed(2)
      const itemsBackSubtotal = items.length > 0
        && Math.abs(lineSum - parsed.subtotal) <= Math.max(2, parsed.subtotal * 0.02)

      if (gap > 0 && parsed.discount_amount === 0 && itemsBackSubtotal) {
        // Keep subtotal as the pre-discount item sum and book the gap as the
        // discount — the convention the rest of this function uses
        // (total = subtotal + VAT − discount).
        parsed.discount_amount = gap
        parsed.extraction_issues = [
          ...(parsed.extraction_issues ?? []),
          `พบส่วนลดที่ไม่ได้อ่าน ${gap} (รายการรวม ${lineSum} − สุทธิ ${net})`,
        ]
      } else {
        // Can't justify a discount, so make the figures self-consistent the
        // only other way: treat the net as the subtotal.
        parsed.subtotal = net
      }

      parsed.extraction_issues = [
        ...(parsed.extraction_issues ?? []),
        `total_amount ${net} คือยอดก่อน VAT ไม่ใช่ยอดรวม — แก้เป็น ${newTotal}`,
      ]
      parsed.total_amount     = newTotal
      parsed.confidence_score = Math.max(0, parsed.confidence_score - 0.15)
      netAsTotalFixed         = true
    }
  }

  // ── Total reconciliation (VAT present) ─────────────────────────────────────
  // When VAT is internally consistent with subtotal, that (subtotal, VAT) pair
  // is trustworthy — so a wildly different total_amount is a misread and gets
  // corrected instead of stored. Critically this handles VAT-INCLUSIVE receipts
  // ("VAT Included"), where the printed subtotal IS the gross and the total
  // equals the subtotal — the old code (which only ADDS VAT) mis-modelled them.
  // The inclusive/exclusive choice uses whichever VAT model the extracted VAT
  // is *nearest* to, since 7/107 (27.48) and 7% (29.40) of a subtotal are close.
  if (!netAsTotalFixed && parsed.subtotal > 0 && parsed.vat_amount > 0 && parsed.total_amount > 0) {
    // VAT is charged on the DISCOUNTED amount, so the 7% test has to run
    // against subtotal − discount. Testing the raw subtotal mis-classified any
    // discounted VAT-exclusive receipt: on the KOFUKU bill (items 1126,
    // discount 80, VAT 73.22) the raw subtotal's inclusive figure (73.66)
    // looked like a match, so a correctly-read total of 1119.22 was "corrected"
    // down to 1046 — silently deleting the VAT.
    // Base, convention and expected total all come from ./amounts. Nothing is
    // re-derived here — that duplication is what let the reconciler and the
    // validator disagree about the same receipt.
    const model = vatModel(parsed)
    if (model.convention !== "unresolved") {
      const isInclusive = model.convention === "inclusive"
      const expectedTotal = isInclusive
        ? +(parsed.subtotal + parsed.delivery_fee - parsed.discount_amount - parsed.wht_amount).toFixed(2)
        : +(parsed.subtotal + parsed.vat_amount + parsed.delivery_fee - parsed.discount_amount - parsed.wht_amount).toFixed(2)

      // The line items are the only witness to the total that is independent of
      // the subtotal. When they add up to the total that was read AND disagree
      // with the subtotal, the subtotal is the misread figure — replacing the
      // corroborated number with the uncorroborated one is exactly backwards.
      // When they agree with both (VAT-inclusive receipts) or back the subtotal
      // instead, this doesn't fire and a genuinely misread total is still fixed.
      const evidence = totalEvidence(parsed)
      const lineSum = coreLineItemSumCheck(parsed)?.sum ?? 0
      const totalIsCorroborated = evidence.totalOutranksSubtotal

      if (expectedTotal > 0
          && Math.abs(parsed.total_amount - expectedTotal) > Math.max(2, expectedTotal * 0.02)) {
        if (totalIsPaidConfirmed(parsed)) {
          parsed.extraction_issues = [
            ...(parsed.extraction_issues ?? []),
            `ยอดที่ชำระจริง ${parsed.paid_amount} ตรงกับยอดรวม ${parsed.total_amount} — คงยอดไว้ ` +
            `แต่ subtotal/VAT/ค่าบริการ ไม่ครบ (คำนวณได้ ${expectedTotal}) ตรวจสอบอีกครั้ง`,
          ]
          parsed.confidence_score = Math.max(0, parsed.confidence_score - 0.1)
        } else if (totalIsCorroborated) {
          parsed.extraction_issues = [
            ...(parsed.extraction_issues ?? []),
            `subtotal ${parsed.subtotal} ไม่ตรงกับรายการสินค้า (รวม ${lineSum}) — คงยอดรวม ${parsed.total_amount} ไว้ ตรวจสอบ subtotal/VAT อีกครั้ง`,
          ]
          parsed.confidence_score = Math.max(0, parsed.confidence_score - 0.15)
        } else {
          parsed.extraction_issues = [
            ...(parsed.extraction_issues ?? []),
            `total_amount ${parsed.total_amount} ขัดกับ subtotal/VAT (${isInclusive ? "VAT-included" : "VAT-excluded"}) — แก้เป็น ${expectedTotal}`,
          ]
          parsed.total_amount     = expectedTotal
          parsed.confidence_score = Math.max(0, parsed.confidence_score - 0.15)
        }
      }
    }
  }

  // ── Total reconciliation (no VAT) ──────────────────────────────────────────
  // Total should equal subtotal (± fees/discount). If a mis-read total conflicts
  // AND the (already non-item-filtered) line items independently sum to the
  // subtotal, trust the math. Catches a total pulled from promotional text —
  // e.g. "ยอดซื้อ 60.- ได้ 1 คะแนน" read as total 60 on a ฿68 bill — which the
  // VAT-based reconcile above can't see (vat = 0).
  if (parsed.vat_amount === 0 && parsed.subtotal > 0 && parsed.total_amount > 0) {
    const expectedTotal = +(parsed.subtotal + parsed.delivery_fee
      - parsed.discount_amount - parsed.wht_amount).toFixed(2)
    const items = Array.isArray(parsed.line_items) ? parsed.line_items : []
    const lineSum = +items.reduce(
      (s: number, i: { amount?: unknown }) => s + (Number(i.amount) || 0), 0
    ).toFixed(2)
    const subtotalCorroborated = items.length > 0
      && Math.abs(lineSum - parsed.subtotal) <= Math.max(2, parsed.subtotal * 0.02)

    if (expectedTotal > 0
        && Math.abs(parsed.total_amount - expectedTotal) > Math.max(2, expectedTotal * 0.02)
        && subtotalCorroborated
        // Same veto as the VAT branch: a tender line that agrees with the total
        // outranks arithmetic assembled from figures that may themselves be misread.
        && !totalIsPaidConfirmed(parsed)) {
      parsed.extraction_issues = [
        ...(parsed.extraction_issues ?? []),
        `total_amount ${parsed.total_amount} ขัดกับ subtotal ${parsed.subtotal} (ไม่มี VAT, รายการรวม=${lineSum}) — แก้เป็น ${expectedTotal}`,
      ]
      parsed.total_amount     = expectedTotal
      parsed.confidence_score = Math.max(0, parsed.confidence_score - 0.15)
    }
  }

  // Boost confidence_score if math checks out
  if (parsed.total_amount > 0 && parsed.subtotal > 0) {
    const computed = +(parsed.subtotal + parsed.vat_amount + parsed.delivery_fee
      - parsed.discount_amount - parsed.wht_amount).toFixed(2)
    const diff = Math.abs(computed - parsed.total_amount)
    const pct  = diff / parsed.total_amount
    if (pct < 0.01) {
      // Math is correct → boost confidence
      parsed.confidence_score = Math.min(1, parsed.confidence_score + 0.05)
    }
  }

  return parsed
}

// Confidence threshold below which we trigger Google Document AI fallback
const FALLBACK_CONFIDENCE_THRESHOLD = 0.65

/** Thai script range — the alphabet that degrades on a poor receipt capture. */
const THAI_RE = /[฀-๿]/

/**
 * Should the Google Document AI second opinion run?
 *
 * The first three inputs are the model grading its own work, which is NOT
 * dependable: on a real KOFUKU receipt it reported 0.78 overall and 0.85–0.92
 * per line item while rendering "ฮาล์ฟ-ฮาล์ฟ" as "ชาชิ่-ชาชิ่ม" — a VLM cannot
 * tell that it misread a glyph. This fallback was fully built and configured
 * yet had never once fired in production for exactly that reason.
 *
 * `degradedCapture` is the fix: it comes from the image-quality gate, entirely
 * independent of the model. Paired with Thai line items — the script that
 * actually degrades, and where character-level OCR most outclasses a VLM — it
 * gives an objective reason to pay for the second read.
 *
 * Pure, so the routing is unit-tested (scripts/verify-amounts.ts).
 */
export function shouldUseDocAiFallback(input: {
  confidence:            number
  minLineItemConfidence: number
  sumMismatch:           boolean
  degradedCapture:       boolean
  lineItems:             Array<{ description?: unknown }>
  /** false disables only the quality-based trigger (DOCAI_ON_LOW_QUALITY=0). */
  qualityTriggerEnabled?: boolean
  /**
   * Ground every Thai document in character-level OCR (DOCAI_THAI_GROUNDING=1).
   *
   * The vision model reads Thai amounts perfectly and Thai *words* only
   * approximately, and no amount of prompting fixed it: adding vocabulary rules
   * corrected ไอติม and กะทิ on the Lotus receipt while simultaneously breaking
   * เยิ้ม, which had been right before. Each glyph is decided independently, so
   * pushing on one raises the odds on another — that is the shape of a problem
   * that needs different evidence, not better instructions.
   *
   * DocAI is that evidence: a purpose-built OCR that reports the characters it
   * actually saw. Off by default because it is a second vendor on every Thai
   * document; the usage log records it under phase `docai_retry` so the bill for
   * this decision is visible rather than assumed.
   */
  thaiGroundingEnabled?:  boolean
  /**
   * Master switch (DOCAI_ENABLED=0). Defaults to on, so nothing changes until
   * someone turns it off deliberately.
   *
   * Worth having as one flag because the other three triggers fire on facts
   * that are TRUE of most Thai receipts — a confidence under the threshold, a
   * line-item sum that does not tie — so there was no way to stop paying for
   * the second vendor without editing code. And every DocAI call drags a full
   * Sonnet re-read behind it (`docai_retry`), which is the actual expense: on
   * the real usage log, 5 of 18 documents ran Sonnet twice for this reason.
   */
  enabled?: boolean
}): boolean {
  if (input.enabled === false) return false
  if (input.confidence < FALLBACK_CONFIDENCE_THRESHOLD) return true
  if (input.minLineItemConfidence < FALLBACK_CONFIDENCE_THRESHOLD) return true
  if (input.sumMismatch) return true

  const hasThaiItems = input.lineItems.some(i => THAI_RE.test(String(i.description ?? "")))

  // Thai present and grounding switched on — the receipt this exists for looked
  // completely healthy by every other measure (confident model, sums balanced,
  // sharp photo) and still returned words that are not Thai.
  if (input.thaiGroundingEnabled && hasThaiItems) return true

  return (input.qualityTriggerEnabled ?? true) && input.degradedCapture && hasThaiItems
}

// How far sum(line_items.amount) is allowed to drift from subtotal before we
// treat it as a real mismatch rather than rounding noise (e.g. a ฿0.01
// thermal-printer rounding difference on an old receipt).
const LINE_ITEM_SUM_TOLERANCE_PCT = 0.02  // 2%
const LINE_ITEM_SUM_TOLERANCE_ABS = 2     // or ฿2, whichever is larger — protects small receipts

/**
 * Checks whether the extracted line items actually add up to the subtotal.
 * A single low-confidence line item doesn't always trip `minLineItemConfidence`
 * — Claude can be individually "confident" about each misclassified item while
 * the total still comes out wrong (the exact failure mode reported: line items
 * split into the wrong categories/quantities so the final total is off even
 * though nothing on its own looked uncertain). This catches that case
 * regardless of what confidence Claude self-reported.
 */
export function lineItemSumMismatch(doc: SummableDoc | undefined): boolean {
  return lineItemSumCheck(doc)?.mismatch ?? false
}

interface SummableDoc {
  subtotal?: number; discount_amount?: number; vat_amount?: number; line_items?: LineItem[]
}


/**
 * The same comparison as `lineItemSumMismatch`, but it also says WHICH
 * convention the receipt used — so the reconciliation summary can report the
 * figure the items were actually measured against instead of always naming the
 * subtotal, which read as "balanced, difference 5.63" on VAT-inclusive slips.
 *
 * Returns null when there is nothing to compare.
 */
export function lineItemSumCheck(doc: SummableDoc | undefined): LineItemSumCheck | null {
  return coreLineItemSumCheck(doc ?? {})
}


/**
 * Keeps only the part of a Document AI reading that is worth showing the model.
 *
 * The processor configured for this project cannot read Thai script. On a real
 * receipt it returned "tulafaulu / Turada" for "ใบเสร็จรับเงิน / ใบกำกับภาษี
 * อย่างย่อ", "24 ningnaw 2569" for "24 กรกฎาคม 2569", and "3 Quwwa lugj" for
 * "3 สุกี้ บุฟเฟต์ ผู้ใหญ่" — it transliterates Thai into Latin nonsense. Its
 * NUMBERS are perfect (657.00, 117.00, 774.00), which is the same split we see
 * everywhere: digits survive, Thai does not.
 *
 * That nonsense was being injected under the heading "Google Document AI OCR
 * (second opinion)", next to a prompt line telling the model that agreement
 * between two OCR sources makes a value very likely correct. Presenting a
 * source's worst output as corroboration is worse than not consulting it — the
 * same lesson this pipeline already learned, and acted on, for the Apple Vision
 * hint (see triggerServerOCR in the iOS app).
 *
 * So: keep the lines that carry figures, drop the rest.
 */
export function numericOnlyOcr(text: string): string {
  // Extract the figures and drop every word. A line-level filter cannot do this
  // job: "24 ningnaw 2569 20:15" carries more digits than letters and would
  // survive, dragging a transliterated month name into the prompt with it.
  //
  // What Document AI actually contributes on a Thai receipt is a set of numbers
  // it read from the page. Presenting exactly that — and nothing shaped like a
  // transcription — is both the whole of its value and the only form in which
  // it cannot mislead the model about a word.
  const figures = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []
  const unique = [...new Set(figures.filter(f => f.replace(/\D/g, "").length >= 2))]
  return unique.length ? `ตัวเลขที่พบ: ${unique.join("  ")}` : ""
}

// ── Google Document AI fallback ────────────────────────────────────────────────
/**
 * Run Google Document AI on the first page when Claude confidence is low.
 * Adds a third source of OCR text as a "tiebreaker" — if both Haiku and DocAI
 * agree on a value that Sonnet initially got wrong, Sonnet should trust them.
 * Returns empty string if DocAI is not configured or fails.
 */
async function docAiPass(pageBuffer: Buffer): Promise<string> {
  const hasConfig = process.env.GOOGLE_CLOUD_PROJECT &&
    process.env.GOOGLE_DOC_AI_PROCESSOR_ID &&
    (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CREDENTIALS_JSON) &&
    !["...", "YOUR_PROCESSOR_ID", "YOUR_PROJECT_ID"].includes(process.env.GOOGLE_DOC_AI_PROCESSOR_ID) &&
    !["...", "YOUR_PROCESSOR_ID", "YOUR_PROJECT_ID"].includes(process.env.GOOGLE_CLOUD_PROJECT)

  if (!hasConfig) {
    // Say so, loudly and once per call. This used to `return ""` in total
    // silence, so a fallback that had never run in its life looked identical in
    // the logs to one that ran and found nothing — the env vars were present
    // but still holding their YOUR_PROJECT_ID / YOUR_PROCESSOR_ID placeholders,
    // and the credentials file didn't exist at all.
    console.warn(
      "[docai-fallback] SKIPPED — Google Document AI is not configured " +
      `(project=${process.env.GOOGLE_CLOUD_PROJECT ?? "unset"}, ` +
      `processor=${process.env.GOOGLE_DOC_AI_PROCESSOR_ID ?? "unset"}, ` +
      `credentials=${process.env.GOOGLE_CREDENTIALS_JSON ? "inline-json" : (process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "unset")}). ` +
      "Extraction continues with the model's own reading only.",
    )
    return ""
  }

  try {
    const page = await runOcr(pageBuffer)

    const text = page.blocks
      .filter(b => b.confidence > 0.5 && b.text.trim())
      .sort((a, b) => (b.boundingBox?.[1] ?? 0) - (a.boundingBox?.[1] ?? 0))  // top-to-bottom
      .map(b => b.text)
      .join("\n")
      .trim()

    // When the processor is an Expense/Invoice parser it also returns typed
    // fields with per-field confidence. Those are GROUNDED values from a model
    // purpose-built for receipts — far more reliable than the LLM eyeballing
    // digits off a glare-blown thermal print (the ฿420 → 523 failure). Surface
    // them explicitly so Pass 2's job becomes reconciliation, not reading.
    const structured = formatDocAiFields(page.fields)
    return structured ? `${structured}\n\n${text}`.trim() : text
  } catch (err) {
    console.warn("[docai-fallback] failed:", (err as Error).message)
    return ""
  }
}

/** Renders Document AI's typed fields as an authoritative block for the prompt. */
export function formatDocAiFields(fields: DocAiFields | undefined): string {
  if (!fields) return ""
  const conf = (key: string) =>
    fields.confidence[key] != null ? ` [confidence ${fields.confidence[key].toFixed(2)}]` : ""

  const rows: string[] = []
  if (fields.supplierName   != null) rows.push(`ชื่อร้าน/ผู้ขาย: ${fields.supplierName}${conf("supplier_name")}`)
  if (fields.supplierTaxId  != null) rows.push(`เลขผู้เสียภาษี: ${fields.supplierTaxId}${conf("supplier_tax_id")}`)
  if (fields.invoiceId      != null) rows.push(`เลขที่เอกสาร: ${fields.invoiceId}${conf("invoice_id")}`)
  if (fields.receiptDate    != null) rows.push(`วันที่: ${fields.receiptDate}${conf("receipt_date")}`)
  if (fields.netAmount      != null) rows.push(`ยอดก่อนภาษี (net_amount): ${fields.netAmount}${conf("net_amount")}`)
  if (fields.totalTaxAmount != null) rows.push(`ภาษี (total_tax_amount): ${fields.totalTaxAmount}${conf("total_tax_amount")}`)
  if (fields.totalAmount    != null) rows.push(`ยอดรวม (total_amount): ${fields.totalAmount}${conf("total_amount")}`)
  if (fields.currency       != null) rows.push(`สกุลเงิน: ${fields.currency}`)

  // Document AI's Expense parser nails the summary money fields (on a real
  // KOFUKU bill it returned total/net/tax exactly right) but shreds Thai line
  // items — "&", "OP", "SIMPLICITY:", undefined amounts. Listing those under a
  // heading that tells the model to treat this block as authoritative drags the
  // item names down, which is precisely why the on-device OCR hint was removed.
  //
  // So gate them on coherence instead of trusting them blindly: only pass the
  // items through when most of them actually carry BOTH a description and an
  // amount. A clean English receipt keeps its items; a shredded Thai one
  // contributes only its (excellent) totals.
  const realItems = fields.lineItems.filter(it => !isNonItemRow(it.description))
  const usable    = realItems.filter(it => String(it.description ?? "").trim() && it.amount != null)
  const coherent  = realItems.length > 0 && usable.length >= Math.ceil(realItems.length * 0.6)

  if (coherent) {
    for (const [i, item] of usable.entries()) {
      const parts = [item.description ?? "-"]
      if (item.quantity  != null) parts.push(`x${item.quantity}`)
      if (item.unitPrice != null) parts.push(`@${item.unitPrice}`)
      if (item.amount    != null) parts.push(`= ${item.amount}`)
      rows.push(`  รายการ ${i + 1}: ${parts.join(" ")}`)
    }
  } else if (realItems.length) {
    rows.push(
      `  (ตัวแยกรายการอ่านชื่อสินค้าได้ไม่ชัด ${realItems.length} บรรทัด — ` +
      "ไม่ต้องใช้ ให้อ่านรายการสินค้าจากภาพเอง ตัวเลขยอดรวมด้านบนยังเชื่อถือได้)",
    )
  }

  if (!rows.length) return ""

  return [
    "### GOOGLE DOCUMENT AI — STRUCTURED READING (specialised receipt parser)",
    "ค่าตัวเลขในบล็อกนี้มาจากโมเดลที่ออกแบบมาสำหรับใบเสร็จโดยเฉพาะ และมี confidence ราย field",
    "ให้ยึดตัวเลขเหล่านี้เป็นหลัก เว้นแต่ภาพขัดแย้งอย่างชัดเจน — ถ้าจะแก้ ให้ระบุเหตุผลใน extraction_issues",
    "",
    ...rows,
  ].join("\n")
}

// ── Main extraction function ───────────────────────────────────────────────────
/**
 * Three-pass extraction (Pass 3 is conditional):
 *   Pass 1 (Haiku):         OCR — extract raw text from image
 *   Pass 2 (Sonnet):        Structure — given raw text + image, produce JSON
 *   Pass 3 (Google DocAI):  Fallback — only when confidence < 0.65; adds second OCR opinion
 *                            then re-runs Pass 2 with both OCR sources
 *
 * @param pageBuffers     Preprocessed page images (JPEG)
 * @param fewShotBlock    Few-shot + corrections + error patterns block
 * @param qualityWarnings Image quality warnings (blur, exposure) from image-quality.ts
 * @param modelTier       Plan-based AI tier: "haiku" | "smart" | "priority"
 *                        haiku    = Haiku-only (Free/Starter plans — lowest cost)
 *                        smart    = Auto-route by doc type (Pro/Team — balanced)
 *                        priority = Sonnet always (Business/Enterprise — highest accuracy)
 * @param clientOcrHintText Pre-formatted on-device OCR hint (iOS Vision pre-read),
 *                        see local-ocr-hint.ts — empty string if none provided.
 */
/**
 * Builds a document from Document AI alone, with no vision model involved.
 *
 * Used only when the vision provider is down. Returns undefined when DocAI is
 * not configured or finds nothing usable, so the caller can rethrow the original
 * error rather than inventing an empty receipt.
 */
async function extractWithDocAiOnly(
  pages: Buffer[],
): Promise<ExtractedDocument | undefined> {
  try {
    const ocr = await runOcr(pages[0])
    const f = ocr.fields
    if (!f || (f.totalAmount == null && !f.lineItems?.length)) return undefined

    const total    = f.totalAmount ?? 0
    const vat      = f.totalTaxAmount ?? 0
    const subtotal = f.netAmount ?? Math.max(0, total - vat)

    return {
      // No classifier ran, so claim nothing: "other" keeps this out of VAT
      // reporting until a human or a later re-read confirms what it is.
      doc_category: "other",
      doc_type: "other", vat_claimable: false, expense_claimable: true,
      business_use_note: "อ่านด้วย Document AI เท่านั้น — ยังไม่ได้จัดประเภทเอกสาร",

      vendor_name:   f.supplierName ?? "",
      company_name:  null,
      vendor_tax_id: f.supplierTaxId ?? null,
      vendor_address: null, company_address: null, vendor_phone: null,
      platform_name: null, platform_ref: null,
      customer_name: null, staff_name: null,

      doc_number: f.invoiceId ?? null,
      doc_date:   f.receiptDate ?? null,
      due_date:   null,

      subtotal, discount_amount: 0, delivery_fee: 0,
      vat_amount: vat, wht_amount: 0, total_amount: total,
      currency: f.currency ?? "THB",

      payment_method: null,
      notes: null,
      line_items: (f.lineItems ?? []).map(i => ({
        description: i.description ?? "",
        quantity:    i.quantity ?? 1,
        unit_price:  i.unitPrice ?? 0,
        amount:      i.amount ?? 0,
        confidence:  0.6,
      })),
      // Deliberately low: this reading skipped every correctness check the normal
      // path applies, so it must never auto-approve.
      confidence_score: 0.4,
      field_confidence: f.confidence ?? {},
      extraction_issues: [
        "อ่านด้วย Document AI เท่านั้น เพราะบริการ AI หลักใช้งานไม่ได้ชั่วคราว — " +
        "ยอดเงินเชื่อถือได้ แต่ชื่อรายการและประเภทเอกสารอาจไม่ครบ กรุณาตรวจสอบ",
      ],
    } as ExtractedDocument

  } catch (err) {
    console.error("[extractor] DocAI-only fallback failed:", (err as Error).message)
    return undefined
  }
}

export async function extractDocument(
  pageBuffers:     Buffer[],
  fewShotBlock     = "",
  qualityWarnings: string[] = [],
  modelTier:       "haiku" | "smart" | "priority" = "smart",
  clientOcrHintText = "",
  learnedRowOverrides: import("./receipt-rows").LearnedOverrides = {},
  /** True when the images are overlapping slices of ONE tall receipt. */
  pagesAreSlices = false,
  /**
   * Who this spend belongs to. Every row in `ai_usage_log` carried a null
   * document_id and organization_id, and a phase of "extract", because this was
   * never passed — so answering "which model read this document, and did the
   * DocAI retry actually run?" meant correlating timestamps by hand.
   */
  usage: UsageContext = {},
): Promise<ExtractedDocument | ExtractedDocument[]> {
  const pages = pageBuffers.slice(0, pagesAreSlices ? MAX_SLICE_IMAGES : MAX_PAGES)

  const imageBlocks: Anthropic.ImageBlockParam[] = pages.map(buf => ({
    type:   "image",
    source: { type: "base64", media_type: "image/jpeg", data: buf.toString("base64") },
  }))

  // ── Pass 1: OCR + Classify (Haiku — cheap, fast) ────────────────────────────
  // Combined: transcribe text AND guess doc type in one call
  const { ocrText: rawOcrText, category: predictedCategory, useHaiku: autoHaiku, hasThai } = await ocrAndClassify(imageBlocks, usage)

  // Apply plan-tier override on top of auto-routing:
  //   priority → always Sonnet (ignore auto classification)
  //   haiku    → always Haiku (even for complex docs — lower-cost plans accept this trade-off)
  //   smart    → use the auto-classification result
  //
  // Degraded capture overrides the plan tier. Haiku reads *numbers* off a
  // blurry/overexposed receipt just fine, but its Thai goes wrong while still
  // reporting high per-field confidence — on a real KOFUKU bill it returned
  // "น้ำปลา" (fish sauce) for "น้ำเปล่า" (water) and turned "เซตฮาล์ฟ-ฮาล์ฟ"
  // into "เซ็ด ชาดำ-ชาขี้", at 0.92 confidence. Confidence-based escalation
  // can't catch that; the input quality can. A bad photo is exactly where the
  // stronger reader earns its cost, and degraded captures are the minority, so
  // the extra spend stays bounded. Set ESCALATE_ON_LOW_QUALITY=0 to disable.
  const degradedCapture = qualityWarnings.length > 0
    && process.env.ESCALATE_ON_LOW_QUALITY !== "0"

  // Haiku does not read Thai, and — this is the part that hid it — it does not
  // KNOW that it does not. On a faded café bill it returned "Gold Cassod Beef
  // 80 Oz." for "Cold Caramel Macchiato" and scored itself 0.87, comfortably
  // above the 0.72 escalation threshold, so nothing escalated and a ฿295 bill
  // was filed at ฿495. Three runs of the same document through the same path
  // gave ฿295, ฿495 and ฿284.30.
  //
  // Confidence cannot gate this, because the confidence is part of the failure.
  // The language can: Haiku keeps the English/numeric receipts it handles fine,
  // and anything with Thai script goes to the model that can read it. The flag
  // costs nothing — the OCR pass already produced the text.
  //
  // A Thai receipt read by Haiku usually escalates anyway (Haiku → DocAI →
  // Sonnet), so this is often CHEAPER than the path it replaces, not just better.
  const useHaiku = modelTier === "priority" ? false
                 : degradedCapture          ? false
                 : hasThai                  ? false
                 : modelTier === "haiku"    ? true
                 : autoHaiku
  console.log(
    `[extractor] tier=${modelTier} category=${predictedCategory}` +
    `${degradedCapture ? " quality=degraded→escalated" : ""}${hasThai ? " thai→Sonnet" : ""}` +
    ` → ${useHaiku ? "Haiku" : "Sonnet"}`
  )

  // ── Build helpers ─────────────────────────────────────────────────────────────
  const buildOcrSection = (haikuText: string, docAiText = "", clientOcrText = "") => {
    if (!haikuText && !docAiText && !clientOcrText) return ""
    const parts: string[] = []
    if (haikuText) parts.push(`### Haiku OCR:\n\`\`\`\n${haikuText}\n\`\`\``)
    if (docAiText) parts.push(
      "### Google Document AI — NUMBERS ONLY (this processor cannot read Thai script; " +
      "its Thai output is discarded, so absence of a name here means nothing):\n" +
      "```\n" + docAiText + "\n```")
    if (clientOcrText) parts.push(`### On-device OCR (Apple Vision, captured client-side before upload — weaker parser, use only as a tie-breaker hint, never override the image or the OCR sources above with this alone):\n\`\`\`\n${clientOcrText}\n\`\`\``)
    return `## OCR Pre-reads (reference only — IMAGE takes priority over all OCR text)
**When OCR text and image disagree, ALWAYS trust the image.**
**Two OCR sources agreeing is evidence for NUMBERS ONLY.** Neither pre-read
below can read Thai script reliably, so they say nothing about Thai names —
read every Thai word from the image itself.
Common OCR errors: 1↔7, 3↔8, 0↔6 in prices/tax IDs; น↔ม, เ↔แ in Thai words.
**Transcribe Thai exactly as printed.** Neither pre-read below can read Thai
script, so they are evidence about NUMBERS only. Read every Thai word from the
image itself and copy the characters you see — do not replace a reading with a
more plausible dish name, and do not normalise the receipt's spacing.
Glyph pairs that blur on thermal print, so look twice at these: น/ม, เ/แ, ใ/ไ,
ท/ก, ม/บ, ย/บ, ข/ช, ั/ิ, ่/ี. Digits blur too: 1/7, 3/8, 0/6.
${parts.join("\n")}

`
  }

  const qualityBlock = qualityWarnings.length
    ? qualityWarnings.join("\n") + "\n\n"
    : ""

  // A tall receipt is sent as overlapping horizontal slices so each one keeps
  // enough resolution for Thai script (see preprocessor.sliceTallReceipt). Say
  // so explicitly, or the model reasonably concludes it is looking at several
  // different receipts and returns a multi_doc array.
  const sliceBlock = pagesAreSlices
    ? `## IMPORTANT — these ${pages.length} images are ONE receipt
They are overlapping top-to-bottom slices of a single tall receipt, in order.
Read them as one continuous document: join the slices, and because consecutive
slices OVERLAP, a line visible at the bottom of one and the top of the next is
the SAME line — list it once. This is never a multi-document case.

`
    : ""

  const buildTextBlock = (ocrSection: string): Anthropic.TextBlockParam => ({
    type: "text",
    text: `${qualityBlock}${sliceBlock}${ocrSection}${fewShotBlock}First, check if this image contains MORE THAN ONE separate document (e.g. multiple receipts photographed together).

If the image is unreadable or not a financial document, return valid JSON with confidence_score near 0 and explain in extraction_issues.

## If the image contains EXACTLY ONE document:
Return ONLY a single JSON object:
${DOC_SCHEMA}

## If the image contains MULTIPLE documents:
Return ONLY a JSON object with this wrapper:
{
  "multi_doc": true,
  "documents": [ ${DOC_SCHEMA}, ... ]
}

Cross-check ALL OCR pre-reads above against the image. When two OCR sources agree, prefer that value.
Extract all accounting data from ${pages.length > 1 ? `these ${pages.length} document pages` : "this document"}.`,
  })

  // ── Pass 2: Extraction — Haiku or Sonnet based on doc complexity ─────────────
  //
  // ROUTING LOGIC:
  //   consumer_receipt / receipt  → Haiku (predictable layout, few fields, ~฿0.22/doc)
  //   everything else             → Sonnet (complex, needs tax accuracy, ~฿0.91/doc)
  //   useHaiku + confidence < 0.7 → escalate to Sonnet automatically
  //
  const runExtraction = async (
    textBlock: Anthropic.TextBlockParam,
    model: string,
    maxTokens: number,
    phase: UsageContext["phase"] = "extract",
  ): Promise<string> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: Anthropic.Message = await (getClient().messages.create as any)(
      {
        model,
        max_tokens: maxTokens,
        system: [
          {
            type:          "text",
            text:          systemPrompt(),
            // One-hour cache, not the default five minutes.
            //
            // The system prompt is ~46KB — comfortably the largest single input
            // on every call, larger than the receipt images themselves. A cache
            // WRITE costs more than sending it uncached (1.25× at 5 min, 2× at
            // 1h) and only pays off when a later call READS it at ~0.1×. So the
            // right TTL is decided by the gap between scans, not by latency.
            //
            // Real gaps in production: 12:16, 12:18, 12:57, 13:22, 13:28, 14:21,
            // 14:30, 15:36, then five within one minute. At 5 minutes almost
            // every one of those is a fresh write — paying the premium and
            // collecting the discount maybe twice. At one hour all but one fall
            // inside the window.
            cache_control: { type: "ephemeral", ttl: "1h" },
          },
        ],
        messages: [{ role: "user", content: [...imageBlocks, textBlock] }],
      },
      { headers: { "anthropic-beta": "prompt-caching-2024-07-31,extended-cache-ttl-2025-04-11" } },
    )

    // Record what the call actually cost. Until now nothing anywhere logged a
    // single token, which made every efficiency question unanswerable: whether
    // the cache helps, whether slicing or the prompt dominates, whether an
    // escalation to Sonnet was worth it. Guessing at that is how you optimise
    // the wrong thing.
    recordUsage(model, response.usage as unknown as ExtractionUsage, { ...usage, phase })

    return (response.content as Anthropic.ContentBlock[])
      .filter((c): c is Anthropic.TextBlock => c.type === "text")
      .map((c: Anthropic.TextBlock) => c.text)
      .join("")
  }

  // Alias for the two Sonnet re-reads (escalation and the DocAI retry). The
  // phase is what separates them in the usage log.
  const runSonnetExtraction = (
    textBlock: Anthropic.TextBlockParam,
    phase: UsageContext["phase"] = "escalate",
  ) => runExtraction(textBlock, MODEL_SONNET, MAX_TOKENS_SONNET, phase)

  const ocrSection = buildOcrSection(rawOcrText, "", clientOcrHintText)
  const textBlock  = buildTextBlock(ocrSection)

  // First extraction — Haiku or Sonnet
  const firstModel     = useHaiku ? MODEL_HAIKU  : MODEL_SONNET
  const firstMaxTokens = useHaiku ? MAX_TOKENS_HAIKU : MAX_TOKENS_SONNET

  let response: string
  try {
    response = await runExtraction(textBlock, firstModel, firstMaxTokens)
  } catch (err) {
    // The vision model is unreachable for reasons no retry and no better photo
    // can fix — an out-of-credit account, a revoked key. Document AI is a
    // completely separate vendor with its own billing, and it was sitting idle
    // through exactly this outage: five receipts were marked failed and the user
    // was told to photograph them again while a working, already-paid-for
    // receipt parser did nothing, because DocAI was only ever consulted AFTER a
    // successful Claude read (see shouldUseDocAiFallback below).
    //
    // Degraded, not equal: DocAI returns typed totals and line items but no
    // classification, no Thai-name repair, no VAT reasoning. Good enough to keep
    // the document usable and the numbers right; flagged so the user knows to
    // check it, and so a later re-read can improve on it.
    const kind = classifyFailure((err as Error).message)
    if (kind !== "provider") throw err

    console.warn(`[extractor] provider unavailable — falling back to Document AI only: ${(err as Error).message.slice(0, 120)}`)
    const docAiOnly = await extractWithDocAiOnly(pages)
    if (!docAiOnly) throw err
    return docAiOnly
  }

  // ── Robust JSON extraction ────────────────────────────────────────────────────
  // Claude Sonnet sometimes adds explanatory text or markdown fences even when
  // instructed not to. We try multiple strategies in order:
  function extractJson(text: string): string {
    // Strategy 1a: full fence match ```json ... ```
    const fullFence = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/i)
    if (fullFence?.[1]?.trim()) {
      const inner = fullFence[1].trim()
      if (inner.startsWith("{") || inner.startsWith("[")) return inner
    }

    // Strategy 1b: opening fence only (response truncated before closing ```)
    // e.g. response was cut off mid-JSON by max_tokens
    const openFence = text.match(/```(?:json)?\s*\n?([\s\S]+)/i)
    if (openFence?.[1]?.trim()) {
      const inner = openFence[1].replace(/```[\s\S]*$/, "").trim()
      if (inner.startsWith("{") || inner.startsWith("[")) return inner
    }

    // Strategy 2: find the first { or [ and slice to the last matching closer
    const objStart = text.indexOf("{")
    const arrStart = text.indexOf("[")
    if (objStart === -1 && arrStart === -1) return text.trim()

    const jsonStart = (objStart === -1) ? arrStart
      : (arrStart === -1) ? objStart
      : Math.min(objStart, arrStart)

    const opener  = text[jsonStart]
    const closer  = opener === "{" ? "}" : "]"
    const jsonEnd = text.lastIndexOf(closer)

    // Return whatever we found — JSON.parse will catch malformed JSON
    return jsonEnd > jsonStart
      ? text.slice(jsonStart, jsonEnd + 1).trim()
      : text.slice(jsonStart).trim()   // truncated — no closer found
  }

  // ── Parse response ────────────────────────────────────────────────────────────
  type RawDoc = Omit<ExtractedDocument, "doc_type" | "vat_claimable" | "expense_claimable" | "business_use_note">
  let rawParsed: RawDoc | RawDoc[]

  const FALLBACK_DOC: RawDoc = {
    doc_category: "other", vendor_name: "", company_name: null,
    vendor_tax_id: null, vendor_address: null, company_address: null, vendor_phone: null,
    platform_name: null, platform_ref: null, customer_name: null, staff_name: null,
    doc_number: null, doc_date: null, due_date: null,
    subtotal: 0, discount_amount: 0, delivery_fee: 0,
    vat_amount: 0, wht_amount: 0, total_amount: 0, paid_amount: 0,
    currency: "THB", payment_method: null, notes: null,
    line_items: [], confidence_score: 0, field_confidence: {},
    extraction_issues: [],
  }

  const parseRaw = (text: string): RawDoc | RawDoc[] => {
    const jsonStr2 = extractJson(text)
    try {
      const json = JSON.parse(jsonStr2)
      if (json?.multi_doc === true && Array.isArray(json.documents)) return json.documents as RawDoc[]
      return json as RawDoc
    } catch {
      const hint = text.slice(0, 200).trim() || "AI ไม่สามารถประมวลผลเอกสารนี้ได้"
      return { ...FALLBACK_DOC, extraction_issues: [`AI ตอบกลับในรูปแบบที่ไม่คาดคิด: ${hint}`] }
    }
  }

  rawParsed = parseRaw(response)

  const firstConfidence = Array.isArray(rawParsed)
    ? rawParsed[0]?.confidence_score ?? 0
    : rawParsed.confidence_score ?? 0

  // ── Haiku → Sonnet escalation ─────────────────────────────────────────────────
  // If Haiku was used but result is low-confidence, automatically escalate to Sonnet.
  // Cost: adds ~฿0.69 for this doc, but beats sending user a wrong result.
  const HAIKU_ESCALATE_THRESHOLD = 0.72
  if (useHaiku && firstConfidence < HAIKU_ESCALATE_THRESHOLD) {
    console.log(`[extractor] Haiku confidence ${firstConfidence.toFixed(2)} < ${HAIKU_ESCALATE_THRESHOLD} — escalating to Sonnet`)
    const escalatedResponse = await runSonnetExtraction(buildTextBlock(ocrSection))
    const escalatedParsed   = parseRaw(escalatedResponse)
    const escalatedConf     = Array.isArray(escalatedParsed)
      ? escalatedParsed[0]?.confidence_score ?? 0
      : escalatedParsed.confidence_score ?? 0
    if (escalatedConf >= firstConfidence) {
      rawParsed = escalatedParsed
      console.log(`[extractor] Sonnet escalation: ${firstConfidence.toFixed(2)} → ${escalatedConf.toFixed(2)}`)
    }
  }

  // ── Pass 3: Google Document AI fallback ──────────────────────────────────────
  // Triggered when: overall confidence < threshold even after potential escalation,
  // OR any individual line_item is low-confidence (overall score can stay high
  // even when a couple of menu-item descriptions were misread on a thermal receipt).
  // Adds a second OCR source and re-runs Sonnet — costs ~2x but saves low-confidence docs
  const currentConfidence = Array.isArray(rawParsed)
    ? rawParsed[0]?.confidence_score ?? 0
    : rawParsed.confidence_score ?? 0

  const firstDoc = Array.isArray(rawParsed) ? rawParsed[0] : rawParsed
  const minLineItemConfidence = (firstDoc?.line_items ?? [])
    .map(item => item.confidence ?? 1)
    .reduce((min, c) => Math.min(min, c), 1)
  const sumMismatch = lineItemSumMismatch(firstDoc)

  // See shouldUseDocAiFallback: the model's own confidence can't detect a
  // misread glyph, so a quality-flagged capture with Thai items also qualifies.
  const objectiveDoubt = degradedCapture
    && process.env.DOCAI_ON_LOW_QUALITY !== "0"
    && (firstDoc?.line_items ?? []).some(i => THAI_RE.test(String(i.description ?? "")))

  if (shouldUseDocAiFallback({
    confidence:            currentConfidence,
    minLineItemConfidence,
    sumMismatch,
    degradedCapture,
    lineItems:             firstDoc?.line_items ?? [],
    qualityTriggerEnabled: process.env.DOCAI_ON_LOW_QUALITY !== "0",
    enabled:               process.env.DOCAI_ENABLED !== "0",
    thaiGroundingEnabled:  process.env.DOCAI_THAI_GROUNDING === "1",
  })) {
    console.log(`[extractor] confidence ${currentConfidence.toFixed(2)} (min line item ${minLineItemConfidence.toFixed(2)}, sum mismatch: ${sumMismatch}, degraded+thai: ${objectiveDoubt}) — triggering Google DocAI fallback`)
    const docAiText = await docAiPass(pages[0])
    // A zero-token row, purely so the log answers "did the second vendor
    // actually get called?". Nothing recorded DocAI before, so the only way to
    // infer it was counting Sonnet calls and hoping.
    recordUsage("google-document-ai", { input_tokens: 0, output_tokens: 0 },
                { ...usage, phase: "docai_retry" })
    if (docAiText) {
      const retryRaw = await runSonnetExtraction(
        buildTextBlock(buildOcrSection(rawOcrText, numericOnlyOcr(docAiText), clientOcrHintText)),
        "docai_retry",
      )
      const retryParsed = parseRaw(retryRaw)
      const retryFirstDoc = Array.isArray(retryParsed) ? retryParsed[0] : retryParsed
      const retryConfidence = retryFirstDoc?.confidence_score ?? 0
      const retryMinLineItemConfidence = (retryFirstDoc?.line_items ?? [])
        .map(item => item.confidence ?? 1)
        .reduce((min, c) => Math.min(min, c), 1)
      // Penalize a still-mismatched sum so a retry that "fixes" confidence
      // scores but still doesn't add up correctly won't be preferred.
      const retrySumMismatch = lineItemSumMismatch(retryFirstDoc)

      const before = Math.min(currentConfidence, minLineItemConfidence) - (sumMismatch ? 0.5 : 0)
      const after  = Math.min(retryConfidence, retryMinLineItemConfidence) - (retrySumMismatch ? 0.5 : 0)

      if (after > before) {
        console.log(`[extractor] DocAI fallback improved: ${before.toFixed(2)} → ${after.toFixed(2)}`)
        rawParsed = retryParsed
      } else {
        console.log(`[extractor] DocAI fallback did not improve (${after.toFixed(2)}) — keeping current result`)
      }
    }
  }

  // ── Normalise single or multiple documents ─────────────────────────────────
  const normalise = (parsed: RawDoc): ExtractedDocument => {
    const clamp = (v: unknown) => Math.min(1, Math.max(0, Number(v) || 0))
    parsed.confidence_score = clamp(parsed.confidence_score)
    parsed.field_confidence = Object.fromEntries(
      Object.entries(parsed.field_confidence ?? {}).map(([k, v]) => [k, clamp(v)])
    )
    for (const item of parsed.line_items ?? []) item.confidence = clamp(item.confidence)

    const toNum = (v: unknown) => { const n = Number(String(v ?? 0).replace(/,/g, "")); return isNaN(n) ? 0 : n }
    parsed.subtotal        = toNum(parsed.subtotal)
    parsed.discount_amount = toNum(parsed.discount_amount)
    parsed.delivery_fee    = toNum(parsed.delivery_fee)
    parsed.vat_amount      = toNum(parsed.vat_amount)
    parsed.wht_amount      = toNum(parsed.wht_amount)
    parsed.total_amount    = toNum(parsed.total_amount)
    // Left out when paid_amount was added, which made the tender-line veto
    // silently inert: the model prints "1,039.00", the string passed the
    // `<= 0` guard as NaN-not-less-than-zero, and the subtraction then
    // produced NaN so the comparison was always false. A money safeguard that
    // quietly does nothing is worse than not having one.
    parsed.paid_amount     = toNum(parsed.paid_amount)

    // Re-bucket rows by role: keep real products/freebies, route discounts and
    // service/delivery charges into their own fields, drop payment/total/tax/
    // points/noise. Runs AFTER numeric coercion (so field amounts are numbers)
    // and BEFORE reconcileAmounts (which trusts the cleaned line-item sum).
    reclassifyLineItems(parsed, learnedRowOverrides)

    reconcileAmounts(parsed)

    const category = (parsed.doc_category ?? "other") as DocCategory
    return {
      ...parsed,
      doc_category:      category,
      doc_type:          CATEGORY_TO_DOC_TYPE[category] ?? "unknown",
      vat_claimable:     VAT_CLAIMABLE.has(category),
      expense_claimable: EXPENSE_CLAIMABLE.has(category),
      business_use_note: BUSINESS_USE_NOTE[category],
      currency:          parsed.currency ?? "THB",
      line_items:        parsed.line_items ?? [],
      extraction_issues: parsed.extraction_issues ?? [],
    }
  }

  if (Array.isArray(rawParsed)) {
    return rawParsed.map(normalise)
  }
  return normalise(rawParsed)
}
