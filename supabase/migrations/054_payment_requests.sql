-- 054: Payment requests (PromptPay-first)
CREATE TABLE IF NOT EXISTS payment_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid REFERENCES organizations(id) ON DELETE CASCADE,
  requester_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payer_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  amount           numeric(14,2) NOT NULL,
  currency         text NOT NULL DEFAULT 'THB',
  description      text,
  promptpay_id     text,
  qr_payload       text,
  status           text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','expired','cancelled')),
  expires_at       timestamptz DEFAULT now() + interval '24 hours',
  paid_at          timestamptz,
  slip_doc_id      uuid REFERENCES documents(id) ON DELETE SET NULL,
  conversation_id  uuid REFERENCES conversations(id) ON DELETE SET NULL,
  split_bill_id    uuid REFERENCES split_bills(id) ON DELETE SET NULL,
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pr_payer     ON payment_requests(payer_id, status);
CREATE INDEX IF NOT EXISTS idx_pr_requester ON payment_requests(requester_id, status);
CREATE INDEX IF NOT EXISTS idx_pr_conv      ON payment_requests(conversation_id);
