-- ── documents.source — the complete allow-list, and the only place it lives ──
--
-- Sharing a receipt into Slippy from another app (LINE, Photos, Mail) failed
-- with "violates check constraint documents_source_check". SharedImportView
-- writes source='share_extension'; the constraint had never heard of it.
--
-- This is the FOURTH migration to widen this same constraint, and each one was
-- written the same way: a new capture flow shipped, a user hit the error, and a
-- migration added exactly the one missing string.
--
--   001  web, mobile, email, line
--   050  + liff_scan        (the /liff/scan page)
--   081  + gallery          (คลังพักเอกสาร staging flow)
--   here + share_extension  (iOS share sheet)
--
-- The failure is invisible until a real person tries the feature, because
-- nothing in the app or the test suite knows the allow-list exists. So the list
-- below names its writer for every value — if you are adding a capture flow,
-- this file is the one to edit, and the comment tells you whether the value you
-- want is already here.
--
-- Kept as a CHECK rather than dropped: it catches a typo'd source at write time,
-- which is worth one migration per new flow. A lookup table with a foreign key
-- would move the problem rather than remove it.

alter table documents drop constraint if exists documents_source_check;
alter table documents add constraint documents_source_check
  check (source = any (array[
    'web',              -- web/ Next.js upload
    'mobile',           -- ios CameraPickerView (camera + photo picker)
    'share_extension',  -- ios SharedImportView (iOS share sheet from other apps)
    'gallery',          -- ios GalleryView (คลังพักเอกสาร staging → commit)
    'liff_scan',        -- web /liff/scan LIFF page
    'line',             -- LINE webhook
    'email'             -- inbound email ingest
  ]));
