-- ─────────────────────────────────────────────────────────────────────────────
-- 048_split_bill_receipt.sql
-- Lets the creator attach a receipt/slip photo when creating a "หารบิล"
-- (general split) group from /liff/split, stored in the existing
-- payment-proofs bucket under "receipts/{split_bill_id}.{ext}".
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE split_bills
  ADD COLUMN IF NOT EXISTS receipt_url text;
