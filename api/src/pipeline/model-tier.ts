/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 *
 * Plan → model tier routing.
 *
 * Pulled out of the pipeline so it can be tested without a database, because
 * the way this failed was invisible from the inside: the pipeline asked
 * `organizations` for a `plan_id` column that does not exist, PostgREST
 * returned an error instead of a row, and the lookup fell through to the
 * free-plan default. Every organisation on every plan was routed to the
 * cheapest model for as long as that code existed, and nothing logged a word
 * about it — a business-plan org was reading receipts on Haiku.
 *
 * The plan ids are the ones in `web/src/lib/plans.ts`. Keep them in sync.
 */

export type ModelTier = "haiku" | "smart" | "priority"

export const PLAN_MODEL_TIER: Record<string, ModelTier> = {
  free:       "haiku",
  starter:    "haiku",
  pro:        "smart",
  team:       "smart",
  premium:    "priority",
  business:   "priority",
  enterprise: "priority",
}

/**
 * An unknown or missing plan resolves to "smart", not to "haiku".
 *
 * The default is the answer to "we could not find out what this customer is
 * paying for", and that is not a reason to give them the weakest reader. Only
 * a plan we positively recognise as free/starter earns the cheap tier.
 */
export function getModelTier(plan: string | null | undefined): ModelTier {
  if (!plan) return "smart"
  return PLAN_MODEL_TIER[plan] ?? "smart"
}
