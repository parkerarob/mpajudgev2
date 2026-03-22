-- Packet completeness and overall-rating computation.

create or replace function public.expected_packet_sheet_count(
  target_event_entry_id uuid
)
returns integer
language plpgsql
stable
as $$
declare
  entry_grade public.event_entry_grade;
  comments_only_mode boolean;
  sight_reading_opted_out_value boolean;
begin
  select grade, comments_only, sight_reading_opted_out
  into entry_grade, comments_only_mode, sight_reading_opted_out_value
  from public.event_entries
  where id = target_event_entry_id;

  if comments_only_mode and sight_reading_opted_out_value then
    return 3;
  end if;

  if public.grade_requires_sight_reading(entry_grade) then
    return 4;
  end if;

  return 3;
end;
$$;

create or replace function public.grade_i_overall_rating_from_sum(
  total_sum integer
)
returns public.final_overall_rating
language sql
immutable
as $$
  select case
    when total_sum between 3 and 5 then 'I'::public.final_overall_rating
    when total_sum between 6 and 8 then 'II'::public.final_overall_rating
    when total_sum between 9 and 11 then 'III'::public.final_overall_rating
    when total_sum between 12 and 14 then 'IV'::public.final_overall_rating
    when total_sum = 15 then 'V'::public.final_overall_rating
    else null
  end
$$;

create or replace function public.grade_i_overall_rating_lookup(
  rating_values integer[]
)
returns public.final_overall_rating
language plpgsql
immutable
as $$
declare
  sorted_values integer[];
  total_sum integer;
  combo text;
begin
  select array_agg(value order by value)
  into sorted_values
  from unnest(rating_values) as value;

  total_sum := coalesce(sorted_values[1], 0) + coalesce(sorted_values[2], 0) + coalesce(sorted_values[3], 0);
  combo := array_to_string(sorted_values, ',');

  return case combo
    when '1,1,1' then 'I'::public.final_overall_rating
    when '1,1,2' then 'I'::public.final_overall_rating
    when '1,1,3' then 'I'::public.final_overall_rating
    when '1,1,4' then 'I'::public.final_overall_rating
    when '1,1,5' then 'I'::public.final_overall_rating
    when '1,2,2' then 'II'::public.final_overall_rating
    when '1,2,3' then 'II'::public.final_overall_rating
    when '2,2,2' then 'II'::public.final_overall_rating
    when '2,2,3' then 'II'::public.final_overall_rating
    when '2,2,4' then 'II'::public.final_overall_rating
    when '2,2,5' then 'II'::public.final_overall_rating
    when '1,3,3' then 'III'::public.final_overall_rating
    when '2,3,3' then 'III'::public.final_overall_rating
    when '2,3,4' then 'III'::public.final_overall_rating
    when '3,3,3' then 'III'::public.final_overall_rating
    when '3,3,4' then 'III'::public.final_overall_rating
    when '3,3,5' then 'III'::public.final_overall_rating
    when '1,4,4' then 'IV'::public.final_overall_rating
    when '2,4,4' then 'IV'::public.final_overall_rating
    when '3,4,4' then 'IV'::public.final_overall_rating
    when '3,4,5' then 'IV'::public.final_overall_rating
    when '4,4,4' then 'IV'::public.final_overall_rating
    when '4,4,5' then 'IV'::public.final_overall_rating
    when '1,5,5' then 'V'::public.final_overall_rating
    when '2,5,5' then 'V'::public.final_overall_rating
    when '3,5,5' then 'V'::public.final_overall_rating
    when '4,5,5' then 'V'::public.final_overall_rating
    when '5,5,5' then 'V'::public.final_overall_rating
    else public.grade_i_overall_rating_from_sum(total_sum)
  end;
end;
$$;

create or replace function public.compute_packet_overall_rating(
  target_event_entry_id uuid
)
returns public.final_overall_rating
language plpgsql
stable
as $$
declare
  entry_grade public.event_entry_grade;
  comments_only_mode boolean;
  sheet_count integer;
  rating_values integer[];
  total_sum integer;
  stage_values integer[];
begin
  select grade, comments_only
  into entry_grade, comments_only_mode
  from public.event_entries
  where id = target_event_entry_id;

  if comments_only_mode then
    return 'CO'::public.final_overall_rating;
  end if;

  select array_agg(public.rating_to_numeric(ss.final_judge_rating) order by public.rating_to_numeric(ss.final_judge_rating))
  into rating_values
  from public.score_sheets ss
  where ss.event_entry_id = target_event_entry_id
    and ss.status = 'verified'
    and ss.final_judge_rating is not null;

  sheet_count := coalesce(array_length(rating_values, 1), 0);
  if sheet_count = 0 then
    return null;
  end if;

  if public.grade_requires_sight_reading(entry_grade) = false then
    if sheet_count <> 3 then
      return null;
    end if;

    return public.grade_i_overall_rating_lookup(rating_values);
  end if;

  if sheet_count <> 4 then
    return null;
  end if;

  select array_agg(public.rating_to_numeric(ss.final_judge_rating) order by ja.position)
  into stage_values
  from public.score_sheets ss
  join public.judge_assignments ja on ja.id = ss.judge_assignment_id
  where ss.event_entry_id = target_event_entry_id
    and ss.status = 'verified'
    and ja.position in ('stage1', 'stage2', 'stage3')
    and ss.final_judge_rating is not null;

  if coalesce(array_length(stage_values, 1), 0) = 3
     and stage_values[1] = stage_values[2]
     and stage_values[2] = stage_values[3]
     and stage_values[1] >= 3 then
    return public.numeric_to_overall_rating(stage_values[1]);
  end if;

  select coalesce(sum(value), 0)
  into total_sum
  from unnest(rating_values) as value;

  return case
    when total_sum between 4 and 6 then 'I'::public.final_overall_rating
    when total_sum between 7 and 10 then 'II'::public.final_overall_rating
    when total_sum between 11 and 14 then 'III'::public.final_overall_rating
    when total_sum between 15 and 18 then 'IV'::public.final_overall_rating
    when total_sum between 19 and 20 then 'V'::public.final_overall_rating
    else null
  end;
end;
$$;

create or replace function public.recompute_packet_state(
  target_event_entry_id uuid
)
returns void
language plpgsql
as $$
declare
  expected_sheet_count integer;
  verified_sheet_count integer;
  canonical_tape_count integer;
  is_complete boolean;
begin
  expected_sheet_count := public.expected_packet_sheet_count(target_event_entry_id);

  select count(*)
  into verified_sheet_count
  from public.score_sheets ss
  where ss.event_entry_id = target_event_entry_id
    and ss.status = 'verified';

  select count(*)
  into canonical_tape_count
  from public.canonical_tapes ct
  join public.score_sheets ss on ss.id = ct.score_sheet_id
  where ss.event_entry_id = target_event_entry_id;

  is_complete := verified_sheet_count = expected_sheet_count
    and canonical_tape_count = expected_sheet_count;

  update public.packets
  set
    assembly_status = case when is_complete then 'complete'::public.packet_assembly_status else 'incomplete'::public.packet_assembly_status end,
    has_split_rating_flag = public.compute_packet_split_rating_flag(target_event_entry_id),
    overall_rating = case
      when is_complete then public.compute_packet_overall_rating(target_event_entry_id)
      else null
    end
  where event_entry_id = target_event_entry_id;
end;
$$;

comment on function public.recompute_packet_state(uuid) is
  'Recomputes packet assembly status, split-rating flag, and overall rating for one event entry.';
