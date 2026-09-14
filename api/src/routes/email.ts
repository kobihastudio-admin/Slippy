import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase"
import { ingestDocument } from "../services/ingest"

const ALLOWED_TYPES = new Set([
  "image/jpeg", "image/jpg", "image/png",
  "application/pdf",
])

export async function emailRoutes(app: FastifyInstance) {
  // POST /webhooks/email/:token — Postmark Inbound webhook
  // Token is set in Postmark webhook URL to prevent unauthorized calls
  app.post<{ Params: { token: string } }>(
    "/email/:token",
    async (req, rep) => {
      if (req.params.token !== process.env.EMAIL_WEBHOOK_TOKEN) {
        return rep.status(401).send({ error: "Invalid token" })
      }

      const body        = req.body as any
      const from        = (body.From ?? body.from ?? "") as string
      const subject     = (body.Subject ?? body.subject ?? "Email Document") as string
      const toEmail     = (body.To ?? body.to ?? "") as string
      const attachments = (body.Attachments ?? body.attachments ?? []) as any[]

      // Resolve org from inbound address: docs+{slug}@inbound.yourdomain.com
      const slugMatch = toEmail.match(/docs\+([^@+]+)@/)
      const slug = slugMatch?.[1]

      let orgId: string | null = null
      if (slug) {
        const { data: org } = await supabase
          .from("organizations")
          .select("id")
          .eq("slug", slug)
          .single()
        orgId = org?.id ?? null
      }

      if (!orgId) {
        console.log(`[email] No org found for address: ${toEmail}`)
        return { ok: true } // Silently accept to avoid Postmark bounce retries
      }

      // ── Plan feature check: email ingestion requires Personal+ ──────────────
      const { data: orgPlan } = await supabase
        .from("organizations")
        .select("plan")
        .eq("id", orgId)
        .single()
      const { data: planRow } = await supabase
        .from("pricing_plans")
        .select("feature_email_ingestion")
        .eq("id", orgPlan?.plan ?? "free")
        .single()
      if (!planRow?.feature_email_ingestion) {
        console.log(`[email] Org ${orgId} on plan ${orgPlan?.plan} — email ingestion not available`)
        return { ok: true } // accept quietly, don't reveal plan info to sender
      }

      const { data: member } = await supabase
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", orgId)
        .eq("role", "owner")
        .single()

      let processedCount = 0

      for (const att of attachments) {
        const contentType = (att.ContentType ?? att.contentType ?? "") as string
        const name        = (att.Name ?? att.name ?? `attachment_${Date.now()}`) as string
        const content     = (att.Content ?? att.content ?? "") as string

        if (!ALLOWED_TYPES.has(contentType.split(";")[0].trim())) {
          console.log(`[email] Skipping ${name} — unsupported type: ${contentType}`)
          continue
        }

        // Check & increment quota
        const { data: allowed } = await supabase.rpc("increment_doc_used", {
          p_org_id: orgId,
        })
        if (!allowed) {
          console.log(`[email] Quota exceeded for org ${orgId}`)
          break
        }

        // Decode base64 attachment
        const buffer   = Buffer.from(content, "base64")
        const safeN    = name.replace(/[^a-zA-Z0-9._-]/g, "_")
        const fileName = `email_${Date.now()}_${safeN}`
        const filePath = `${orgId}/${fileName}`

        const { error: uploadErr } = await supabase.storage
          .from("documents")
          .upload(filePath, buffer, {
            contentType: contentType.split(";")[0].trim(),
            upsert:      false,
          })

        if (uploadErr) {
          console.error(`[email] Upload failed for ${name}:`, uploadErr.message)
          continue
        }

        const { data: doc } = await supabase
          .from("documents")
          .insert({
            organization_id: orgId,
            uploaded_by:     member?.user_id ?? null,
            file_path:       filePath,
            file_name:       fileName,
            file_type:       contentType.split(";")[0].trim(),
            source:          "email",
            source_meta:     { from, subject, original_name: name },
            status:          "pending",
          })
          .select("id")
          .single()

        if (!doc) {
          console.error(`[email] Document insert failed for ${name}`)
          continue
        }

        // Shared ingestion contract — same durable-queue-with-inline-fallback
        // path as LINE/web/iOS, so an emailed receipt can't be dropped when the
        // queue is unavailable.
        //
        // Deliberately NOT awaited: if the queue is down the fallback runs the
        // pipeline right here, which takes far longer than Postmark's webhook
        // timeout — the retry that followed would re-upload every attachment as
        // a duplicate document. The row is already persisted, so returning now
        // loses nothing.
        void ingestDocument(doc.id, orgId).then(r => {
          if (!r.ok) console.error(`[email] ingest failed for ${doc.id} (${r.mode}):`, r.error)
        })

        processedCount++
      }

      console.log(`[email] Processed ${processedCount} attachment(s) from ${from}`)
      return { ok: true, processed: processedCount }
    }
  )
}
