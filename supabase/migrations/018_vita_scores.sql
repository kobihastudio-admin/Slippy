/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * Migration 018 — Vita Scores
 * Adds score_snapshots table for historical score tracking,
 * vita_cards table for shareable score cards,
 * and a Postgres function to compute Longevity + Wealth scores.
 */

-- ─────────────────────────────────────────────────────────
-- 1. score_snapshots — daily score history
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS score_snapshots (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot_date    date NOT NULL DEFAULT CURRENT_DATE,
  longevity_score  numeric(5,2) NOT NULL DEFAULT 0,
  wealth_score     numeric(5,2) NOT NULL DEFAULT 0,
  -- Component breakdown (for chart/detail views)
  longevity_physical   numeric(5,2) DEFAULT 0,  -- max 40
  longevity_metabolic  numeric(5,2) DEFAULT 0,  -- max 20
  longevity_lifestyle  numeric(5,2) DEFAULT 0,  -- max 25
  longevity_financial  numeric(5,2) DEFAULT 0,  -- max 15
  wealth_discipline    numeric(5,2) DEFAULT 0,  -- max 30
  wealth_goals         numeric(5,2) DEFAULT 0,  -- max 25
  wealth_subscriptions numeric(5,2) DEFAULT 0,  -- max 15
  wealth_health_invest numeric(5,2) DEFAULT 0,  -- max 15
  wealth_consistency   numeric(5,2) DEFAULT 0,  -- max 15
  created_at       timestamptz DEFAULT now(),
  UNIQUE (user_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS score_snapshots_user_date
  ON score_snapshots(user_id, snapshot_date DESC);
-- ─────────────────────────────────────────────────────────
-- 2. vita_cards — shareable public score cards
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vita_cards (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug             text NOT NULL UNIQUE,  -- short public URL e.g. "vita/abc123"
  longevity_score  numeric(5,2) NOT NULL,
  wealth_score     numeric(5,2) NOT NULL,
  highlight_text   text,                 -- user-written summary
  theme            text DEFAULT 'emerald'
                     CHECK (theme IN ('emerald','violet','amber','ocean','rose')),
  is_public        bool DEFAULT true,
  view_count       int DEFAULT 0,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vita_cards_user    ON vita_cards(user_id);
CREATE INDEX IF NOT EXISTS vita_cards_slug    ON vita_cards(slug);
-- ─────────────────────────────────────────────────────────
-- 3. Postgres scoring function
--    Returns (longevity_score, wealth_score, components)
--    All component logic mirrors the TypeScript model in src/lib/scores.ts
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION compute_vita_scores(p_user_id uuid)
RETURNS TABLE (
  longevity_score      numeric,
  wealth_score         numeric,
  longevity_physical   numeric,
  longevity_metabolic  numeric,
  longevity_lifestyle  numeric,
  longevity_financial  numeric,
  wealth_discipline    numeric,
  wealth_goals         numeric,
  wealth_subscriptions numeric,
  wealth_health_invest numeric,
  wealth_consistency   numeric
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_since_30d   timestamptz := now() - interval '30 days';
  v_since_90d   timestamptz := now() - interval '90 days';

  -- Health entries (last 30 days)
  v_avg_steps       numeric := 0;
  v_avg_sleep       numeric := 0;
  v_avg_hr          numeric := 0;
  v_avg_hrv         numeric := 0;
  v_avg_sys_bp      numeric := 0;
  v_avg_dia_bp      numeric := 0;
  v_avg_glucose     numeric := 0;
  v_weight_entries  int     := 0;
  v_avg_water       numeric := 0;
  v_health_entries  int     := 0;

  -- Document lifestyle stats (last 30 days)
  v_healthy_food_count   int := 0;
  v_unhealthy_food_count int := 0;
  v_fitness_count        int := 0;
  v_supplement_count     int := 0;
  v_alcohol_count        int := 0;
  v_health_spend_ratio   numeric := 0;
  v_total_personal_docs  int := 0;

  -- Financial stats
  v_avg_monthly_spend   numeric := 0;
  v_curr_monthly_spend  numeric := 0;
  v_goal_completion_pct numeric := 0;
  v_active_goals        int := 0;
  v_confirmed_subs      int := 0;
  v_total_subs          int := 0;

  -- Component scores
  c_physical   numeric := 0;
  c_metabolic  numeric := 0;
  c_lifestyle  numeric := 0;
  c_financial  numeric := 0;
  c_discipline numeric := 0;
  c_goals      numeric := 0;
  c_subs       numeric := 0;
  c_hinvest    numeric := 0;
  c_consist    numeric := 0;

  v_w_score numeric := 0;
  v_l_score numeric := 0;
BEGIN

  -- ── Health entries aggregates ──────────────────────────────
  SELECT
    COALESCE(AVG(CASE WHEN type='steps'                    THEN value END), 0),
    COALESCE(AVG(CASE WHEN type='sleep_hours'              THEN value END), 0),
    COALESCE(AVG(CASE WHEN type='heart_rate'               THEN value END), 0),
    COALESCE(AVG(CASE WHEN type='hrv'                      THEN value END), 0),
    COALESCE(AVG(CASE WHEN type='blood_pressure_systolic'  THEN value END), 0),
    COALESCE(AVG(CASE WHEN type='blood_pressure_diastolic' THEN value END), 0),
    COALESCE(AVG(CASE WHEN type='blood_glucose'            THEN value END), 0),
    COALESCE(AVG(CASE WHEN type='water_ml'                 THEN value END), 0),
    COUNT(*)
  INTO
    v_avg_steps, v_avg_sleep, v_avg_hr, v_avg_hrv,
    v_avg_sys_bp, v_avg_dia_bp, v_avg_glucose, v_avg_water,
    v_health_entries
  FROM health_entries
  WHERE user_id = p_user_id
    AND recorded_at >= v_since_30d;

  SELECT COUNT(*) INTO v_weight_entries
  FROM health_entries
  WHERE user_id = p_user_id AND type = 'weight' AND recorded_at >= v_since_90d;

  -- ── Lifestyle receipts (last 30 days) ─────────────────────
  SELECT
    COUNT(*) FILTER (WHERE health_category = 'food_healthy'),
    COUNT(*) FILTER (WHERE health_category = 'food_unhealthy'),
    COUNT(*) FILTER (WHERE health_category = 'fitness'),
    COUNT(*) FILTER (WHERE health_category IN ('supplement','wellness','medical')),
    COUNT(*) FILTER (WHERE health_category IN ('alcohol','caffeine')),
    COUNT(*)
  INTO
    v_healthy_food_count, v_unhealthy_food_count, v_fitness_count,
    v_supplement_count,   v_alcohol_count,         v_total_personal_docs
  FROM documents
  WHERE user_id = p_user_id
    AND is_personal = true
    AND created_at >= v_since_30d;

  IF v_total_personal_docs > 0 THEN
    v_health_spend_ratio := (v_healthy_food_count + v_fitness_count + v_supplement_count)::numeric
                            / v_total_personal_docs;
  END IF;

  -- ── Financial aggregates ───────────────────────────────────
  -- 3-month avg monthly spend
  SELECT COALESCE(SUM(total_amount) / 3.0, 0)
  INTO v_avg_monthly_spend
  FROM documents
  WHERE user_id = p_user_id AND is_personal = true AND created_at >= v_since_90d;

  -- This month spend
  SELECT COALESCE(SUM(total_amount), 0)
  INTO v_curr_monthly_spend
  FROM documents
  WHERE user_id = p_user_id
    AND is_personal = true
    AND date_trunc('month', created_at) = date_trunc('month', now());

  -- Goals
  SELECT
    COUNT(*),
    COALESCE(
      AVG(LEAST(current_amount / NULLIF(target_amount, 0), 1.0)) * 100,
      0
    )
  INTO v_active_goals, v_goal_completion_pct
  FROM financial_goals
  WHERE user_id = p_user_id AND status = 'active';

  -- Subscriptions
  SELECT
    COUNT(*) FILTER (WHERE is_confirmed = true),
    COUNT(*)
  INTO v_confirmed_subs, v_total_subs
  FROM detected_subscriptions
  WHERE user_id = p_user_id;

  -- ─────────────────────────────────────────────────────────
  -- LONGEVITY SCORE COMPONENTS
  -- ─────────────────────────────────────────────────────────

  -- 1. Physical Health (max 40)
  -- Steps: ≥10000=10, ≥7500=7, ≥5000=5, ≥3000=2, else 0
  c_physical := c_physical +
    CASE
      WHEN v_avg_steps >= 10000 THEN 10
      WHEN v_avg_steps >= 7500  THEN 7
      WHEN v_avg_steps >= 5000  THEN 5
      WHEN v_avg_steps >= 3000  THEN 2
      ELSE 0
    END;

  -- Sleep: 7-9h=10, 6-7h or 9-10h=7, 5-6h=4, else 0
  c_physical := c_physical +
    CASE
      WHEN v_avg_sleep BETWEEN 7 AND 9   THEN 10
      WHEN v_avg_sleep BETWEEN 6 AND 9.9 THEN 7
      WHEN v_avg_sleep BETWEEN 5 AND 6   THEN 4
      WHEN v_avg_sleep > 0               THEN 1
      ELSE 0
    END;

  -- Heart rate (resting): 50-70=10, 70-80=7, 80-90=4, else 0
  c_physical := c_physical +
    CASE
      WHEN v_avg_hr BETWEEN 50 AND 70 THEN 10
      WHEN v_avg_hr BETWEEN 70 AND 80 THEN 7
      WHEN v_avg_hr BETWEEN 80 AND 90 THEN 4
      WHEN v_avg_hr > 0               THEN 1
      ELSE 0
    END;

  -- HRV: ≥60=5, ≥40=3, ≥20=1, else 0
  c_physical := c_physical +
    CASE
      WHEN v_avg_hrv >= 60 THEN 5
      WHEN v_avg_hrv >= 40 THEN 3
      WHEN v_avg_hrv >= 20 THEN 1
      ELSE 0
    END;

  -- Blood pressure (systolic/diastolic): optimal=5, normal=3, high normal=1
  c_physical := c_physical +
    CASE
      WHEN v_avg_sys_bp BETWEEN 90 AND 120 AND v_avg_dia_bp BETWEEN 60 AND 80 THEN 5
      WHEN v_avg_sys_bp BETWEEN 90 AND 130 AND v_avg_dia_bp BETWEEN 60 AND 85 THEN 3
      WHEN v_avg_sys_bp > 0 THEN 1
      ELSE 0
    END;

  -- 2. Metabolic Health (max 20)
  -- Blood glucose (fasting mg/dL): 70-100=10, 100-110=6, 110-125=3, else 0
  c_metabolic := c_metabolic +
    CASE
      WHEN v_avg_glucose BETWEEN 70 AND 100  THEN 10
      WHEN v_avg_glucose BETWEEN 100 AND 110 THEN 6
      WHEN v_avg_glucose BETWEEN 110 AND 125 THEN 3
      WHEN v_avg_glucose > 0                 THEN 1
      ELSE 0
    END;

  -- Weight tracking consistency (using entries as proxy): ≥8 entries/month=10
  c_metabolic := c_metabolic +
    CASE
      WHEN v_weight_entries >= 8 THEN 10
      WHEN v_weight_entries >= 4 THEN 7
      WHEN v_weight_entries >= 1 THEN 4
      ELSE 0
    END;

  -- 3. Lifestyle Quality from receipts (max 25)
  -- Healthy food ratio
  IF v_healthy_food_count + v_unhealthy_food_count > 0 THEN
    c_lifestyle := c_lifestyle +
      ROUND(
        LEAST(
          (v_healthy_food_count::numeric / NULLIF(v_healthy_food_count + v_unhealthy_food_count, 0)) * 10,
          10
        ), 2
      );
  END IF;

  -- Fitness frequency: ≥8/month=8, ≥4=6, ≥1=3
  c_lifestyle := c_lifestyle +
    CASE
      WHEN v_fitness_count >= 8 THEN 8
      WHEN v_fitness_count >= 4 THEN 6
      WHEN v_fitness_count >= 1 THEN 3
      ELSE 0
    END;

  -- Supplements/wellness receipts: ≥2/month=4, ≥1=2
  c_lifestyle := c_lifestyle +
    CASE
      WHEN v_supplement_count >= 2 THEN 4
      WHEN v_supplement_count >= 1 THEN 2
      ELSE 0
    END;

  -- Water tracking: ≥2000ml avg = 3
  c_lifestyle := c_lifestyle +
    CASE
      WHEN v_avg_water >= 2000 THEN 3
      WHEN v_avg_water >= 1500 THEN 2
      WHEN v_avg_water >= 1000 THEN 1
      ELSE 0
    END;

  -- Alcohol penalty (max -3)
  IF v_alcohol_count >= 8 THEN
    c_lifestyle := c_lifestyle - 3;
  ELSIF v_alcohol_count >= 4 THEN
    c_lifestyle := c_lifestyle - 1.5;
  END IF;

  c_lifestyle := GREATEST(c_lifestyle, 0);

  -- 4. Financial-Health Connection (max 15)
  -- Will be filled after wealth score is computed below

  -- ─────────────────────────────────────────────────────────
  -- WEALTH SCORE COMPONENTS
  -- ─────────────────────────────────────────────────────────

  -- 1. Spending Discipline (max 30)
  IF v_avg_monthly_spend > 0 THEN
    -- Spend this month vs 3-month avg: within ±10%=15, ±20%=10, ±30%=5
    DECLARE v_spend_ratio numeric := v_curr_monthly_spend / NULLIF(v_avg_monthly_spend, 0);
    BEGIN
      c_discipline := c_discipline +
        CASE
          WHEN v_spend_ratio BETWEEN 0.8 AND 1.1 THEN 15
          WHEN v_spend_ratio BETWEEN 0.7 AND 1.2 THEN 10
          WHEN v_spend_ratio BETWEEN 0.5 AND 1.3 THEN 5
          ELSE 0
        END;
    END;
  END IF;

  -- Healthy spending ratio (receipts tagged as health-positive)
  c_discipline := c_discipline +
    ROUND(LEAST(v_health_spend_ratio * 15, 15), 2);

  -- 2. Goals Progress (max 25)
  -- Completion percentage
  c_goals := ROUND(LEAST(v_goal_completion_pct * 0.15, 15), 2);

  -- Active goals count: 1-5=10, 0=0, >5=7
  c_goals := c_goals +
    CASE
      WHEN v_active_goals BETWEEN 1 AND 5 THEN 10
      WHEN v_active_goals > 5             THEN 7
      ELSE 0
    END;

  -- 3. Subscription Efficiency (max 15)
  IF v_total_subs > 0 THEN
    c_subs := ROUND(LEAST((v_confirmed_subs::numeric / v_total_subs) * 10, 10), 2);
  ELSIF v_total_subs = 0 THEN
    c_subs := 10; -- no detected subs = clean
  END IF;
  -- Bonus for having few subs (frugality)
  c_subs := c_subs +
    CASE
      WHEN v_total_subs <= 3 THEN 5
      WHEN v_total_subs <= 6 THEN 3
      WHEN v_total_subs <= 10 THEN 1
      ELSE 0
    END;

  -- 4. Health Investment (max 15)
  c_hinvest := ROUND(LEAST(v_health_spend_ratio * 15, 15), 2);

  -- 5. Consistency — data recording (max 15)
  -- Health entries in 30d: ≥30=8, ≥15=5, ≥7=3
  c_consist := c_consist +
    CASE
      WHEN v_health_entries >= 30 THEN 8
      WHEN v_health_entries >= 15 THEN 5
      WHEN v_health_entries >= 7  THEN 3
      WHEN v_health_entries >= 1  THEN 1
      ELSE 0
    END;
  -- Receipt tagging consistency
  c_consist := c_consist +
    CASE
      WHEN v_total_personal_docs >= 20 THEN 7
      WHEN v_total_personal_docs >= 10 THEN 5
      WHEN v_total_personal_docs >= 5  THEN 3
      WHEN v_total_personal_docs >= 1  THEN 1
      ELSE 0
    END;

  -- Compute raw wealth score
  v_w_score := LEAST(c_discipline + c_goals + c_subs + c_hinvest + c_consist, 100);

  -- 4. Financial-Health Connection in Longevity (max 15)
  -- Wealth score > 60 → low financial stress → better health
  c_financial :=
    CASE
      WHEN v_w_score >= 80 THEN 15
      WHEN v_w_score >= 60 THEN 10
      WHEN v_w_score >= 40 THEN 6
      WHEN v_w_score >= 20 THEN 3
      ELSE 0
    END;

  -- Compute longevity score
  v_l_score := LEAST(c_physical + c_metabolic + c_lifestyle + c_financial, 100);

  -- Return all components rounded to 2dp
  RETURN QUERY SELECT
    ROUND(v_l_score,    2),
    ROUND(v_w_score,    2),
    ROUND(c_physical,   2),
    ROUND(c_metabolic,  2),
    ROUND(c_lifestyle,  2),
    ROUND(c_financial,  2),
    ROUND(c_discipline, 2),
    ROUND(c_goals,      2),
    ROUND(c_subs,       2),
    ROUND(c_hinvest,    2),
    ROUND(c_consist,    2);

END;
$$;
-- ─────────────────────────────────────────────────────────
-- 4. RLS
-- ─────────────────────────────────────────────────────────
ALTER TABLE score_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE vita_cards      ENABLE ROW LEVEL SECURITY;
CREATE POLICY "score_snapshots: own access"
  ON score_snapshots FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "vita_cards: public readable"
  ON vita_cards FOR SELECT
  USING (is_public = true OR auth.uid() = user_id);
CREATE POLICY "vita_cards: own write"
  ON vita_cards FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
-- ─────────────────────────────────────────────────────────
-- 5. Grants
-- ─────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON score_snapshots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON vita_cards      TO authenticated;
GRANT EXECUTE ON FUNCTION compute_vita_scores(uuid)     TO authenticated;
