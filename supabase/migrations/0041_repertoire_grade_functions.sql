-- Repertoire-to-grade derivation helpers.

create or replace function public.grade_sort_value(
  input_grade public.piece_grade
)
returns integer
language sql
immutable
as $$
  select case input_grade
    when 'I' then 1
    when 'II' then 2
    when 'III' then 3
    when 'IV' then 4
    when 'V' then 5
    when 'VI' then 6
    else null
  end
$$;

create or replace function public.grade_pair_to_event_entry_grade(
  grade_a public.piece_grade,
  grade_b public.piece_grade
)
returns public.event_entry_grade
language plpgsql
immutable
as $$
declare
  low_value integer;
  high_value integer;
  low_grade public.piece_grade;
  high_grade public.piece_grade;
begin
  if grade_a is null then
    return null;
  end if;

  if grade_b is null then
    case grade_a
      when 'I' then return 'I'::public.event_entry_grade;
      when 'II' then return 'II'::public.event_entry_grade;
      when 'III' then return 'III'::public.event_entry_grade;
      when 'IV' then return 'IV'::public.event_entry_grade;
      when 'V' then return 'V'::public.event_entry_grade;
      when 'VI' then return 'VI'::public.event_entry_grade;
      else return null;
    end case;
  end if;

  low_value := least(public.grade_sort_value(grade_a), public.grade_sort_value(grade_b));
  high_value := greatest(public.grade_sort_value(grade_a), public.grade_sort_value(grade_b));

  if high_value - low_value > 1 then
    return null;
  end if;

  low_grade := case low_value
    when 1 then 'I'::public.piece_grade
    when 2 then 'II'::public.piece_grade
    when 3 then 'III'::public.piece_grade
    when 4 then 'IV'::public.piece_grade
    when 5 then 'V'::public.piece_grade
    when 6 then 'VI'::public.piece_grade
  end;

  high_grade := case high_value
    when 1 then 'I'::public.piece_grade
    when 2 then 'II'::public.piece_grade
    when 3 then 'III'::public.piece_grade
    when 4 then 'IV'::public.piece_grade
    when 5 then 'V'::public.piece_grade
    when 6 then 'VI'::public.piece_grade
  end;

  if low_value = high_value then
    return public.grade_pair_to_event_entry_grade(low_grade, null);
  end if;

  return case
    when low_grade = 'I' and high_grade = 'II' then 'I/II'::public.event_entry_grade
    when low_grade = 'II' and high_grade = 'III' then 'II/III'::public.event_entry_grade
    when low_grade = 'III' and high_grade = 'IV' then 'III/IV'::public.event_entry_grade
    when low_grade = 'IV' and high_grade = 'V' then 'IV/V'::public.event_entry_grade
    when low_grade = 'V' and high_grade = 'VI' then 'V/VI'::public.event_entry_grade
    else null
  end;
end;
$$;

create or replace function public.derive_event_entry_grade(
  target_event_entry_id uuid
)
returns public.event_entry_grade
language plpgsql
stable
as $$
declare
  selection_1_piece_id uuid;
  selection_2_piece_id uuid;
  selection_1_grade public.piece_grade;
  selection_2_grade public.piece_grade;
  selection_1_is_masterwork boolean;
begin
  select r.piece_id
  into selection_1_piece_id
  from public.repertoire r
  where r.event_entry_id = target_event_entry_id
    and r.piece_slot = 'selection_1';

  select r.piece_id
  into selection_2_piece_id
  from public.repertoire r
  where r.event_entry_id = target_event_entry_id
    and r.piece_slot = 'selection_2';

  if selection_1_piece_id is null then
    return null;
  end if;

  select p.grade, p.is_masterwork
  into selection_1_grade, selection_1_is_masterwork
  from public.pieces p
  where p.id = selection_1_piece_id;

  if selection_2_piece_id is null then
    if selection_1_is_masterwork then
      return public.grade_pair_to_event_entry_grade(selection_1_grade, null);
    end if;

    return null;
  end if;

  select p.grade
  into selection_2_grade
  from public.pieces p
  where p.id = selection_2_piece_id;

  return public.grade_pair_to_event_entry_grade(selection_1_grade, selection_2_grade);
end;
$$;

create or replace function public.sync_event_entry_grade(
  target_event_entry_id uuid
)
returns void
language plpgsql
as $$
begin
  update public.event_entries
  set grade = public.derive_event_entry_grade(target_event_entry_id)
  where id = target_event_entry_id;
end;
$$;

comment on function public.derive_event_entry_grade(uuid) is
  'Derives the event-entry grade from selection_1 and selection_2 according to glossary rules.';
