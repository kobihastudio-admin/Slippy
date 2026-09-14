-- ═══════════════════════════════════════════════════════════════════════════
-- 075_personal_loans.sql — Personal loan tracking (condo/mortgage payoff)
--
-- Stores the loan's original terms (principal, rate, term) plus a payment
-- ledger. Actual interest/principal split per payment is NOT stored here —
-- it's derived at read time by web/src/lib/loan-ledger.ts by replaying the
-- payments against the loan's rate, month by month, the same "ลดต้นลดดอก"
-- logic as the what-if calculator (web/src/lib/loan-amortization.ts). This
-- keeps the split correct even if a payment is edited/deleted later, rather
-- than storing a snapshot that can drift out of sync.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS personal_loans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           text NOT NULL,
  lender         text,
  principal      numeric(14,2) NOT NULL CHECK (principal > 0),
  annual_rate_pct numeric(6,3) NOT NULL CHECK (annual_rate_pct >= 0),
  term_months    int NOT NULL CHECK (term_months > 0),
  start_date     date NOT NULL,
  is_archived    boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_personal_loans_user ON personal_loans(user_id);

CREATE TABLE IF NOT EXISTS personal_loan_payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id       uuid NOT NULL REFERENCES personal_loans(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payment_date  date NOT NULL,
  amount        numeric(14,2) NOT NULL CHECK (amount > 0),
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_personal_loan_payments_loan ON personal_loan_payments(loan_id, payment_date);

ALTER TABLE personal_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_loan_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "personal_loans_select" ON personal_loans FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "personal_loans_insert" ON personal_loans FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "personal_loans_update" ON personal_loans FOR UPDATE
  USING (auth.uid() = user_id);
CREATE POLICY "personal_loans_delete" ON personal_loans FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "personal_loan_payments_select" ON personal_loan_payments FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "personal_loan_payments_insert" ON personal_loan_payments FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "personal_loan_payments_update" ON personal_loan_payments FOR UPDATE
  USING (auth.uid() = user_id);
CREATE POLICY "personal_loan_payments_delete" ON personal_loan_payments FOR DELETE
  USING (auth.uid() = user_id);
;
