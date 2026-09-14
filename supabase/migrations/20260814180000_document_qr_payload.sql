-- Raw barcode payload as printed on the document.
--
-- The app has decoded QR codes on device since the PromptPay work, but only
-- EMVCo Bill-Payment codes went anywhere: tax id, reference and amount were
-- lifted out and the rest was discarded. Thai receipts increasingly carry a
-- different kind — HomePro prints one labelled
-- "SCAN QR เพื่อออกใบกำกับภาษีเต็มรูปแบบ" pointing at the merchant's own e-Tax
-- Invoice, which is authoritative structured data from the seller's system.
-- Those payloads were being read and thrown away.
--
-- Stored raw and unparsed on purpose. Nothing consumes this yet; the point is
-- to find out what real receipts actually encode before designing anything on
-- top of a guess.
--
-- Note this can hold a URL that identifies a purchase. It is customer data,
-- covered by the same RLS as the rest of the row, and must not be fetched
-- server-side without a deliberate decision — some of these links are an
-- ACTION ("issue me a full tax invoice"), not a read.

alter table public.documents
  add column if not exists qr_payload text;

comment on column public.documents.qr_payload is
  'Raw barcode payload decoded on device from the original capture. Unparsed. May be an EMVCo bill-payment string or a merchant e-Tax Invoice URL.';
