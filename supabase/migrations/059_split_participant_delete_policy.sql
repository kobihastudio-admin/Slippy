-- 059: The iOS app's tree-style roster (058) lets a participant remove a
-- friend they added (or an org member tidy up the roster), but
-- split_participants never had a DELETE policy — only select/insert/update
-- (015). Mirrors the existing org-membership check used by
-- "split_parts_select" so removal is scoped to people who can already see
-- the bill.

CREATE POLICY "split_parts_delete" ON split_participants FOR DELETE
  USING (split_bill_id IN (
    SELECT id FROM split_bills WHERE organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  ));
