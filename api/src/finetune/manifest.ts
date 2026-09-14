/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 *
 * Dataset manifest — what makes a measurement reproducible.
 *
 * An accuracy number without a dataset identity is an anecdote. Six weeks from
 * now "CER went from 0.18 to 0.11" is only meaningful if you can prove both
 * numbers came from the same held-out set, and a corpus rebuilt from a live
 * database is not the same corpus twice. The fingerprint below is the thing you
 * record next to the number.
 */
import { createHash } from "node:crypto"
import { DATASET_SCHEMA_VERSION, type TrainingExample } from "./schema"

export interface DatasetManifest {
  schema_version: number
  /** Stable across rebuilds of identical content, different the moment anything changes. */
  fingerprint: string
  counts: { train: number; validation: number; test: number; total: number }
  /** Distinct merchants per split — the number that shows whether test is actually diverse. */
  merchants: { train: number; validation: number; test: number }
  /** Wall-clock build time. Deliberately NOT part of the fingerprint. */
  generated_at: string
}

/**
 * Content fingerprint of a corpus.
 *
 * Sorted by id and hashed over (id, split, target) triples so the value depends
 * on the dataset's content and nothing else — not the order rows came back from
 * the database, not when the build ran, not which machine ran it. Two builds
 * that produce the same fingerprint are the same experiment; two that don't,
 * aren't, and any comparison across them is invalid.
 */
export function fingerprint(examples: TrainingExample[]): string {
  const hash = createHash("sha256")
  hash.update(`v${DATASET_SCHEMA_VERSION}\n`)
  const rows = examples
    .map(ex => `${ex.id}\t${ex.split}\t${ex.messages[1].content}`)
    .sort()
  for (const row of rows) hash.update(row + "\n")
  return hash.digest("hex")
}

export function buildManifest(examples: TrainingExample[], now = new Date()): DatasetManifest {
  const bySplit = (s: TrainingExample["split"]) => examples.filter(e => e.split === s)
  const merchantsIn = (s: TrainingExample["split"]) =>
    new Set(bySplit(s).map(e => e.merchant_key).filter(Boolean)).size

  return {
    schema_version: DATASET_SCHEMA_VERSION,
    fingerprint: fingerprint(examples),
    counts: {
      train:      bySplit("train").length,
      validation: bySplit("validation").length,
      test:       bySplit("test").length,
      total:      examples.length,
    },
    merchants: {
      train:      merchantsIn("train"),
      validation: merchantsIn("validation"),
      test:       merchantsIn("test"),
    },
    generated_at: now.toISOString(),
  }
}

/**
 * Whether a corpus is big enough for its numbers to mean anything.
 *
 * This exists because the failure it prevents is the likeliest one here. This
 * org has 60 documents and 2 with any human feedback: a "test set" of three
 * receipts from one shop will happily report 100% accuracy and tell you
 * nothing. Reporting a number from a corpus that thin is worse than reporting
 * none, because a number gets believed.
 */
export function readiness(m: DatasetManifest): { ready: boolean; warnings: string[] } {
  const warnings: string[] = []
  if (m.counts.test < 30) {
    warnings.push(`test set has ${m.counts.test} examples — under 30, a single document moves the metric by >3%`)
  }
  if (m.merchants.test < 5) {
    warnings.push(`test set covers ${m.merchants.test} merchant(s) — too few to distinguish reading a receipt from recognising a shop`)
  }
  if (m.counts.train < 100) {
    warnings.push(`train set has ${m.counts.train} examples — enough to evaluate with, not enough to train on`)
  }
  return { ready: warnings.length === 0, warnings }
}
