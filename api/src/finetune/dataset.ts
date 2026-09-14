/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 *
 * Corpus builder — the one impure module, kept deliberately thin.
 *
 * Every decision worth arguing about (admission, redaction, splitting,
 * fingerprinting) lives in a pure module with tests. This file only reads rows
 * and calls them in order, so the parts that can be wrong are the parts that
 * can be verified.
 */
import { createClient } from "../lib/supabase"
import { admit, summarise, type Candidate, type Verdict } from "./quality-gate"
import { redactTarget } from "./redact"
import { assignSplit, merchantKey, auditLeakage } from "./split"
import { buildManifest, readiness, type DatasetManifest } from "./manifest"
import { encodeTarget, validateExample, type TrainingExample } from "./schema"

/** Instruction shown with every example. Frozen — changing it changes the task. */
const TASK_PROMPT =
  "Extract the fields from this Thai receipt. Return JSON with vendor_name, " +
  "vendor_tax_id, doc_number, doc_date, subtotal, vat_amount, total_amount, " +
  "and line_items (description and amount, in printed order). Use null for " +
  "any field the receipt does not show."

export interface BuildResult {
  examples: TrainingExample[]
  manifest: DatasetManifest
  rejections: ReturnType<typeof summarise>
  /** Structural problems found after building. Non-empty means do not ship. */
  problems: string[]
}

interface GroundTruthRow {
  document_id: string
  vendor_name: string | null
  vendor_tax_id: string | null
  doc_number: string | null
  doc_date: string | null
  subtotal: number | null
  vat_amount: number | null
  total_amount: number | null
  line_items: Array<{ description: string; amount: number }> | null
  source_width: number
  source_height: number
  verified_by: string
  verified_at: string
  documents: { status: string; file_path: string } | null
}

/**
 * Builds the corpus for one organisation.
 *
 * `imageRoot` is prepended to each document's storage path to produce the
 * absolute `image_path` in the output — the corpus records where the images
 * are, and never copies or embeds them.
 */
export async function buildDataset(organizationId: string, imageRoot: string): Promise<BuildResult> {
  const supabase = createClient()

  // Newest verification per document wins; the older row stays in the table as
  // the audit trail rather than being deleted.
  const { data, error } = await supabase
    .from("document_ground_truth")
    .select("document_id,vendor_name,vendor_tax_id,doc_number,doc_date,subtotal,vat_amount," +
            "total_amount,line_items,source_width,source_height,verified_by,verified_at," +
            "documents(status,file_path)")
    .eq("organization_id", organizationId)
    .order("verified_at", { ascending: false })

  if (error) throw new Error(`ground truth query failed: ${error.message}`)

  const seenDocuments = new Set<string>()
  const rows = ((data ?? []) as unknown as GroundTruthRow[]).filter(r => {
    if (seenDocuments.has(r.document_id)) return false
    seenDocuments.add(r.document_id)
    return true
  })

  const seenHashes = new Set<string>()
  const verdicts: Verdict[] = []
  const examples: TrainingExample[] = []

  for (const row of rows) {
    const candidate: Candidate = {
      id: row.document_id,
      status: row.documents?.status ?? "unknown",
      verified_by: row.verified_by,
      source_width: row.source_width,
      source_height: row.source_height,
      vendor_name: row.vendor_name,
      vendor_tax_id: row.vendor_tax_id,
      doc_number: row.doc_number,
      doc_date: row.doc_date,
      subtotal: row.subtotal,
      vat_amount: row.vat_amount,
      total_amount: row.total_amount,
      line_items: row.line_items ?? [],
    }

    const verdict = admit(candidate, seenHashes)
    verdicts.push(verdict)
    if (!verdict.admitted) continue

    const { fields, redactedFields } = redactTarget({
      vendor_name: candidate.vendor_name,
      line_items: candidate.line_items,
    })
    const key = merchantKey(candidate)

    examples.push({
      id: candidate.id,
      split: assignSplit(key),
      merchant_key: key,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", image_path: `${imageRoot.replace(/\/$/, "")}/${row.documents?.file_path ?? ""}` },
            { type: "text", text: TASK_PROMPT },
          ],
        },
        {
          role: "assistant",
          content: encodeTarget({
            vendor_name:   fields.vendor_name,
            vendor_tax_id: candidate.vendor_tax_id,
            doc_number:    candidate.doc_number,
            doc_date:      candidate.doc_date,
            subtotal:      candidate.subtotal,
            vat_amount:    candidate.vat_amount,
            total_amount:  candidate.total_amount,
            line_items:    fields.line_items,
          }),
        },
      ],
      metadata: {
        verified_by: row.verified_by,
        verified_at: row.verified_at,
        source_width: row.source_width,
        source_height: row.source_height,
        redacted_fields: redactedFields,
      },
    })
  }

  // Post-build audit. `assignSplit` cannot leak on its own, but this corpus can
  // also be merged, hand-edited, or built while the key derivation was being
  // changed — so the property is checked on the finished artifact rather than
  // assumed from the function that was supposed to guarantee it.
  const problems: string[] = []
  const leak = auditLeakage(examples)
  if (leak.leaked) {
    problems.push(`merchant leakage across splits: ${leak.offenders.map(o => o.merchant_key).join(", ")}`)
  }
  for (const ex of examples) {
    for (const issue of validateExample(ex)) {
      problems.push(`${ex.id}: ${issue.field} — ${issue.reason}`)
    }
  }

  const manifest = buildManifest(examples)
  problems.push(...readiness(manifest).warnings)

  return { examples, manifest, rejections: summarise(verdicts), problems }
}

/** JSONL, one example per line — the format every training stack reads. */
export function toJsonl(examples: TrainingExample[]): string {
  return examples.map(ex => JSON.stringify(ex)).join("\n") + "\n"
}
