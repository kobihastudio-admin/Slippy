-- Medication identity remains in medications; each treatment period is a course.
-- This migration is additive so legacy schedule/log readers continue to work.

ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE medication_inventory ADD COLUMN IF NOT EXISTS loc_code text;
ALTER TABLE medication_inventory ADD COLUMN IF NOT EXISTS lot_no text;

-- medical_providers already exists (20260831030000_medication_tracking_expansion.sql,
-- type CHECK IN ('hospital','clinic','pharmacy') — that's the enum the web/iOS
-- provider picker UI is built against, kept as canonical). Only add what this
-- migration's trigger needs.
ALTER TABLE medical_providers ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE medication_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_id uuid NOT NULL REFERENCES medications(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'stopped', 'completed')),
  start_date date NOT NULL DEFAULT current_date,
  planned_end_date date,
  actual_end_at timestamptz,
  provider_id uuid REFERENCES medical_providers(id) ON DELETE SET NULL,
  prescribed_by text,
  doctor_instructions text,
  instruction_source text NOT NULL DEFAULT 'user'
    CHECK (instruction_source IN ('label', 'doctor', 'pharmacist', 'user')),
  resume_review_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (planned_end_date IS NULL OR planned_end_date >= start_date),
  CHECK (
    (status IN ('stopped', 'completed') AND actual_end_at IS NOT NULL)
    OR (status IN ('active', 'paused'))
  )
);

CREATE UNIQUE INDEX medication_courses_one_open_per_medication
  ON medication_courses(user_id, medication_id)
  WHERE status IN ('active', 'paused');
CREATE INDEX medication_courses_user_status_idx
  ON medication_courses(user_id, status, start_date DESC);
CREATE INDEX medication_courses_medication_idx ON medication_courses(medication_id);
CREATE INDEX medication_courses_provider_idx ON medication_courses(provider_id)
  WHERE provider_id IS NOT NULL;

CREATE TABLE medication_dose_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES medication_courses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  time_value time,
  period_label text NOT NULL DEFAULT 'custom'
    CHECK (period_label IN ('morning', 'midday', 'evening', 'bedtime', 'custom')),
  dose_qty numeric(6,2) NOT NULL DEFAULT 1 CHECK (dose_qty > 0),
  meal_relation text NOT NULL DEFAULT 'any'
    CHECK (meal_relation IN ('before', 'after', 'with', 'any')),
  meal_note text,
  sort_order integer NOT NULL DEFAULT 0,
  reminder_enabled boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (time_value IS NOT NULL OR period_label = 'bedtime')
);

CREATE INDEX medication_dose_slots_course_idx
  ON medication_dose_slots(course_id, is_active, sort_order);
CREATE INDEX medication_dose_slots_user_idx ON medication_dose_slots(user_id);

CREATE TABLE medication_course_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES medication_courses(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('created', 'pause', 'resume', 'stop', 'complete')),
  from_status text CHECK (from_status IS NULL OR from_status IN ('active', 'paused', 'stopped', 'completed')),
  to_status text NOT NULL CHECK (to_status IN ('active', 'paused', 'stopped', 'completed')),
  effective_at timestamptz NOT NULL,
  reason text,
  confirmed_by text NOT NULL
    CHECK (confirmed_by IN ('self', 'doctor', 'pharmacist', 'caregiver')),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, idempotency_key)
);

CREATE INDEX medication_course_events_course_idx
  ON medication_course_events(course_id, effective_at DESC);
CREATE INDEX medication_course_events_user_idx ON medication_course_events(user_id);

ALTER TABLE medication_schedules ADD COLUMN IF NOT EXISTS course_id uuid
  REFERENCES medication_courses(id) ON DELETE SET NULL;
ALTER TABLE medication_logs ADD COLUMN IF NOT EXISTS course_id uuid
  REFERENCES medication_courses(id) ON DELETE SET NULL;
ALTER TABLE medication_logs ADD COLUMN IF NOT EXISTS slot_id uuid
  REFERENCES medication_dose_slots(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS medication_schedules_course_idx ON medication_schedules(course_id);
CREATE INDEX IF NOT EXISTS medication_logs_course_time_idx
  ON medication_logs(course_id, scheduled_at DESC) WHERE course_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS medication_logs_slot_time_idx
  ON medication_logs(slot_id, scheduled_at DESC) WHERE slot_id IS NOT NULL;

-- Pauses/stops cancel only future unconfirmed occurrences. Cancelled entries are
-- retained for audit but excluded from adherence calculations.
ALTER TABLE medication_logs DROP CONSTRAINT IF EXISTS medication_logs_status_check;
ALTER TABLE medication_logs ADD CONSTRAINT medication_logs_status_check
  CHECK (status IN ('taken', 'skipped', 'late', 'missed', 'pending', 'cancelled'));

-- medical_providers already has RLS enabled + an owner policy
-- (medical_providers_own, from 20260831030000) — not repeated here.
ALTER TABLE medication_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication_dose_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication_course_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY medication_courses_owner ON medication_courses FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY medication_dose_slots_owner ON medication_dose_slots FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY medication_course_events_owner ON medication_course_events FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TRIGGER medical_providers_updated_at
  BEFORE UPDATE ON medical_providers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER medication_courses_updated_at
  BEFORE UPDATE ON medication_courses FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER medication_dose_slots_updated_at
  BEFORE UPDATE ON medication_dose_slots FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Backfill one open course for every active medication. Existing instructions
-- remain personal notes; only newly scanned label text is stored as sourced data.
INSERT INTO medication_courses (
  medication_id, user_id, status, start_date, planned_end_date,
  prescribed_by, instruction_source, created_at, updated_at
)
SELECT
  m.id,
  m.user_id,
  'active',
  COALESCE(MIN(ms.start_date) FILTER (WHERE ms.is_active), m.created_at::date, current_date),
  MAX(ms.end_date) FILTER (WHERE ms.is_active),
  m.prescribed_by,
  'user',
  m.created_at,
  COALESCE(m.updated_at, now())
FROM medications m
LEFT JOIN medication_schedules ms ON ms.medication_id = m.id AND ms.user_id = m.user_id
WHERE m.is_active
GROUP BY m.id
ON CONFLICT (user_id, medication_id) WHERE status IN ('active', 'paused') DO NOTHING;

UPDATE medication_schedules ms
SET course_id = c.id
FROM medication_courses c
WHERE ms.course_id IS NULL
  AND c.medication_id = ms.medication_id
  AND c.user_id = ms.user_id
  AND c.status IN ('active', 'paused');

INSERT INTO medication_dose_slots (
  course_id, user_id, time_value, period_label, dose_qty,
  meal_relation, meal_note, sort_order, reminder_enabled, is_active
)
SELECT
  ms.course_id,
  ms.user_id,
  dose_time::time,
  CASE
    WHEN dose_time::time < time '11:00' THEN 'morning'
    WHEN dose_time::time < time '16:00' THEN 'midday'
    WHEN dose_time::time < time '21:00' THEN 'evening'
    ELSE 'bedtime'
  END,
  ms.dose_qty,
  ms.meal_relation,
  ms.meal_note,
  ordinality::integer,
  ms.reminder_enabled,
  ms.is_active
FROM medication_schedules ms
CROSS JOIN LATERAL unnest(ms.times) WITH ORDINALITY AS t(dose_time, ordinality)
WHERE ms.course_id IS NOT NULL
  AND dose_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  AND NOT EXISTS (
    SELECT 1 FROM medication_dose_slots slot
    WHERE slot.course_id = ms.course_id
      AND slot.time_value = dose_time::time
      AND slot.sort_order = ordinality::integer
  );

UPDATE medication_logs ml
SET course_id = ms.course_id
FROM medication_schedules ms
WHERE ml.course_id IS NULL
  AND ml.schedule_id = ms.id
  AND ml.user_id = ms.user_id;

UPDATE medication_logs ml
SET slot_id = slot.id
FROM medication_dose_slots slot
WHERE ml.slot_id IS NULL
  AND ml.course_id = slot.course_id
  AND ml.scheduled_at::time = slot.time_value;

CREATE OR REPLACE FUNCTION transition_medication_course(
  p_course_id uuid,
  p_action text,
  p_effective_at timestamptz,
  p_reason text,
  p_confirmed_by text,
  p_idempotency_key text
)
RETURNS medication_courses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_course medication_courses%ROWTYPE;
  v_target text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;
  IF p_effective_at IS NULL OR btrim(COALESCE(p_idempotency_key, '')) = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'effective time and idempotency key are required';
  END IF;
  IF p_confirmed_by NOT IN ('self', 'doctor', 'pharmacist', 'caregiver') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid confirmer';
  END IF;

  SELECT * INTO v_course
  FROM medication_courses
  WHERE id = p_course_id AND user_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'medication course not found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM medication_course_events
    WHERE course_id = p_course_id AND idempotency_key = p_idempotency_key
  ) THEN
    RETURN v_course;
  END IF;

  v_target := CASE
    WHEN v_course.status = 'active' AND p_action = 'pause' THEN 'paused'
    WHEN v_course.status = 'paused' AND p_action = 'resume' THEN 'active'
    WHEN v_course.status IN ('active', 'paused') AND p_action = 'stop' THEN 'stopped'
    WHEN v_course.status = 'active' AND p_action = 'complete' THEN 'completed'
    ELSE NULL
  END;
  IF v_target IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'invalid or stale medication course transition';
  END IF;

  INSERT INTO medication_course_events (
    course_id, user_id, action, from_status, to_status, effective_at,
    reason, confirmed_by, idempotency_key
  ) VALUES (
    v_course.id, v_course.user_id, p_action, v_course.status, v_target,
    p_effective_at, NULLIF(btrim(COALESCE(p_reason, '')), ''),
    p_confirmed_by, p_idempotency_key
  );

  UPDATE medication_courses
  SET status = v_target,
      actual_end_at = CASE WHEN v_target IN ('stopped', 'completed') THEN p_effective_at ELSE NULL END,
      resume_review_at = CASE WHEN v_target = 'paused' THEN p_effective_at ELSE NULL END,
      updated_at = now()
  WHERE id = v_course.id
  RETURNING * INTO v_course;

  IF v_target IN ('paused', 'stopped', 'completed') THEN
    UPDATE medication_logs
    SET status = 'cancelled', note = COALESCE(note, 'ยกเลิกตามการเปลี่ยนสถานะคอร์สยา')
    WHERE course_id = v_course.id
      AND status = 'pending'
      AND scheduled_at >= p_effective_at;
  END IF;

  RETURN v_course;
END;
$$;

REVOKE ALL ON FUNCTION transition_medication_course(uuid, text, timestamptz, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION transition_medication_course(uuid, text, timestamptz, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION transition_medication_course(uuid, text, timestamptz, text, text, text) TO authenticated;

CREATE OR REPLACE VIEW medication_adherence AS
SELECT
  user_id,
  medication_id,
  date_trunc('month', scheduled_at) AS month,
  count(*) AS total_doses,
  count(*) FILTER (WHERE status = 'taken') AS taken,
  count(*) FILTER (WHERE status = 'skipped') AS skipped,
  count(*) FILTER (WHERE status = 'missed') AS missed,
  count(*) FILTER (WHERE status = 'late') AS late,
  round(
    count(*) FILTER (WHERE status IN ('taken', 'late'))::numeric
    / NULLIF(count(*), 0) * 100,
    1
  ) AS adherence_pct
FROM medication_logs
WHERE status NOT IN ('pending', 'cancelled')
GROUP BY user_id, medication_id, date_trunc('month', scheduled_at);
