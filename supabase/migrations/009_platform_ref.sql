-- ---------------------------------------------------------------------------
-- Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
-- All rights reserved. Proprietary and confidential.
-- ---------------------------------------------------------------------------
-- 009_platform_ref.sql
-- Adds platform_ref, customer_name, staff_name to documents.
-- platform_ref = delivery order ID (LMF-xxx, GrabOrder-xxx, etc.)
--   → used as primary duplicate-detection key for consumer_receipt documents.
-- ---------------------------------------------------------------------------

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS platform_ref   text,   -- LMF-260523-562610273, GrabOrder-xxx …
  ADD COLUMN IF NOT EXISTS customer_name  text,   -- ชื่อลูกค้า / ผู้รับสินค้า
  ADD COLUMN IF NOT EXISTS staff_name     text;
-- ชื่อพนักงาน / แคชเชียร์

-- Index: fast duplicate lookup per org by platform_ref
CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_platform_ref
  ON documents (organization_id, platform_ref)
  WHERE platform_ref IS NOT NULL AND platform_ref != '';
