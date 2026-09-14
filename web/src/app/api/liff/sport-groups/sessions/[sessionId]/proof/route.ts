import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { loadSessionDetail } from "../../../_lib"
import { getVerifiedLineUserId, liffUnauthorized } from "@/lib/liff-auth"
import { validateImageUpload } from "@/lib/validate-upload"

const BUCKET = "payment-proofs"
const MAX_FILE_SIZE = 5 * 1024 * 1024 // matches the bucket's own limit (migration 043)

// POST /api/liff/sport-groups/sessions/[sessionId]/proof — multipart/form-data
// fields: lineUserId, file (image). Uploads the slip/screenshot to the
// payment-proofs bucket. Does NOT mark as paid — the group creator must
// review the slip and approve it (action: "approvePayment") first.
export async function POST(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const form = await req.formData()
  const claimedLineUserId = form.get("lineUserId") as string | null
  const lineUserId = getVerifiedLineUserId(req, claimedLineUserId)
  const file       = form.get("file") as File | null
  if (!lineUserId) return liffUnauthorized("LINE identity mismatch")
  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 })

  const admin = createAdminClient()
  const { data: me } = await admin.from("split_participants")
    .select("id").eq("split_bill_id", sessionId).eq("line_user_id", lineUserId).maybeSingle()
  if (!me) return NextResponse.json({ error: "คุณยังไม่ได้เข้าร่วมกลุ่มนี้" }, { status: 400 })

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: `ขนาดไฟล์เกิน ${MAX_FILE_SIZE / 1024 / 1024}MB` }, { status: 400 })
  }
  const buffer = Buffer.from(await file.arrayBuffer())

  // Sniff actual content — never trust file.type, which is fully
  // client-controlled and was previously passed straight through as the
  // storage Content-Type, letting any content be uploaded and served back
  // labeled as an image.
  const validated = await validateImageUpload(buffer)
  if (!validated) {
    return NextResponse.json({ error: "ไม่ใช่ไฟล์รูปภาพที่รองรับ" }, { status: 400 })
  }
  const path = `${sessionId}/${me.id}.${validated.ext}`

  const { error: uploadError } = await admin.storage.from(BUCKET)
    .upload(path, buffer, { contentType: validated.mime, upsert: true })
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 })

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path)

  await admin.from("split_participants")
    .update({ payment_proof_url: pub.publicUrl })
    .eq("id", me.id)

  const detail = await loadSessionDetail(admin, sessionId, lineUserId)
  return NextResponse.json({ ok: true, group: detail })
}

// DELETE /api/liff/sport-groups/sessions/[sessionId]/proof?lineUserId=Uxxx
// — removes the uploaded slip and clears paid status
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const lineUserId = req.nextUrl.searchParams.get("lineUserId")
  if (!lineUserId) return NextResponse.json({ error: "lineUserId required" }, { status: 400 })

  const admin = createAdminClient()
  const { data: me } = await admin.from("split_participants")
    .select("id, payment_proof_url").eq("split_bill_id", sessionId).eq("line_user_id", lineUserId).maybeSingle()
  if (!me) return NextResponse.json({ error: "คุณยังไม่ได้เข้าร่วมกลุ่มนี้" }, { status: 400 })

  if (me.payment_proof_url) {
    for (const ext of ["jpg", "png", "webp", "gif"]) {
      await admin.storage.from(BUCKET).remove([`${sessionId}/${me.id}.${ext}`])
    }
  }

  await admin.from("split_participants")
    .update({ payment_proof_url: null, paid_at: null })
    .eq("id", me.id)

  const detail = await loadSessionDetail(admin, sessionId, lineUserId)
  return NextResponse.json({ ok: true, group: detail })
}
