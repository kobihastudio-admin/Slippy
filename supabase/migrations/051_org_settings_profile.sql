-- ── 051: Add settings jsonb to organizations + picture_url to line_connections ──
-- Used by /liff/profile for storing PromptPay ID and other org-level settings.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS settings jsonb DEFAULT '{}'::jsonb;
-- Store LINE profile picture URL for display without calling LIFF API
ALTER TABLE line_connections
  ADD COLUMN IF NOT EXISTS picture_url text;
