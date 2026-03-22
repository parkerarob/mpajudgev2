-- Score-sheet and rating computation helpers.

create or replace function public.caption_rating_to_numeric(
  input_rating public.caption_rating
)
returns integer
language sql
immutable
as $$
  select case input_rating
    when 'A' then 1
    when 'B' then 2
    when 'C' then 3
    when 'D' then 4
    when 'F' then 5
    else null
  end
$$;

create or replace function public.final_judge_rating_from_total(
  total integer
)
returns public.final_judge_rating
language sql
immutable
as $$
  select case
    when total between 7 and 10 then 'I'::public.final_judge_rating
    when total between 11 and 17 then 'II'::public.final_judge_rating
    when total between 18 and 24 then 'III'::public.final_judge_rating
    when total between 25 and 31 then 'IV'::public.final_judge_rating
    when total between 32 and 35 then 'V'::public.final_judge_rating
    else null
  end
$$;

create or replace function public.rating_to_numeric(
  input_rating public.final_judge_rating
)
returns integer
language sql
immutable
as $$
  select case input_rating
    when 'I' then 1
    when 'II' then 2
    when 'III' then 3
    when 'IV' then 4
    when 'V' then 5
    else null
  end
$$;

create or replace function public.numeric_to_overall_rating(
  rating_value integer
)
returns public.final_overall_rating
language sql
immutable
as $$
  select case rating_value
    when 1 then 'I'::public.final_overall_rating
    when 2 then 'II'::public.final_overall_rating
    when 3 then 'III'::public.final_overall_rating
    when 4 then 'IV'::public.final_overall_rating
    when 5 then 'V'::public.final_overall_rating
    else null
  end
$$;

create or replace function public.grade_requires_sight_reading(
  input_grade public.event_entry_grade
)
returns boolean
language sql
immutable
as $$
  select case
    when input_grade in ('I', 'I/II') then false
    when input_grade is null then true
    else true
  end
$$;

create or replace function public.compute_score_sheet_totals(
  target_score_sheet_id uuid
)
returns void
language plpgsql
as $$
declare
  rated_count integer;
  total_score integer;
begin
  select
    count(*) filter (where rating is not null),
    sum(numeric_value)
  into rated_count, total_score
  from public.caption_ratings
  where score_sheet_id = target_score_sheet_id;

  update public.score_sheets
  set
    caption_score_total = case when rated_count = 7 then total_score else null end,
    final_judge_rating = case
      when rated_count = 7 then public.final_judge_rating_from_total(total_score)
      else null
    end
  where id = target_score_sheet_id;
end;
$$;

create or replace function public.compute_packet_split_rating_flag(
  target_event_entry_id uuid
)
returns boolean
language plpgsql
stable
as $$
declare
  min_rating integer;
  max_rating integer;
  rating_count integer;
begin
  select
    count(*),
    min(public.rating_to_numeric(ss.final_judge_rating)),
    max(public.rating_to_numeric(ss.final_judge_rating))
  into rating_count, min_rating, max_rating
  from public.score_sheets ss
  join public.judge_assignments ja on ja.id = ss.judge_assignment_id
  where ss.event_entry_id = target_event_entry_id
    and ss.status = 'verified'
    and ja.position in ('stage1', 'stage2', 'stage3')
    and ss.final_judge_rating is not null;

  if rating_count < 3 then
    return false;
  end if;

  return (max_rating - min_rating) >= 2;
end;
$$;

comment on function public.compute_score_sheet_totals(uuid) is
  'Recomputes caption_score_total and final_judge_rating for one score sheet when caption rows change.';
