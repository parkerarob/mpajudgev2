-- Persistent ensembles and their participation in a specific event.

create table if not exists public.ensembles (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint ensembles_school_name_key unique (school_id, name)
);

create table if not exists public.event_entries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  ensemble_id uuid not null references public.ensembles (id) on delete cascade,
  registered_by uuid not null references public.users (id) on delete restrict,
  grade public.event_entry_grade,
  comments_only boolean not null default false,
  sight_reading_opted_out boolean not null default false,
  total_members integer,
  checkin_completed boolean not null default false,
  checkin_completed_by uuid references public.users (id) on delete set null,
  checkin_completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  constraint event_entries_event_ensemble_key unique (event_id, ensemble_id),
  constraint event_entries_total_members_check check (total_members is null or total_members > 0),
  constraint event_entries_sight_reading_opt_out_check check (
    comments_only = true or sight_reading_opted_out = false
  ),
  constraint event_entries_checkin_consistency_check check (
    (checkin_completed = true and checkin_completed_by is not null and checkin_completed_at is not null)
    or (checkin_completed = false and checkin_completed_by is null and checkin_completed_at is null)
  )
);

create index if not exists idx_ensembles_school_id
  on public.ensembles (school_id);

create index if not exists idx_event_entries_event_id
  on public.event_entries (event_id);

create index if not exists idx_event_entries_ensemble_id
  on public.event_entries (ensemble_id);

create index if not exists idx_event_entries_registered_by
  on public.event_entries (registered_by);

comment on table public.ensembles is
  'Persistent performing groups at a school, independent of any single event.';

comment on table public.event_entries is
  'An ensemble''s participation in a specific event, including comments-only and check-in state.';
