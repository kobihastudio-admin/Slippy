-- ═══════════════════════════════════════════════════════════════════════════
-- 20260830090000_personal_tasks.sql — "ภารกิจ" personal task/checklist list
-- Deliberately per-user, not organization-scoped — a personal to-do list,
-- not a shared work item (unlike vendors/tax, which are org data). No
-- category/priority/subtasks — YAGNI'd out per the bounded design; title +
-- done + optional due date is the whole feature for now.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS personal_tasks (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        text    NOT NULL,
  is_done      bool    NOT NULL DEFAULT false,
  due_date     date,
  created_at   timestamptz DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_personal_tasks_user ON personal_tasks(user_id, is_done, due_date);

ALTER TABLE personal_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "personal_tasks_own" ON personal_tasks FOR ALL USING (user_id = auth.uid());
