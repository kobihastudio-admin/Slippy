/**
 * The label photo a medication was scanned or added from — store & view
 * only, no re-extraction here (that's POST /api/medications/scan). See the
 * medication_label_images migration for why this exists: `image_url` sat
 * unused in the schema with no bucket and nothing writing to it.
 *
 * POST   — upload/replace the label image for this medication.
 * GET    — a short-lived signed URL to view it (private bucket).
 * DELETE — remove it.
 *
 * `image_url` holds a STORAGE PATH despite the name, not a public URL —
 * see the migration's own comment. Every read here resolves it through
 * createSignedUrl, the same pattern already used for the accounting
 * documents review page (documents/[id]/review/page.tsx).
 */
import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

const MAX_BYTES = 15 * 1024 * 1024
const EXT_TYPE: Record<string, string> = { pdf: "pdf", jpg: "jpg", jpeg: "jpg", png: "png", heic: "heic", webp: "webp" }

type Params = { params: Promise<{ id: string }> }

async function guard(medicationId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }

  const admin = createAdminClient()
  // A medication id alone is not authority — confirm it belongs to this
  // user before touching its label, same discipline as every other
  // per-row write in this codebase.
  const { data: med } = await admin.from("medications")
    .select("id, image_url").eq("id", medicationId).eq("user_id", user.id).single()
  if (!med) return { error: NextResponse.json({ error: "ไม่พบยานี้" }, { status: 404 }) }

  return { admin, userId: user.id, med }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const g = await guard(id)
  if ("error" in g) return g.error
  const { admin, userId, med } = g

  const form = await req.formData().catch(() => null)
  const file = form?.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "แนบไฟล์ด้วย" }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `ไฟล์ใหญ่เกินไป (${(file.size / 1024 / 1024).toFixed(1)} MB) — จำกัดที่ 15 MB` }, { status: 413 })
  }
  const ext = (file.name.split(".").pop() ?? "").toLowerCase()
  const fileType = EXT_TYPE[ext]
  if (!fileType) {
    return NextResponse.json({ error: "รองรับเฉพาะไฟล์ PDF, JPG, PNG, WEBP, HEIC" }, { status: 400 })
  }

  const path = `${userId}/${id}/${crypto.randomUUID()}.${fileType}`
  const bytes = Buffer.from(await file.arrayBuffer())
  const { error: upErr } = await admin.storage.from("medication-labels")
    .upload(path, bytes, { contentType: file.type || undefined })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  // Replacing an existing label — the old file is now unreferenced, clean
  // it up rather than leaving it as an orphan nobody can ever reach again.
  const oldPath = med.image_url
  const { error } = await admin.from("medications").update({ image_url: path }).eq("id", id)
  if (error) {
    await admin.storage.from("medication-labels").remove([path])
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (oldPath) await admin.storage.from("medication-labels").remove([oldPath])

  const { data: signed } = await admin.storage.from("medication-labels").createSignedUrl(path, 3600)
  return NextResponse.json({ url: signed?.signedUrl ?? null })
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  const g = await guard(id)
  if ("error" in g) return g.error
  const { admin, med } = g

  if (!med.image_url) return NextResponse.json({ url: null })
  const { data: signed, error } = await admin.storage.from("medication-labels")
    .createSignedUrl(med.image_url, 3600)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ url: signed.signedUrl })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params
  const g = await guard(id)
  if ("error" in g) return g.error
  const { admin, med } = g

  if (!med.image_url) return NextResponse.json({ ok: true })
  await admin.storage.from("medication-labels").remove([med.image_url])
  const { error } = await admin.from("medications").update({ image_url: null }).eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
