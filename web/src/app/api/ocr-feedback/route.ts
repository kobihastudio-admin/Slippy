import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { documentId, imagePath, original, corrected, correctedLineItems, rawText } = body

    const supabase = await createClient()

    // Previously unchecked — the insert was silently failing (table didn't
    // exist; see migration 066) while this route kept returning 200 "ok",
    // so every "ส่งให้ Slippy เรียนรู้" tap looked successful but saved nothing.
    const { error } = await supabase.from("ocr_feedback").insert({
      document_id:   documentId ?? null,
      image_path:    imagePath ?? null,
      original_data: original,
      // lineItems carries each item's user-reviewed `isLineItem` flag, so a
      // sub-component wrongly extracted as a real line item is recorded as
      // a correction, not silently dropped.
      corrected_data: { ...corrected, lineItems: correctedLineItems ?? [] },
      raw_text:      rawText ?? null,
      submitted_at:  new Date().toISOString(),
    })

    if (error) {
      console.error("[ocr-feedback] insert failed:", error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error("[ocr-feedback]", e)
    return NextResponse.json({ error: "internal" }, { status: 500 })
  }
}
