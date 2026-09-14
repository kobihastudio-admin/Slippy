import { createClient }            from "../lib/supabase"
import { prepareImages }           from "./preprocessor"
import { extractDocument }         from "./extractor"
import type { ExtractedDocument }  from "./extractor"
import { validateDocument, shouldAutoApprove } from "./validator"
import { upsertVendor }            from "./vendor"
import { fetchFewShotExamples, fetchVendorCorrections, formatFewShotBlock } from "./few-shot"
import { populateLifeGraph }       from "../services/life-graph"
import { normalizeVendorName }     from "./merchant-normalizer"
import { measureImageQuality, logImageQuality, isUnreadableCapture } from "./image-quality"
import { fetchErrorPatterns, formatErrorPatternBlock, mineErrorPatterns } from "./pattern-miner"
import { formatLocalOcrHintText, type LocalOcrHint, type UserConfirmedFields } from "./local-ocr-hint"
import { fetchLearnedRowOverrides } from "./receipt-feedback"
import { verifyVendorIdentity }     from "./vendor-registry"
import { classifyFailure, PROVIDER_OUTAGE_NOTE } from "./failure-kind"
import { checkDocumentScope } from "./scope-gate"
import { recordActivity } from "../services/activity-log"
import { createNotification } from "../lib/notify"
import { getModelTier } from "./model-tier"
import { isValidThaiTaxId } from "./tax-id"

/** How far back error-pattern mining looks. See the call site for why. */
const PATTERN_MINING_WINDOW_DAYS = 90

// Plan → model tier mapping lives in ./model-tier so it can be tested without
// a database — see the note there on why that matters.

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

export interface PipelineResult {
  success:          boolean
  documentId:       string
  confidence_score: number
  auto_approved:    boolean
  warnings:         string[]
  machine_verification_status?: "unverified" | "needs_review" | "verified"
  reconciliation?:  {
    status: "not_checked" | "balanced" | "mismatch"
    total: { checked: boolean; balanced: boolean | null; expected?: number; actual?: number; difference?: number }
    line_items: { checked: boolean; balanced: boolean | null; expected?: number; actual?: number; difference?: number }
  }
  error?:           string
}

/**
 * Run the full extraction pipeline for a document:
 *  1. Download + convert to PNG pages
 *  2. AI vision extraction via Claude Haiku (image → JSON, no separate OCR step)
 *  3. Validate & duplicate-check
 *  4. Persist results to DB
 */
export async function runPipeline(
  documentId:     string,
  organizationId: string,
  localOcrHint?:  LocalOcrHint | null,
  userConfirmed?: UserConfirmedFields | null,
): Promise<PipelineResult> {
  const supabase = createClient()

  // ── Fetch document record + org plan ────────────────────────────────────────
  const { data: doc, error: fetchErr } = await supabase
    .from("documents")
    .select("file_path, status")
    .eq("id", documentId)
    .single()

  // Fetch the org's plan for model tier routing (non-blocking if it fails).
  //
  // This asked for `plan_id`, and `organizations` has no such column — the
  // column is `plan`. PostgREST answered with an error, `orgRow` came back
  // null, and getModelTier(undefined) fell through to "free" → Haiku. So the
  // tier has never once been read: every organisation on every plan has been
  // routed to the cheapest model, and Sonnet only ever ran by accident, via
  // the degraded-capture escape hatch in extractDocument.
  const { data: orgRow, error: orgErr } = await supabase
    .from("organizations")
    .select("plan")
    .eq("id", organizationId)
    .single()
  if (orgErr) console.warn(`[pipeline] plan lookup failed (${orgErr.message}) — defaulting tier`)
  const modelTier = getModelTier(orgRow?.plan)

  if (fetchErr || !doc) {
    return fail(documentId, `Document not found: ${fetchErr?.message}`)
  }
  if (doc.status === "pushed") {
    return fail(documentId, "Document already pushed — skipping re-extraction")
  }

  await setStatus(documentId, "processing")

  try {
    // ── Step 1 — Preprocess (download + convert to PNG buffers) ──────────────
    await updateProgress(documentId, "preprocessing", 10)
    const { pages: pageBuffers, sliced: pagesAreSlices, source } = await prepareImages(doc.file_path)

    // ── Step 1.5 — Image Quality Check ───────────────────────────────────────
    // Detect blur / exposure / resolution issues before sending to AI — inject
    // warnings into the prompt. `source` is the size the user actually uploaded:
    // passing the processed page instead meant the resolution of a 762px capture
    // was read off the 2000px page this pipeline had just made out of it.
    const imageQuality = await measureImageQuality(pageBuffers[0], source)
    logImageQuality(documentId, imageQuality, 0).catch(() => {/* fire-and-forget */})
    if (imageQuality.isBlurry) {
      console.log(`[pipeline] blurry image detected (score: ${imageQuality.blurScore.toFixed(1)}) — warnings injected into prompt`)
    }
    if (imageQuality.isTooSmall) {
      console.log(`[pipeline] low-resolution capture ${source.width}×${source.height} — Thai text is unlikely to be readable`)
    }

    // ── Step 2 — AI Vision Extraction ────────────────────────────────────────
    await updateProgress(documentId, "extracting", 40)

    // Parallel fetch: few-shot + vendor corrections + learned error patterns
    //                 + learned row-role overrides (which labels aren't items)
    const [fewShotExamples, vendorCorrections, errorPatterns, rowOverrides] = await Promise.all([
      fetchFewShotExamples(organizationId),
      fetchVendorCorrections(organizationId),
      fetchErrorPatterns(organizationId),
      fetchLearnedRowOverrides(supabase, organizationId),
    ])

    const errorPatternBlock = formatErrorPatternBlock(errorPatterns)
    const fewShotBlock      = errorPatternBlock + formatFewShotBlock(fewShotExamples, vendorCorrections)
    const clientOcrHintText = formatLocalOcrHintText(localOcrHint)

    const rawExtracted = await extractDocument(
      pageBuffers, fewShotBlock, imageQuality.warnings, modelTier, clientOcrHintText, rowOverrides,
      pagesAreSlices,
      { documentId, organizationId },
    )

    // ── Multi-document handling ──────────────────────────────────────────────
    //    When a single photo contains multiple receipts the extractor returns
    //    an array.  The first doc updates the existing record; additional docs
    //    get new sibling records (same file_path, status "reviewing").
    let extracted: ExtractedDocument
    if (Array.isArray(rawExtracted)) {
      extracted = rawExtracted[0]

      // Spin up sibling records for docs 2..N in the background
      const siblings = rawExtracted.slice(1)
      if (siblings.length > 0) {
        createSiblingDocuments(documentId, organizationId, doc.file_path, siblings).catch(err =>
          console.warn("[pipeline] sibling creation error:", err?.message)
        )
      }
    } else {
      extracted = rawExtracted
    }

    // ── Step 2.5 — Merchant Normalization ───────────────────────────────────
    // แก้ชื่อร้านค้าที่อ่านผิด เช่น "ปตท." → "PTT", fuzzy match กับ org vendors
    if (extracted.vendor_name) {
      extracted.vendor_name = await normalizeVendorName(extracted.vendor_name, organizationId)
    }

    // A Bill-Payment QR yields an EXACT tax id — apply it BEFORE the registry
    // lookup below so verification runs on the correct number rather than the
    // OCR mis-read (the recurring 5→3 digit error). Full userConfirmed merge
    // still runs at step 2.6.
    if (userConfirmed?.vendor_tax_id) extracted.vendor_tax_id = userConfirmed.vendor_tax_id

    // ── Step 2.55 — Verify merchant by Tax ID (official registry) ───────────
    // If the receipt carries a 13-digit tax id, resolve the OFFICIAL juristic
    // name into company_name. The shop name (vendor_name) is deliberately left
    // alone: a tax id identifies the company behind the counter, not the branch
    // the customer visited. Cache-first via merchant_directory. Bounded so a
    // cold miss can't stall the pipeline — on timeout the extracted values are
    // kept and the cache still fills in the background.
    if (extracted.vendor_tax_id) {
      await Promise.race([
        verifyVendorIdentity(supabase, organizationId, documentId, extracted)
          .then(v => { if (v.changed) console.log(`[vendor-registry] ${documentId}: OCR "${v.record?.taxId}" → official "${v.officialName}"`) })
          .catch(() => {}),
        // Web-search verification can take several seconds; allow it to finish
        // in-line so a first-time vendor is corrected on this run (not only on
        // the next occurrence via cache). On timeout the OCR name is kept and
        // the lookup still finishes in the background to fill the cache.
        new Promise<void>(resolve => setTimeout(resolve, 12000)),
      ])
    }

    // ── Step 2.6 — Apply user-confirmed fields ──────────────────────────────
    // The user reviewed + saved these in OCRFullDetailView before upload
    // (iOS CameraPickerView) — without this, the AI's own (re-)extraction
    // below always won, silently discarding any pre-upload correction the
    // moment processing finished. Only listed fields are overridden; the
    // AI's own classification (doc_category/vat_claimable/etc.) still runs
    // normally since the user isn't picking from that enum.
    if (userConfirmed) {
      if (userConfirmed.vendor_name)               extracted.vendor_name   = userConfirmed.vendor_name
      if (userConfirmed.vendor_tax_id)             extracted.vendor_tax_id = userConfirmed.vendor_tax_id
      if (userConfirmed.doc_type)                  extracted.doc_type      = userConfirmed.doc_type
      if (userConfirmed.doc_number != null)         extracted.doc_number   = userConfirmed.doc_number
      if (userConfirmed.doc_date != null)           extracted.doc_date     = userConfirmed.doc_date
      if (userConfirmed.subtotal != null)           extracted.subtotal     = userConfirmed.subtotal
      if (userConfirmed.vat_amount != null)         extracted.vat_amount   = userConfirmed.vat_amount
      if (userConfirmed.wht_amount != null)         extracted.wht_amount   = userConfirmed.wht_amount
      if (userConfirmed.total_amount != null)       extracted.total_amount = userConfirmed.total_amount
      if (userConfirmed.payment_method)             extracted.payment_method = userConfirmed.payment_method
    }

    // ── Step 2.65 — Mark a reading that may be an invention ────────────────
    //
    // This block used to REFUSE the document outright. That was wrong, and the
    // production numbers said so within a day: 8 of ~34 uploads in one session
    // were rejected, and the first one inspected was a pharmacy bill whose every
    // line was legible and whose items summed exactly to its printed ฿1,200.
    // The user simply photographed it again — the second attempt went through,
    // because the gate's second input is the MODEL's self-assessed confidence,
    // which swings between runs on the same image (measured 0.47–0.60). A test
    // that returns a different verdict each time must never be the thing that
    // destroys work.
    //
    // The first input was no better: `isTooBright` measures paper-to-ink
    // contrast, and a pale photocopy is exactly the document that scores low
    // while remaining perfectly readable.
    //
    // What actually fixed the fabrication this was built for was elsewhere —
    // Sonnet 5 reading the Thai, and the prompt learning that a printed total
    // outranks a sum assembled from line items. The café bill that came out at
    // ฿584.30 now reads ฿295 with no gate involved.
    //
    // So the pair is kept as a SIGNAL, not a verdict: the document is stored and
    // the person sees it flagged, which is the same protection without throwing
    // away their upload.
    const suspectReading = isUnreadableCapture({
      degradedCapture: imageQuality.warnings.length > 0,
      confidence: extracted.confidence_score,
    })
    if (suspectReading) {
      console.log(`[pipeline] ${documentId} degraded capture at confidence ${extracted.confidence_score} — flagging for review, not refusing`)
      extracted.extraction_issues = [
        ...(extracted.extraction_issues ?? []),
        "ภาพซีดหรือไม่ชัด และระบบเองก็ไม่มั่นใจในการอ่าน — ควรเทียบกับใบเสร็จจริงก่อนใช้ตัวเลขนี้",
      ]
    }

    // ── Step 2.7 — Reject an impossible tax ID ──────────────────────────────
    // A tax ID is the merchant's identity: the vendor registry keys on it, the
    // training corpus splits on it, and merchant lookups will resolve by it. So
    // a wrong one does not stay a wrong string in one row — it merges two
    // unrelated shops, or splits one shop in two, and everything downstream
    // inherits that. Production stored "0000000000000" on doc 3e3e4d8e, which
    // passes every length check there is, and two different "CP All" IDs on two
    // 7-Eleven receipts. The mod-11 check digit settles both on the spot.
    if (extracted.vendor_tax_id && !isValidThaiTaxId(extracted.vendor_tax_id)) {
      console.log(`[pipeline] ${documentId} dropping invalid tax id ${extracted.vendor_tax_id}`)
      extracted.extraction_issues = [
        ...(extracted.extraction_issues ?? []),
        `เลขผู้เสียภาษี ${extracted.vendor_tax_id} ไม่ผ่านการตรวจสอบ check digit — ไม่บันทึก`,
      ]
      extracted.vendor_tax_id = null
    }

    // ── Step 3 — Validation ──────────────────────────────────────────────────
    await updateProgress(documentId, "validating", 75)

    // ── Step 3.5 — Scope gate: financial documents only ─────────────────────
    // A selfie or a screenshot has, by this point, already cost a full read —
    // there is no cheaper moment to know. What is still worth protecting is the
    // user's monthly quota, which was being spent on files the product cannot
    // use, and their document list, which was collecting junk rows.
    const scope = checkDocumentScope(extracted)
    if (!scope.accepted) {
      console.log(`[pipeline] ${documentId} rejected — not a financial document (category=${extracted.doc_category})`)

      // Give the quota slot back. Burning one on a mistaken photo is how a
      // wrong tap turns into "the app ate my document allowance".
      await supabase.rpc("decrement_doc_used", { p_org_id: organizationId }).then(
        () => {}, (e: Error) => console.warn("[pipeline] quota refund failed:", e.message),
      )

      await supabase.from("documents")
        .update({ status: "rejected", notes: scope.reason, updated_at: new Date().toISOString() })
        .eq("id", documentId)

      // The mobile clients no longer sit on a review screen watching this
      // document, so the rejection has to survive being missed: the iOS
      // dashboard shows it as an alert once, and this row is what's left to
      // find afterwards in the bell / notifications page.
      void createNotification({
        type: "document_rejected",
        title: "เอกสารไม่เข้าเกณฑ์ — คืนเครดิตแล้ว",
        body: scope.reason,
        organizationId,
        metadata: { document_id: documentId, doc_category: extracted.doc_category ?? null },
      })

      // Repeated rejections from one account is one of the abuse signals — this
      // is the only place that fact is observable.
      void recordActivity({
        action: "document.rejected", outcome: "rejected",
        orgId: organizationId, resourceType: "document", resourceId: documentId,
        detail: "ไม่ใช่เอกสารทางการเงิน",
        metadata: { doc_category: extracted.doc_category ?? null },
      })

      return {
        success: false, documentId, confidence_score: 0, auto_approved: false,
        warnings: [], error: scope.reason,
      }
    }

    const validation = await validateDocument(extracted, organizationId, documentId, localOcrHint)

    // ── Step 4 — Persist to DB ───────────────────────────────────────────────
    await updateProgress(documentId, "saving", 90)

    const autoApprove = shouldAutoApprove(validation, extracted.doc_category)
    const newStatus   = autoApprove ? "approved" : "reviewing"

    // Upsert line items
    await supabase.from("document_line_items").delete().eq("document_id", documentId)
    if (extracted.line_items?.length) {
      await supabase.from("document_line_items").insert(
        extracted.line_items.map((item, i) => ({
          document_id:  documentId,
          description:  item.description,
          quantity:     item.quantity,
          unit_price:   item.unit_price,
          amount:       item.amount,
          confidence:   item.confidence,
          sort_order:   i,
        }))
      )
    }

    // Update document with extracted + classification fields
    const { error: updateErr } = await supabase
      .from("documents")
      .update({
        status:            newStatus,

        // Vendor / issuer
        vendor_name:       extracted.vendor_name,
        company_name:      extracted.company_name,
        vendor_tax_id:     extracted.vendor_tax_id,
        vendor_address:    extracted.vendor_address,
        company_address:   extracted.company_address,
        vendor_phone:      extracted.vendor_phone,

        // Document identity
        doc_type:          extracted.doc_type,
        doc_number:        extracted.doc_number,
        doc_date:          extracted.doc_date,
        due_date:          extracted.due_date,

        // Amounts
        subtotal:          extracted.subtotal,
        discount_amount:   extracted.discount_amount,
        delivery_fee:      extracted.delivery_fee,
        vat_amount:        extracted.vat_amount,
        wht_amount:        extracted.wht_amount,
        total_amount:      extracted.total_amount,
        currency:          extracted.currency,

        // Classification & business-use
        doc_category:      extracted.doc_category,
        vat_claimable:     extracted.vat_claimable,
        expense_claimable: extracted.expense_claimable,
        business_use_note: extracted.business_use_note,
        platform_name:     extracted.platform_name,
        platform_ref:      extracted.platform_ref      || null,
        customer_name:     extracted.customer_name     || null,
        staff_name:        extracted.staff_name        || null,

        // Other
        payment_method:    extracted.payment_method,
        notes:             extracted.notes,

        // Confidence & meta
        overall_confidence: validation.confidence_score,
        confidence:         extracted.field_confidence,
        ai_raw_response:    extracted,          // jsonb — pass object, not JSON.stringify
        extracted_at:       new Date().toISOString(),
        updated_at:         new Date().toISOString(),

        // Validation + AI-reported issues
        validation_issues:   validation.warnings.map(w => w.code),
        validation_warnings: validation.warnings,
        machine_verification_status: validation.machine_verification_status,
        reconciliation_status: validation.reconciliation.status,
        reconciliation_details: validation.reconciliation,
        ...(extracted.extraction_issues?.length
          ? { notes: extracted.extraction_issues.join("\n") }
          : {}),
        is_duplicate:      validation.is_duplicate,
        duplicate_of:      validation.duplicate_doc_id ?? null,
      })
      .eq("id", documentId)

    if (updateErr) {
      throw new Error(`DB update failed: ${updateErr.message} (hint: migration 007 อาจยังไม่ได้ apply)`)
    }

    // Vendor upsert — fire-and-forget, never blocks pipeline
    upsertVendor(organizationId, extracted).catch(err =>
      console.warn("[vendor] background upsert error:", err?.message)
    )

    // ── Pattern Mining — อัพเดต error patterns จาก corrections ล่าสุด ────────
    //
    // The window used to be 24 hours "for speed", and that single choice made
    // the entire learning loop dead on arrival: corrections arrive in bursts
    // when somebody sits down to review a batch, then nothing for weeks. Mining
    // only yesterday meant that on almost every run there was nothing to mine —
    // 19 corrections had accumulated in production, 6 of them repeating the same
    // mistake often enough to qualify as a pattern, and `ocr_error_patterns` was
    // still empty. The model kept making errors users had already corrected.
    //
    // Ninety days is bounded by the 500-row cap above, so this stays cheap while
    // actually seeing the corrections that exist.
    const since = new Date(Date.now() - PATTERN_MINING_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    mineErrorPatterns(organizationId, since).catch(err =>
      console.warn("[pattern-miner] background mining error:", err?.message)
    )

    // ── Life Graph population — only for approved documents ──────────────────
    // Builds: life_merchants, life_events, life_memories
    // Core principle (CLAUDE.md): every document enriches the Life Graph.
    if (autoApprove) {
      populateLifeGraph(documentId, organizationId).catch(err =>
        console.warn("[life-graph] population error:", err?.message)
      )
    }

    // Audit log
    await supabase.from("document_audit_logs").insert({
      document_id: documentId,
      action:      autoApprove ? "auto_approved" : "extracted",
      actor:       "pipeline",
      metadata:    {
        confidence_score: validation.confidence_score,
        doc_category:     extracted.doc_category,
        vat_claimable:    extracted.vat_claimable,
        warnings:         validation.warnings.map(w => w.code),
        auto_approved:    autoApprove,
        machine_verification_status: validation.machine_verification_status,
        reconciliation_status: validation.reconciliation.status,
      },
    })

    return {
      success:          true,
      documentId,
      confidence_score: validation.confidence_score,
      auto_approved:    autoApprove,
      warnings:         validation.warnings.map(w => w.message),
      machine_verification_status: validation.machine_verification_status,
      reconciliation:   validation.reconciliation,
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await setStatus(documentId, "failed", toUserMessage(msg))
    return fail(documentId, msg)
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function setStatus(documentId: string, status: string, errorMsg?: string) {
  const supabase = createClient()
  await supabase
    .from("documents")
    .update({
      status,
      ...(errorMsg ? { notes: `Pipeline error: ${errorMsg}` } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId)
}

async function updateProgress(documentId: string, stage: string, pct: number) {
  const supabase = createClient()
  await supabase
    .from("documents")
    .update({
      processing_stage:   stage,
      processing_percent: pct,
      updated_at:         new Date().toISOString(),
    })
    .eq("id", documentId)
}

function fail(documentId: string, error: string): PipelineResult {
  return { success: false, documentId, confidence_score: 0, auto_approved: false, warnings: [], error }
}

/**
 * Create sibling document records for additional documents detected in the same image.
 * Each sibling reuses the same file_path but gets its own DB row and full pipeline run.
 */
async function createSiblingDocuments(
  sourceDocId:    string,
  organizationId: string,
  filePath:       string,
  siblings:       ExtractedDocument[],
): Promise<void> {
  const supabase = createClient()

  // Look up the source document to copy its uploader / metadata
  const { data: source } = await supabase
    .from("documents")
    .select("uploaded_by, original_name")
    .eq("id", sourceDocId)
    .single()

  for (let i = 0; i < siblings.length; i++) {
    const sib = siblings[i]

    // Create a new document row pointing at the same file
    const { data: newDoc, error } = await supabase
      .from("documents")
      .insert({
        organization_id: organizationId,
        uploaded_by:     source?.uploaded_by ?? null,
        file_path:       filePath,
        original_name:   source?.original_name
          ? `${source.original_name} (doc ${i + 2})`
          : `document (doc ${i + 2})`,
        status:          "processing",
        processing_stage:   "extracting",
        processing_percent: 40,
        created_at:      new Date().toISOString(),
        updated_at:      new Date().toISOString(),
      })
      .select("id")
      .single()

    if (error || !newDoc) {
      console.warn(`[pipeline] failed to create sibling doc ${i + 2}:`, error?.message)
      continue
    }

    // Persist extracted data immediately (skip re-running extractor; we already have the data)
    const validation = await validateDocument(sib, organizationId, newDoc.id)
    const autoApprove = shouldAutoApprove(validation, sib.doc_category)

    await supabase.from("documents").update({
      status:            autoApprove ? "approved" : "reviewing",
      vendor_name:       sib.vendor_name,
      vendor_tax_id:     sib.vendor_tax_id,
      vendor_address:    sib.vendor_address,
      vendor_phone:      sib.vendor_phone,
      doc_type:          sib.doc_type,
      doc_number:        sib.doc_number,
      doc_date:          sib.doc_date,
      due_date:          sib.due_date,
      subtotal:          sib.subtotal,
      discount_amount:   sib.discount_amount,
      delivery_fee:      sib.delivery_fee,
      vat_amount:        sib.vat_amount,
      wht_amount:        sib.wht_amount,
      total_amount:      sib.total_amount,
      currency:          sib.currency,
      doc_category:      sib.doc_category,
      vat_claimable:     sib.vat_claimable,
      expense_claimable: sib.expense_claimable,
      business_use_note: sib.business_use_note,
      platform_name:     sib.platform_name,
      platform_ref:      sib.platform_ref      || null,
      customer_name:     sib.customer_name     || null,
      staff_name:        sib.staff_name        || null,
      payment_method:    sib.payment_method,
      notes:             sib.notes,
      overall_confidence: validation.confidence_score,
      confidence:         sib.field_confidence,
      ai_raw_response:    sib,
      extracted_at:       new Date().toISOString(),
      validation_issues:   validation.warnings.map(w => w.code),
      validation_warnings: validation.warnings,
      machine_verification_status: validation.machine_verification_status,
      reconciliation_status: validation.reconciliation.status,
      reconciliation_details: validation.reconciliation,
      is_duplicate:      validation.is_duplicate,
      duplicate_of:      validation.duplicate_doc_id ?? null,
      processing_stage:   "saving",
      processing_percent: 90,
      updated_at:         new Date().toISOString(),
    }).eq("id", newDoc.id)

    // Upsert line items for sibling
    if (sib.line_items?.length) {
      await supabase.from("document_line_items").insert(
        sib.line_items.map((item, idx) => ({
          document_id: newDoc.id,
          description: item.description,
          quantity:    item.quantity,
          unit_price:  item.unit_price,
          amount:      item.amount,
          confidence:  item.confidence,
          sort_order:  idx,
        }))
      )
    }

    // Vendor upsert — fire-and-forget
    upsertVendor(organizationId, sib).catch(err =>
      console.warn("[vendor] sibling upsert error:", err?.message)
    )

    await supabase.from("document_audit_logs").insert({
      document_id: newDoc.id,
      action:      autoApprove ? "auto_approved" : "extracted",
      actor:       "pipeline",
      metadata:    {
        source:           "multi_doc_sibling",
        parent_doc_id:    sourceDocId,
        confidence_score: validation.confidence_score,
        doc_category:     sib.doc_category,
        auto_approved:    autoApprove,
      },
    })

    console.log(`[pipeline] sibling doc ${newDoc.id} created from ${sourceDocId} (doc ${i + 2})`)
  }
}

/** Map a technical error message to a user-friendly Thai string stored in doc.notes */
function toUserMessage(msg: string): string {
  const m = msg.toLowerCase()
  // Our billing problem, not the user's document. Said first, because every
  // test below would otherwise mislabel it: an out-of-credit 400 mentions
  // neither the image nor the JSON, so it fell through to the raw-error dump
  // and five perfectly good receipts were reported as unreadable.
  if (classifyFailure(msg) === "provider") return PROVIDER_OUTAGE_NOTE
  if (m.includes("json") || m.includes("parse") || m.includes("unexpected token") || m.includes("syntax")) {
    return "AI ไม่สามารถอ่านข้อมูลจากเอกสารได้ — รูปภาพอาจไม่ชัดเจน หรือไม่ใช่เอกสารทางการเงิน กรุณาลองถ่ายรูปใหม่ให้ชัดและตรง"
  }
  if (m.includes("download failed") || m.includes("storage")) {
    return "ดาวน์โหลดไฟล์ไม่สำเร็จ — กรุณาลองอัปโหลดไฟล์ใหม่อีกครั้ง"
  }
  if (m.includes("rate_limit") || m.includes("overloaded") || m.includes("529")) {
    return "บริการ AI มีผู้ใช้งานหนาแน่น — กรุณาลองใหม่ในอีกสักครู่"
  }
  if (m.includes("image") || m.includes("base64") || m.includes("media_type")) {
    return "ไม่สามารถประมวลผลรูปภาพได้ — กรุณาอัปโหลดเป็นไฟล์ JPG, PNG หรือ PDF"
  }
  if (m.includes("timeout") || m.includes("timed out")) {
    return "การประมวลผลใช้เวลานานเกินไป — กรุณาลองใหม่ หรือลองส่งไฟล์ขนาดเล็กกว่านี้"
  }
  return `เกิดข้อผิดพลาดในการประมวลผล — ${msg.slice(0, 120)}`
}
