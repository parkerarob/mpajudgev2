-- Packet-level release state and audit history.

create table if not exists public.packets (
  id uuid primary key default gen_random_uuid(),
  event_entry_id uuid not null references public.event_entries (id) on delete cascade,
  assembly_status public.packet_assembly_status not null default 'incomplete',
  has_split_rating_flag boolean not null default false,
  release_status public.packet_release_status not null default 'unreleased',
  overall_rating public.final_overall_rating,
  released_at timestamptz,
  released_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint packets_event_entry_id_key unique (event_entry_id),
  constraint packets_release_fields_check check (
    (release_status = 'released' and released_at is not null and released_by is not null)
    or (release_status = 'unreleased' and released_at is null and released_by is null)
  )
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid not null,
  action text not null,
  performed_by uuid references public.users (id) on delete set null,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_packets_release_status
  on public.packets (release_status);

create index if not exists idx_audit_log_table_record
  on public.audit_log (table_name, record_id);

create index if not exists idx_audit_log_performed_by
  on public.audit_log (performed_by);

create index if not exists idx_audit_log_created_at
  on public.audit_log (created_at desc);

create trigger packets_set_updated_at
before update on public.packets
for each row
execute function public.set_updated_at();

comment on table public.packets is
  'Packet-level assembly and release state for one event entry.';

comment on table public.audit_log is
  'Database-written audit trail for key state transitions.';
