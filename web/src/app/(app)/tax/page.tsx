/**
 * Tax Page — แสดงตาม account_type ขององค์กร/profile ที่เลือกอยู่
 * business  → ภาษีองค์กร: VAT (ภ.พ.30) + WHT (ภ.ง.ด.3/53)
 * personal  → ภาษีส่วนบุคคล: ภ.ง.ด.90/91 income tax calculator
 */
import { getMembership } from "@/lib/get-membership"
import { createClient }  from "@/lib/supabase/server"
import { TaxPageClient } from "@/components/tax/tax-page-client"
import { PersonalTaxClient } from "@/components/tax/personal-tax-client"

export const metadata = { title: "ภาษี · Slippy" }

export default async function TaxPage() {
  const supabase = await createClient()
  const { organization_id: orgId } = await getMembership()

  // Get the account type of the currently active org/profile
  const { data: org } = await supabase
    .from("organizations")
    .select("account_type, name")
    .eq("id", orgId)
    .single()

  const accountType = (org?.account_type ?? "business") as "business" | "personal"

  // Org tax — no extra data needed (fetched client-side)
  if (accountType === "business") {
    return (
      <div className="page-wide">
        <TaxPageClient orgId={orgId} />
      </div>
    )
  }

  // Personal tax — fetch this year's docs for the calculator
  const year = new Date().getFullYear()
  const { data: docs } = await supabase
    .from("documents")
    .select("id, vendor_name, total_amount, vat_amount, doc_date, category, status")
    .eq("organization_id", orgId)
    .gte("doc_date", `${year}-01-01`)
    .lte("doc_date", `${year}-12-31`)
    .not("status", "in", "(failed,rejected,pending,processing)")
    .order("doc_date", { ascending: false })

  return (
    <div className="p-6 lg:p-7 max-w-[1200px]">
      <PersonalTaxClient
        userId=""
        year={year}
        docs={docs ?? []}
      />
    </div>
  )
}
