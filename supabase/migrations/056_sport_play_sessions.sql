-- Sport Play: sessions, shots, AI insight for Slippy Play (Badminton Tracker)

create table if not exists sport_play_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  sport            text not null default 'badminton',
  source           text not null default 'apple_watch',
  status           text not null default 'active' check (status in ('active','paused','completed','failed')),
  sync_status      text not null default 'pending' check (sync_status in ('pending','syncing','synced','failed')),
  started_at       timestamptz not null,
  ended_at         timestamptz,
  duration_seconds integer,

  total_shots      integer not null default 0,
  smash_count      integer not null default 0,
  avg_heart_rate   integer,
  max_heart_rate   integer,
  active_calories  numeric(8,2),

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create table if not exists sport_play_shots (
  id                 uuid primary key default gen_random_uuid(),
  session_id         uuid not null references sport_play_sessions(id) on delete cascade,
  shot_at            timestamptz not null,
  shot_type          text not null default 'unknown' check (shot_type in ('unknown','smash','clear','drive','drop','net_shot','serve')),
  confidence         numeric(4,3) not null default 0,
  peak_acceleration  numeric(8,4),
  peak_gyro          numeric(8,4),
  energy             numeric(10,4),
  created_at         timestamptz not null default now()
);
create index if not exists sport_play_shots_session_idx on sport_play_shots(session_id);
create index if not exists sport_play_shots_type_idx on sport_play_shots(shot_type);
create table if not exists sport_play_ai_insights (
  id                 uuid primary key default gen_random_uuid(),
  session_id         uuid not null unique references sport_play_sessions(id) on delete cascade,
  insight_text       text not null,
  skill_score        integer,
  power_score        integer,
  stamina_score      integer,
  consistency_score  integer,
  created_at         timestamptz not null default now()
);
-- RLS
alter table sport_play_sessions  enable row level security;
alter table sport_play_shots      enable row level security;
alter table sport_play_ai_insights enable row level security;
create policy "users own sessions" on sport_play_sessions
  for all using (auth.uid() = user_id);
create policy "users own shots" on sport_play_shots
  for all using (
    session_id in (select id from sport_play_sessions where user_id = auth.uid())
  );
create policy "users own insights" on sport_play_ai_insights
  for all using (
    session_id in (select id from sport_play_sessions where user_id = auth.uid())
  );
-- Auto-update updated_at
create or replace function update_sport_play_session_ts()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger trg_sport_play_session_ts
  before update on sport_play_sessions
  for each row execute function update_sport_play_session_ts();
