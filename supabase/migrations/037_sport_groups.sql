-- ─────────────────────────────────────────────────────────────────────────────
-- 037_sport_groups.sql
-- "หารบิลกลุ่มกีฬา" — sport-group bill splitting (à la KhunThong), built on
-- top of the existing split_bills/split_participants tables from 015 + 022.
--
-- A "sport group" is just a split_bill with document_id = NULL and
-- category = 'sport'. The total court/equipment fee is split EVENLY across
-- whoever has joined by the time `/sportstatus` or `/splitdone` is run —
-- no document/line-items required (unlike the receipt-based /split flow).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE split_bills
  ADD COLUMN IF NOT EXISTS category   text,            -- 'sport' | 'receipt' (null = legacy receipt-based)
  ADD COLUMN IF NOT EXISTS sport_type text,            -- แบด/บาส/ฟุตบอล/...
  ADD COLUMN IF NOT EXISTS venue      text;
-- สนาม/สถานที่ (optional)

-- Allow document_id to be NULL for sport groups (already nullable per 015 — confirm)
COMMENT ON COLUMN split_bills.document_id IS
  'NULL for sport-group bills (category=sport) — those split a flat fee evenly, not document line items';
-- A participant has paid their even-split share
CREATE INDEX IF NOT EXISTS idx_split_parts_paid ON split_participants(split_bill_id, paid_at);
-- Helpful filter index for "active sport groups in this org"
CREATE INDEX IF NOT EXISTS idx_split_bills_category
  ON split_bills(organization_id, category, status)
  WHERE category = 'sport';
COMMENT ON COLUMN split_bills.category IS
  'sport = even-split group bill created via /sportgroup (LINE); null/receipt = document-based /split';
