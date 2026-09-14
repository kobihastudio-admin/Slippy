-- ═══════════════════════════════════════════════════════════════════════════
-- 030_trip_management.sql
-- Trip Management: participants, expenses, settlement, payment QR
-- Extends life_journeys (already exists)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Extend life_journeys for trip management ─────────────────────────────────
ALTER TABLE life_journeys
  ADD COLUMN IF NOT EXISTS trip_type     text DEFAULT 'general'
    CHECK (trip_type IN ('travel','food_order','sport','general')),
  ADD COLUMN IF NOT EXISTS sport_type    text,          -- 'badminton','football','tennis',...
  ADD COLUMN IF NOT EXISTS venue         text,          -- สนาม/ร้าน
  ADD COLUMN IF NOT EXISTS event_date    date,          -- วันที่จัดกิจกรรม
  ADD COLUMN IF NOT EXISTS split_mode    text DEFAULT 'equal'
    CHECK (split_mode IN ('equal','individual','custom')),
  ADD COLUMN IF NOT EXISTS status        text DEFAULT 'active'
    CHECK (status IN ('active','settled','cancelled')),
  ADD COLUMN IF NOT EXISTS share_token   text UNIQUE,
  ADD COLUMN IF NOT EXISTS line_group_id text,          -- LINE group ที่สร้างทริปนี้
  ADD COLUMN IF NOT EXISTS base_fee      numeric(14,2) DEFAULT 0,  -- ค่าสนาม/ค่าจองเบื้องต้น
  ADD COLUMN IF NOT EXISTS notes         text;
CREATE INDEX IF NOT EXISTS idx_lj_share ON life_journeys(share_token) WHERE share_token IS NOT NULL;
-- ─── Trip Participants ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trip_participants (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id       uuid    NOT NULL REFERENCES life_journeys(id) ON DELETE CASCADE,
  -- identity
  user_id          uuid    REFERENCES users(id) ON DELETE SET NULL,
  line_user_id     text,
  display_name     text    NOT NULL,
  is_non_line      bool    NOT NULL DEFAULT false,
  -- payment info
  promptpay_type   text    CHECK (promptpay_type IN ('phone','national_id','qr_image',null)),
  promptpay_value  text,          -- เบอร์โทรหรือเลขบัตร
  qr_image_url     text,          -- URL ของรูป QR จากแอพธนาคาร
  -- settlement
  amount_owed      numeric(14,2) NOT NULL DEFAULT 0,   -- ต้องจ่ายทั้งหมด
  amount_paid      numeric(14,2) NOT NULL DEFAULT 0,   -- จ่ายไปแล้ว
  paid_at          timestamptz,
  -- flags
  is_host          bool    NOT NULL DEFAULT false,
  joined_at        timestamptz DEFAULT now(),
  created_at       timestamptz DEFAULT now(),
  UNIQUE (journey_id, line_user_id)
);
CREATE INDEX IF NOT EXISTS idx_tp_journey ON trip_participants(journey_id);
CREATE INDEX IF NOT EXISTS idx_tp_line    ON trip_participants(line_user_id);
-- ─── Trip Expenses ────────────────────────────────────────────────────────────
-- แต่ละรายจ่ายในทริป — เชื่อมกับ document (ใบเสร็จ) หรือ manual entry
CREATE TABLE IF NOT EXISTS trip_expenses (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id       uuid    NOT NULL REFERENCES life_journeys(id) ON DELETE CASCADE,
  document_id      uuid    REFERENCES documents(id) ON DELETE SET NULL,  -- ใบเสร็จ (optional)
  paid_by_id       uuid    NOT NULL REFERENCES trip_participants(id) ON DELETE CASCADE,
  title            text    NOT NULL,
  amount           numeric(14,2) NOT NULL DEFAULT 0,
  category         text,          -- 'food','transport','accommodation','activity','other'
  split_mode       text    DEFAULT 'equal'
    CHECK (split_mode IN ('equal','individual','exclude')),
  split_with       uuid[]  DEFAULT '{}',   -- participant IDs ที่แบ่งด้วย (empty = ทุกคน)
  note             text,
  expense_date     date    DEFAULT CURRENT_DATE,
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_te_journey ON trip_expenses(journey_id);
-- ─── Expense Splits (individual line) ────────────────────────────────────────
-- ใครต้องจ่ายเท่าไรในแต่ละ expense
CREATE TABLE IF NOT EXISTS expense_splits (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id       uuid    NOT NULL REFERENCES trip_expenses(id) ON DELETE CASCADE,
  participant_id   uuid    NOT NULL REFERENCES trip_participants(id) ON DELETE CASCADE,
  amount           numeric(14,2) NOT NULL DEFAULT 0,
  is_paid          bool    NOT NULL DEFAULT false,
  UNIQUE (expense_id, participant_id)
);
-- ─── Payment Confirmations ────────────────────────────────────────────────────
-- หลักฐานการโอนเงิน (รูปสลิป/หลักฐาน)
CREATE TABLE IF NOT EXISTS trip_payments (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id       uuid    NOT NULL REFERENCES life_journeys(id) ON DELETE CASCADE,
  from_participant uuid    NOT NULL REFERENCES trip_participants(id) ON DELETE CASCADE,
  to_participant   uuid    NOT NULL REFERENCES trip_participants(id) ON DELETE CASCADE,
  amount           numeric(14,2) NOT NULL,
  slip_url         text,          -- รูปหลักฐานการโอน (optional)
  note             text,
  status           text    NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','disputed')),
  paid_at          timestamptz DEFAULT now(),
  confirmed_at     timestamptz,
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tpay_journey ON trip_payments(journey_id);
-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE trip_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_expenses     ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_splits    ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_payments     ENABLE ROW LEVEL SECURITY;
-- Org members + public share token access
CREATE POLICY "tp_org_member" ON trip_participants FOR ALL USING (
  journey_id IN (
    SELECT id FROM life_journeys
    WHERE organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "te_org_member" ON trip_expenses FOR ALL USING (
  journey_id IN (
    SELECT id FROM life_journeys
    WHERE organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "es_org_member" ON expense_splits FOR ALL USING (
  expense_id IN (
    SELECT id FROM trip_expenses WHERE journey_id IN (
      SELECT id FROM life_journeys WHERE organization_id IN (
        SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
      )
    )
  )
);
CREATE POLICY "tpay_org_member" ON trip_payments FOR ALL USING (
  journey_id IN (
    SELECT id FROM life_journeys
    WHERE organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  )
);
-- ─── Settlement calculation function ─────────────────────────────────────────
-- Computes who owes whom (minimum transactions algorithm)
CREATE OR REPLACE FUNCTION calculate_trip_settlement(p_journey_id uuid)
RETURNS TABLE (
  from_name  text,
  to_name    text,
  amount     numeric,
  from_id    uuid,
  to_id      uuid
) LANGUAGE plpgsql AS $$
DECLARE
  v_rec record;
  balances jsonb := '{}';
  v_participants uuid[];
  v_name text;
BEGIN
  -- Calculate net balance per participant
  -- (+) = others owe you, (-) = you owe others
  FOR v_rec IN
    SELECT
      p.id,
      p.display_name,
      -- Amount others owe this participant (paid for others)
      COALESCE(SUM(CASE WHEN te.paid_by_id = p.id THEN es.amount ELSE 0 END), 0) AS paid_for_others,
      -- Amount this participant owes others
      COALESCE(SUM(CASE WHEN es.participant_id = p.id AND te.paid_by_id != p.id THEN es.amount ELSE 0 END), 0) AS owes_to_others
    FROM trip_participants p
    LEFT JOIN expense_splits es ON es.participant_id = p.id
    LEFT JOIN trip_expenses te ON te.id = es.expense_id
    WHERE p.journey_id = p_journey_id
    GROUP BY p.id, p.display_name
  LOOP
    balances := balances || jsonb_build_object(
      v_rec.id::text,
      jsonb_build_object(
        'name', v_rec.display_name,
        'balance', v_rec.paid_for_others - v_rec.owes_to_others
      )
    );
  END LOOP;

  -- Simplified settlement: debtors pay creditors
  -- (Returns the minimum set of transactions)
  RETURN QUERY
  WITH balances_cte AS (
    SELECT
      (key)::uuid AS participant_id,
      (value->>'name') AS pname,
      (value->>'balance')::numeric AS balance
    FROM jsonb_each(balances)
  ),
  creditors AS (SELECT participant_id, pname, balance FROM balances_cte WHERE balance > 0.01),
  debtors   AS (SELECT participant_id, pname, balance FROM balances_cte WHERE balance < -0.01)
  SELECT
    d.pname AS from_name,
    c.pname AS to_name,
    LEAST(ABS(d.balance), c.balance) AS amount,
    d.participant_id AS from_id,
    c.participant_id AS to_id
  FROM debtors d, creditors c
  WHERE LEAST(ABS(d.balance), c.balance) > 0.01;
END;
$$;
