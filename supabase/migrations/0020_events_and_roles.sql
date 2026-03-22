-- Event core and role assignments.

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  district_id uuid not null references public.districts (id) on delete restrict,
  site_id uuid not null references public.sites (id) on delete restrict,
  graded_list_version_id uuid not null references public.graded_list_versions (id) on delete restrict,
  name text not null,
  season_year text not null,
  start_date date not null,
  end_date date,
  schedule_start_time time not null,
  status public.event_status not null default 'setup',
  created_at timestamptz not null default timezone('utc', now()),
  constraint events_date_range_check check (end_date is null or end_date >= start_date)
);

create table if not exists public.event_chairs (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role public.chair_role not null,
  primary key (event_id, user_id, role)
);

create table if not exists public.judge_assignments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  position public.judge_position not null,
  form_type public.form_type generated always as (
    case
      when position = 'sight_reading' then 'sight_reading_form'::public.form_type
      else 'stage_form'::public.form_type
    end
  ) stored,
  constraint judge_assignments_event_position_key unique (event_id, position),
  constraint judge_assignments_event_user_key unique (event_id, user_id)
);

create table if not exists public.event_volunteers (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role public.volunteer_role not null,
  primary key (event_id, user_id, role)
);

create table if not exists public.event_day_start_times (
  event_id uuid not null references public.events (id) on delete cascade,
  day date not null,
  start_time time not null,
  primary key (event_id, day)
);

create index if not exists idx_events_district_id
  on public.events (district_id);

create index if not exists idx_events_site_id
  on public.events (site_id);

create index if not exists idx_events_graded_list_version_id
  on public.events (graded_list_version_id);

create index if not exists idx_event_chairs_user_id
  on public.event_chairs (user_id);

create index if not exists idx_judge_assignments_user_id
  on public.judge_assignments (user_id);

create index if not exists idx_event_volunteers_user_id
  on public.event_volunteers (user_id);

comment on table public.events is
  'A specific MPA event at a specific site on a specific date or date range.';

comment on table public.event_chairs is
  'Per-event chair assignments. A single user may hold multiple chair roles for the same event.';

comment on table public.judge_assignments is
  'Per-event judge assignments. One position per event and one position per judge per event.';

comment on table public.event_volunteers is
  'Per-event volunteer assignments. A single user may hold multiple volunteer roles for the same event.';
