/**
 * Live market-price lookup for a medication, via the api service's
 * web-search-backed pipeline. Read-only, never written to `medications` —
 * see api/src/pipeline/medication-price.ts for why a price is looked up
 * fresh every time instead of cached on the row.
 */
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { internalApiError } from "@/lib/trips/internal-api"

const INTERNAL_URL = process.env.INTERNAL_API_URL ?? "http://localhost:4000"

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => null) as
    { name?: string; genericName?: string; strength?: string } | null
  if (!body?.name?.trim()) {
    return NextResponse.json({ error: "name จำเป็นต้องมี" }, { status: 400 })
  }

  const key = process.env.INTERNAL_API_KEY
  if (!key) {
    return NextResponse.json({ error: "ระบบค้นหาราคายังไม่ได้ตั้งค่า" }, { status: 503 })
  }

  try {
    const res = await fetch(`${INTERNAL_URL}/medication-price/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-key": key },
      body: JSON.stringify(body),
      // Matches the api pipeline's own 100s budget for a multi-search
      // lookup, plus headroom — a shorter timeout here would abort a
      // request that was still going to succeed on the other side.
      signal: AbortSignal.timeout(110_000),
    })
    const json = await res.json()
    if (!res.ok) return NextResponse.json({ error: json.error ?? "ค้นหาราคาไม่สำเร็จ" }, { status: res.status })
    return NextResponse.json(json)
  } catch (err) {
    return NextResponse.json(
      { error: internalApiError(err, "ค้นหาราคา", INTERNAL_URL) }, { status: 502 })
  }
}
