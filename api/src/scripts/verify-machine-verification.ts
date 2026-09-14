import assert from "node:assert/strict"
import { classifyMachineVerification, type ReconciliationSummary } from "../pipeline/validator"

const reconciliation = (status: ReconciliationSummary["status"]): ReconciliationSummary => ({
  status,
  total: { checked: status !== "not_checked", balanced: status === "not_checked" ? null : status === "balanced" },
  line_items: { checked: false, balanced: null },
})

assert.equal(classifyMachineVerification(true, 0.92, reconciliation("balanced"), []), "verified")
assert.equal(classifyMachineVerification(true, 0.84, reconciliation("balanced"), []), "needs_review")
assert.equal(classifyMachineVerification(true, 0.99, reconciliation("mismatch"), []), "needs_review")
assert.equal(classifyMachineVerification(false, 0.99, reconciliation("balanced"), []), "unverified")
assert.equal(classifyMachineVerification(true, 0.99, reconciliation("balanced"), [
  { code: "DUPLICATE", message: "duplicate" },
]), "needs_review")

console.log("✓ machine verification classification: 5 cases passed")
