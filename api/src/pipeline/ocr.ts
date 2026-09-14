import { DocumentProcessorServiceClient } from "@google-cloud/documentai"

const PROJECT_ID  = process.env.GOOGLE_CLOUD_PROJECT   ?? ""
const LOCATION    = process.env.GOOGLE_DOC_AI_LOCATION ?? "us"
const PROCESSOR_ID = process.env.GOOGLE_DOC_AI_PROCESSOR_ID ?? ""

const PROCESSOR_NAME =
  `projects/${PROJECT_ID}/locations/${LOCATION}/processors/${PROCESSOR_ID}`

/**
 * Document AI is a REGIONAL service: a processor created in `eu` or
 * `asia-southeast1` is only reachable through that region's endpoint. The
 * default client talks to the US endpoint, so any non-US processor would fail
 * with NOT_FOUND no matter how correct the project/processor ids were. Pin the
 * endpoint to the configured location.
 */
const API_ENDPOINT = `${LOCATION}-documentai.googleapis.com`

/** Sniff the real image type — see the mimeType note in runOcr(). */
function detectMimeType(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg"
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png"
  if (buf.length >= 4 && buf.toString("ascii", 0, 4) === "%PDF") return "application/pdf"
  return "image/jpeg"   // preprocessor emits JPEG
}

/**
 * Service-account credentials taken straight from an env var.
 *
 * The Google libraries normally want GOOGLE_APPLICATION_CREDENTIALS pointing at
 * a JSON file — awkward here, because the api container mounts no volumes, so a
 * key file would have to be baked into the image. Every other secret in this
 * deployment already lives in `api.env`, so allow the same for this one: paste
 * the service-account JSON into GOOGLE_CREDENTIALS_JSON (single line) and skip
 * the file entirely. The file path still works if it is set.
 */
function credentialsFromEnv(): { client_email: string; private_key: string } | undefined {
  const raw = process.env.GOOGLE_CREDENTIALS_JSON
  if (!raw?.trim()) return undefined
  try {
    const c = JSON.parse(raw)
    if (!c.client_email || !c.private_key) {
      console.warn("[docai] GOOGLE_CREDENTIALS_JSON is missing client_email/private_key")
      return undefined
    }
    return {
      client_email: c.client_email,
      // .env files can't hold real newlines, so the key usually arrives with
      // literal \n sequences — restore them or the JWT signing fails.
      private_key: String(c.private_key).replace(/\\n/g, "\n"),
    }
  } catch (err) {
    console.warn("[docai] GOOGLE_CREDENTIALS_JSON is not valid JSON:", (err as Error).message)
    return undefined
  }
}

let _client: DocumentProcessorServiceClient | null = null
function getClient() {
  if (!_client) {
    const credentials = credentialsFromEnv()
    _client = new DocumentProcessorServiceClient({
      apiEndpoint: API_ENDPOINT,
      ...(credentials ? { credentials, projectId: PROJECT_ID } : {}),
    })
  }
  return _client
}

export interface OcrPage {
  text:   string
  blocks: OcrBlock[]
  /** Structured entities, present when PROCESSOR_ID points at an Expense/Invoice
   *  parser rather than a plain OCR processor. */
  fields?: DocAiFields
}

export interface DocAiLineItem {
  description?: string
  amount?:      number
  quantity?:    number
  unitPrice?:   number
}

/**
 * Typed fields from a Document AI Expense/Invoice parser.
 *
 * This is the "grounding" layer: unlike raw OCR text (or an LLM reading an
 * image), these are typed values with a per-field confidence and a normalized
 * money/date value straight from a purpose-built receipt model. Numbers here
 * should outrank anything the LLM infers on its own.
 */
export interface DocAiFields {
  supplierName?:   string
  supplierTaxId?:  string
  invoiceId?:      string
  receiptDate?:    string   // ISO yyyy-MM-dd
  currency?:       string
  totalAmount?:    number
  netAmount?:      number   // subtotal (pre-tax)
  totalTaxAmount?: number   // VAT
  lineItems:       DocAiLineItem[]
  /** entity type → confidence (0–1) */
  confidence:      Record<string, number>
}

export interface OcrBlock {
  text:       string
  confidence: number
  boundingBox?: number[]  // [x1,y1,x2,y2] normalised 0-1
}

/**
 * Run Google Document AI on a single PNG buffer.
 * Returns structured text blocks with confidence scores.
 */
/**
 * Whether this processor accepts `processOptions.ocrConfig`.
 *
 * Only the general OCR processors do. An Expense/Invoice parser rejects the
 * whole request with `INVALID_ARGUMENT: OcrConfig is not supported for
 * processor type: 'EXPENSE_PROCESSOR'`, so the language hints we want for Thai
 * would otherwise make every call fail outright. Discover it on the first call
 * and remember, rather than making the operator configure the processor type by
 * hand (and get it wrong).
 */
let _acceptsOcrConfig: boolean | null = null

export async function runOcr(imageBuffer: Buffer): Promise<OcrPage> {
  const client = getClient()

  const request = (withOcrConfig: boolean) => ({
    name: PROCESSOR_NAME,
    rawDocument: {
      content:  imageBuffer.toString("base64"),
      // Sniffed, not hard-coded: the preprocessor hands us JPEG, and this used
      // to declare "image/png" — Document AI trusts the declared type, so every
      // page was mislabelled.
      mimeType: detectMimeType(imageBuffer),
    },
    // Thai receipts/bills mix Thai + English — hint both so an OCR processor
    // doesn't default to English-only character recognition.
    ...(withOcrConfig
      ? { processOptions: { ocrConfig: { hints: { languageHints: ["th", "en"] } } } }
      : {}),
  })

  let result
  try {
    ;[result] = await client.processDocument(request(_acceptsOcrConfig !== false))
    if (_acceptsOcrConfig === null) _acceptsOcrConfig = true
  } catch (err) {
    const msg = (err as Error)?.message ?? ""
    if (!/OcrConfig is not supported/i.test(msg)) throw err
    console.log("[docai] processor rejects ocrConfig (Expense/Invoice parser) — retrying without language hints")
    _acceptsOcrConfig = false
    ;[result] = await client.processDocument(request(false))
  }

  const doc = result.document
  if (!doc) throw new Error("Document AI returned empty document")

  const fullText = doc.text ?? ""

  // Extract blocks from paragraphs across all pages
  const blocks: OcrBlock[] = []

  for (const page of doc.pages ?? []) {
    for (const paragraph of page.paragraphs ?? []) {
      const layout    = paragraph.layout
      const text      = extractText(fullText, layout?.textAnchor)
      const confidence = layout?.confidence ?? 0

      if (!text.trim()) continue

      const verts = layout?.boundingPoly?.normalizedVertices ?? []
      const xs    = verts.map(v => v.x ?? 0)
      const ys    = verts.map(v => v.y ?? 0)
      const bbox  = xs.length
        ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
        : undefined

      blocks.push({ text: text.trim(), confidence, boundingBox: bbox })
    }
  }

  return { text: fullText.trim(), blocks, fields: parseEntities(doc.entities) }
}

// ── Structured entity parsing (Expense / Invoice parser) ──────────────────────

/** Money from a Document AI entity — prefers the normalized moneyValue. */
function moneyOf(entity: any): number | undefined {
  const m = entity?.normalizedValue?.moneyValue
  if (m) {
    const units = Number(m.units ?? 0)
    const nanos = Number(m.nanos ?? 0)
    const value = units + nanos / 1e9
    return Number.isFinite(value) ? +value.toFixed(2) : undefined
  }
  const raw = entity?.normalizedValue?.text ?? entity?.mentionText
  const n = Number(String(raw ?? "").replace(/[^0-9.\-]/g, ""))
  return Number.isFinite(n) && n !== 0 ? +n.toFixed(2) : undefined
}

function dateOf(entity: any): string | undefined {
  const d = entity?.normalizedValue?.dateValue
  if (d?.year) {
    const mm = String(d.month ?? 1).padStart(2, "0")
    const dd = String(d.day   ?? 1).padStart(2, "0")
    return `${d.year}-${mm}-${dd}`
  }
  return undefined
}

function textOf(entity: any): string | undefined {
  const t = (entity?.normalizedValue?.text ?? entity?.mentionText ?? "").trim()
  return t.length ? t : undefined
}

/**
 * Maps Document AI Expense-parser entities onto our own field names.
 * Unknown entity types are ignored — a plain OCR processor returns none, in
 * which case `fields` stays effectively empty and callers just fall back to text.
 */
export function parseEntities(entities: any): DocAiFields | undefined {
  const list: any[] = Array.isArray(entities) ? entities : []
  if (!list.length) return undefined

  const out: DocAiFields = { lineItems: [], confidence: {} }

  for (const e of list) {
    const type = String(e?.type ?? e?.type_ ?? "")
    if (!type) continue
    if (typeof e?.confidence === "number") out.confidence[type] = e.confidence

    switch (type) {
      case "total_amount":     out.totalAmount    = moneyOf(e) ?? out.totalAmount;    break
      case "net_amount":       out.netAmount      = moneyOf(e) ?? out.netAmount;      break
      case "total_tax_amount": out.totalTaxAmount = moneyOf(e) ?? out.totalTaxAmount; break
      case "supplier_name":    out.supplierName   = textOf(e)  ?? out.supplierName;   break
      case "supplier_tax_id":  out.supplierTaxId  = textOf(e)  ?? out.supplierTaxId;  break
      case "invoice_id":       out.invoiceId      = textOf(e)  ?? out.invoiceId;      break
      case "currency":         out.currency       = textOf(e)  ?? out.currency;       break
      case "receipt_date":
      case "invoice_date":     out.receiptDate    = dateOf(e) ?? out.receiptDate;     break
      case "line_item": {
        const item: DocAiLineItem = {}
        for (const p of (e.properties ?? []) as any[]) {
          switch (String(p?.type ?? "")) {
            case "line_item/description": item.description = textOf(p);  break
            case "line_item/amount":      item.amount      = moneyOf(p); break
            case "line_item/quantity":    item.quantity    = Number(textOf(p) ?? "") || undefined; break
            case "line_item/unit_price":  item.unitPrice   = moneyOf(p); break
          }
        }
        if (item.description || item.amount != null) out.lineItems.push(item)
        break
      }
    }
  }

  return out
}

/**
 * Run OCR over multiple page buffers and concatenate results.
 */
export async function runOcrMultiPage(pageBuffers: Buffer[]): Promise<OcrPage[]> {
  return Promise.all(pageBuffers.map(runOcr))
}

// ── helpers ───────────────────────────────────────────────────────────────────

type TextAnchor = {
  textSegments?: Array<{ startIndex?: unknown; endIndex?: unknown }> | null
} | null | undefined

function extractText(fullText: string, anchor: TextAnchor): string {
  if (!anchor?.textSegments?.length) return ""

  return anchor.textSegments
    .map(seg => {
      const start = Number(seg.startIndex ?? 0)
      const end   = Number(seg.endIndex   ?? 0)
      return fullText.slice(start, end)
    })
    .join("")
}
