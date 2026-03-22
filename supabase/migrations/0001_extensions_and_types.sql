-- Foundation extensions and closed value sets for the Supabase rebuild.
-- Human-facing wording follows docs/Domain-Language.md.
-- Internal SQL identifiers intentionally use snake_case.

create extension if not exists pgcrypto;
create extension if not exists citext;

do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'event_status') then
    create type public.event_status as enum ('setup', 'active', 'completed');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'chair_role') then
    create type public.chair_role as enum ('chair', 'site_chair');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'judge_position') then
    create type public.judge_position as enum ('stage1', 'stage2', 'stage3', 'sight_reading');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'form_type') then
    create type public.form_type as enum ('stage_form', 'sight_reading_form');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'volunteer_role') then
    create type public.volunteer_role as enum ('check_in', 'stage_crew', 'announcer');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'piece_grade') then
    create type public.piece_grade as enum ('I', 'II', 'III', 'IV', 'V', 'VI');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'event_entry_grade') then
    create type public.event_entry_grade as enum (
      'I',
      'I/II',
      'II',
      'II/III',
      'III',
      'III/IV',
      'IV',
      'IV/V',
      'V',
      'V/VI',
      'VI'
    );
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'piece_status') then
    create type public.piece_status as enum ('active', 'archive', 'pop', 'pod', 'moved');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'repertoire_piece_slot') then
    create type public.repertoire_piece_slot as enum ('march', 'selection_1', 'selection_2');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'schedule_slot_type') then
    create type public.schedule_slot_type as enum ('performance', 'break');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'score_sheet_status') then
    create type public.score_sheet_status as enum ('draft', 'submitted', 'returned', 'verified');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'packet_assembly_status') then
    create type public.packet_assembly_status as enum ('incomplete', 'complete');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'packet_release_status') then
    create type public.packet_release_status as enum ('unreleased', 'released');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'final_judge_rating') then
    create type public.final_judge_rating as enum ('I', 'II', 'III', 'IV', 'V');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'final_overall_rating') then
    create type public.final_overall_rating as enum ('I', 'II', 'III', 'IV', 'V', 'CO');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'caption_rating') then
    create type public.caption_rating as enum ('A', 'B', 'C', 'D', 'F');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'caption_modifier') then
    create type public.caption_modifier as enum ('plus', 'none', 'minus');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'lunch_pickup_timing') then
    create type public.lunch_pickup_timing as enum ('before_performance', 'after_performance');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'event_fee_type') then
    create type public.event_fee_type as enum ('per_ensemble', 'comments_only', 'waiver');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'payment_status') then
    create type public.payment_status as enum ('pending', 'paid', 'waived');
  end if;
end
$$;

comment on type public.judge_position is
  'Internal SQL enum. Human-facing glossary uses stage1, stage2, stage3, and sightReading.';

comment on type public.form_type is
  'Internal SQL enum. Human-facing glossary uses stageForm and sightReadingForm.';

comment on type public.event_entry_grade is
  'Music difficulty classification derived from repertoire. Human-facing wording follows the glossary.';

comment on type public.caption_rating is
  'Letter-based caption assessment. Distinct from music grade and final ratings.';
