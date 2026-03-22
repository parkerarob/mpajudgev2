-- Extend judge-audio storage access so directors can read released packet audio only.

create or replace function public.can_manage_score_sheet_audio(
  object_name text,
  check_user_id uuid default public.current_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = public, storage
as $$
  with target as (
    select public.storage_score_sheet_id(object_name) as score_sheet_id
  )
  select exists (
    select 1
    from target
    where score_sheet_id is not null
      and (
        public.is_admin(check_user_id)
        or public.is_event_chair(public.event_id_for_score_sheet(score_sheet_id), check_user_id)
        or public.assigned_user_id_for_score_sheet(score_sheet_id) = check_user_id
      )
  )
$$;

create or replace function public.can_read_score_sheet_audio(
  object_name text,
  check_user_id uuid default public.current_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = public, storage
as $$
  with target as (
    select
      public.storage_score_sheet_id(object_name) as score_sheet_id
  ),
  score_sheet_context as (
    select
      target.score_sheet_id,
      public.event_entry_id_for_score_sheet(target.score_sheet_id) as event_entry_id,
      public.event_id_for_score_sheet(target.score_sheet_id) as event_id
    from target
    where target.score_sheet_id is not null
  )
  select exists (
    select 1
    from score_sheet_context ctx
    where
      public.can_manage_score_sheet_audio(object_name, check_user_id)
      or (
        public.is_director_for_event_entry(ctx.event_entry_id, check_user_id)
        and public.packet_is_released_for_event_entry(ctx.event_entry_id)
      )
  )
$$;

comment on function public.can_read_score_sheet_audio(text, uuid) is
  'Security-definer helper for storage RLS. Allows judges/chairs/admins to read their score-sheet audio, and allows directors to read audio only after packet release.';

drop policy if exists judge_audio_select on storage.objects;
create policy judge_audio_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'judge-audio'
  and public.can_read_score_sheet_audio(name)
);
