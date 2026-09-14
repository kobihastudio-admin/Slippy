# Travel and Health Activity Taxonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one tested category and icon contract power trip, activity, expense, document, and medication presentation on Web and native iOS.

**Architecture:** A pure TypeScript taxonomy module provides category metadata and legacy-data mapping for Web. A matching pure Swift model provides the same category identifiers and SF Symbols for native iOS. UI surfaces consume these display helpers; database records, APIs, RLS, and medical privacy rules are unchanged.

**Tech Stack:** Next.js 15, TypeScript, Lucide React, Node test runner, SwiftUI, XCTest-compatible pure Swift models.

**Spec:** `docs/superpowers/specs/2026-09-03-travel-health-activity-taxonomy-design.md`

## Global Constraints

- Do not alter, delete, or backfill real trip, medication, document, expense, or reminder data.
- Category fallbacks must be `general`; unknown legacy values must render safely.
- Medication remains private and must not become a trip/crew resource.
- Google Maps remains the embedded web map; Apple Maps remains an external helper action.
- Preserve existing URLs and API payloads.

---

### Task 1: Define and test the Web taxonomy

**Files:**
- Create: `web/src/lib/activity-taxonomy.test.mjs`
- Create: `web/src/lib/activity-taxonomy.ts`

**Interfaces:**
- Produces `ActivityCategory`, `activityCategory`, `tripTypeCategory`, `itineraryTypeCategory`, `expenseCategory`, and `medicationCategory`.

- [ ] **Step 1: Write the failing mapping test**

```js
import test from "node:test"
import assert from "node:assert/strict"
import { activityCategory, tripTypeCategory, medicationCategory } from "./activity-taxonomy.ts"

test("unknown values use the safe general category", () => {
  assert.equal(activityCategory("legacy" ).key, "general")
  assert.equal(tripTypeCategory("travel").key, "transport")
  assert.equal(medicationCategory().key, "health")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && node --experimental-strip-types --test src/lib/activity-taxonomy.test.mjs`

Expected: FAIL because `activity-taxonomy.ts` does not exist.

- [ ] **Step 3: Implement the pure category contract**

```ts
export const activityCategory = (key?: string | null) =>
  CATEGORY_BY_KEY[key ?? ""] ?? CATEGORY_BY_KEY.general

export const tripTypeCategory = (type?: string | null) =>
  activityCategory(TRIP_TYPE_TO_CATEGORY[type ?? ""])

export const medicationCategory = () => activityCategory("health")
```

Define all categories in the approved spec with Thai/English labels, Lucide
icon export, theme tone, and SF Symbol name.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && node --experimental-strip-types --test src/lib/activity-taxonomy.test.mjs`

Expected: PASS.

### Task 2: Adopt the taxonomy on Web trip and medication surfaces

**Files:**
- Modify: `web/src/components/trips/trips-client.tsx`
- Modify: `web/src/components/health/medications-client.tsx`
- Test: `web/src/lib/activity-taxonomy.test.mjs`

**Interfaces:**
- Consumes `tripTypeCategory` and `medicationCategory` from Task 1.
- Produces category-consistent picker, card, and health section display.

- [ ] **Step 1: Extend the failing test with legacy trip and expense cases**

```js
test("trip, itinerary, and expense mappings are deterministic", () => {
  assert.equal(tripTypeCategory("food_order").key, "food")
  assert.equal(itineraryTypeCategory("hotel").key, "stay")
  assert.equal(expenseCategory("transport").key, "money")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && node --experimental-strip-types --test src/lib/activity-taxonomy.test.mjs`

Expected: FAIL because itinerary and expense mapping exports are absent.

- [ ] **Step 3: Replace local trip icon/tone ownership with taxonomy lookups**

Use taxonomy category metadata in the create picker, filters, and trip cards.
Retain the current user-facing trip-type labels and API values. Use the
`health` metadata in the medication heading/actions rather than introducing a
trip reference or sharing behaviour.

- [ ] **Step 4: Run Web taxonomy and medication regression tests**

Run: `cd web && node --experimental-strip-types --test src/lib/activity-taxonomy.test.mjs src/lib/medications.test.mjs`

Expected: PASS.

### Task 3: Define matching native iOS taxonomy and use it in Journey style

**Files:**
- Create: `ios/Slippy/Models/ActivityTaxonomy.swift`
- Modify: `ios/Slippy/Models/JourneyStyle.swift`
- Modify: `ios/Slippy/Views/Health/HealthView.swift`

**Interfaces:**
- Consumes the canonical keys in the approved spec.
- Produces `ActivityCategoryStyle.forKey(_:)` and `JourneyStyle.spec(_:)` backed by matching symbol/tone metadata.

- [ ] **Step 1: Add XCTest-equivalent invariant checks in the pure model preview/test target if available**

```swift
assert(ActivityCategoryStyle.forKey("legacy").key == "general")
assert(ActivityCategoryStyle.medication.key == "health")
```

- [ ] **Step 2: Verify the current iOS build succeeds before the change**

Run: `cd ios && xcodegen generate && ./scripts/build-simulator.sh`

Expected: PASS.

- [ ] **Step 3: Implement `ActivityCategoryStyle` and delegate JourneyStyle to it**

```swift
static func forKey(_ raw: String?) -> ActivityCategoryStyle {
    byKey[raw ?? ""] ?? general
}

static let medication = forKey("health")
```

Keep SF Symbols native. Apply the health category title/icon to medication
navigation; do not expose medication data through a trip screen.

- [ ] **Step 4: Build the iOS simulator target**

Run: `cd ios && xcodegen generate && ./scripts/build-simulator.sh`

Expected: PASS.

### Task 4: Verify and deliver without generated artifacts

**Files:**
- Modify: documentation only if implementation differs from this plan.

- [ ] **Step 1: Run full relevant Web regression and production checks**

Run: `npm run typecheck --workspace=web && npm run build --workspace=web`

Expected: both commands exit 0.

- [ ] **Step 2: Run production safety regression tests**

Run: `cd web && node --experimental-strip-types --test src/lib/demo/demo-access.test.mjs src/lib/medications.test.mjs src/lib/trips/apple-maps-links.test.mjs src/lib/profile/profile-sections.test.mjs`

Expected: PASS.

- [ ] **Step 3: Review working tree and commit only source, tests, and docs**

Run: `git status --short`

Expected: generated `web/tsconfig.tsbuildinfo` remains unstaged.

- [ ] **Step 4: Commit the implementation**

```bash
git add docs/superpowers/specs/2026-09-03-travel-health-activity-taxonomy-design.md \
  docs/superpowers/plans/2026-09-03-travel-health-activity-taxonomy.md \
  web/src/lib/activity-taxonomy.ts web/src/lib/activity-taxonomy.test.mjs \
  web/src/components/trips/trips-client.tsx web/src/components/health/medications-client.tsx \
  ios/Slippy/Models/ActivityTaxonomy.swift ios/Slippy/Models/JourneyStyle.swift \
  ios/Slippy/Views/Health/HealthView.swift
git commit -m "feat: unify travel and health activity taxonomy"
```

## Self-review

- The plan covers every category in the approved taxonomy and gives unknown data a safe fallback.
- No task writes migration SQL or changes health sharing policy.
- Web and iOS use equivalent category identifiers while retaining platform-native icons.
- The plan excludes generated build artifacts and preserves existing trip/medication tests.
