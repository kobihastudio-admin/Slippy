/**
 * Scan a receipt into a trip expense.
 *
 * Uploads the image, runs it through the SAME pipeline that reads accounting
 * receipts, and returns the extracted total and line items for the user to
 * check before anything is saved as an expense.
 *
 * WHY REUSE THE DOCUMENT PIPELINE RATHER THAN READ THE IMAGE HERE
 * That pipeline is where every hard-won correction lives: the Thai extraction
 * work, the VAT-convention handling, the reconciliation that refuses to
 * assemble a total out of misread line items. A second, simpler reader for trip
 * receipts would start by getting all of that wrong again.
 *
 * It also means the receipt becomes a real `documents` row — so the expense can
 * point at it (`trip_expenses.document_id`), the image stays viewable, and the
 * same receipt shows up in the accounting side of the app instead of being a
 * private copy that only the trip knows about.
 *
 * NOTHING IS SAVED AS AN EXPENSE HERE. This returns a proposal; the expense is
 * created by the normal path once a person has looked at it.
 */
import { NextRequest, NextResponse } from "next/server"
import { getAuthedUser } from "@/lib/authed-user"
import { createAdminClient } from "@/lib/supabase/admin"
import { getTripAccess } from "@/lib/trips/trip-access"
import { internalApiError } from "@/lib/trips/internal-api"

type Params = { params: Promise<{ id: string }> }

const MAX_BYTES = 12 * 1024 * 1024
const INTERNAL_URL = process.env.INTERNAL_API_URL ?? "http://localhost:4000"
/** Extraction on a dense receipt is not fast; the default fetch timeout is not enough. */
const EXTRACT_TIMEOUT_MS = 150_000

export async function POST(req: NextRequest, { params }: Params) {
  const { id: tripId } = await params

  const user = await getAuthedUser(req)
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const access = await getTripAccess(tripId, user.id)
  if (!access.allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const key = process.env.INTERNAL_API_KEY
  if (!key) return NextResponse.json({ error: "ระบบอ่านเอกสารยังไม่ได้ตั้งค่า" }, { status: 503 })

  const form = await req.formData().catch(() => null)
  const file = form?.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "แนบไฟล์ด้วย" }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `ไฟล์ใหญ่เกินไป (${(file.size / 1024 / 1024).toFixed(1)} MB) — จำกัดที่ 12 MB` },
      { status: 413 })
  }

  const admin = createAdminClient()

  // The receipt is filed against the trip's OWNING organization, not the
  // caller's currently-selected one. A trip can have participants from
  // elsewhere, and the document belongs with the trip.
  const { data: journey } = await admin.from("life_journeys")
    .select("organization_id, base_currency").eq("id", tripId).single()
  if (!journey) return NextResponse.json({ error: "not found" }, { status: 404 })

  const ext  = file.name.split(".").pop()?.toLowerCase() ?? "jpg"
  const path = `${journey.organization_id}/${Date.now()}.${ext}`

  const { error: uploadError } = await admin.storage
    .from("documents").upload(path, file, { contentType: file.type })
  if (uploadError) {
    return NextResponse.json({ error: `อัปโหลดไม่สำเร็จ: ${uploadError.message}` }, { status: 502 })
  }

  const { data: doc, error: insertError } = await admin.from("documents").insert({
    organization_id: journey.organization_id,
    uploaded_by: user.id,
    file_path: path,
    file_type: ext === "pdf" ? "pdf" : "jpg",
    status: "pending",
    source: "web",
  }).select("id").single()
  if (insertError || !doc) {
    return NextResponse.json({ error: "สร้างเอกสารไม่สำเร็จ" }, { status: 500 })
  }

  try {
    const res = await fetch(`${INTERNAL_URL}/documents/${doc.id}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-key": key },
      body: JSON.stringify({ orgId: journey.organization_id }),
      signal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return NextResponse.json({
        error: err.error ?? "อ่านใบเสร็จไม่สำเร็จ",
        documentId: doc.id,
      }, { status: 502 })
    }
  } catch (err) {
    return NextResponse.json({
      error: internalApiError(err, "อ่านใบเสร็จ", INTERNAL_URL),
      documentId: doc.id,
    }, { status: 502 })
  }

  // Read back what the pipeline stored. Reading the DATABASE rather than the
  // process response on purpose: the row is what every other screen will show,
  // so the form is filled from the same source and cannot disagree with it.
  const { data: extracted } = await admin.from("documents")
    .select("id, vendor_name, total_amount, currency, doc_date, notes, overall_confidence, validation_issues")
    .eq("id", doc.id).single()

  const { data: lines } = await admin.from("document_line_items")
    .select("description, quantity, unit_price, amount")
    .eq("document_id", doc.id).order("sort_order")

  return NextResponse.json({
    documentId: doc.id,
    vendorName: extracted?.vendor_name ?? null,
    total: extracted?.total_amount ?? null,
    currency: extracted?.currency ?? journey.base_currency ?? "THB",
    date: extracted?.doc_date ?? null,
    confidence: extracted?.overall_confidence ?? null,
    // The pipeline's own notes about what it could not read cleanly. Shown to
    // the user, because a low-confidence reading that nobody checks against the
    // paper is the failure this whole codebase keeps producing.
    issues: [
      ...(extracted?.notes ? String(extracted.notes).split("\n").filter(Boolean) : []),
      ...((extracted?.validation_issues as string[] | null) ?? []),
    ],
    items: (lines ?? []).map(l => ({
      description: l.description ?? "",
      quantity: l.quantity == null ? null : Number(l.quantity),
      unit_price: l.unit_price == null ? null : Number(l.unit_price),
      amount: Number(l.amount ?? 0),
    })),
  })
}
