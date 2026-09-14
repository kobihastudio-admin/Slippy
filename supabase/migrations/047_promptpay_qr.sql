-- ─────────────────────────────────────────────────────────────────────────────
-- 047_promptpay_qr.sql
-- Adds a PromptPay ID (phone number or national ID) that group hosts can set
-- so participants get a dynamic QR (amount pre-filled) to transfer payment to.
--   - sport_groups.promptpay_id — default for recurring groups
--   - split_bills.promptpay_id  — override for a single session (falls back
--                                  to the sport_groups value if null)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE sport_groups
  ADD COLUMN IF NOT EXISTS promptpay_id text;
ALTER TABLE split_bills
  ADD COLUMN IF NOT EXISTS promptpay_id text;
