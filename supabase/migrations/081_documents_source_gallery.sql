-- ============================================================
-- Migration 081: Allow 'gallery' as a document source
-- ============================================================
-- The iOS "คลังพักเอกสาร" (GalleryView) staging flow commits documents with
-- source='gallery' to distinguish them from direct mobile captures. The
-- existing documents_source_check constraint rejected it, so committing from
-- the gallery failed with "violates check constraint documents_source_check".

alter table documents drop constraint if exists documents_source_check;
alter table documents add constraint documents_source_check
  check (source = any (array['web', 'mobile', 'email', 'line', 'liff_scan', 'gallery']));
