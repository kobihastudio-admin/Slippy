-- ---------------------------------------------------------------------------
-- Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
-- All rights reserved. Proprietary and confidential.
-- ---------------------------------------------------------------------------

-- ══════════════════════════════════════════════════════════════
--  001_core_schema.sql
--  Core tables: organizations, users, members, documents, etc.
-- ══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
-- for fuzzy text search

-- ── Organizations ──────────────────────────────────────────────
CREATE TABLE organizations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  slug             text NOT NULL UNIQUE,
  tax_id           text,
  address          text,
  plan             text NOT NULL DEFAULT 'free'
                   CHECK (plan IN ('free','starter','pro','enterprise')),
  doc_quota        int  NOT NULL DEFAULT 50,
  doc_used         int  NOT NULL DEFAULT 0,
  fiscal_year_end  int  NOT NULL DEFAULT 12 CHECK (fiscal_year_end BETWEEN 1 AND 12),
  stripe_customer_id    text UNIQUE,
  stripe_subscription_id text UNIQUE,
  subscription_status   text DEFAULT 'inactive',
  subscription_ends_at  timestamptz,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);
-- ── Users (mirrors auth.users) ─────────────────────────────────
CREATE TABLE users (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text NOT NULL UNIQUE,
  full_name  text,
  avatar_url text,
  created_at timestamptz DEFAULT now()
);
-- Trigger: auto-insert user record on auth signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  ) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
-- ── Organization Members ───────────────────────────────────────
CREATE TABLE organization_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'viewer'
                  CHECK (role IN ('owner','admin','accountant','viewer')),
  joined_at       timestamptz DEFAULT now(),
  UNIQUE(organization_id, user_id)
);
-- ── Invitations ────────────────────────────────────────────────
CREATE TABLE invitations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           text NOT NULL,
  role            text NOT NULL DEFAULT 'viewer'
                  CHECK (role IN ('admin','accountant','viewer')),
  token           text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32),'hex'),
  invited_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at      timestamptz NOT NULL DEFAULT now() + INTERVAL '7 days',
  accepted_at     timestamptz,
  created_at      timestamptz DEFAULT now()
);
-- ── Integrations ───────────────────────────────────────────────
CREATE TABLE integrations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider        text NOT NULL
                  CHECK (provider IN ('flowaccount','peak','express','webhook')),
  api_key_enc     text,
  meta            jsonb DEFAULT '{}',
  is_active       boolean DEFAULT true,
  last_synced_at  timestamptz,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE(organization_id, provider)
);
CREATE TABLE integration_accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  external_code  text NOT NULL,
  name           text NOT NULL,
  account_type   text,
  synced_at      timestamptz DEFAULT now(),
  UNIQUE(integration_id, external_code)
);
CREATE TABLE integration_contacts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  external_id    text NOT NULL,
  name           text NOT NULL,
  tax_id         text,
  contact_type   text,
  synced_at      timestamptz DEFAULT now(),
  UNIQUE(integration_id, external_id)
);
CREATE TABLE account_mappings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  vendor_name    text,
  keyword        text,
  account_code   text NOT NULL,
  match_count    int  NOT NULL DEFAULT 1,
  updated_at     timestamptz DEFAULT now(),
  UNIQUE(integration_id, vendor_name, account_code)
);
-- ── Documents ──────────────────────────────────────────────────
CREATE TABLE documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  uploaded_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  file_path           text NOT NULL,
  file_type           text NOT NULL CHECK (file_type IN ('pdf','jpg','png')),
  source              text NOT NULL DEFAULT 'web'
                      CHECK (source IN ('web','mobile','email','line')),
  source_meta         jsonb DEFAULT '{}',
  doc_type            text CHECK (doc_type IN ('expense','invoice','receipt','unknown')),
  vendor_name         text,
  vendor_tax_id       text,
  doc_date            date,
  doc_number          text,
  subtotal            numeric(15,2),
  vat_amount          numeric(15,2),
  wht_rate            numeric(5,2),
  wht_amount          numeric(15,2),
  total_amount        numeric(15,2),
  confidence          jsonb DEFAULT '{}',
  overall_confidence  numeric(4,3),
  validation_issues   text[] DEFAULT '{}',
  is_duplicate        boolean DEFAULT false,
  duplicate_of        uuid REFERENCES documents(id),
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN (
                        'pending','processing','reviewing',
                        'approved','pushed','failed','rejected','flagged'
                      )),
  reviewed_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at         timestamptz,
  review_note         text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);
CREATE TABLE document_line_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  description  text,
  quantity     numeric(15,4),
  unit_price   numeric(15,2),
  amount       numeric(15,2),
  account_code text,
  sort_order   int DEFAULT 0
);
CREATE TABLE document_audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  before_data jsonb,
  after_data  jsonb,
  note        text,
  created_at  timestamptz DEFAULT now()
);
CREATE TABLE document_push_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  integration_id  uuid NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  status          text NOT NULL CHECK (status IN ('success','failed','retrying')),
  external_doc_id text,
  external_doc_no text,
  request_body    jsonb,
  response_body   jsonb,
  error_message   text,
  attempt         int DEFAULT 1,
  pushed_at       timestamptz DEFAULT now()
);
-- ── Line Bot Connections ───────────────────────────────────────
CREATE TABLE line_connections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id    text NOT NULL UNIQUE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  display_name    text,
  created_at      timestamptz DEFAULT now()
);
CREATE TABLE line_connection_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token           text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16),'hex'),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  expires_at      timestamptz NOT NULL DEFAULT now() + INTERVAL '10 minutes',
  used_at         timestamptz,
  created_at      timestamptz DEFAULT now()
);
-- ── Indexes ────────────────────────────────────────────────────
CREATE INDEX idx_docs_org_status    ON documents(organization_id, status, created_at DESC);
CREATE INDEX idx_docs_org_date      ON documents(organization_id, doc_date DESC);
CREATE INDEX idx_docs_vendor_tax    ON documents(organization_id, vendor_tax_id);
CREATE INDEX idx_docs_duplicate     ON documents(organization_id, doc_number, vendor_tax_id)
  WHERE doc_number IS NOT NULL;
CREATE INDEX idx_audit_doc          ON document_audit_logs(document_id, created_at DESC);
CREATE INDEX idx_push_doc           ON document_push_logs(document_id, status);
CREATE INDEX idx_members_user       ON organization_members(user_id);
CREATE INDEX idx_invite_token       ON invitations(token) WHERE accepted_at IS NULL;
CREATE INDEX idx_docs_vendor_search ON documents USING gin(vendor_name gin_trgm_ops)
  WHERE vendor_name IS NOT NULL;
-- ── Auto-update updated_at ─────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER organizations_updated_at
  BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER documents_updated_at
  BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER integrations_updated_at
  BEFORE UPDATE ON integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
