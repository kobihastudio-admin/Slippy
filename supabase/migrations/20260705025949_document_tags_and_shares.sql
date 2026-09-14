CREATE TABLE IF NOT EXISTS document_tags (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS document_tag_links (
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tag_id      uuid NOT NULL REFERENCES document_tags(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_document_tags_org ON document_tags(organization_id);
CREATE INDEX IF NOT EXISTS idx_document_tag_links_tag ON document_tag_links(tag_id);

ALTER TABLE document_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_tag_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "document_tags: org members can read" ON document_tags FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));
CREATE POLICY "document_tags: org members can write" ON document_tags FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

CREATE POLICY "document_tag_links: org members can read" ON document_tag_links FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM documents d JOIN organization_members om ON om.organization_id = d.organization_id
    WHERE d.id = document_tag_links.document_id AND om.user_id = auth.uid()
  ));
CREATE POLICY "document_tag_links: org members can write" ON document_tag_links FOR ALL
  USING (EXISTS (
    SELECT 1 FROM documents d JOIN organization_members om ON om.organization_id = d.organization_id
    WHERE d.id = document_tag_links.document_id AND om.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM documents d JOIN organization_members om ON om.organization_id = d.organization_id
    WHERE d.id = document_tag_links.document_id AND om.user_id = auth.uid()
  ));

CREATE TABLE IF NOT EXISTS document_shares (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id         uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  shared_with_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission          text NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'edit')),
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, shared_with_user_id)
);

CREATE INDEX IF NOT EXISTS idx_document_shares_document ON document_shares(document_id);
CREATE INDEX IF NOT EXISTS idx_document_shares_user ON document_shares(shared_with_user_id);

ALTER TABLE document_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "document_shares: visible to org or the shared-with user" ON document_shares FOR SELECT
  USING (
    shared_with_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM documents d JOIN organization_members om ON om.organization_id = d.organization_id
      WHERE d.id = document_shares.document_id AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "document_shares: org members can write" ON document_shares FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM documents d JOIN organization_members om ON om.organization_id = d.organization_id
    WHERE d.id = document_shares.document_id AND om.user_id = auth.uid()
  ));
CREATE POLICY "document_shares: org members can delete" ON document_shares FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM documents d JOIN organization_members om ON om.organization_id = d.organization_id
    WHERE d.id = document_shares.document_id AND om.user_id = auth.uid()
  ));
;
