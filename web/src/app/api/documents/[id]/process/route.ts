/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getAuthedUser }     from "@/lib/authed-user"
import { isOrgMember }       from "@/lib/require-org-member"
import { checkRateLimit }    from "@/lib/rate-limit"
import { recordActivity, recordDenied } from "@/lib/activity-log"

/**
 * Triggers an extraction for a document.
 *
 * This route holds `INTERNAL_API_KEY` and forwards to the API with it, so it is
 * the boundary between the public internet and a privileged endpoint. It
 * previously performed no checks whatsoever: no sign-in, no ownership test, no
 * limit. A POST with any document id — guessed, or seen once in someone else's
 * screenshot — would start a paid AI read on a stranger's document, and a loop
 * around it would drain the Anthropic balance for every customer at once. That
 * is not hypothetical here: the balance ran dry, every upload failed, and the
 * only reason it was not this is that nobody had tried.
 *
 * Three gates now, in the order that costs least to evaluate:
 *   1. signed in
 *   2. their organisation owns the document
 *   3. within their own extraction budget
 */

/** Re-reads are legitimate but rarely rapid; each one costs real money. */
const REPROCESS_LIMIT_PER_USER  = 20
const REPROCESS_WINDOW_SECONDS  = 60 * 10

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // Browser cookie OR the iOS app's bearer token — see getAuthedUser.
  const user = await getAuthedUser(req)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Ownership. The admin client below ignores RLS, so this is the only thing
  // standing between a document id and somebody else's receipt.
  const admin = createAdminClient()
  const { data: doc } = await admin
    .from("documents")
    .select("id, organization_id")
    .eq("id", id)
    .maybeSingle()

  if (!doc || !(await isOrgMember(user.id, doc.organization_id))) {
    // 404 either way: a stranger must not be able to tell a document that
    // exists from one that does not. Recorded, because a run of these against
    // different ids is what an enumeration sweep looks like.
    recordDenied("document.view", {
      userId: user.id, resourceType: "document", resourceId: id, req,
    })
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  // Budget. Keyed on the user rather than the address so one person cannot
  // multiply their allowance by changing networks, and separate from the API's
  // blanket 120/minute, which counts a page view the same as a paid model call.
  const limit = await checkRateLimit(
    "doc-reprocess", user.id, REPROCESS_LIMIT_PER_USER, REPROCESS_WINDOW_SECONDS,
  )
  if (!limit.allowed) {
    void recordActivity({
      action: "document.upload", outcome: "denied",
      userId: user.id, orgId: doc.organization_id,
      resourceType: "document", resourceId: id, req,
      detail: "เกินขีดจำกัดการอ่านซ้ำ",
    })
    return NextResponse.json(
      { error: "สั่งอ่านเอกสารถี่เกินไป กรุณารอสักครู่แล้วลองใหม่",
        retryAfterSeconds: limit.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    )
  }

  // Body is optional — web's upload flow calls this with no body at all,
  // while the iOS app may attach `{ localOcrHint }` (its on-device Vision
  // OCR pre-read) for the pipeline to use as a second opinion/cross-check.
  const body = await req.json().catch(() => ({}))

  const res = await fetch(`${process.env.API_BASE_URL}/documents/${id}/process`, {
    method:  "POST",
    headers: { "x-internal-key": process.env.INTERNAL_API_KEY!, "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  })

  const data = await res.json()

  void recordActivity({
    action: "document.upload", outcome: res.ok ? "success" : "failed",
    userId: user.id, orgId: doc.organization_id,
    resourceType: "document", resourceId: id, req,
    detail: "สั่งอ่านเอกสารด้วย AI",
    metadata: { status: res.status },
  })

  return NextResponse.json(data, { status: res.status })
}
