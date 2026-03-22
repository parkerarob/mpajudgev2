-- Ordered schedule slots for an event.

create table if not exists public.schedule_slots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  day date not null,
  slot_order integer not null,
  slot_type public.schedule_slot_type not null,
  event_entry_id uuid references public.event_entries (id) on delete cascade,
  break_duration_minutes integer,
  created_at timestamptz not null default timezone('utc', now()),
  constraint schedule_slots_event_day_slot_order_key unique (event_id, day, slot_order),
  constraint schedule_slots_slot_order_check check (slot_order > 0),
  constraint schedule_slots_break_duration_check check (
    break_duration_minutes is null or break_duration_minutes > 0
  ),
  constraint schedule_slots_slot_type_reference_check check (
    (slot_type = 'performance' and event_entry_id is not null and break_duration_minutes is null)
    or (slot_type = 'break' and event_entry_id is null and break_duration_minutes is not null)
  )
);

create index if not exists idx_schedule_slots_event_id
  on public.schedule_slots (event_id);

create index if not exists idx_schedule_slots_event_entry_id
  on public.schedule_slots (event_entry_id);

comment on table public.schedule_slots is
  'Ordered performance and break slots for an event day. Start times are computed, not stored.';
