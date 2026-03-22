-- Audit helpers and trigger functions for state transitions.

create or replace function public.write_audit_log_entry(
  audit_table_name text,
  audit_record_id uuid,
  audit_action text,
  audit_old_value jsonb,
  audit_new_value jsonb
)
returns void
language plpgsql
as $$
begin
  insert into public.audit_log (
    table_name,
    record_id,
    action,
    performed_by,
    old_value,
    new_value
  )
  values (
    audit_table_name,
    audit_record_id,
    audit_action,
    public.current_actor_id(),
    audit_old_value,
    audit_new_value
  );
end;
$$;

create or replace function public.audit_score_sheet_transition()
returns trigger
language plpgsql
as $$
declare
  action_name text;
begin
  if tg_op = 'INSERT' then
    perform public.write_audit_log_entry(
      'score_sheets',
      new.id,
      'created',
      null,
      to_jsonb(new)
    );
    return new;
  end if;

  if old.status is distinct from new.status then
    action_name := case new.status
      when 'submitted' then 'submitted'
      when 'returned' then 'returned'
      when 'verified' then 'verified'
      when 'draft' then 'drafted'
      else 'updated'
    end;
  else
    action_name := 'updated';
  end if;

  perform public.write_audit_log_entry(
    'score_sheets',
    new.id,
    action_name,
    to_jsonb(old),
    to_jsonb(new)
  );

  return new;
end;
$$;

create or replace function public.audit_packet_transition()
returns trigger
language plpgsql
as $$
declare
  action_name text;
begin
  if tg_op = 'INSERT' then
    perform public.write_audit_log_entry(
      'packets',
      new.id,
      'created',
      null,
      to_jsonb(new)
    );
    return new;
  end if;

  if old.release_status is distinct from new.release_status then
    action_name := case new.release_status
      when 'released' then 'released'
      when 'unreleased' then 'unreleased'
      else 'updated'
    end;
  elsif old.assembly_status is distinct from new.assembly_status then
    action_name := 'assembly_status_changed';
  else
    action_name := 'updated';
  end if;

  perform public.write_audit_log_entry(
    'packets',
    new.id,
    action_name,
    to_jsonb(old),
    to_jsonb(new)
  );

  return new;
end;
$$;

comment on function public.write_audit_log_entry(text, uuid, text, jsonb, jsonb) is
  'Writes an audit row using the resolved current actor id.';
