-- 087 — Migration 079 added p_match_key as a defaulted trailing argument.
-- PostgreSQL treats a changed argument list as a new overload rather than a
-- replacement, leaving both the old 8-argument and new 9-argument functions.
-- An 8-argument RPC can then match both signatures. Keep only the new function;
-- its defaulted p_match_key still accepts legacy 8-argument callers.

DROP FUNCTION IF EXISTS public.upsert_vendor(
  uuid, text, text, text, text, numeric, numeric, date
);

