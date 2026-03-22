-- Repertoire and site-specific registration details for event entries.

create table if not exists public.repertoire (
  id uuid primary key default gen_random_uuid(),
  event_entry_id uuid not null references public.event_entries (id) on delete cascade,
  piece_slot public.repertoire_piece_slot not null,
  march_id uuid references public.marches (id) on delete restrict,
  piece_id uuid references public.pieces (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  constraint repertoire_event_entry_piece_slot_key unique (event_entry_id, piece_slot),
  constraint repertoire_slot_reference_check check (
    (piece_slot = 'march' and march_id is not null and piece_id is null)
    or (piece_slot in ('selection_1', 'selection_2') and piece_id is not null and march_id is null)
  )
);

create table if not exists public.instrumentation (
  id uuid primary key default gen_random_uuid(),
  event_entry_id uuid not null references public.event_entries (id) on delete cascade,
  instrument_id uuid references public.instruments (id) on delete restrict,
  custom_instrument_name text,
  player_count integer not null,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint instrumentation_reference_check check (
    (instrument_id is not null and custom_instrument_name is null)
    or (instrument_id is null and nullif(trim(custom_instrument_name), '') is not null)
  ),
  constraint instrumentation_player_count_check check (player_count > 0)
);

create table if not exists public.event_entry_percussion_requests (
  event_entry_id uuid not null references public.event_entries (id) on delete cascade,
  inventory_item_id uuid not null references public.site_percussion_inventory (id) on delete cascade,
  notes text,
  primary key (event_entry_id, inventory_item_id)
);

create table if not exists public.event_entry_seating (
  id uuid primary key default gen_random_uuid(),
  event_entry_id uuid not null references public.event_entries (id) on delete cascade,
  row_number integer not null,
  chairs integer not null,
  stands integer not null,
  constraint event_entry_seating_event_entry_row_key unique (event_entry_id, row_number),
  constraint event_entry_seating_row_number_check check (row_number > 0),
  constraint event_entry_seating_chairs_check check (chairs >= 0),
  constraint event_entry_seating_stands_check check (stands >= 0)
);

create table if not exists public.event_lunch_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  item_name text not null,
  display_order integer not null,
  constraint event_lunch_items_event_item_name_key unique (event_id, item_name),
  constraint event_lunch_items_event_display_order_key unique (event_id, display_order),
  constraint event_lunch_items_display_order_check check (display_order > 0)
);

create table if not exists public.event_entry_lunch_orders (
  id uuid primary key default gen_random_uuid(),
  event_entry_id uuid not null references public.event_entries (id) on delete cascade,
  lunch_item_id uuid not null references public.event_lunch_items (id) on delete cascade,
  quantity integer not null,
  pickup_timing public.lunch_pickup_timing not null,
  constraint event_entry_lunch_orders_entry_item_pickup_key unique (event_entry_id, lunch_item_id, pickup_timing),
  constraint event_entry_lunch_orders_quantity_check check (quantity > 0)
);

create table if not exists public.event_fees (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  fee_type public.event_fee_type not null,
  amount_cents integer not null,
  description text not null,
  constraint event_fees_event_fee_type_key unique (event_id, fee_type),
  constraint event_fees_amount_cents_check check (amount_cents >= 0)
);

create table if not exists public.event_entry_fees (
  id uuid primary key default gen_random_uuid(),
  event_entry_id uuid not null references public.event_entries (id) on delete cascade,
  event_fee_id uuid not null references public.event_fees (id) on delete cascade,
  is_waived boolean not null default false,
  waiver_reason text,
  payment_status public.payment_status not null default 'pending',
  notes text,
  constraint event_entry_fees_event_entry_fee_key unique (event_entry_id, event_fee_id),
  constraint event_entry_fees_waiver_reason_check check (
    (is_waived = true and nullif(trim(waiver_reason), '') is not null and payment_status = 'waived')
    or (is_waived = false and waiver_reason is null)
  )
);

create index if not exists idx_repertoire_event_entry_id
  on public.repertoire (event_entry_id);

create index if not exists idx_repertoire_piece_id
  on public.repertoire (piece_id);

create index if not exists idx_repertoire_march_id
  on public.repertoire (march_id);

create index if not exists idx_instrumentation_event_entry_id
  on public.instrumentation (event_entry_id);

create unique index if not exists idx_instrumentation_standard_unique
  on public.instrumentation (event_entry_id, instrument_id)
  where instrument_id is not null;

create unique index if not exists idx_instrumentation_custom_unique
  on public.instrumentation (event_entry_id, lower(custom_instrument_name))
  where instrument_id is null;

create index if not exists idx_event_entry_percussion_requests_inventory_item_id
  on public.event_entry_percussion_requests (inventory_item_id);

create index if not exists idx_event_entry_seating_event_entry_id
  on public.event_entry_seating (event_entry_id);

create index if not exists idx_event_lunch_items_event_id
  on public.event_lunch_items (event_id);

create index if not exists idx_event_entry_lunch_orders_event_entry_id
  on public.event_entry_lunch_orders (event_entry_id);

create index if not exists idx_event_entry_lunch_orders_lunch_item_id
  on public.event_entry_lunch_orders (lunch_item_id);

create index if not exists idx_event_fees_event_id
  on public.event_fees (event_id);

create index if not exists idx_event_entry_fees_event_entry_id
  on public.event_entry_fees (event_entry_id);

create index if not exists idx_event_entry_fees_event_fee_id
  on public.event_entry_fees (event_fee_id);

comment on table public.repertoire is
  'One march plus up to two graded selections for an event entry, with slot-specific reference checks.';

comment on table public.instrumentation is
  'Per-entry instrumentation counts using either a standard instrument reference or a custom instrument name.';

comment on table public.event_entry_percussion_requests is
  'Requested site-provided percussion inventory items for an event entry.';

comment on table public.event_entry_seating is
  'Chair and stand counts by row for stage setup.';

comment on table public.event_lunch_items is
  'Event-specific lunch options configured by the Chair.';

comment on table public.event_entry_lunch_orders is
  'Per-entry lunch quantities by item and pickup timing.';

comment on table public.event_fees is
  'Configurable fee types for an event.';

comment on table public.event_entry_fees is
  'Per-entry fee status, including waiver handling.';
