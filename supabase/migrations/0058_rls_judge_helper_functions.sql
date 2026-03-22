-- Security-definer helper functions for judge-assignment ownership checks in RLS policies.

create or replace function public.user_id_for_judge_assignment(
  target_judge_assignment_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select user_id
  from public.judge_assignments
  where id = target_judge_assignment_id
$$;

create or replace function public.event_id_for_judge_assignment(
  target_judge_assignment_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select event_id
  from public.judge_assignments
  where id = target_judge_assignment_id
$$;
