/**
 * /api/liff/scan — Document scanner upload endpoint for /liff/scan LIFF page.
 *
 * Mirrors the LINE webhook image flow exactly:
 *   1. Upload image to Supabase Storage "documents" bucket
 *   2. Check & increment org quota via increment_doc_used RPC
 *   3. Insert a documents record (status: "pending", source: "liff_scan")
 *   4. Call INTERNAL_API_URL/documents/{id}/process to trigger OCR pipeline
 *
 * GET  /api/liff/scan?lineUserId=X           — list recent liff_scan documents
 * POST /api/liff/scan                        — upload images (multipart)
 * GET  /api/liff/scan/status?ids=a,b&lineUserId=X — poll processing status
 */

import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getVerifiedLineUserId, liffUnauthorized } from "@/lib/liff-auth"
import { validateImageUpload } from "@/lib/validate-upload"

const INTERNAL_URL = process.env.INTERNAL_API_URL ?? "http://localhost:4000"
const INTERNAL_KEY = process.env.INTERNAL_API_KEY ?? ""
const MAX_FILE_SIZE = 20 * 1024 * 1024 // matches api/'s multipart limit

async function resolveConn(admin: ReturnType<typeof createAdminClient>, lineUserId: string) {
  const { data } = await admin
    .from("line_connections")
    .select("user_id, organization_id, display_name")
    .eq("line_user_id", lineUserId)
    .maybeSingle()
  return data
}

// ── POST — upload 1-5 images, create documents records, trigger pipeline ──────
export async function POST(req: NextRequest) {
  const form        = await req.formData()
  const claimedLineUserId = form.get("lineUserId") as string | null
  const lineUserId = getVerifiedLineUserId(req, claimedLineUserId)
  const files       = form.getAll("files") as File[]

  if (!lineUserId) return liffUnauthorized("LINE identity mismatch")
  if (files.length === 0)
    return NextResponse.json({ error: "lineUserId และไฟล์อย่างน้อย 1 รูปจำเป็น" }, { status: 400 })

  const admin = createAdminClient()
  const conn  = await resolveConn(admin, lineUserId)
  if (!conn)
    return NextResponse.json({ needsConnect: true, error: "กรุณาเชื่อมบัญชี LINE ก่อน — พิมพ์ /connect ในแชท Slippy" }, { status: 403 })

  const results: { id: string; status: string }[] = []
  const errors:  string[] = []

  for (const file of files.slice(0, 5)) {
    try {
      // 1. Read + validate the buffer — sniff actual content, never trust
      // the client-supplied file.type (previously used directly for the
      // storage extension/Content-Type, letting any content masquerade as
      // an image).
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name || "ไฟล์"}: ขนาดเกิน ${MAX_FILE_SIZE / 1024 / 1024}MB`)
        continue
      }
      const rawBuf  = Buffer.from(await file.arrayBuffer())
      const validated = await validateImageUpload(rawBuf)
      if (!validated) {
        errors.push(`${file.name || "ไฟล์"}: ไม่ใช่ไฟล์รูปภาพที่รองรับ`)
        continue
      }
      const fileName = `liff_scan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${validated.ext}`
      const filePath = `${conn.organization_id}/${fileName}`

      // 2. Compress with sharp if available (reduces storage + speeds up OCR)
      // — a failure here means the buffer is malformed in a way our magic-byte
      // check missed; don't silently fall back to uploading the raw bytes.
      let finalBuf: Buffer = rawBuf
      let finalMime = validated.mime
      try {
        const sharp = (await import("sharp")).default
        const compressed = await sharp(rawBuf)
          .resize({ width: 1400, height: 1800, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 82, progressive: true })
          .toBuffer()
        finalBuf  = Buffer.from(compressed)
        finalMime = "image/jpeg"
      } catch (sharpErr: any) {
        if (sharpErr?.code !== "MODULE_NOT_FOUND" && sharpErr?.code !== "ERR_MODULE_NOT_FOUND") {
          errors.push(`${file.name || "ไฟล์"}: ประมวลผลรูปภาพไม่ได้`)
          continue
        }
        // sharp genuinely not installed in this runtime — proceed with the
        // already-validated original buffer/mime.
      }

      // 3. Upload to Supabase Storage "documents" bucket (same as LINE flow)
      const { error: upErr } = await admin.storage
        .from("documents")
        .upload(filePath, finalBuf, { contentType: finalMime, upsert: true })

      if (upErr) {
        errors.push(`อัปโหลดล้มเหลว: ${upErr.message}`)
        continue
      }

      // 4. Check & increment quota
      const { data: allowed } = await admin.rpc("increment_doc_used", {
        p_org_id: conn.organization_id,
      })
      if (!allowed) {
        await admin.storage.from("documents").remove([filePath])
        return NextResponse.json({
          error: "โควต้าเอกสารเดือนนี้เต็มแล้วครับ — กรุณาอัปเกรดแผนที่ slippy.ai/billing",
          quotaExceeded: true,
          documents: results,
        }, { status: 402 })
      }

      // 5. Insert documents record (matches LINE webhook schema)
      const { data: doc, error: insertErr } = await admin
        .from("documents")
        .insert({
          organization_id: conn.organization_id,
          uploaded_by:     conn.user_id,
          file_path:       filePath,
          file_type:       finalMime === "image/jpeg" ? "jpg" : finalMime.split("/")[1],
          source:          "liff_scan",
          source_meta: {
            line_user_id: lineUserId,
            file_name:    fileName,
            uploaded_via: "liff_scan",
          },
          status: "pending",
        })
        .select("id")
        .single()

      if (insertErr || !doc) {
        await admin.storage.from("documents").remove([filePath])
        errors.push(`บันทึกข้อมูลล้มเหลว: ${insertErr?.message}`)
        continue
      }

      results.push({ id: doc.id, status: "pending" })

      // 6. Trigger OCR pipeline (fire-and-forget via api service)
      fetch(`${INTERNAL_URL}/documents/${doc.id}/process`, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "x-internal-key": INTERNAL_KEY,
        },
        body: JSON.stringify({ orgId: conn.organization_id }),
      }).catch(err => console.error(`[liff/scan] pipeline trigger failed for ${doc.id}:`, err))

    } catch (err: any) {
      errors.push(err?.message ?? "เกิดข้อผิดพลาดที่ไม่คาดคิด")
    }
  }

  if (results.length === 0) {
    return NextResponse.json({
      error: errors[0] ?? "อัปโหลดไม่สำเร็จ กรุณาลองใหม่",
    }, { status: 500 })
  }

  return NextResponse.json({ ok: true, documents: results, errors: errors.length ? errors : undefined })
}

// ── GET — list recent liff_scan documents for this user ───────────────────────
export async function GET(req: NextRequest) {
  const lineUserId = req.nextUrl.searchParams.get("lineUserId")
  const ids        = req.nextUrl.searchParams.get("ids") // comma-separated — for status poll

  if (!lineUserId)
    return NextResponse.json({ error: "lineUserId required" }, { status: 400 })

  const admin = createAdminClient()
  const conn  = await resolveConn(admin, lineUserId)
  if (!conn) return NextResponse.json({ needsConnect: true, documents: [] })

  // Status poll mode — client provides specific document IDs
  if (ids) {
    const idList = ids.split(",").filter(Boolean).slice(0, 10)
    const { data } = await admin
      .from("documents")
      .select("id, status, vendor_name, total_amount, doc_date, overall_confidence, file_path, created_at")
      .in("id", idList)
      .eq("organization_id", conn.organization_id)
    return NextResponse.json({ documents: data ?? [] })
  }

  // History list — most recent 20 liff_scan docs
  const { data } = await admin
    .from("documents")
    .select("id, status, vendor_name, total_amount, doc_date, overall_confidence, file_path, created_at")
    .eq("organization_id", conn.organization_id)
    .eq("source", "liff_scan")
    .order("created_at", { ascending: false })
    .limit(20)

  // Attach public URLs for thumbnails
  const docs = (data ?? []).map(d => {
    let thumbUrl: string | null = null
    if (d.file_path) {
      const { data: pub } = admin.storage.from("documents").getPublicUrl(d.file_path)
      thumbUrl = pub.publicUrl
    }
    return { ...d, thumbUrl }
  })

  return NextResponse.json({ documents: docs })
}
