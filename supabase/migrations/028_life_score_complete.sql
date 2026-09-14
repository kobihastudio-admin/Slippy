-- ═══════════════════════════════════════════════════════════════════════════
-- 028_life_score_complete.sql — Life Score System (4 Domains)
-- Wealth + Lifestyle + Journey + Social = Life Score
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Life Score snapshots (computed and stored periodically) ─────────────────
CREATE TABLE IF NOT EXISTS life_score_snapshots (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  snapshot_date    date    NOT NULL DEFAULT CURRENT_DATE,

  -- 4 domain scores (0-100 each)
  wealth_score     numeric(5,2) NOT NULL DEFAULT 0,
  lifestyle_score  numeric(5,2) NOT NULL DEFAULT 0,
  journey_score    numeric(5,2) NOT NULL DEFAULT 0,
  social_score     numeric(5,2) NOT NULL DEFAULT 0,

  -- Overall (weighted average)
  overall_score    numeric(5,2) NOT NULL DEFAULT 0,

  -- Component breakdown for detail view
  components       jsonb   NOT NULL DEFAULT '{}',

  created_at       timestamptz DEFAULT now(),
  UNIQUE (organization_id, snapshot_date)
);
CREATE INDEX idx_lss_org ON life_score_snapshots(organization_id, snapshot_date DESC);
-- ─── Compute Life Score for an org ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION compute_life_score_new(p_org_id uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_wealth    numeric := 0;
  v_lifestyle numeric := 0;
  v_journey   numeric := 0;
  v_social    numeric := 0;
  v_overall   numeric := 0;
  v_doc_count int;
  v_approved  int;
  v_budget    jsonb;
  v_events    int;
  v_journeys  int;
  v_splits    int;
BEGIN
  -- ── WEALTH SCORE (0-100) ─────────────────────────────────────────────────
  -- Based on: document approval rate, budget compliance, doc volume

  -- Document counts
  SELECT COUNT(*) INTO v_doc_count FROM documents WHERE organization_id = p_org_id;
  SELECT COUNT(*) INTO v_approved  FROM documents WHERE organization_id = p_org_id AND status IN ('approved','pushed');

  -- Approval rate (40 pts max)
  IF v_doc_count > 0 THEN
    v_wealth := v_wealth + LEAST(40, (v_approved::float / v_doc_count * 40));
  END IF;

  -- Document volume (20 pts max — more docs = more engaged)
  v_wealth := v_wealth + LEAST(20, v_doc_count * 0.5);

  -- Life events (spending tracked) — 20 pts max
  SELECT COUNT(*) INTO v_events
    FROM life_events
   WHERE organization_id = p_org_id
     AND event_type = 'expense'
     AND occurred_at >= now() - interval '30 days';
  v_wealth := v_wealth + LEAST(20, v_events * 2);

  -- Budget set (20 pts if budget is configured)
  SELECT metadata->'budgets' INTO v_budget FROM organizations WHERE id = p_org_id;
  IF v_budget IS NOT NULL AND v_budget != 'null' THEN
    v_wealth := v_wealth + 20;
  END IF;

  v_wealth := LEAST(100, v_wealth);

  -- ── LIFESTYLE SCORE (0-100) ──────────────────────────────────────────────
  -- Based on: health entries, personal profile completeness

  -- Health entries (50 pts max)
  SELECT COUNT(*) INTO v_events
    FROM documents
   WHERE organization_id = p_org_id
     AND is_personal = true
     AND health_category IS NOT NULL
     AND created_at >= now() - interval '30 days';
  v_lifestyle := v_lifestyle + LEAST(50, v_events * 5);

  -- Personal profile filled (50 pts if profile exists)
  SELECT COUNT(*) INTO v_events
    FROM personal_profiles
   WHERE user_id IN (
     SELECT user_id FROM organization_members WHERE organization_id = p_org_id
   );
  IF v_events > 0 THEN v_lifestyle := v_lifestyle + 50; END IF;

  v_lifestyle := LEAST(100, v_lifestyle);

  -- ── JOURNEY SCORE (0-100) ────────────────────────────────────────────────
  -- Based on: trips logged, places visited, experience diversity

  SELECT COUNT(*) INTO v_journeys
    FROM life_journeys WHERE organization_id = p_org_id;

  -- Each journey = 20 pts, max 100
  v_journey := LEAST(100, v_journeys * 20);

  -- ── SOCIAL SCORE (0-100) ─────────────────────────────────────────────────
  -- Based on: split bills, participants, community activity

  SELECT COUNT(*) INTO v_splits
    FROM split_bills WHERE organization_id = p_org_id;

  -- Each split bill = 15 pts, max 60
  v_social := LEAST(60, v_splits * 15);

  -- Social posts/follows (40 pts max)
  SELECT COUNT(*) INTO v_events
    FROM posts WHERE organization_id = p_org_id;
  v_social := v_social + LEAST(40, v_events * 8);

  v_social := LEAST(100, v_social);

  -- ── OVERALL SCORE (weighted) ─────────────────────────────────────────────
  -- Wealth 40% + Lifestyle 25% + Journey 20% + Social 15%
  v_overall := ROUND(
    v_wealth    * 0.40 +
    v_lifestyle * 0.25 +
    v_journey   * 0.20 +
    v_social    * 0.15, 1
  );

  -- Upsert snapshot
  INSERT INTO life_score_snapshots(
    organization_id, snapshot_date,
    wealth_score, lifestyle_score, journey_score, social_score, overall_score,
    components
  )
  VALUES (
    p_org_id, CURRENT_DATE,
    v_wealth, v_lifestyle, v_journey, v_social, v_overall,
    jsonb_build_object(
      'doc_count', v_doc_count, 'approved', v_approved,
      'journeys', v_journeys, 'splits', v_splits
    )
  )
  ON CONFLICT (organization_id, snapshot_date)
  DO UPDATE SET
    wealth_score    = EXCLUDED.wealth_score,
    lifestyle_score = EXCLUDED.lifestyle_score,
    journey_score   = EXCLUDED.journey_score,
    social_score    = EXCLUDED.social_score,
    overall_score   = EXCLUDED.overall_score,
    components      = EXCLUDED.components;

  RETURN jsonb_build_object(
    'overall',   v_overall,
    'wealth',    v_wealth,
    'lifestyle', v_lifestyle,
    'journey',   v_journey,
    'social',    v_social
  );
END;
$$;
-- RLS
ALTER TABLE life_score_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lss_member" ON life_score_snapshots FOR ALL USING (
  organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
);
-- Drop old version if owned by us, then alias
DROP FUNCTION IF EXISTS compute_life_score(uuid);
ALTER FUNCTION compute_life_score_new(uuid) RENAME TO compute_life_score;
