-- Audit writes are system-owned and should bypass caller RLS restrictions.

create or replace function public.write_audit_log_entry(
  audit_table_name text,
  audit_record_id uuid,
  audit_action text,
  audit_old_value jsonb,
  audit_new_value jsonb
)
returns void
language plpgsql
security definer
set search_path = public
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
