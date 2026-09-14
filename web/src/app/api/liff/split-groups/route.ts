import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getVerifiedLineUserId, liffUnauthorized } from "@/lib/liff-auth"
import { validateImageUpload } from "@/lib/validate-upload"

// Resolve a LINE userId → { organization_id, user_id } via line_connections.
// "หารบิล" groups require a linked account (same as sport/trip groups) — keeps
// creator_id/org consistent and avoids partial/orphaned connections.
async function resolveConnection(admin: ReturnType<typeof createAdminClient>, lineUserId: string) {
  const { data } = await admin.from("line_connections")
    .select("user_id, organization_id, display_name")
    .eq("line_user_id", lineUserId)
    .maybeSingle()
  return data
}

// GET /api/liff/split-groups?lineUserId=Uxxx — list "หารบิล" groups the user is in
export async function GET(req: NextRequest) {
  const lineUserId = req.nextUrl.searchParams.get("lineUserId")
  if (!lineUserId) return NextResponse.json({ error: "lineUserId required" }, { status: 400 })

  const admin = createAdminClient()
  const conn  = await resolveConnection(admin, lineUserId)
  if (!conn) return NextResponse.json({ needsConnect: true, groups: [] })

  // Groups where this LINE user is a participant (creator auto-joins on create)
  const { data: parts } = await admin.from("split_participants")
    .select("split_bill_id, amount, paid_at, name")
    .eq("line_user_id", lineUserId)

  const billIds = [...new Set((parts ?? []).map(p => p.split_bill_id))]
  if (billIds.length === 0) return NextResponse.json({ groups: [] })

  const { data: bills } = await admin.from("split_bills")
    .select("id, title, note, total_amount, status, share_token, created_at, split_participants(id, name, amount, paid_at)")
    .in("id", billIds)
    .eq("category", "general")
    .order("created_at", { ascending: false })

  const groups = (bills ?? []).map((b: any) => {
    const paid  = (b.split_participants as any[]).filter(p => p.paid_at).length
    const total = (b.split_participants as any[]).length
    return {
      id:         b.id,
      title:      b.title,
      note:       b.note,
      fee:        Number(b.total_amount),
      status:     b.status,
      shareToken: b.share_token,
      createdAt:  b.created_at,
      paidCount:  paid,
      headCount:  total,
    }
  })

  return NextResponse.json({ groups })
}

const RECEIPT_BUCKET = "payment-proofs"
const MAX_RECEIPT_SIZE = 5 * 1024 * 1024 // matches the bucket's own limit (migration 043)

// POST /api/liff/split-groups — create a new "หารบิล" group (creator auto-joins)
// multipart/form-data fields: lineUserId, displayName, title, fee, note,
// members (JSON array of { name, amount?, detail?, paymentMethod? }),
// receipt (image, optional)
export async function POST(req: NextRequest) {
  const form = await req.formData()
  const claimedLineUserId = form.get("lineUserId") as string | null
  const lineUserId = getVerifiedLineUserId(req, claimedLineUserId)
  const displayName = form.get("displayName") as string | null
  const title       = form.get("title") as string | null
  const fee         = Number(form.get("fee"))
  const note        = form.get("note") as string | null
  const allocationMode = (form.get("allocationMode") as string | null) ?? "equal"
  const creatorDetail = ((form.get("creatorDetail") as string | null) ?? "").trim()
  const creatorPaymentMethod = ((form.get("creatorPaymentMethod") as string | null) ?? "transfer").trim()
  const receiptPayerName = ((form.get("receiptPayerName") as string | null) ?? "").trim()
  const receiptDate = ((form.get("receiptDate") as string | null) ?? new Date().toISOString().slice(0, 10)).trim()
  const receiptMealType = ((form.get("receiptMealType") as string | null) ?? "other").trim()
  const linePictureUrl = ((form.get("linePictureUrl") as string | null) ?? "").trim()
  const receipt     = form.get("receipt") as File | null

  let members: { name: string; amount?: number; detail?: string; paymentMethod?: string }[] = []
  try { members = JSON.parse((form.get("members") as string | null) ?? "[]") } catch {}
  members = members
    .map(m => ({
      name: (m.name ?? "").trim(), amount: Number(m.amount),
      detail: (m.detail ?? "").trim(),
      paymentMethod: (m.paymentMethod ?? "transfer").trim(),
    }))
    .filter(m => m.name)

  if (!lineUserId) return liffUnauthorized("LINE identity mismatch")
  if (!title?.trim() || !fee || fee <= 0) {
    return NextResponse.json({ error: "lineUserId, title, fee required" }, { status: 400 })
  }
  if (!["equal", "custom", "itemized"].includes(allocationMode)) {
    return NextResponse.json({ error: "รูปแบบการหารไม่ถูกต้อง" }, { status: 400 })
  }

  const admin = createAdminClient()
  const conn  = await resolveConnection(admin, lineUserId)
  if (!conn) return NextResponse.json({ needsConnect: true, error: "กรุณาเชื่อมบัญชี LINE ก่อน — เข้าสู่ระบบด้วย LINE ที่หน้า Slippy login (เชื่อมอัตโนมัติ) หรือพิมพ์ /connect CODE ในแชท" }, { status: 403 })

  const headCount = 1 + members.length
  const evenShare = Math.round((fee / headCount) * 100) / 100
  const memberAmounts = members.map(m => Number.isFinite(m.amount) && m.amount! >= 0 ? m.amount! : evenShare)
  const membersTotal  = memberAmounts.reduce((s, a) => s + a, 0)
  if (allocationMode !== "equal" && membersTotal > fee) {
    return NextResponse.json({ error: "ยอดของเพื่อนรวมกันเกินยอดบิล" }, { status: 400 })
  }
  const creatorAmount = Math.max(0, Math.round((fee - membersTotal) * 100) / 100)

  const { data: bill, error } = await admin.from("split_bills")
    .insert({
      organization_id: conn.organization_id,
      creator_id:      conn.user_id,
      document_id:     null,
      category:        "general",
      title:           title.trim(),
      note:            note?.trim() || null,
      total_amount:    fee,
      split_mode:      allocationMode === "equal" ? "equal" : "custom",
      allocation_details: {
        mode: allocationMode,
        creator: { detail: creatorDetail, paymentMethod: creatorPaymentMethod },
        members: members.map(m => ({ name: m.name, detail: m.detail, paymentMethod: m.paymentMethod })),
      },
      status:          "open",
    })
    .select("id, share_token")
    .single()

  if (error || !bill) return NextResponse.json({ error: error?.message ?? "สร้างบิลไม่สำเร็จ" }, { status: 500 })

  // Members with a custom amount keep it; ones left blank fall back to an even share
  // Auto-add creator as the first participant
  const { data: creatorParticipant } = await admin.from("split_participants").insert({
    split_bill_id: bill.id,
    name:          displayName ?? conn.display_name ?? "ผู้สร้างบิล",
    line_user_id:  lineUserId,
    line_display:  displayName ?? conn.display_name,
    line_picture_url: linePictureUrl || null,
    is_non_line:   false,
    amount:        creatorAmount,
  }).select("id, name").single()

  // Add the rest as non-LINE placeholder participants (รายชื่อผู้ที่จะหารด้วย)
  if (members.length > 0) {
    await admin.from("split_participants").insert(
      members.map((m, i) => ({
        split_bill_id: bill.id,
        name:          m.name,
        is_non_line:   true,
        amount:        memberAmounts[i],
      }))
    )
  }

  // Receipt/slip photo (optional) — sniff actual content, never trust the
  // client-supplied receipt.type (previously passed straight through as the
  // storage Content-Type).
  if (receipt && receipt.size > 0 && receipt.size <= MAX_RECEIPT_SIZE) {
    const buffer = Buffer.from(await receipt.arrayBuffer())
    const validated = await validateImageUpload(buffer)
    if (validated) {
      const path = `receipts/${bill.id}.${validated.ext}`
      const { error: uploadError } = await admin.storage.from(RECEIPT_BUCKET)
        .upload(path, buffer, { contentType: validated.mime, upsert: true })
      if (!uploadError) {
        const { data: pub } = admin.storage.from(RECEIPT_BUCKET).getPublicUrl(path)
        await admin.from("split_bills").update({ receipt_url: pub.publicUrl }).eq("id", bill.id)
        let paidByParticipantId = creatorParticipant?.id ?? null
        if (receiptPayerName && receiptPayerName !== "__creator__") {
          const { data: payer } = await admin.from("split_participants")
            .select("id").eq("split_bill_id", bill.id).eq("name", receiptPayerName).limit(1).maybeSingle()
          paidByParticipantId = payer?.id ?? paidByParticipantId
        }
        await admin.from("split_bill_receipts").insert({
          split_bill_id: bill.id,
          paid_by_participant_id: paidByParticipantId,
          receipt_url: pub.publicUrl,
          title: title.trim(),
          amount: fee,
          expense_date: receiptDate,
          meal_type: receiptMealType,
          source: "split",
        })
      }
    }
  }

  return NextResponse.json({ ok: true, id: bill.id, shareToken: bill.share_token })
}
