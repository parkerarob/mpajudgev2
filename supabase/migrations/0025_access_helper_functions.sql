-- Access helper functions created after the required tables exist.

create or replace function public.is_admin(check_user_id uuid default public.current_user_id())
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.users
    where id = check_user_id
      and is_admin = true
  )
$$;

create or replace function public.is_event_chair(
  target_event_id uuid,
  check_user_id uuid default public.current_user_id()
)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.event_chairs
    where event_id = target_event_id
      and user_id = check_user_id
  )
$$;

create or replace function public.is_event_judge(
  target_event_id uuid,
  check_user_id uuid default public.current_user_id()
)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.judge_assignments
    where event_id = target_event_id
      and user_id = check_user_id
  )
$$;

create or replace function public.is_director_for_school(
  target_school_id uuid,
  check_user_id uuid default public.current_user_id()
)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.director_schools
    where school_id = target_school_id
      and director_id = check_user_id
  )
$$;

comment on function public.is_admin(uuid) is
  'Returns true when the target user has the global admin flag.';

comment on function public.is_event_chair(uuid, uuid) is
  'Returns true when the target user has any chair role for the given event.';

comment on function public.is_event_judge(uuid, uuid) is
  'Returns true when the target user is assigned as a judge for the given event.';

comment on function public.is_director_for_school(uuid, uuid) is
  'Returns true when the target user is attached to the given school as a director.';
