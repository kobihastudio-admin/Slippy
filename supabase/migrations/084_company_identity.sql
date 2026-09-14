-- ============================================================
-- Migration 084: Separate the SHOP from the LEGAL ENTITY
-- ============================================================
-- A Thai receipt routinely carries two different names and two different
-- addresses, and collapsing them loses whichever one the user actually cares
-- about. From a real KOFUKU bill:
--
--   KOFUKU Silom Complex               ← the shop/branch you visited
--   บริษัท สยาม อัลเตอร์ กรุ๊ป จำกัด     ← the company that issued it
--   TAX ID 0105562046201               ← belongs to the company
--   เลขที่ 2 ซอยงามวงศ์วาน 6 … นนทบุรี   ← the REGISTERED address, in a different
--                                        province from the Silom branch
--
-- The pipeline previously had only `vendor_name`, so the tax-id lookup
-- overwrote "KOFUKU Silom Complex" with the legal name and the recognisable
-- shop disappeared from the user's own records.
--
--   vendor_*  = the shop as experienced (name, branch address, phone)
--   company_* = the juristic entity behind it (tied to vendor_tax_id)
--
-- Both may legitimately be identical for a small single-branch business.

alter table documents add column if not exists company_name    text;
alter table documents add column if not exists company_address text;

comment on column documents.vendor_name is
  'Shop/branch name as printed — e.g. "KOFUKU Silom Complex". What the user recognises.';
comment on column documents.company_name is
  'Registered juristic name behind the shop — e.g. "บริษัท สยาม อัลเตอร์ กรุ๊ป จำกัด". Owns vendor_tax_id.';
comment on column documents.vendor_address is
  'Address of the branch visited, when the receipt prints one.';
comment on column documents.company_address is
  'Registered/HQ address, when it differs from the branch.';

-- Same split for the vendor directory, so repeat-purchase stats stay keyed on
-- the shop while the legal name is still available for accounting exports.
alter table vendors add column if not exists company_name text;
