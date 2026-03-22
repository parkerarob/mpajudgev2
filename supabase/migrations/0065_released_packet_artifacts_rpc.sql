-- Read-only released packet artifact summary for director-facing packet presentation.

create or replace function public.released_packet_artifacts(
  target_event_entry_id uuid
)
returns table (
  score_sheet_id uuid,
  judge_position public.judge_position,
  form_type public.form_type,
  score_sheet_status public.score_sheet_status,
  caption_score_total integer,
  final_judge_rating public.final_judge_rating,
  submitted_at timestamptz,
  verified_at timestamptz,
  canonical_tape_id uuid,
  canonical_tape_storage_path text,
  canonical_tape_duration_seconds integer,
  canonical_tape_is_stitched boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  packet_released boolean;
begin
  actor_id := public.current_user_id();

  if actor_id is null then
    raise exception 'Authentication required';
  end if;

  select public.packet_is_released_for_event_entry(target_event_entry_id)
  into packet_released;

  if not (
    public.is_admin(actor_id)
    or public.is_event_chair(public.event_id_for_event_entry(target_event_entry_id), actor_id)
    or (packet_released and public.is_director_for_event_entry(target_event_entry_id, actor_id))
  ) then
    raise exception 'Not authorized to view packet artifacts';
  end if;

  return query
  select
    ss.id as score_sheet_id,
    ja.position as judge_position,
    ja.form_type,
    ss.status as score_sheet_status,
    ss.caption_score_total,
    ss.final_judge_rating,
    ss.submitted_at,
    ss.verified_at,
    ct.id as canonical_tape_id,
    ct.storage_path as canonical_tape_storage_path,
    ct.duration_seconds as canonical_tape_duration_seconds,
    ct.is_stitched as canonical_tape_is_stitched
  from public.score_sheets ss
  join public.judge_assignments ja on ja.id = ss.judge_assignment_id
  left join public.canonical_tapes ct on ct.score_sheet_id = ss.id
  where ss.event_entry_id = target_event_entry_id
    and (
      public.is_admin(actor_id)
      or public.is_event_chair(public.event_id_for_event_entry(target_event_entry_id), actor_id)
      or packet_released
    )
  order by
    case ja.position
      when 'stage1' then 1
      when 'stage2' then 2
      when 'stage3' then 3
      when 'sight_reading' then 4
      else 5
    end;
end;
$$;

revoke all on function public.released_packet_artifacts(uuid) from public;
grant execute on function public.released_packet_artifacts(uuid) to authenticated;

comment on function public.released_packet_artifacts(uuid) is
  'Returns released packet score-sheet and canonical-tape summaries with judge positions for authorized directors, chairs, and admins.';
