-- 20261109120000_friend_balances.sql
-- One person across features + a read-only per-friend balance function.
--
-- 1. split_participants gets an optional user_id so bill/sport participants can
--    be the same person as a Slippy friend (trip_participants already has it).
-- 2. friend_balances(): what the caller owes / is owed by each ACCEPTED friend
--    across bills, sport sessions and standalone payment requests.
--    SECURITY DEFINER because bills are readable per organization while the
--    friend may be in another organization. It is scoped to auth.uid() and to
--    accepted friends, and exposes only the minimum a person needs to
--    understand their own debt. Trips are NOT included: the existing
--    calculate_trip_settlement() credits a payer with their own share instead of
--    the others' shares, so trip balances wait for a separately approved fix.
--
-- Rules (see docs/superpowers/specs/2026-11-09-people-and-balances-design.md):
--  - participant person = COALESCE(user_id, the user connected to its LINE id)
--  - bill payer = the single receipt payer; a sport session with no receipts is
--    paid by its creator; anything else is "unattributed" (attributed = false,
--    never to be summed by clients)
--  - only unpaid (paid_at IS NULL), amount > 0 participant rows owe money, never
--    the payer's own row
--  - requests with a split_bill_id are not counted (the bill is the debt); only
--    pending, unexpired, THB requests between two users count
--  - only accepted friends are returned (stops strangers being linked to a bill
--    to attach a debt to someone)

-- ── 1. Linking column ──────────────────────────────────────────────────────
ALTER TABLE public.split_participants
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_split_parts_user
  ON public.split_participants(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_split_bills_creator
  ON public.split_bills(creator_id);

-- Backfill only the unambiguous case: a LINE id that is connected to a user.
-- line_connections.line_user_id is UNIQUE, so this can never pick between two
-- people. Never match by name. Later rows are resolved at read time below.
UPDATE public.split_participants sp
SET user_id = lc.user_id
FROM public.line_connections lc
WHERE sp.user_id IS NULL
  AND sp.line_user_id IS NOT NULL
  AND sp.line_user_id = lc.line_user_id;

-- ── 2. friend_balances() ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.friend_balances()
RETURNS TABLE (
  counterpart_user_id uuid,
  direction           text,
  amount              numeric,
  source_kind         text,
  source_id           uuid,
  title               text,
  occurred_at         timestamptz,
  attributed          boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
WITH me AS (SELECT auth.uid() AS uid),
friends AS (
  SELECT CASE WHEN f.requester_id = (SELECT uid FROM me) THEN f.addressee_id ELSE f.requester_id END AS fid
  FROM friendships f
  WHERE f.status = 'accepted'
    AND (f.requester_id = (SELECT uid FROM me) OR f.addressee_id = (SELECT uid FROM me))
),
my_bills AS (
  SELECT b.id AS bill_id FROM split_bills b WHERE b.creator_id = (SELECT uid FROM me)
  UNION
  SELECT sp.split_bill_id FROM split_participants sp WHERE sp.user_id = (SELECT uid FROM me)
  UNION
  -- participants that carry only a LINE id which is connected to me (index-friendly:
  -- no scan of every participant row)
  SELECT sp.split_bill_id
  FROM split_participants sp
  WHERE sp.user_id IS NULL
    AND sp.line_user_id IN (SELECT lc.line_user_id FROM line_connections lc WHERE lc.user_id = (SELECT uid FROM me))
),
parts AS (
  SELECT sp.id, sp.split_bill_id, sp.amount, sp.paid_at,
         COALESCE(sp.user_id, lc.user_id) AS uid
  FROM split_participants sp
  LEFT JOIN line_connections lc ON lc.line_user_id = sp.line_user_id
  WHERE sp.split_bill_id IN (SELECT bill_id FROM my_bills)
),
-- The payer is counted by PERSON, not by participant row (two rows for the same
-- person paying two receipts is still one payer), and a receipt's payer row must
-- belong to the same bill (there is no FK constraint for that).
receipt_payers AS (
  SELECT r.split_bill_id,
         count(DISTINCT pp.uid) AS payers,
         count(*) FILTER (WHERE r.paid_by_participant_id IS NULL OR pp.uid IS NULL) AS unknown_payers,
         (array_agg(pp.uid) FILTER (WHERE pp.uid IS NOT NULL))[1] AS payer_uid
  FROM split_bill_receipts r
  LEFT JOIN parts pp ON pp.id = r.paid_by_participant_id AND pp.split_bill_id = r.split_bill_id
  WHERE r.split_bill_id IN (SELECT bill_id FROM my_bills)
  GROUP BY r.split_bill_id
),
bill_payer AS (
  SELECT b.id AS bill_id, b.title, b.created_at, b.category, b.creator_id,
         CASE
           WHEN rp.split_bill_id IS NOT NULL THEN
             CASE WHEN rp.payers = 1 AND rp.unknown_payers = 0 THEN rp.payer_uid END
           WHEN b.category = 'sport' THEN b.creator_id
         END AS payer_uid
  FROM split_bills b
  LEFT JOIN receipt_payers rp ON rp.split_bill_id = b.id
  WHERE b.id IN (SELECT bill_id FROM my_bills)
),
bill_debts AS (
  SELECT p.uid AS debtor, bp.payer_uid AS creditor, p.amount,
         bp.bill_id, bp.title, bp.created_at,
         CASE WHEN bp.category = 'sport' THEN 'sport' ELSE 'bill' END AS kind
  FROM bill_payer bp
  JOIN parts p ON p.split_bill_id = bp.bill_id
  WHERE bp.payer_uid IS NOT NULL
    AND p.uid IS NOT NULL
    AND p.uid <> bp.payer_uid
    AND p.paid_at IS NULL
    AND p.amount > 0
),
requests AS (
  SELECT pr.id, pr.requester_id, pr.payer_id, pr.amount, pr.created_at,
         COALESCE(pr.description, 'ขอเงิน') AS title
  FROM payment_requests pr
  WHERE pr.split_bill_id IS NULL
    AND pr.status = 'pending'
    AND pr.currency = 'THB'
    AND pr.payer_id IS NOT NULL
    AND (pr.expires_at IS NULL OR pr.expires_at > now())
    AND ((pr.requester_id = (SELECT uid FROM me)) OR (pr.payer_id = (SELECT uid FROM me)))
)
-- bill / sport: they owe me
SELECT d.debtor, 'they_owe_me'::text, d.amount, d.kind, d.bill_id, d.title, d.created_at, true
FROM bill_debts d
WHERE d.creditor = (SELECT uid FROM me) AND d.debtor IN (SELECT fid FROM friends)
UNION ALL
-- bill / sport: I owe them
SELECT d.creditor, 'i_owe_them', d.amount, d.kind, d.bill_id, d.title, d.created_at, true
FROM bill_debts d
WHERE d.debtor = (SELECT uid FROM me) AND d.creditor IN (SELECT fid FROM friends)
UNION ALL
-- unattributed: I am an unpaid linked participant and the payer is unknown → tie it to the creator when a friend
SELECT bp.creator_id, 'i_owe_them', p.amount,
       CASE WHEN bp.category = 'sport' THEN 'sport' ELSE 'bill' END,
       bp.bill_id, bp.title, bp.created_at, false
FROM bill_payer bp
JOIN parts p ON p.split_bill_id = bp.bill_id
WHERE bp.payer_uid IS NULL
  AND p.uid = (SELECT uid FROM me)
  AND p.paid_at IS NULL AND p.amount > 0
  AND bp.creator_id <> (SELECT uid FROM me)
  AND bp.creator_id IN (SELECT fid FROM friends)
UNION ALL
-- unattributed: I created the bill, a friend is a linked unpaid participant, payer unknown
SELECT p.uid, 'they_owe_me', p.amount,
       CASE WHEN bp.category = 'sport' THEN 'sport' ELSE 'bill' END,
       bp.bill_id, bp.title, bp.created_at, false
FROM bill_payer bp
JOIN parts p ON p.split_bill_id = bp.bill_id
WHERE bp.payer_uid IS NULL
  AND bp.creator_id = (SELECT uid FROM me)
  AND p.uid IN (SELECT fid FROM friends)
  AND p.paid_at IS NULL AND p.amount > 0
UNION ALL
-- standalone requests: they owe me
SELECT r.payer_id, 'they_owe_me', r.amount, 'request', r.id, r.title, r.created_at, true
FROM requests r
WHERE r.requester_id = (SELECT uid FROM me) AND r.payer_id IN (SELECT fid FROM friends)
UNION ALL
-- standalone requests: I owe them
SELECT r.requester_id, 'i_owe_them', r.amount, 'request', r.id, r.title, r.created_at, true
FROM requests r
WHERE r.payer_id = (SELECT uid FROM me) AND r.requester_id IN (SELECT fid FROM friends);
$$;

-- Same lockdown pattern as accept_friend_invite (070), plus anon: Supabase's
-- default privileges grant EXECUTE on new functions to anon explicitly, which
-- REVOKE ... FROM PUBLIC alone does not remove.
REVOKE ALL ON FUNCTION public.friend_balances() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.friend_balances() TO authenticated;

COMMENT ON FUNCTION public.friend_balances() IS
  'Per-friend balances for auth.uid() across bills, sport sessions and standalone payment requests. attributed=false rows must never be summed.';
