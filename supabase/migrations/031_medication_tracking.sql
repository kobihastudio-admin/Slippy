-- ═══════════════════════════════════════════════════════════════════════════
-- 031_medication_tracking.sql — Medication Management
-- Part of Lifestyle Domain in Life Graph
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Medication Registry ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS medications (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id  uuid    REFERENCES organizations(id) ON DELETE CASCADE,
  -- Identity
  name             text    NOT NULL,           -- ชื่อยา เช่น "ยาลดความดัน"
  brand_name       text,                       -- ชื่อการค้า เช่น "Norvasc"
  generic_name     text,                       -- ชื่อสามัญ เช่น "Amlodipine"
  -- Form & strength
  dosage_form      text    DEFAULT 'tablet'    -- tablet|capsule|liquid|inhaler|injection|other
    CHECK (dosage_form IN ('tablet','capsule','liquid','inhaler','injection','patch','cream','other')),
  strength         text,                       -- เช่น "5mg", "500mg/5ml"
  -- Source
  document_id      uuid    REFERENCES documents(id) ON DELETE SET NULL,  -- ใบเสร็จร้านยา
  prescribed_by    text,                       -- ชื่อแพทย์/เภสัชกร (optional)
  -- Category
  category         text    DEFAULT 'general'
    CHECK (category IN ('chronic','prescription','supplement','vitamin','otc','other','general')),
  purpose          text,                       -- ใช้สำหรับอะไร เช่น "ลดความดัน"
  -- Flags
  is_active        bool    NOT NULL DEFAULT true,
  is_chronic       bool    NOT NULL DEFAULT false,  -- ยาเรื้อรัง กินต่อเนื่อง
  notes            text,
  color            text,                       -- สีของยา (ช่วยจำ)
  image_url        text,                       -- รูปยา
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_med_user   ON medications(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_med_doc    ON medications(document_id) WHERE document_id IS NOT NULL;
-- ─── Dosage Schedules ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS medication_schedules (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_id    uuid    NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  user_id          uuid    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Schedule
  times            text[]  NOT NULL DEFAULT '{"08:00"}',  -- เวลากิน เช่น ['07:00','19:00']
  days_of_week     int[]   DEFAULT NULL,  -- NULL = ทุกวัน, [1..7] = วันเฉพาะ
  dose_qty         numeric(6,2) NOT NULL DEFAULT 1,  -- กี่เม็ดต่อครั้ง
  -- Meal relation
  meal_relation    text    DEFAULT 'any'
    CHECK (meal_relation IN ('before','after','with','any')),
  meal_note        text,                       -- เช่น "หลังอาหาร 30 นาที"
  -- Reminders
  reminder_enabled bool    NOT NULL DEFAULT true,
  reminder_minutes int     DEFAULT 0,          -- แจ้งเตือนล่วงหน้ากี่นาที
  reminder_via     text    DEFAULT 'line'
    CHECK (reminder_via IN ('line','app','both','none')),
  -- Duration
  start_date       date    DEFAULT CURRENT_DATE,
  end_date         date,                       -- NULL = ต่อเนื่อง
  -- Status
  is_active        bool    NOT NULL DEFAULT true,
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_msched_user ON medication_schedules(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_msched_med  ON medication_schedules(medication_id);
-- ─── Inventory Tracking ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS medication_inventory (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_id    uuid    NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  user_id          uuid    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Stock
  qty_remaining    numeric(8,2) NOT NULL DEFAULT 0,  -- จำนวนที่เหลือ (เม็ด/ml)
  qty_unit         text    DEFAULT 'เม็ด',           -- หน่วย
  qty_per_pack     numeric(8,2),                     -- จำนวนต่อกล่อง (สำหรับสั่งซื้อ)
  -- Alerts
  low_stock_alert  numeric(8,2) DEFAULT 7,           -- แจ้งเตือนเมื่อเหลือกี่เม็ด
  expiry_date      date,                             -- วันหมดอายุ
  expiry_alert_days int DEFAULT 30,                  -- แจ้งเตือนก่อนหมดอายุกี่วัน
  -- Price tracking
  price_per_unit   numeric(10,2),                    -- ราคาต่อเม็ด
  last_purchased_at date,
  last_purchased_qty numeric(8,2),
  -- Meta
  storage_note     text,                             -- เก็บในตู้เย็น, ไม่โดนแสง ฯลฯ
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  UNIQUE (medication_id, user_id)
);
-- ─── Medication Logs ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS medication_logs (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id      uuid    NOT NULL REFERENCES medication_schedules(id) ON DELETE CASCADE,
  medication_id    uuid    NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  user_id          uuid    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Timing
  scheduled_at     timestamptz NOT NULL,             -- เวลาที่ควรกิน
  taken_at         timestamptz,                      -- เวลาที่กินจริง (NULL = ข้าม/ลืม)
  -- Status
  status           text    NOT NULL DEFAULT 'pending'
    CHECK (status IN ('taken','skipped','late','missed','pending')),
  dose_taken       numeric(6,2),                     -- กี่เม็ดที่กินจริง
  -- Note
  note             text,                             -- บันทึกเพิ่มเติม
  side_effects     text,                             -- ผลข้างเคียงที่สังเกตได้ (optional)
  -- Source
  confirmed_via    text DEFAULT 'app'
    CHECK (confirmed_via IN ('app','line','auto')),
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mlog_user      ON medication_logs(user_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_mlog_schedule  ON medication_logs(schedule_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_mlog_status    ON medication_logs(user_id, status, scheduled_at DESC);
-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE medications           ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication_schedules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication_inventory  ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication_logs       ENABLE ROW LEVEL SECURITY;
CREATE POLICY "med_own"   ON medications           FOR ALL USING (user_id = auth.uid());
CREATE POLICY "msched_own" ON medication_schedules  FOR ALL USING (user_id = auth.uid());
CREATE POLICY "minv_own"  ON medication_inventory  FOR ALL USING (user_id = auth.uid());
CREATE POLICY "mlog_own"  ON medication_logs       FOR ALL USING (user_id = auth.uid());
-- ─── Adherence stats view ─────────────────────────────────────────────────────
CREATE OR REPLACE VIEW medication_adherence AS
SELECT
  user_id,
  medication_id,
  DATE_TRUNC('month', scheduled_at) AS month,
  COUNT(*)                           AS total_doses,
  COUNT(*) FILTER (WHERE status = 'taken')   AS taken,
  COUNT(*) FILTER (WHERE status = 'skipped') AS skipped,
  COUNT(*) FILTER (WHERE status = 'missed')  AS missed,
  COUNT(*) FILTER (WHERE status = 'late')    AS late,
  ROUND(
    COUNT(*) FILTER (WHERE status IN ('taken','late'))::numeric
    / NULLIF(COUNT(*) FILTER (WHERE status != 'pending'), 0) * 100, 1
  ) AS adherence_pct
FROM medication_logs
WHERE status != 'pending'
GROUP BY user_id, medication_id, DATE_TRUNC('month', scheduled_at);
-- ─── Function: Get pending reminders ─────────────────────────────────────────
-- Called by worker every minute to find due reminders
CREATE OR REPLACE FUNCTION get_pending_medication_reminders(
  p_from  timestamptz DEFAULT now(),
  p_to    timestamptz DEFAULT now() + interval '5 minutes'
)
RETURNS TABLE (
  log_id        uuid,
  user_id       uuid,
  medication_id uuid,
  med_name      text,
  dose_qty      numeric,
  meal_relation text,
  meal_note     text,
  scheduled_at  timestamptz,
  reminder_via  text
) LANGUAGE sql AS $$
  SELECT
    ml.id           AS log_id,
    ml.user_id,
    ml.medication_id,
    m.name          AS med_name,
    ms.dose_qty,
    ms.meal_relation,
    ms.meal_note,
    ml.scheduled_at,
    ms.reminder_via
  FROM medication_logs ml
  JOIN medication_schedules ms ON ms.id = ml.schedule_id
  JOIN medications m           ON m.id  = ml.medication_id
  WHERE
    ml.status        = 'pending'
    AND ms.reminder_enabled = true
    AND ml.scheduled_at - (ms.reminder_minutes * interval '1 minute')
        BETWEEN p_from AND p_to;
$$;
