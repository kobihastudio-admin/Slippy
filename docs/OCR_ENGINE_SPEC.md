# OCR Engine

Status: **derived from code** (`api/src/pipeline/`, at the commit that introduced this file). Where this document and the code disagree, the code is right; fix this document.

Scope: how a receipt, tax invoice, slip, invoice or credit note becomes structured data. How a document *gets* to the pipeline (channels, queue, retries) is in [document-ingestion.md](document-ingestion.md). Medication labels (`medication-label.ts`) and travel documents (`travel-doc.ts`) are separate readers with their own prompts and are out of scope here.

## Entry point

`runPipeline(documentId, organizationId, localOcrHint?, userConfirmed?)` in `pipeline/index.ts`. It never trusts the caller for the file: it reads `documents.file_path`, and skips a document whose status is already `pushed`.

## Stages

| # | Stage | Module | What happens |
|---|---|---|---|
| 1 | Prepare images | `preprocessor.ts` | Download from Supabase Storage. PDF → page images; HEIC/HEIF and orientation normalised; output JPEG (quality 95) at a 2576 px long edge. A tall receipt is cut into up to 5 overlapping slices (12% overlap) so Thai text reaches the model at readable width. |
| 2 | Quality check | `image-quality.ts` | Measures blur, darkness, ink contrast and resolution (minimum short side 1200 px). Produces warnings that are injected into the prompt and mark the capture as *degraded*. |
| 3 | Learning context | `few-shot.ts`, `pattern-miner.ts`, `receipt-feedback.ts` | In parallel: recent approved documents and per-vendor corrections (few-shot), learned OCR error patterns, and learned row-role overrides. All fail soft; they never block extraction. |
| 4 | Pre-read + classify | `extractor.ts` `ocrAndClassify` | One Haiku call reads all visible text and picks a category. Failure is tolerated (treated as unknown, assumed Thai). |
| 5 | Extraction | `extractor.ts` `extractDocument` | Vision model returns one JSON document, or a `multi_doc` wrapper when a photo holds several. Model routing below. |
| 6 | Post-processing | `index.ts` | Vendor name normalisation; tax-ID registry lookup (12 s bound); user-confirmed fields applied; suspect-reading flag; tax-ID check-digit test; scope gate. |
| 7 | Validation | `validator.ts` | Rules, duplicate detection, reconciliation, final confidence, machine-verification status. |
| 8 | Persist | `index.ts` | Line items replaced, document row updated, audit log written, vendor upsert and pattern mining run in the background. |

Progress is written to the document as `preprocessing` (10) → `extracting` (40) → `validating` (75) → `saving` (90).

## Model routing

Models: Haiku `claude-haiku-4-5-20251001`, Sonnet `claude-sonnet-5`. Token caps: Haiku 1500, Sonnet 8192 (Sonnet's adaptive thinking shares the cap). At most 3 pages, or 5 when the pages are slices of one receipt.

The plan is mapped to a tier by `getModelTier` (`model-tier.ts`): `free`, `starter` → `haiku`; `pro`, `team` → `smart`; `premium`, `business`, `enterprise` → `priority`. A missing or unknown plan resolves to `smart`.

Sonnet reads the document first if **any** of these holds, in this order: tier is `priority`; the capture is degraded (`ESCALATE_ON_LOW_QUALITY` not `0`); the pre-read contains Thai script. Otherwise Haiku reads it when the tier is `haiku`, or when the pre-read category is `receipt` or `consumer_receipt`. In practice, Thai documents go to Sonnet.

Escalations, in order:
1. **Haiku → Sonnet:** if Haiku was the first reader and confidence is below 0.72; the Sonnet result replaces it only if its confidence is at least as high.
2. **Document AI retry:** the Google Document AI pass runs when confidence < 0.65, any line item's confidence < 0.65, line items do not sum to the subtotal (tolerance 2% or ฿2, whichever is larger), or a degraded capture has Thai line items (`DOCAI_ON_LOW_QUALITY` not `0`). Master switch `DOCAI_ENABLED=0`; optional Thai grounding `DOCAI_THAI_GROUNDING=1`. Only its **numbers** are passed on (it cannot read Thai script). Sonnet re-reads with those numbers and the retry replaces the result only if it scores better (`min(confidence, min line-item confidence)`, minus 0.5 for a sum mismatch).
3. **Provider outage:** if the model call fails with a billing/credential error, the extractor falls back to Document AI only; if that also yields nothing, the error is raised.

The client's on-device OCR hint (iOS, Apple Vision) is passed as a tie-breaker section of the prompt; the image always takes priority over any OCR text.

## Output shape

`ExtractedDocument` (see `extractor.ts`): classification (`doc_category`, legacy `doc_type`, `vat_claimable`, `expense_claimable`, `business_use_note`); vendor/issuer (`vendor_name` as printed, `company_name` = registered entity, `vendor_tax_id`, addresses, phone); identifiers (`doc_number`, `doc_date` YYYY-MM-DD, `due_date`); amounts (`subtotal`, `discount_amount`, `delivery_fee`, `vat_amount`, `wht_amount`, `total_amount`, `paid_amount`, `currency`); platform fields (`platform_name`, `platform_ref`, `customer_name`, `staff_name`); `payment_method`, `notes`, `line_items` (description, quantity, unit price, amount, confidence); `confidence_score`, per-field `field_confidence`, and `extraction_issues`.

Categories: `tax_invoice_full`, `tax_invoice_simplified`, `receipt_with_tax`, `receipt`, `consumer_receipt`, `invoice`, `credit_note`, `other`. VAT-claimable: `tax_invoice_full`, `receipt_with_tax`, `credit_note`. Expense-claimable: all except `other`.

## Amounts and rows

All monetary relations (VAT 7%, inclusive/exclusive conventions, rounding) live in `amounts.ts`; other modules must not derive money themselves. `receipt-rows.ts` classifies every printed row deterministically into a role (`item`, `freebie`, `discount`, `service_charge`, `delivery_fee`, `subtotal`, `vat`, `total`, `tender`, `change`, `rounding`, `loyalty`, `count`), so labels such as tender or change are not counted as items. Users' corrections feed back as learned overrides.

## Post-processing rules

- **Vendor name:** static brand aliases, then fuzzy match against the organisation's vendors (`merchant-normalizer.ts`).
- **Tax ID:** a Bill-Payment QR value from the client overrides the OCR value. A 13-digit ID is resolved to the official juristic name through the vendor-registry provider chain and cached in `merchant_directory`; it fills `company_name` and never rewrites `vendor_name`. An ID that fails the Thai mod-11 check digit is dropped (set to `null`, with an issue recorded).
- **User-confirmed fields** (vendor, tax ID, type, number, date, amounts, payment method) override the AI's values.
- **Suspect reading:** a degraded capture with confidence < 0.6 is flagged with a Thai issue message; the document is still stored (it used to be refused).
- **Scope gate** (`scope-gate.ts`): accepted if the category is one of the seven financial categories, or if the document has a positive total/subtotal or any line items. Otherwise the document is set to `rejected`, the monthly quota slot is refunded (`decrement_doc_used`), and a notification and activity record are written.

## Validation and confidence

`validateDocument` starts from the model's `confidence_score` and subtracts:

| Code | Deduction |
|---|---|
| `MISSING_VENDOR` | 0.20 |
| `MISSING_DOC_NUM` | 0.10 |
| `MISSING_DATE` | 0.10 |
| `ZERO_TOTAL` | 0.25 |
| `VAT_MISMATCH` | 0.10 |
| `TOTAL_MISMATCH` | 0.20 consumer categories, otherwise 0.15 |
| `LINE_ITEM_SUM_MISMATCH` | 0.15 |
| `INVALID_DATE` | 0.10 |
| `FUTURE_DATE` | 0.05 |
| `DUPLICATE` | 0.30 |
| `INVALID_TAX_ID` | 0.05 |

`OLD_DATE` (older than 2 years) raises a warning with no deduction. Duplicates are looked for in three ways, in order: same `platform_ref`, same `doc_number`, then same vendor name plus total.

The final score is then capped by a **ceiling**: 0.50 if the client's on-device total disagrees with the extracted total (tolerance 2% or ฿1); 0.80 if there is no client total to compare; 0.70 if the total reconciliation fails, 0.90 if it could not be checked. `is_valid` requires a score of at least 0.4 and no `ZERO_TOTAL`.

`machine_verification_status`: `unverified` (invalid or score < 0.4), `verified` (score ≥ 0.85, reconciliation `balanced`, and none of `DUPLICATE`, `ZERO_TOTAL`, `TOTAL_MISMATCH`, `LINE_ITEM_SUM_MISMATCH`), otherwise `needs_review`. Reconciliation (`total` and `line_items`) is stored as `reconciliation_status` / `reconciliation_details`.

## Auto-approval

`shouldAutoApprove` never approves a document with a blocking warning (`DUPLICATE`, `ZERO_TOTAL`, `TOTAL_MISMATCH`, `LINE_ITEM_SUM_MISMATCH`). Both thresholds are set to **1.0** (code comment: "disabled — always require review"), so approval needs a perfect score, which the ceilings above make rare. Documents normally end as `reviewing`. Only approved documents populate the Life Graph.

## Failure handling

`failure-kind.ts` classifies errors: `provider` (billing, credentials — never retried, never blamed on the document), `transient` (rate limit, overload, timeout — retried), `document` (unreadable image, bad JSON), `unknown`. Provider and transient failures are replayed automatically: `services/recover-stranded.ts` sweeps every 5 minutes, up to 20 documents per sweep, and replays stranded or provider-outage documents. Document errors set status `failed` with a user-facing message.

## Cost and usage

`usage-meter.ts` records tokens per call with a phase (`ocr`, `extract`, `escalate`, `docai_retry`) tied to the document and organisation; `/health/queue` exposes a snapshot. `cost-tracker.ts` logs per-document cost into the audit log metadata. Rates are approximate.

## Configuration

| Variable | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Vision models |
| `GOOGLE_CLOUD_PROJECT`, `GOOGLE_DOC_AI_LOCATION`, `GOOGLE_DOC_AI_PROCESSOR_ID`, `GOOGLE_CREDENTIALS_JSON` or `GOOGLE_APPLICATION_CREDENTIALS` | Document AI |
| `SUPABASE_STORAGE_BUCKET` | Source bucket (default `documents`) |
| `ESCALATE_ON_LOW_QUALITY=0` | Do not force Sonnet on degraded captures |
| `DOCAI_ENABLED=0` | Disable the Document AI retry |
| `DOCAI_ON_LOW_QUALITY=0` | Disable the quality-triggered retry only |
| `DOCAI_THAI_GROUNDING=1` | Ground every Thai document in Document AI numbers |
| `RUN_WORKERS`, `EXTRACTION_CONCURRENCY` | See document-ingestion.md |

## Tests

`npm run verify` in `api/` chains `verify:amounts`, `verify:rows`, `verify:vendor`, `verify:vendor-registry`, `verify:ingest`, `verify:failures`, `verify:scope`, `verify:capture`, `verify:finetune`, `verify:learning`. The pipeline uses native modules (`sharp`, `esbuild`); on Apple Silicon run them with an arm64 Node, not an x64 Node under Rosetta.

## Known discrepancies in the code

- The comment above `AUTO_APPROVE_THRESHOLD` in `validator.ts` describes a 0.80 bar for consumer receipts; the constants are 1.0.
