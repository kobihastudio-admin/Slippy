/**
 * medical_providers — hospitals/clinics/pharmacies a user's medications
 * are tied to, kept as a real reference table (not free text) so medication
 * history stays searchable by source. Same table iOS's ProviderPickerView
 * reads/writes via HealthViewModel.loadProviders/addProvider.
 */
import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// GET — list this user's providers
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data, error } = await supabase.from("medical_providers")
    .select("id, name, type, hn, created_at")
    .eq("user_id", user.id)
    .order("name")

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ providers: data ?? [] })
}

// POST — create a provider (hospital/clinic/pharmacy)
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json() as { name: string; type: "hospital" | "clinic" | "pharmacy"; hn?: string }
  if (!body.name?.trim()) return NextResponse.json({ error: "กรอกชื่อโรงพยาบาล/ร้านยา" }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin.from("medical_providers").insert({
    user_id: user.id,
    name:    body.name.trim(),
    type:    body.type ?? "hospital",
    // HN is hospital-specific — matches the iOS picker's own gating.
    hn:      body.type === "hospital" ? (body.hn?.trim() || null) : null,
  }).select("id, name, type, hn, created_at").single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ provider: data })
}
