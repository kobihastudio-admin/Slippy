/**
 * Vendor registry — Tax ID → official juristic identity
 * =====================================================================
 * Turns the 13-digit เลขประจำตัวผู้เสียภาษี / เลขทะเบียนนิติบุคคล printed on a
 * receipt into the company's *official* registered name (and, where available,
 * status / type / address). This is the "verify the merchant" half of the two
 * problems from mobile testing — OCR alone keeps mis-reading store names.
 *
 * Design: a small pluggable provider chain, so we can slot in whichever data
 * source actually works without touching the pipeline:
 *
 *   resolveJuristic(taxId, [providerA, providerB, ...]) → first hit wins
 *
 *   • dbdOpenApiProvider  — openapi.dbd.go.th/api/v1/juristic_person/{id}
 *                           FULL registry incl. Thai + English name. The real
 *                           prize, but currently 502/Imperva-gated and needs
 *                           DBD's own key → configured via env, skipped if unset.
 *   • dataGoThProvider    — data.go.th CKAN datastore (token in env). PROVEN
 *                           callable, but only covers monthly "ตั้งใหม่"
 *                           registration slices, so it hits for recently-
 *                           registered entities and misses established chains.
 *   • mockProvider        — for tests.
 *
 * The pure pieces (normalizeTaxId, resolveJuristic w/ injected providers,
 * reconcileVendorName, parseDbdOpenApi) are unit-tested in
 * scripts/verify-vendor-registry.ts — no network, no LLM.
 *
 * Results are cached in `merchant_directory` (migration 080) keyed by tax_id,
 * so the same store is looked up over the network at most once (hits AND misses
 * are cached, protecting the 1000-call/day data.go.th quota).
 *
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */
import Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import { canonicalMerchantKey } from "./merchant-key"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface JuristicRecord {
  taxId:              string
  nameTh:             string
  nameEn?:            string | null
  status?:            string | null   // e.g. "ยังดำเนินกิจการอยู่"
  entityType?:        string | null   // บริษัทจำกัด / ห้างหุ้นส่วนจำกัด / ...
  address?:           string | null
  registeredCapital?: number | null
  registeredDate?:    string | null
  source:             string          // provider name — provenance
}

/** Optional context from the receipt to help fuzzy/AI providers disambiguate. */
export interface LookupHint {
  name?:    string | null   // the OCR-read vendor name (may be wrong)
  address?: string | null
}

export interface VendorRegistryProvider {
  readonly name: string
  /** Returns the record for a *normalized 13-digit* taxId, or null if not found. */
  lookup(taxId: string, hint?: LookupHint): Promise<JuristicRecord | null>
}

// ── Pure helpers ────────────────────────────────────────────────────────────────

/** Strip formatting; return a 13-digit Thai id or null if it isn't one. */
export function normalizeTaxId(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "")
  return digits.length === 13 ? digits : null
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null
  const n = Number(String(v).replace(/,/g, ""))
  return Number.isFinite(n) ? n : null
}

/**
 * Walk a provider chain and return the first real hit. Providers are tried in
 * order (most-authoritative first). A provider throwing is logged and skipped —
 * one dead source never blocks the rest. Pure w.r.t. the injected providers, so
 * fully testable with mocks.
 */
export async function resolveJuristic(
  rawTaxId:  string | null | undefined,
  providers: VendorRegistryProvider[],
  hint?:     LookupHint,
): Promise<JuristicRecord | null> {
  const taxId = normalizeTaxId(rawTaxId)
  if (!taxId) return null
  for (const p of providers) {
    try {
      const rec = await p.lookup(taxId, hint)
      if (rec?.nameTh?.trim()) return { ...rec, taxId, source: rec.source || p.name }
    } catch (err) {
      console.warn(`[vendor-registry] provider "${p.name}" failed:`, (err as Error)?.message)
    }
  }
  return null
}

export interface VendorNameDecision {
  name:          string   // the name the pipeline should use
  official:      boolean  // true → came from the registry (verified)
  changed:       boolean  // true → official name differs from what OCR read
  officialName?: string   // the registry legal name, when resolved
}

/**
 * Decide the authoritative vendor name. When the registry resolves a tax id we
 * trust its *legal* name over OCR (that is the whole point of verifying by tax
 * id) — but we flag whether it actually changed, so the caller only records a
 * learning correction when OCR really got it wrong. Comparison uses the shared
 * canonical merchant key, so pure formatting differences aren't "changes".
 */
export function reconcileVendorName(
  extractedName: string | null | undefined,
  record:        JuristicRecord | null,
): VendorNameDecision {
  const extracted = String(extractedName ?? "").trim()
  if (!record?.nameTh?.trim()) return { name: extracted, official: false, changed: false }
  const official = record.nameTh.trim()
  const changed =
    canonicalMerchantKey({ name: extracted }) !== canonicalMerchantKey({ name: official })
  return { name: official, official: true, changed, officialName: official }
}

// ── Provider: DBD OpenAPI (full registry — the real prize) ──────────────────────

/**
 * Tolerant parser for the openapi.dbd.go.th juristic_person response. Kept pure
 * + exported so the shape is unit-tested against a fixture even while the live
 * endpoint is gated. DBD wraps the record under `data` (sometimes an array),
 * with THAI/ENG name, status, type, capital, register date, address object.
 */
export function parseDbdOpenApi(json: any, taxId: string): JuristicRecord | null {
  const d = Array.isArray(json?.data) ? json.data[0] : (json?.data ?? json)
  if (!d || typeof d !== "object") return null

  const nameTh = String(
    d.juristicNameTH ?? d.JuristicNameTH ?? d.name_th ?? d.nameTH ?? "",
  ).trim()
  if (!nameTh) return null

  const addr = d.address ?? d.Address ?? null
  const addressStr = typeof addr === "string"
    ? addr
    : addr && typeof addr === "object"
      ? [addr.houseNumber, addr.building, addr.roomNo, addr.floor, addr.villageName,
         addr.moo && `หมู่ ${addr.moo}`, addr.soi && `ซอย ${addr.soi}`,
         addr.street, addr.subDistrict, addr.district, addr.province, addr.postalCode]
          .filter(Boolean).join(" ").trim() || null
      : null

  return {
    taxId,
    nameTh,
    nameEn:            (d.juristicNameEN ?? d.JuristicNameEN ?? d.name_en ?? null) || null,
    status:            (d.juristicStatus ?? d.JuristicStatus ?? d.status ?? null) || null,
    entityType:        (d.juristicType ?? d.JuristicType ?? d.type ?? null) || null,
    address:           addressStr,
    registeredCapital: numOrNull(d.registerCapital ?? d.RegisterCapital ?? d.capital),
    registeredDate:    (d.registerDate ?? d.RegisterDate ?? null) || null,
    source:            "openapi.dbd.go.th",
  }
}

export function dbdOpenApiProvider(opts: {
  baseUrl?:   string   // e.g. https://openapi.dbd.go.th/api/v1
  apiKey?:    string
  timeoutMs?: number
} = {}): VendorRegistryProvider {
  const baseUrl   = opts.baseUrl ?? process.env.DBD_OPENAPI_URL
  const apiKey    = opts.apiKey  ?? process.env.DBD_OPENAPI_KEY
  const timeoutMs = opts.timeoutMs ?? 8000
  return {
    name: "openapi.dbd.go.th",
    async lookup(taxId) {
      if (!baseUrl) return null   // not provisioned yet → skip silently
      const url = `${baseUrl.replace(/\/+$/, "")}/juristic_person/${taxId}`
      const res = await fetch(url, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal:  AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return parseDbdOpenApi(await res.json(), taxId)
    },
  }
}

// ── Provider: data.go.th CKAN datastore (proven callable, partial coverage) ─────

const DATAGOTH_BASE      = "https://data.go.th/api/3/action"
const DBD_NEW_REG_DATASET = "dataset_11_0121"   // นิติบุคคลจดทะเบียนตั้งใหม่ (monthly slices)
const F_TAXID = "เลขทะเบียน"
const F_NAME  = "ชื่อนิติบุคคล"

export function dataGoThProvider(opts: {
  token?:        string
  datasetId?:    string
  maxResources?: number   // how many monthly slices to scan before giving up
  timeoutMs?:    number
} = {}): VendorRegistryProvider {
  const token        = opts.token ?? process.env.DATAGOTH_API_TOKEN
  const datasetId    = opts.datasetId ?? DBD_NEW_REG_DATASET
  const maxResources = opts.maxResources ?? 12   // ~1 year; bounded for the daily quota
  const timeoutMs    = opts.timeoutMs ?? 6000
  let resourceCache: { ids: string[]; at: number } | null = null

  async function ckan(path: string): Promise<any> {
    const res = await fetch(`${DATAGOTH_BASE}/${path}`, {
      headers: token ? { "api-key": token } : {},
      signal:  AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json() as any
    if (!json?.success) throw new Error("CKAN success=false")
    return json.result
  }

  async function resourceIds(): Promise<string[]> {
    if (resourceCache && Date.now() - resourceCache.at < 6 * 3600_000) return resourceCache.ids
    const pkg = await ckan(`package_show?id=${encodeURIComponent(datasetId)}`)
    const ids: string[] = (pkg?.resources ?? [])
      .filter((r: any) => r?.datastore_active)
      .map((r: any) => r.id as string)
      .slice(0, maxResources)
    resourceCache = { ids, at: Date.now() }
    return ids
  }

  return {
    name: "data.go.th/dbd",
    async lookup(taxId) {
      if (!token) return null
      const ids    = await resourceIds()
      const filter = encodeURIComponent(JSON.stringify({ [F_TAXID]: taxId }))
      for (const rid of ids) {
        let result: any
        try {
          result = await ckan(`datastore_search?resource_id=${rid}&filters=${filter}&limit=1`)
        } catch { continue }   // one dead slice doesn't abort the scan
        const rec = result?.records?.[0]
        if (rec) {
          const addr = [rec["ที่ตั้งสำนักงานใหญ่"], rec["ตำบล"], rec["อำเภอ"], rec["จังหวัด"], rec["รหัสไปรษณีย์"]]
            .filter(Boolean).join(" ").trim() || null
          return {
            taxId,
            nameTh:            String(rec[F_NAME] ?? "").trim(),
            entityType:        rec["ประเภทนิติบุคคล"] ?? null,
            address:           addr,
            registeredCapital: numOrNull(rec["ทุนจดทะเบียน"]),
            registeredDate:    rec["วันที่จดทะเบียน"] ?? null,
            source:            "data.go.th/dbd",
          }
        }
      }
      return null
    },
  }
}

// ── Provider: mock (tests) ──────────────────────────────────────────────────────

export function mockProvider(
  records: Record<string, Partial<JuristicRecord> & { nameTh: string }>,
  name = "mock",
): VendorRegistryProvider {
  return {
    name,
    async lookup(taxId) {
      const r = records[taxId]
      return r ? { source: name, ...r, taxId } : null
    },
  }
}

// ── Provider: AI + web search (fallback for entities the registries miss) ───────

let _aiClient: Anthropic | null = null
function aiClient(): Anthropic {
  if (!_aiClient) _aiClient = new Anthropic()   // reads ANTHROPIC_API_KEY at call time
  return _aiClient
}

/**
 * Pure parser for the model's JSON answer. Kept separate + exported so it can be
 * unit-tested without any network/LLM. Returns null unless the model reports a
 * confident, found result with a Thai name.
 */
export function parseAiVendorResponse(
  text: string,
): { found: boolean; nameTh: string; nameEn: string | null; confidence: number } | null {
  if (!text) return null
  const m = text.match(/\{[\s\S]*\}/)   // first JSON object in the reply
  if (!m) return null
  try {
    const j = JSON.parse(m[0])
    const nameTh = String(j.nameTh ?? j.name_th ?? "").trim()
    return {
      found:      !!j.found && nameTh.length > 0,
      nameTh,
      nameEn:     j.nameEn || j.name_en ? String(j.nameEn ?? j.name_en).trim() : null,
      confidence: typeof j.confidence === "number" ? j.confidence : 0,
    }
  } catch {
    return null
  }
}

/**
 * Last-resort provider: asks Claude (with the server-side web_search tool) for
 * the official juristic name behind a tax id, seeded with the OCR-read name as a
 * disambiguation hint. Covers established companies the open-data registries
 * miss — but is opt-in (VENDOR_AI_SEARCH=1) since it costs tokens + latency, and
 * only returns a result the model is confident about (else null), so a wrong
 * guess never overwrites a decent OCR read.
 */
export function aiWebSearchProvider(opts: {
  model?:         string
  maxUses?:       number
  minConfidence?: number
} = {}): VendorRegistryProvider {
  const model         = opts.model ?? process.env.VENDOR_AI_MODEL ?? "claude-haiku-4-5-20251001"
  const maxUses       = opts.maxUses ?? 3
  const minConfidence = opts.minConfidence ?? 0.7
  return {
    name: "ai-web-search",
    async lookup(taxId, hint) {
      const hintLine = hint?.name?.trim()
        ? `ชื่อที่อ่านได้จากใบเสร็จ (OCR อาจผิดเพี้ยน ใช้เป็นเบาะแสได้): "${hint.name.trim()}".`
        : ""
      const prompt =
        `ค้นเว็บเพื่อหาชื่อนิติบุคคล/บริษัท "ทางการ" ในประเทศไทย ที่มีเลขทะเบียนนิติบุคคล/` +
        `เลขประจำตัวผู้เสียภาษี ${taxId}. ${hintLine}\n` +
        `ตอบกลับเป็น JSON อย่างเดียว รูปแบบ: ` +
        `{"found": boolean, "nameTh": string, "nameEn": string|null, "confidence": number}\n` +
        `- found=true เฉพาะเมื่อพบหลักฐานที่ยืนยันว่าเลขนี้ตรงกับบริษัทนี้จริง\n` +
        `- ถ้าไม่พบหรือไม่มั่นใจ ให้ found=false และ confidence ต่ำ — ห้ามเดา`
      // SDK 0.24 has no web_search types; the client is a JSON passthrough, so
      // send the server tool via `as any`. Any failure (unsupported/timeout) is
      // caught by resolveJuristic and simply skips this provider.
      const res: any = await (aiClient().messages.create as any)({
        model,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxUses }],
      })
      const text = Array.isArray(res?.content)
        ? res.content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n")
        : ""
      const parsed = parseAiVendorResponse(text)
      if (parsed?.found && parsed.confidence >= minConfidence) {
        return { taxId, nameTh: parsed.nameTh, nameEn: parsed.nameEn, source: "ai-web-search" }
      }
      return null
    },
  }
}

/**
 * Build the default chain from env: DBD OpenAPI first (authoritative), then
 * data.go.th, then AI web-search last (only overrides OCR when the registries
 * came up empty and the model is confident).
 */
export function defaultProviders(): VendorRegistryProvider[] {
  const chain: VendorRegistryProvider[] = []
  if (process.env.DBD_OPENAPI_URL)     chain.push(dbdOpenApiProvider())
  if (process.env.DATAGOTH_API_TOKEN)  chain.push(dataGoThProvider())
  if (process.env.VENDOR_AI_SEARCH === "1") chain.push(aiWebSearchProvider())
  return chain
}

// ── Cached resolution (merchant_directory) ──────────────────────────────────────

const HIT_TTL_MS  = 180 * 24 * 3600_000   // re-verify a resolved entity twice a year
const MISS_TTL_MS = 30  * 24 * 3600_000   // don't re-scan a miss for a month

function rowToRecord(row: any): JuristicRecord | null {
  if (!row?.found || !row.name_th) return null
  return {
    taxId:             row.tax_id,
    nameTh:            row.name_th,
    nameEn:            row.name_en ?? null,
    status:            row.status ?? null,
    entityType:        row.entity_type ?? null,
    address:           row.address ?? null,
    registeredCapital: row.registered_capital ?? null,
    registeredDate:    row.registered_date ?? null,
    source:            row.source ?? "cache",
  }
}

/**
 * Resolve a tax id to its juristic record, cache-first. On a network hit or miss
 * the result is written to `merchant_directory` so we never pay for the same
 * lookup twice. Returns null when the id is invalid, cached-miss-and-fresh, or
 * unresolved. Best-effort: any DB/network error degrades to null, never throws.
 */
export async function resolveVendorIdentity(
  supabase:   SupabaseClient,
  rawTaxId:   string | null | undefined,
  providers?: VendorRegistryProvider[],
  hint?:      LookupHint,
): Promise<JuristicRecord | null> {
  const taxId = normalizeTaxId(rawTaxId)
  if (!taxId) return null

  try {
    const { data: cached } = await supabase
      .from("merchant_directory")
      .select("*")
      .eq("tax_id", taxId)
      .maybeSingle()

    if (cached) {
      const age = Date.now() - new Date(cached.looked_up_at).getTime()
      const fresh = cached.found ? age < HIT_TTL_MS : age < MISS_TTL_MS
      if (fresh) {
        // bump hit_count (fire-and-forget)
        supabase.from("merchant_directory")
          .update({ hit_count: (cached.hit_count ?? 1) + 1 })
          .eq("tax_id", taxId)
          .then(() => {}, () => {})
        return rowToRecord(cached)
      }
    }
  } catch { /* cache read is best-effort */ }

  const chain  = providers ?? defaultProviders()
  const record = chain.length ? await resolveJuristic(taxId, chain, hint) : null

  // Upsert cache (hit or miss)
  try {
    await supabase.from("merchant_directory").upsert({
      tax_id:             taxId,
      found:              !!record,
      name_th:            record?.nameTh ?? null,
      name_en:            record?.nameEn ?? null,
      status:             record?.status ?? null,
      entity_type:        record?.entityType ?? null,
      address:            record?.address ?? null,
      registered_capital: record?.registeredCapital ?? null,
      registered_date:    record?.registeredDate ?? null,
      source:             record?.source ?? "miss",
      looked_up_at:       new Date().toISOString(),
      updated_at:         new Date().toISOString(),
    }, { onConflict: "tax_id" })
  } catch { /* cache write is best-effort */ }

  return record
}

// ── Pipeline wiring ─────────────────────────────────────────────────────────────

export interface VerifiableDoc {
  vendor_name?:     string | null   // shop/branch — must survive verification
  company_name?:    string | null   // juristic entity — this is what we verify
  vendor_tax_id?:   string | null
  vendor_address?:  string | null   // branch address — never overwritten
  company_address?: string | null   // registered office
}

export interface VendorVerification {
  verified:      boolean          // tax id resolved to an official record
  changed:       boolean          // official name replaced what OCR read
  officialName?: string
  record?:       JuristicRecord
}

/**
 * If the extracted doc carries a tax id, resolve the official juristic name and
 * (a) overwrite `vendor_name` with the verified legal name, (b) when OCR had it
 * wrong, record a `vendor_name` correction so the merchant-normalizer learns the
 * OCR-name → official-name mapping for future receipts (same receipt_corrections
 * feedback loop that already powers few-shot learning).
 *
 * Best-effort and non-throwing — verification never blocks extraction. Mutates
 * `extracted` in place and returns what happened.
 */
export async function verifyVendorIdentity(
  supabase:       SupabaseClient,
  organizationId: string,
  documentId:     string,
  extracted:      VerifiableDoc,
  providers?:     VendorRegistryProvider[],
): Promise<VendorVerification> {
  try {
    const record = await resolveVendorIdentity(supabase, extracted.vendor_tax_id, providers, {
      name:    extracted.vendor_name,
      address: extracted.vendor_address,
    })
    if (!record) return { verified: false, changed: false }

    // Verify the COMPANY, not the shop. A tax id identifies the juristic entity
    // ("บริษัท สยาม อัลเตอร์ กรุ๊ป จำกัด"), never the branch you walked into
    // ("KOFUKU Silom Complex"). This used to overwrite vendor_name, which threw
    // away the only name the user actually recognises on their own receipt.
    const decision = reconcileVendorName(extracted.company_name, record)
    const ocrName  = String(extracted.company_name ?? "").trim()

    extracted.company_name  = decision.name
    extracted.vendor_tax_id = record.taxId   // normalized, format-independent

    // The registry address is the REGISTERED office, which is often nowhere near
    // the branch on the receipt — keep it as company_address and never let it
    // overwrite the branch address the customer actually visited.
    if (record.address?.trim() && !extracted.company_address?.trim()) {
      extracted.company_address = record.address.trim()
    }

    if (decision.changed && ocrName) {
      // Teach the normalizer: this OCR reading really means the official name.
      supabase.from("receipt_corrections").insert({
        organization_id: organizationId,
        document_id:     documentId,
        field_name:      "company_name",
        ai_value:        ocrName,
        corrected_value: decision.name,
        vendor_name:     decision.name,
        corrected_by:    null,
      }).then(() => {}, () => {})
    }

    return { verified: true, changed: decision.changed, officialName: decision.officialName, record }
  } catch {
    return { verified: false, changed: false }
  }
}
