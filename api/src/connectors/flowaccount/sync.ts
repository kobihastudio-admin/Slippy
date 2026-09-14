import { supabase } from "../../lib/supabase"

const BASE = "https://openapi.flowaccount.com/v1"

function headers(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Accept-Language": "th",
  }
}

export async function syncFlowAccountData(integrationId: string, apiKey: string) {
  const h = headers(apiKey)

  // Sync accounts
  const accRes = await fetch(`${BASE}/chart-of-accounts?accountType=expense`, { headers: h })
  if (accRes.ok) {
    const { data: accounts } = await accRes.json() as { data?: any[] }
    if (accounts?.length) {
      await supabase.from("integration_accounts").upsert(
        accounts.map((a: any) => ({
          integration_id: integrationId,
          external_code:  a.code,
          name:           a.name,
          account_type:   a.type,
          synced_at:      new Date().toISOString(),
        })),
        { onConflict: "integration_id,external_code" }
      )
    }
  }

  // Sync contacts (vendors)
  const conRes = await fetch(`${BASE}/contacts?type=vendor&limit=500`, { headers: h })
  if (conRes.ok) {
    const { data: contacts } = await conRes.json() as { data?: any[] }
    if (contacts?.length) {
      await supabase.from("integration_contacts").upsert(
        contacts.map((c: any) => ({
          integration_id: integrationId,
          external_id:    c.code,
          name:           c.name,
          tax_id:         c.taxId,
          contact_type:   "vendor",
          synced_at:      new Date().toISOString(),
        })),
        { onConflict: "integration_id,external_id" }
      )
    }
  }

  await supabase
    .from("integrations")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", integrationId)
}
