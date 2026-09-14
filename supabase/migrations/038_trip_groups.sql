-- ─────────────────────────────────────────────────────────────────────────────
-- 038_trip_groups.sql
-- "กลุ่มทริป" — trip-group bill splitting & tracking on LINE, à la KhunThong.
-- Mirrors 037_sport_groups.sql exactly: reuses split_bills/split_participants
-- with category='trip' and a flat-fee even-split (NOT document line items).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE split_bills
  ADD COLUMN IF NOT EXISTS trip_type   text,   -- เช่น เที่ยวทะเล, แคมป์ปิ้ง, ปีนเขา, ทริปต่างประเทศ
  ADD COLUMN IF NOT EXISTS destination text;
-- เช่น เขาใหญ่, ภูเก็ต, ญี่ปุ่น

CREATE INDEX IF NOT EXISTS idx_split_bills_category_trip
  ON split_bills(organization_id, category, status) WHERE category = 'trip';
COMMENT ON COLUMN split_bills.trip_type IS
  'Trip theme/category for category=trip bills (เที่ยวทะเล/แคมป์ปิ้ง/ปีนเขา/...) — set via /tripgroup on LINE';
COMMENT ON COLUMN split_bills.destination IS
  'Trip destination for category=trip bills — set via /tripgroup on LINE';
COMMENT ON COLUMN split_bills.category IS
  'sport = even-split sport-group bill via /sportgroup; trip = even-split trip-group bill via /tripgroup; null/receipt = document-based /split';
