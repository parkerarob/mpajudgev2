-- Trigger wiring for computed values, packet state, and audit hooks.

create or replace function public.before_caption_rating_write()
returns trigger
language plpgsql
as $$
begin
  if new.rating is not null then
    new.numeric_value := public.caption_rating_to_numeric(new.rating);
  else
    new.numeric_value := null;
  end if;

  return new;
end;
$$;

create or replace function public.after_caption_ratings_change()
returns trigger
language plpgsql
as $$
declare
  target_score_sheet_id uuid;
  target_event_entry_id uuid;
begin
  target_score_sheet_id := coalesce(new.score_sheet_id, old.score_sheet_id);

  perform public.compute_score_sheet_totals(target_score_sheet_id);

  select event_entry_id
  into target_event_entry_id
  from public.score_sheets
  where id = target_score_sheet_id;

  if target_event_entry_id is not null then
    perform public.recompute_packet_state(target_event_entry_id);
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function public.after_repertoire_change()
returns trigger
language plpgsql
as $$
declare
  target_event_entry_id uuid;
begin
  target_event_entry_id := coalesce(new.event_entry_id, old.event_entry_id);
  perform public.sync_event_entry_grade(target_event_entry_id);
  perform public.recompute_packet_state(target_event_entry_id);
  return coalesce(new, old);
end;
$$;

create or replace function public.before_score_sheet_write()
returns trigger
language plpgsql
as $$
declare
  entry_event_id uuid;
  assignment_event_id uuid;
begin
  select event_id
  into entry_event_id
  from public.event_entries
  where id = new.event_entry_id;

  select event_id
  into assignment_event_id
  from public.judge_assignments
  where id = new.judge_assignment_id;

  if entry_event_id is null or assignment_event_id is null or entry_event_id <> assignment_event_id then
    raise exception 'score_sheet event_entry_id and judge_assignment_id must belong to the same event';
  end if;

  return new;
end;
$$;

create or replace function public.after_score_sheet_change()
returns trigger
language plpgsql
as $$
declare
  target_event_entry_id uuid;
begin
  target_event_entry_id := coalesce(new.event_entry_id, old.event_entry_id);
  perform public.recompute_packet_state(target_event_entry_id);
  return coalesce(new, old);
end;
$$;

create or replace function public.after_canonical_tape_change()
returns trigger
language plpgsql
as $$
declare
  target_event_entry_id uuid;
begin
  select ss.event_entry_id
  into target_event_entry_id
  from public.score_sheets ss
  where ss.id = coalesce(new.score_sheet_id, old.score_sheet_id);

  if target_event_entry_id is not null then
    perform public.recompute_packet_state(target_event_entry_id);
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function public.after_event_entry_insert_create_packet()
returns trigger
language plpgsql
as $$
begin
  insert into public.packets (event_entry_id)
  values (new.id)
  on conflict (event_entry_id) do nothing;

  return new;
end;
$$;

drop trigger if exists caption_ratings_set_numeric_value on public.caption_ratings;
create trigger caption_ratings_set_numeric_value
before insert or update on public.caption_ratings
for each row
execute function public.before_caption_rating_write();

drop trigger if exists caption_ratings_recompute_score_sheet on public.caption_ratings;
create trigger caption_ratings_recompute_score_sheet
after insert or update or delete on public.caption_ratings
for each row
execute function public.after_caption_ratings_change();

drop trigger if exists repertoire_sync_event_entry_grade on public.repertoire;
create trigger repertoire_sync_event_entry_grade
after insert or update or delete on public.repertoire
for each row
execute function public.after_repertoire_change();

drop trigger if exists score_sheets_validate_event_consistency on public.score_sheets;
create trigger score_sheets_validate_event_consistency
before insert or update on public.score_sheets
for each row
execute function public.before_score_sheet_write();

drop trigger if exists score_sheets_recompute_packet on public.score_sheets;
create trigger score_sheets_recompute_packet
after insert or update or delete on public.score_sheets
for each row
execute function public.after_score_sheet_change();

drop trigger if exists canonical_tapes_recompute_packet on public.canonical_tapes;
create trigger canonical_tapes_recompute_packet
after insert or update or delete on public.canonical_tapes
for each row
execute function public.after_canonical_tape_change();

drop trigger if exists event_entries_create_packet on public.event_entries;
create trigger event_entries_create_packet
after insert on public.event_entries
for each row
execute function public.after_event_entry_insert_create_packet();

drop trigger if exists score_sheets_audit_transition on public.score_sheets;
create trigger score_sheets_audit_transition
after insert or update on public.score_sheets
for each row
execute function public.audit_score_sheet_transition();

drop trigger if exists packets_audit_transition on public.packets;
create trigger packets_audit_transition
after insert or update on public.packets
for each row
execute function public.audit_packet_transition();
