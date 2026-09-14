-- ---------------------------------------------------------------------------
-- 065_billing_notifications.sql
--
-- First real writers into the `notifications` table (migration 006) — it has
-- had a full schema/API/UI (web + iOS bell) since then but nothing ever
-- inserted a row. This wires up the credit/quota half of that; the payment
-- half (invoice.upcoming / invoice.payment_failed / invoice.paid) is wired
-- in api/src/routes/stripe.ts in the same change.
--
-- Notifications here target the whole org (organization_id set, user_id
-- NULL) — billing/quota is an org-level concern, any member should see it,
-- matching how GET /api/notifications already ORs on organization_id.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION increment_doc_used(p_org_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_quota     int;
  v_used      int;
  v_new_used  int;
BEGIN
  SELECT doc_quota, doc_used INTO v_quota, v_used
  FROM organizations WHERE id = p_org_id FOR UPDATE;

  -- -1 or 99999 = unlimited — no quota notifications make sense here
  IF v_quota >= 99999 THEN
    UPDATE organizations SET doc_used = doc_used + 1 WHERE id = p_org_id;
    RETURN true;
  END IF;

  IF v_used >= v_quota THEN
    RETURN false;  -- quota exceeded
  END IF;

  v_new_used := v_used + 1;
  UPDATE organizations SET doc_used = v_new_used WHERE id = p_org_id;

  -- Crossing the 80% line — fire once, only on the increment that crosses it
  IF v_used < (v_quota * 0.8) AND v_new_used >= (v_quota * 0.8) THEN
    INSERT INTO notifications (organization_id, type, title, body, metadata)
    VALUES (
      p_org_id, 'quota_warning', 'โควต้าเอกสารใกล้เต็มแล้ว',
      format('ใช้ไป %s จาก %s เอกสารในรอบนี้ (%s%%)',
             v_new_used, v_quota, round(v_new_used::numeric / v_quota * 100)),
      jsonb_build_object('doc_used', v_new_used, 'doc_quota', v_quota)
    );
  END IF;

  -- Fully exhausted on this increment
  IF v_new_used >= v_quota THEN
    INSERT INTO notifications (organization_id, type, title, body, metadata)
    VALUES (
      p_org_id, 'quota_exceeded', 'โควต้าเอกสารเต็มแล้ว',
      format('ใช้ครบ %s เอกสารแล้วในรอบนี้ — อัปโหลดเพิ่มไม่ได้จนกว่าจะรอบถัดไปหรืออัปเกรดแผน', v_quota),
      jsonb_build_object('doc_used', v_new_used, 'doc_quota', v_quota)
    );
  END IF;

  RETURN true;
END;
$$;
