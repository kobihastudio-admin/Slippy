import test from "node:test"
import assert from "node:assert/strict"

import {
  activityCategory,
  expenseCategory,
  itineraryTypeCategory,
  medicationCategory,
  tripTypeCategory,
} from "./activity-taxonomy.ts"

test("every public activity category has labels and native icon fallbacks", () => {
  for (const key of [
    "transport", "place", "stay", "food", "sightseeing", "nature",
    "shopping", "reservation", "document", "money", "people", "safety",
    "memory", "health", "general",
  ]) {
    const category = activityCategory(key)
    assert.equal(category.key, key)
    assert.ok(category.labelTh)
    assert.ok(category.labelEn)
    assert.ok(category.icon)
    assert.ok(category.sfSymbol)
  }
})

test("unknown values use the safe general category", () => {
  assert.equal(activityCategory("legacy-value").key, "general")
  assert.equal(tripTypeCategory("travel").key, "transport")
  assert.equal(medicationCategory().key, "health")
})

test("trip, itinerary, and expense mappings are deterministic", () => {
  assert.equal(tripTypeCategory("food_order").key, "food")
  assert.equal(tripTypeCategory("sport").key, "sightseeing")
  assert.equal(itineraryTypeCategory("hotel").key, "stay")
  assert.equal(itineraryTypeCategory("train").key, "transport")
  assert.equal(expenseCategory("transport").key, "money")
  assert.equal(expenseCategory("unrecognised").key, "money")
})
