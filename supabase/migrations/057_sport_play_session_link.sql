-- Links a Slippy Play (Apple Watch) workout session to a booked sport session
-- (split_bills row with category='sport') so shot/HR data recorded on the
-- Watch can be analyzed alongside the booking's roster/payment info.

alter table sport_play_sessions
  add column if not exists organization_id     uuid references organizations(id) on delete cascade,
  add column if not exists linked_split_bill_id uuid references split_bills(id) on delete set null;
create index if not exists sport_play_sessions_linked_bill_idx
  on sport_play_sessions(linked_split_bill_id) where linked_split_bill_id is not null;
comment on column sport_play_sessions.linked_split_bill_id is
  'Optional FK to split_bills(category=sport) — set when the user attaches an Apple Watch workout to a specific booked sport session for combined analysis (shots/HR + payment/roster).';
