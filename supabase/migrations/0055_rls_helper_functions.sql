-- Security-definer helper functions used by RLS policies to avoid recursive table-policy chains.

create or replace function public.event_id_for_event_entry(
  target_event_entry_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select event_id
  from public.event_entries
  where id = target_event_entry_id
$$;

create or replace function public.school_id_for_ensemble(
  target_ensemble_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select school_id
  from public.ensembles
  where id = target_ensemble_id
$$;

create or replace function public.school_id_for_event_entry(
  target_event_entry_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select en.school_id
  from public.event_entries ee
  join public.ensembles en on en.id = ee.ensemble_id
  where ee.id = target_event_entry_id
$$;

create or replace function public.is_director_for_event_entry(
  target_event_entry_id uuid,
  check_user_id uuid default public.current_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.event_entries ee
    join public.ensembles en on en.id = ee.ensemble_id
    join public.director_schools ds on ds.school_id = en.school_id
    where ee.id = target_event_entry_id
      and ds.director_id = check_user_id
  )
$$;

create or replace function public.packet_is_released_for_event_entry(
  target_event_entry_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.packets
    where event_entry_id = target_event_entry_id
      and release_status = 'released'
  )
$$;

create or replace function public.event_entry_id_for_score_sheet(
  target_score_sheet_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select event_entry_id
  from public.score_sheets
  where id = target_score_sheet_id
$$;

create or replace function public.event_id_for_score_sheet(
  target_score_sheet_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select ee.event_id
  from public.score_sheets ss
  join public.event_entries ee on ee.id = ss.event_entry_id
  where ss.id = target_score_sheet_id
$$;

create or replace function public.assigned_user_id_for_score_sheet(
  target_score_sheet_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select ja.user_id
  from public.score_sheets ss
  join public.judge_assignments ja on ja.id = ss.judge_assignment_id
  where ss.id = target_score_sheet_id
$$;

comment on function public.is_director_for_event_entry(uuid, uuid) is
  'Security-definer helper for RLS. Checks whether a user directs the school associated with an event entry.';
