-- ═══════════════════════════════════════════════════════════════════════════
-- 026_business_suite.sql — Business Suite (V4)
-- Team expense claims, approval workflows, project-based expenses
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Expense Claims (employee submits → manager approves) ────────────────────
CREATE TABLE IF NOT EXISTS expense_claims (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  submitter_id     uuid    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewer_id      uuid    REFERENCES users(id) ON DELETE SET NULL,
  document_id      uuid    REFERENCES documents(id) ON DELETE SET NULL,
  title            text    NOT NULL,
  description      text,
  amount           numeric(14,2) NOT NULL DEFAULT 0,
  currency         text    NOT NULL DEFAULT 'THB',
  category         text,                       -- expense category
  project_id       uuid,                       -- optional project link
  status           text    NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','submitted','under_review','approved','rejected','paid')),
  submitted_at     timestamptz,
  reviewed_at      timestamptz,
  paid_at          timestamptz,
  rejection_reason text,
  receipt_url      text,
  metadata         jsonb   NOT NULL DEFAULT '{}',
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);
CREATE INDEX idx_ec_org_status   ON expense_claims(organization_id, status, created_at DESC);
CREATE INDEX idx_ec_submitter    ON expense_claims(submitter_id, status);
CREATE INDEX idx_ec_reviewer     ON expense_claims(reviewer_id, status);
-- ─── Projects (group claims by project) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_projects (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             text    NOT NULL,
  description      text,
  budget           numeric(14,2),
  status           text    NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','completed','on_hold','cancelled')),
  start_date       date,
  end_date         date,
  owner_id         uuid    REFERENCES users(id) ON DELETE SET NULL,
  metadata         jsonb   NOT NULL DEFAULT '{}',
  created_at       timestamptz DEFAULT now()
);
-- Add FK from expense_claims to projects
ALTER TABLE expense_claims
  ADD CONSTRAINT fk_ec_project
  FOREIGN KEY (project_id) REFERENCES business_projects(id) ON DELETE SET NULL;
-- ─── Approval Audit Trail ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS approval_events (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id         uuid    NOT NULL REFERENCES expense_claims(id) ON DELETE CASCADE,
  actor_id         uuid    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action           text    NOT NULL,   -- 'submitted','approved','rejected','paid','commented'
  comment          text,
  metadata         jsonb   NOT NULL DEFAULT '{}',
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX idx_ae_claim ON approval_events(claim_id, created_at DESC);
-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE expense_claims    ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_events   ENABLE ROW LEVEL SECURITY;
-- Submitter can see own claims; managers see all org claims
CREATE POLICY "ec_member_select" ON expense_claims FOR SELECT USING (
  organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
);
CREATE POLICY "ec_submitter_insert" ON expense_claims FOR INSERT WITH CHECK (
  submitter_id = auth.uid()
  AND organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
);
CREATE POLICY "ec_update" ON expense_claims FOR UPDATE USING (
  organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
);
CREATE POLICY "proj_member" ON business_projects FOR ALL USING (
  organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
);
CREATE POLICY "ae_member"   ON approval_events   FOR ALL USING (
  claim_id IN (
    SELECT id FROM expense_claims
    WHERE organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
  )
);
-- ─── Helper: claim stats per org ─────────────────────────────────────────────
CREATE OR REPLACE VIEW expense_claim_stats AS
SELECT
  organization_id,
  COUNT(*) FILTER (WHERE status = 'pending')       AS pending_count,
  COUNT(*) FILTER (WHERE status = 'submitted')     AS submitted_count,
  COUNT(*) FILTER (WHERE status = 'under_review')  AS reviewing_count,
  COUNT(*) FILTER (WHERE status = 'approved')      AS approved_count,
  COUNT(*) FILTER (WHERE status = 'rejected')      AS rejected_count,
  SUM(amount) FILTER (WHERE status IN ('approved','paid')) AS total_approved_amount,
  SUM(amount) FILTER (WHERE status = 'pending')    AS pending_amount
FROM expense_claims
GROUP BY organization_id;
