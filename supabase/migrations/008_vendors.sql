-- ---------------------------------------------------------------------------
-- Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
-- All rights reserved. Proprietary and confidential.
-- ---------------------------------------------------------------------------
-- 008_vendors.sql
-- Vendor master table: deduplicates vendors from documents, stores geocoords.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vendors (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Identity
  name            text NOT NULL,
  tax_id          text,
  address         text,
  phone           text,

  -- Classification (user-editable)
  category        text,

  -- Geo (populated async via Nominatim)
  lat             numeric(10,7),
  lng             numeric(10,7),
  geocoded_at     timestamptz,

  -- Stats (incremented on each approved document)
  doc_count       int          NOT NULL DEFAULT 0,
  total_amount    numeric(15,2) NOT NULL DEFAULT 0,
  vat_total       numeric(15,2) NOT NULL DEFAULT 0,
  last_doc_date   date,

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
-- Unique: per org, match by tax_id when present, otherwise by lower(name)
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_tax_id
  ON vendors(organization_id, tax_id)
  WHERE tax_id IS NOT NULL AND tax_id != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_name
  ON vendors(organization_id, lower(name))
  WHERE tax_id IS NULL OR tax_id = '';
CREATE INDEX IF NOT EXISTS idx_vendors_org_total
  ON vendors(organization_id, total_amount DESC);
CREATE INDEX IF NOT EXISTS idx_vendors_geocoded
  ON vendors(organization_id, lat, lng)
  WHERE lat IS NOT NULL;
-- Trigger: auto-update updated_at
CREATE TRIGGER vendors_updated_at
  BEFORE UPDATE ON vendors FOR EACH ROW EXECUTE FUNCTION update_updated_at();
-- RLS
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vendors: org members can read"
  ON vendors FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );
CREATE POLICY "vendors: org members can write"
  ON vendors FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid()
        AND role IN ('owner','admin','accountant')
    )
  );
GRANT SELECT, INSERT, UPDATE ON TABLE vendors TO authenticated;
-- Function: upsert vendor from a document, returns vendor id
CREATE OR REPLACE FUNCTION upsert_vendor(
  p_org_id      uuid,
  p_name        text,
  p_tax_id      text,
  p_address     text,
  p_phone       text,
  p_amount      numeric,
  p_vat         numeric,
  p_doc_date    date
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_tax_id IS NOT NULL AND p_tax_id != '' THEN
    -- Match by tax_id
    INSERT INTO vendors(organization_id, name, tax_id, address, phone, doc_count, total_amount, vat_total, last_doc_date)
    VALUES (p_org_id, p_name, p_tax_id, p_address, p_phone, 1, COALESCE(p_amount,0), COALESCE(p_vat,0), p_doc_date)
    ON CONFLICT (organization_id, tax_id) WHERE tax_id IS NOT NULL AND tax_id != ''
    DO UPDATE SET
      name          = EXCLUDED.name,
      address       = COALESCE(EXCLUDED.address, vendors.address),
      phone         = COALESCE(EXCLUDED.phone,   vendors.phone),
      doc_count     = vendors.doc_count + 1,
      total_amount  = vendors.total_amount + COALESCE(p_amount, 0),
      vat_total     = vendors.vat_total   + COALESCE(p_vat,    0),
      last_doc_date = GREATEST(vendors.last_doc_date, p_doc_date)
    RETURNING id INTO v_id;
  ELSE
    -- Match by name (case-insensitive)
    INSERT INTO vendors(organization_id, name, address, phone, doc_count, total_amount, vat_total, last_doc_date)
    VALUES (p_org_id, p_name, p_address, p_phone, 1, COALESCE(p_amount,0), COALESCE(p_vat,0), p_doc_date)
    ON CONFLICT (organization_id, lower(name)) WHERE tax_id IS NULL OR tax_id = ''
    DO UPDATE SET
      address       = COALESCE(EXCLUDED.address, vendors.address),
      phone         = COALESCE(EXCLUDED.phone,   vendors.phone),
      doc_count     = vendors.doc_count + 1,
      total_amount  = vendors.total_amount + COALESCE(p_amount, 0),
      vat_total     = vendors.vat_total   + COALESCE(p_vat,    0),
      last_doc_date = GREATEST(vendors.last_doc_date, p_doc_date)
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;
