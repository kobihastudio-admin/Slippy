import { createHash, randomBytes } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => ({})) as { expiresAt?: string; maxUses?: number }
  const expiresAt = body.expiresAt ?? null
  if (expiresAt && Number.isNaN(Date.parse(expiresAt))) return NextResponse.json({ error: "expiresAt is invalid" }, { status: 400 })
  if (body.maxUses != null && (!Number.isInteger(body.maxUses) || body.maxUses < 1)) {
    return NextResponse.json({ error: "maxUses must be a positive integer" }, { status: 400 })
  }

  const { data: activity } = await supabase.from("activities").select("id").eq("id", id).eq("owner_id", user.id).maybeSingle()
  if (!activity) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const token = randomBytes(32).toString("base64url")
  const tokenHash = createHash("sha256").update(token).digest("hex")
  const { data: link, error } = await supabase.from("activity_registration_links").insert({
    activity_id: id,
    token_hash: tokenHash,
    expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
    max_uses: body.maxUses ?? null,
    created_by: user.id,
  }).select("expires_at, max_uses").single()
  if (error || !link) return NextResponse.json({ error: "Unable to create registration link" }, { status: 500 })
  return NextResponse.json({
    url: new URL(`/join/${token}`, req.nextUrl.origin).toString(),
    expiresAt: link.expires_at,
    maxUses: link.max_uses,
  }, { status: 201 })
}
