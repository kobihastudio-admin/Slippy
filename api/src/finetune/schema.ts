/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 *
 * Training-example schema — the contract for the whole pipeline.
 *
 * There is no fine-tuning API for Claude, so nothing here trains a Claude
 * model. What this produces is the artifact every downstream option needs and
 * none of them can substitute for: a curated, split, verified corpus of
 * (receipt image → correct fields) pairs. Feed it to an open-weights fine-tune,
 * a distillation run, a relevance-ranked few-shot index, or — most immediately
 * — the evaluation harness that finally makes "did accuracy improve?" a
 * question with an answer.
 *
 * The format is the standard chat-JSONL shape every training stack reads, so
 * the corpus is portable rather than married to whatever we do with it first.
 */

/** Bumped whenever the emitted record shape changes. Recorded in the manifest. */
export const DATASET_SCHEMA_VERSION = 1

/**
 * The fields a receipt extraction is graded on.
 *
 * Deliberately narrower than the `documents` table: only fields a human can
 * verify by looking at the paper. Derived classifications (`doc_category`,
 * `vat_claimable`) are the model's judgement, not ground truth, and grading
 * against them would be grading the model against itself.
 */
export interface ExtractedFields {
  vendor_name:   string | null
  vendor_tax_id: string | null
  doc_number:    string | null
  doc_date:      string | null
  subtotal:      number | null
  vat_amount:    number | null
  total_amount:  number | null
  line_items:    Array<{ description: string; amount: number }>
}

export type DatasetSplit = "train" | "validation" | "test"

/** One graded example. `messages` is the training payload; the rest is provenance. */
export interface TrainingExample {
  /** The source document. Stable across rebuilds — the join key back to production. */
  id: string
  split: DatasetSplit
  /**
   * Merchant identity, normalised. The split is computed from THIS, never from
   * `id` — see split.ts for why that distinction decides whether the eval
   * numbers mean anything.
   */
  merchant_key: string | null
  messages: [
    { role: "user";      content: Array<{ type: "image"; image_path: string } | { type: "text"; text: string }> },
    { role: "assistant"; content: string },
  ]
  metadata: {
    /** Who verified the fields, and when — an example is only as good as its provenance. */
    verified_by: string
    verified_at: string
    source_width:  number
    source_height: number
    /** Set when redaction rewrote the target. Recorded so a reviewer can tell. */
    redacted_fields: string[]
  }
}

export interface ValidationIssue {
  field:  string
  reason: string
}

/**
 * Structural validation of one record.
 *
 * Runs at export time, not import time. A malformed record that reaches a
 * training run costs a full run to discover; a malformed record caught here
 * costs a line of output. The check is deliberately picky about the things
 * that fail silently downstream — an empty assistant turn still trains, it
 * just trains the model to say nothing.
 */
export function validateExample(ex: TrainingExample | null | undefined): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!ex) return [{ field: "record", reason: "record is null" }]

  if (!ex.id?.trim())               issues.push({ field: "id", reason: "missing document id" })
  if (!["train", "validation", "test"].includes(ex.split)) {
    issues.push({ field: "split", reason: `unknown split "${ex.split}"` })
  }

  const [user, assistant] = ex.messages ?? []
  if (!user || user.role !== "user") {
    issues.push({ field: "messages", reason: "first message must be the user turn" })
  } else {
    const images = user.content?.filter(c => c.type === "image") ?? []
    if (images.length !== 1) {
      issues.push({ field: "messages[0]", reason: `expected exactly 1 image, found ${images.length}` })
    }
    // A relative or empty path resolves differently on every machine that reads
    // the corpus, which turns a portable dataset into one that only works here.
    for (const img of images) {
      if (!("image_path" in img) || !img.image_path?.startsWith("/")) {
        issues.push({ field: "messages[0].image", reason: "image_path must be absolute" })
      }
    }
  }

  if (!assistant || assistant.role !== "assistant") {
    issues.push({ field: "messages", reason: "second message must be the assistant turn" })
  } else if (!assistant.content?.trim()) {
    // Trains the model to answer with nothing. Silent, and the loss curve looks fine.
    issues.push({ field: "messages[1]", reason: "assistant turn is empty" })
  } else {
    try {
      JSON.parse(assistant.content)
    } catch {
      issues.push({ field: "messages[1]", reason: "assistant turn is not valid JSON" })
    }
  }

  if (!ex.metadata?.verified_by?.trim()) {
    // An unattributed example cannot be audited or retracted later.
    issues.push({ field: "metadata.verified_by", reason: "example has no verifier" })
  }

  return issues
}

/** Serialises the target fields as the assistant turn. Stable key order — see manifest.ts. */
export function encodeTarget(fields: ExtractedFields): string {
  return JSON.stringify({
    vendor_name:   fields.vendor_name,
    vendor_tax_id: fields.vendor_tax_id,
    doc_number:    fields.doc_number,
    doc_date:      fields.doc_date,
    subtotal:      fields.subtotal,
    vat_amount:    fields.vat_amount,
    total_amount:  fields.total_amount,
    line_items:    fields.line_items.map(i => ({ description: i.description, amount: i.amount })),
  })
}
