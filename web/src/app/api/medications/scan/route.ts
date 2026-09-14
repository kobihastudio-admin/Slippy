/**
 * Read a medication label photo into a proposed medication entry.
 *
 * Read-only, same discipline as trips' import-document: this route never
 * writes to medications/medication_schedules/medication_inventory — it
 * returns proposals, the client pre-fills the existing "เพิ่มยา" form with
 * them, and POST /api/medications (unchanged) does the actual write once a
 * person has reviewed it. A machine-read dose is exactly the kind of value
 * that must never reach the database without someone comparing it to the
 * label first.
 */
import { NextRequest, NextResponse } from "next/server"
import { getAuthedUser } from "@/lib/authed-user"
import { internalApiError } from "@/lib/trips/internal-api"

const MAX_BYTES = 12 * 1024 * 1024
const INTERNAL_URL = process.env.INTERNAL_API_URL ?? "http://localhost:4000"

export async function POST(req: NextRequest) {
  // getAuthedUser, not createClient().auth.getUser() directly — the iOS app
  // has no cookie jar and sends a Supabase Bearer token instead (see
  // authed-user.ts). A cookie-only check silently 401s every phone request;
  // this is exactly the mistake that comment warns about, caught here
  // while wiring up the iOS scan flow.
  const user = await getAuthedUser(req)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

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

  const key = process.env.INTERNAL_API_KEY
  if (!key) {
    return NextResponse.json({ error: "ระบบอ่านฉลากยายังไม่ได้ตั้งค่า" }, { status: 503 })
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer())
    const res = await fetch(`${INTERNAL_URL}/medication-label/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-key": key },
      body: JSON.stringify({
        fileBase64: bytes.toString("base64"),
        mimeType: file.type || "application/octet-stream",
        fileName: file.name,
      }),
      signal: AbortSignal.timeout(90_000),
    })
    const json = await res.json()
    if (!res.ok) return NextResponse.json({ error: json.error ?? "อ่านฉลากยาไม่สำเร็จ" }, { status: res.status })
    return NextResponse.json(json)
  } catch (err) {
    return NextResponse.json(
      { error: internalApiError(err, "อ่านฉลากยา", INTERNAL_URL) }, { status: 502 })
  }
}
