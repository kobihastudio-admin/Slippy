/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 *
 * Train/validation/test assignment.
 *
 * This is the single decision that determines whether the eval numbers mean
 * anything, and the obvious implementation is the wrong one.
 *
 * Splitting by DOCUMENT leaks. Receipts arrive in merchant clusters — 29 of
 * this org's documents are from a handful of shops — so a random per-document
 * split puts 7-Eleven receipts in both train and test. The model then scores
 * well on test by having memorised that shop's vocabulary, tax id, and layout,
 * which is exactly the thing we are trying to measure it NOT doing. The number
 * goes up, the product does not improve, and nothing in the pipeline says so.
 *
 * So the split is by MERCHANT: every document from one shop lands in one split.
 * Test accuracy then answers the question that matters — how well does this
 * read a shop it has never seen?
 */
import { createHash } from "node:crypto"

export type Split = "train" | "validation" | "test"

/**
 * Bucket boundaries out of 100. Train is deliberately the remainder rather than
 * a third boundary, so the three always sum to exactly 100.
 */
const TRAIN_PCT = 70
const VALIDATION_PCT = 15   // test gets the rest

/**
 * Deterministic 0–99 bucket for a key.
 *
 * Hash-based rather than shuffle-based on purpose: a shuffle re-partitions the
 * whole corpus every time a document is added, which silently moves merchants
 * across the train/test boundary between runs. Two evals a week apart would
 * then differ for a reason that has nothing to do with the pipeline, and the
 * held-out set would quietly stop being held out. Hashing pins each merchant to
 * one bucket for the life of the corpus, so the set only ever grows.
 */
export function bucketOf(key: string): number {
  const digest = createHash("sha256").update(key, "utf8").digest()
  return digest.readUInt32BE(0) % 100
}

/**
 * Normalises a merchant identity so the same shop hashes to one bucket.
 *
 * Tax id wins when present — it is the only exact, deterministic merchant
 * identity on a Thai receipt, and it survives the OCR misreads that make the
 * printed name unreliable ("ไฟแรงได้รุ่ง" and "ไฟแรงโต้รุ่ง" are one shop).
 * Falling back to the name is a compromise, which is why case and whitespace
 * are folded before hashing.
 */
export function merchantKey(
  doc: { vendor_tax_id?: string | null; vendor_name?: string | null },
): string | null {
  const taxId = (doc.vendor_tax_id ?? "").replace(/\D/g, "")
  if (taxId.length === 13) return `tax:${taxId}`
  const name = (doc.vendor_name ?? "").trim().toLowerCase().replace(/\s+/g, " ")
  return name ? `name:${name}` : null
}

/**
 * Assigns one document to a split.
 *
 * A document whose merchant cannot be identified goes to TRAIN, always. It
 * cannot be proven not to share a shop with something in test, and an
 * unprovable non-overlap in the held-out set is the same failure as a known
 * one — you just don't find out. Costing the test set a few documents is the
 * cheap side of that trade.
 */
export function assignSplit(key: string | null): Split {
  if (!key) return "train"
  const bucket = bucketOf(key)
  if (bucket < TRAIN_PCT) return "train"
  if (bucket < TRAIN_PCT + VALIDATION_PCT) return "validation"
  return "test"
}

export interface LeakReport {
  leaked: boolean
  /** Merchant keys found in more than one split, with the splits they span. */
  offenders: Array<{ merchant_key: string; splits: Split[] }>
}

/**
 * Independent audit that no merchant spans two splits.
 *
 * `assignSplit` cannot produce a leak on its own — but a corpus can also be
 * hand-edited, merged from another export, or built while the key derivation
 * was being changed. This checks the property on the finished dataset rather
 * than trusting that the function that should have guaranteed it was the one
 * that actually ran.
 */
export function auditLeakage(
  examples: Array<{ merchant_key: string | null; split: Split }>,
): LeakReport {
  const seen = new Map<string, Set<Split>>()
  for (const ex of examples) {
    if (!ex.merchant_key) continue   // unknown-merchant docs are train-only by construction
    const splits = seen.get(ex.merchant_key) ?? new Set<Split>()
    splits.add(ex.split)
    seen.set(ex.merchant_key, splits)
  }

  const offenders = [...seen.entries()]
    .filter(([, splits]) => splits.size > 1)
    .map(([merchant_key, splits]) => ({ merchant_key, splits: [...splits].sort() }))

  return { leaked: offenders.length > 0, offenders }
}
