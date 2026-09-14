-- 025_life_graph.sql — Life Graph Foundation (idempotent)

-- Tables (all IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS life_merchants (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             text    NOT NULL, normalized_name text NOT NULL,
  category text, tax_id text, address text,
  visit_count int NOT NULL DEFAULT 0, total_spent numeric(14,2) NOT NULL DEFAULT 0,
  avg_amount numeric(14,2) GENERATED ALWAYS AS (
    CASE WHEN visit_count > 0 THEN total_spent / visit_count ELSE 0 END
  ) STORED,
  last_visit_at timestamptz, first_visit_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, normalized_name)
);
CREATE TABLE IF NOT EXISTS life_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL, source_type text, source_id uuid,
  merchant_id uuid REFERENCES life_merchants(id) ON DELETE SET NULL,
  journey_id uuid,
  amount numeric(14,2), category text, doc_category text, description text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS life_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  memory_type text NOT NULL, key text NOT NULL, value jsonb NOT NULL,
  confidence numeric(3,2) NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  source text, observation_count int NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, memory_type, key)
);
CREATE TABLE IF NOT EXISTS life_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  insight_type text NOT NULL, title text NOT NULL, body text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  period_start date, period_end date,
  priority int NOT NULL DEFAULT 0, is_read bool NOT NULL DEFAULT false,
  expires_at timestamptz, created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS life_journeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  title text NOT NULL, description text,
  journey_type text NOT NULL DEFAULT 'trip',
  started_at timestamptz, ended_at timestamptz, destination text,
  total_spent numeric(14,2) GENERATED ALWAYS AS (0::numeric(14,2)) STORED,
  cover_emoji text DEFAULT '✈️',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
-- Indexes (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_lm_org      ON life_merchants(organization_id);
CREATE INDEX IF NOT EXISTS idx_lm_category ON life_merchants(organization_id, category);
CREATE INDEX IF NOT EXISTS idx_lm_spent    ON life_merchants(organization_id, total_spent DESC);
CREATE INDEX IF NOT EXISTS idx_le_org      ON life_events(organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_le_merchant ON life_events(merchant_id);
CREATE INDEX IF NOT EXISTS idx_le_type     ON life_events(organization_id, event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_le_source   ON life_events(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_lmem_org    ON life_memories(organization_id, memory_type);
CREATE INDEX IF NOT EXISTS idx_li_org_unread ON life_insights(organization_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_li_type     ON life_insights(organization_id, insight_type);
CREATE INDEX IF NOT EXISTS idx_lj_org      ON life_journeys(organization_id, started_at DESC);
-- FK: life_events.journey_id → life_journeys
ALTER TABLE life_events ADD COLUMN IF NOT EXISTS journey_id uuid;
ALTER TABLE life_events DROP CONSTRAINT IF EXISTS fk_le_journey;
ALTER TABLE life_events ADD CONSTRAINT fk_le_journey
  FOREIGN KEY (journey_id) REFERENCES life_journeys(id) ON DELETE SET NULL;
-- RLS
ALTER TABLE life_merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE life_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE life_memories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE life_insights  ENABLE ROW LEVEL SECURITY;
ALTER TABLE life_journeys  ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='life_merchants_member' AND tablename='life_merchants') THEN
    CREATE POLICY "life_merchants_member" ON life_merchants FOR ALL USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='life_events_member' AND tablename='life_events') THEN
    CREATE POLICY "life_events_member" ON life_events FOR ALL USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='life_memories_member' AND tablename='life_memories') THEN
    CREATE POLICY "life_memories_member" ON life_memories FOR ALL USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='life_insights_member' AND tablename='life_insights') THEN
    CREATE POLICY "life_insights_member" ON life_insights FOR ALL USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='life_journeys_member' AND tablename='life_journeys') THEN
    CREATE POLICY "life_journeys_member" ON life_journeys FOR ALL USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));
  END IF;
END $$;
-- Function: upsert merchant
CREATE OR REPLACE FUNCTION upsert_life_merchant(
  p_org_id uuid, p_name text, p_tax_id text DEFAULT NULL,
  p_address text DEFAULT NULL, p_category text DEFAULT NULL,
  p_amount numeric DEFAULT 0, p_date timestamptz DEFAULT now()
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_normalized text; v_id uuid;
BEGIN
  v_normalized := lower(trim(regexp_replace(p_name, '\s+', ' ', 'g')));
  INSERT INTO life_merchants(organization_id,name,normalized_name,category,tax_id,address,visit_count,total_spent,last_visit_at,first_visit_at)
  VALUES (p_org_id,p_name,v_normalized,p_category,p_tax_id,p_address,1,p_amount,p_date,p_date)
  ON CONFLICT (organization_id,normalized_name) DO UPDATE
    SET visit_count=life_merchants.visit_count+1,
        total_spent=life_merchants.total_spent+EXCLUDED.total_spent,
        last_visit_at=GREATEST(life_merchants.last_visit_at,EXCLUDED.last_visit_at),
        category=COALESCE(EXCLUDED.category,life_merchants.category),
        tax_id=COALESCE(EXCLUDED.tax_id,life_merchants.tax_id),
        address=COALESCE(EXCLUDED.address,life_merchants.address),
        updated_at=now()
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
