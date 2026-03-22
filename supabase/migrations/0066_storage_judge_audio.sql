-- Hosted storage bucket and policies for judge audio uploads.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'judge-audio',
  'judge-audio',
  false,
  104857600,
  array[
    'audio/mpeg',
    'audio/mp4',
    'audio/m4a',
    'audio/aac',
    'audio/wav',
    'audio/x-wav',
    'audio/webm',
    'audio/ogg',
    'video/mp4',
    'video/quicktime'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.storage_score_sheet_id(object_name text)
returns uuid
language plpgsql
immutable
set search_path = public, storage
as $$
declare
  path_parts text[];
begin
  path_parts := storage.foldername(object_name);

  if coalesce(array_length(path_parts, 1), 0) < 2 then
    return null;
  end if;

  if path_parts[1] <> 'score-sheets' then
    return null;
  end if;

  begin
    return path_parts[2]::uuid;
  exception
    when others then
      return null;
  end;
end;
$$;

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

comment on function public.storage_score_sheet_id(text) is
  'Extracts the score sheet id from a judge-audio storage object path shaped like score-sheets/<score_sheet_id>/...';

comment on function public.can_manage_score_sheet_audio(text, uuid) is
  'Security-definer helper for storage RLS. Allows only the assigned judge, event chairs, or admins to access score-sheet audio objects.';

drop policy if exists judge_audio_select on storage.objects;
create policy judge_audio_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'judge-audio'
  and public.can_manage_score_sheet_audio(name)
);

drop policy if exists judge_audio_insert on storage.objects;
create policy judge_audio_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'judge-audio'
  and public.can_manage_score_sheet_audio(name)
);

drop policy if exists judge_audio_update on storage.objects;
create policy judge_audio_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'judge-audio'
  and public.can_manage_score_sheet_audio(name)
)
with check (
  bucket_id = 'judge-audio'
  and public.can_manage_score_sheet_audio(name)
);

drop policy if exists judge_audio_delete on storage.objects;
create policy judge_audio_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'judge-audio'
  and public.can_manage_score_sheet_audio(name)
);
