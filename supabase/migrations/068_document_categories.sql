-- ---------------------------------------------------------------------------
-- 068_document_categories.sql
--
-- documents.doc_category has always been free text — no master list, so
-- every document could end up with a slightly different spelling of the
-- same category. This adds an org-managed category list (CRUD by
-- owner/admin/accountant, same role gate as vendors), and seeds each
-- existing org with a sensible default set so the list isn't empty on day
-- one. documents.doc_category stays free text (not a FK) so existing rows
-- and the AI extraction pipeline are unaffected — the category list is a
-- picker convenience, not a hard constraint.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS document_categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  sort_order      int  NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_categories_org_name
  ON document_categories(organization_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_doc_categories_org_sort
  ON document_categories(organization_id, sort_order);
CREATE TRIGGER document_categories_updated_at
  BEFORE UPDATE ON document_categories FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE document_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "doc_categories: org members can read"
  ON document_categories FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );
CREATE POLICY "doc_categories: owner/admin/accountant can write"
  ON document_categories FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid()
        AND role IN ('owner','admin','accountant')
    )
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE document_categories TO authenticated;
-- Seed every existing org with a default category set, ordered for display.
INSERT INTO document_categories (organization_id, name, sort_order)
SELECT o.id, c.name, c.sort_order
FROM organizations o
CROSS JOIN (VALUES
  ('ค่าเดินทาง',        0),
  ('ค่าอาหาร',          1),
  ('ค่าที่พัก',          2),
  ('วัสดุสำนักงาน',      3),
  ('ค่าสาธารณูปโภค',     4),
  ('ค่าบริการ/ที่ปรึกษา', 5),
  ('อื่นๆ',             6)
) AS c(name, sort_order)
ON CONFLICT (organization_id, lower(name)) DO NOTHING;
-- New orgs get the same default set automatically.
CREATE OR REPLACE FUNCTION seed_default_document_categories()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO document_categories (organization_id, name, sort_order) VALUES
    (NEW.id, 'ค่าเดินทาง',        0),
    (NEW.id, 'ค่าอาหาร',          1),
    (NEW.id, 'ค่าที่พัก',          2),
    (NEW.id, 'วัสดุสำนักงาน',      3),
    (NEW.id, 'ค่าสาธารณูปโภค',     4),
    (NEW.id, 'ค่าบริการ/ที่ปรึกษา', 5),
    (NEW.id, 'อื่นๆ',             6);
  RETURN NEW;
END;
$$;
CREATE TRIGGER organizations_seed_doc_categories
  AFTER INSERT ON organizations FOR EACH ROW
  EXECUTE FUNCTION seed_default_document_categories();
