/**
 * Row-classification feedback loop
 * =====================================================================
 * Closes the loop so the classifier gets better the more people use it:
 *
 *   predict ─▶ user edits (keeps/removes rows) ─▶ derive corrections
 *      ▲                                                   │
 *      └──────── apply learned overrides ◀── aggregate ◀───┘
 *
 * Reuses the existing `receipt_corrections` table (migration 033) with a
 * dedicated field_name, so no new schema is required — the same table that
 * already powers vendor-name and OCR-error learning now also learns which
 * labels are NOT real line items (the recurring discount/points/promo problem).
 *
 * The pure functions (`deriveRowRoleCorrections`, `aggregateLearnedOverrides`)
 * are unit-tested; the DB helpers are thin wrappers around Supabase.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { normalizeLabel, type LearnedOverrides, type RowRole } from "./receipt-rows"

/** field_name used in receipt_corrections for row-role feedback. */
export const ROW_ROLE_FIELD = "line_item_role"

/** A correction ready to persist (matches the receipt_corrections columns). */
export interface RowRoleCorrection {
  field_name:      typeof ROW_ROLE_FIELD
  ai_value:        string   // the row label the pipeline produced
  corrected_value: string   // "non_item" | a concrete RowRole | "item"
}

interface HasDescription { description?: unknown }

/**
 * Diffs what the pipeline kept as line items against what the user actually kept
 * after editing, and emits a correction for each divergence:
 *   • label the AI kept but the user removed  → "non_item"  (we over-included)
 *   • label the user has but the AI dropped   → "item"      (we over-filtered)
 * Pure — the caller decides whether/how to persist.
 */
export function deriveRowRoleCorrections(
  aiItems:   HasDescription[],
  userItems: HasDescription[],
): RowRoleCorrection[] {
  const aiLabels   = new Map<string, string>()  // normalized → original
  const userKeys   = new Set<string>()
  for (const it of userItems) userKeys.add(normalizeLabel(it.description))
  for (const it of aiItems) {
    const key = normalizeLabel(it.description)
    if (key) aiLabels.set(key, String(it.description ?? "").trim())
  }

  const out: RowRoleCorrection[] = []

  // Removed by the user → not a real item.
  for (const [key, label] of aiLabels) {
    if (!userKeys.has(key)) {
      out.push({ field_name: ROW_ROLE_FIELD, ai_value: label, corrected_value: "non_item" })
    }
  }
  // Present for the user but the AI never produced it → should have been an item.
  for (const it of userItems) {
    const key = normalizeLabel(it.description)
    if (key && !aiLabels.has(key)) {
      out.push({ field_name: ROW_ROLE_FIELD, ai_value: String(it.description ?? "").trim(), corrected_value: "item" })
    }
  }
  return out
}

const VALID_ROLES: ReadonlySet<string> = new Set<RowRole>([
  "item", "freebie", "discount", "service_charge", "delivery_fee",
  "subtotal", "vat", "total", "tender", "change", "rounding",
  "loyalty", "count", "noise", "unknown",
])

/** "non_item" is stored as the neutral drop role. */
function toRole(correctedValue: string): RowRole | null {
  const v = correctedValue.trim().toLowerCase()
  if (v === "non_item" || v === "nonitem") return "noise"
  return VALID_ROLES.has(v) ? (v as RowRole) : null
}

/**
 * Turns raw correction rows into a stable label→role map. A label is only
 * learned once it has been corrected the SAME way at least `minCount` times AND
 * that direction is the clear majority — so one accidental edit never poisons
 * the classifier.
 */
export function aggregateLearnedOverrides(
  rows: Array<{ ai_value?: string | null; corrected_value?: string | null }>,
  minCount = 2,
): LearnedOverrides {
  // normalizedLabel → role → count
  const tally = new Map<string, Map<RowRole, number>>()

  for (const r of rows) {
    const key  = normalizeLabel(r.ai_value)
    const role = toRole(String(r.corrected_value ?? ""))
    if (!key || !role) continue
    if (!tally.has(key)) tally.set(key, new Map())
    const inner = tally.get(key)!
    inner.set(role, (inner.get(role) ?? 0) + 1)
  }

  const out: LearnedOverrides = {}
  for (const [key, roleCounts] of tally) {
    let bestRole: RowRole | null = null
    let bestCount = 0
    let total = 0
    for (const [role, count] of roleCounts) {
      total += count
      if (count > bestCount) { bestCount = count; bestRole = role }
    }
    // Confident and dominant (> half of this label's corrections).
    if (bestRole && bestCount >= minCount && bestCount * 2 > total) {
      out[key] = bestRole
    }
  }
  return out
}

// ── Persistence (thin Supabase wrappers) ──────────────────────────────────────

/** Reads the org's row-role corrections and folds them into learned overrides. */
export async function fetchLearnedRowOverrides(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<LearnedOverrides> {
  try {
    const { data, error } = await supabase
      .from("receipt_corrections")
      .select("ai_value, corrected_value")
      .eq("organization_id", organizationId)
      .eq("field_name", ROW_ROLE_FIELD)
      .order("created_at", { ascending: false })
      .limit(2000)
    if (error || !data) return {}
    return aggregateLearnedOverrides(data)
  } catch {
    return {}   // learning is best-effort — never block extraction
  }
}

/** Persists row-role corrections (fire-and-forget; never throws). */
export async function recordRowRoleCorrections(
  supabase: SupabaseClient,
  organizationId: string,
  documentId: string,
  corrections: RowRoleCorrection[],
  ctx: { vendorName?: string | null; docCategory?: string | null; correctedBy?: string | null } = {},
): Promise<void> {
  if (!corrections.length) return
  try {
    await supabase.from("receipt_corrections").insert(
      corrections.map(c => ({
        organization_id: organizationId,
        document_id:     documentId,
        field_name:      c.field_name,
        ai_value:        c.ai_value,
        corrected_value: c.corrected_value,
        vendor_name:     ctx.vendorName ?? null,
        doc_category:    ctx.docCategory ?? null,
        corrected_by:    ctx.correctedBy ?? null,
      })),
    )
  } catch { /* best-effort */ }
}
