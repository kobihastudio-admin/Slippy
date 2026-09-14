/**
 * One-time backfill: sets vendors.match_key for existing rows using the SAME
 * canonicalMerchantKey() the runtime upsert uses, so historical vendors match
 * new documents from the same store. Run once after applying migration 079:
 *
 *     npm run backfill:vendor-keys
 *
 * Idempotent — re-running only rewrites keys, never touches stats. Prints how
 * many rows would collapse (duplicates now sharing a key) for review before you
 * decide whether to run the optional merge in the migration.
 */
import { createClient } from "../lib/supabase"
import { canonicalMerchantKey } from "../pipeline/merchant-key"

async function main() {
  const supabase = createClient()
  const { data, error } = await supabase
    .from("vendors")
    .select("id, organization_id, name, tax_id, match_key")
  if (error) { console.error("fetch failed:", error.message); process.exit(1) }

  const rows = data ?? []
  let updated = 0
  for (const v of rows) {
    const key = canonicalMerchantKey({ name: v.name, taxId: v.tax_id }) || null
    if (key !== v.match_key) {
      const { error: upErr } = await supabase.from("vendors").update({ match_key: key }).eq("id", v.id)
      if (upErr) console.warn(`  ! ${v.id}: ${upErr.message}`)
      else updated++
    }
  }

  // Report would-be duplicates (same org + key) so the merge decision is informed.
  const seen = new Map<string, number>()
  for (const v of rows) {
    const key = canonicalMerchantKey({ name: v.name, taxId: v.tax_id })
    if (!key) continue
    const k = `${v.organization_id}::${key}`
    seen.set(k, (seen.get(k) ?? 0) + 1)
  }
  const collapsing = [...seen.values()].filter(n => n > 1).reduce((s, n) => s + (n - 1), 0)

  console.log(`\n✅ backfilled ${updated}/${rows.length} vendor keys`)
  console.log(`   ${collapsing} row(s) now share a key with another → candidates for the optional merge\n`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
