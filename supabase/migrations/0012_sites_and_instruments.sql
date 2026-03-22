-- Site reference data, instrument taxonomy, and site-provided percussion inventory.

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  city text,
  state text not null default 'NC'
);

create table if not exists public.instrument_families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  display_order integer not null,
  constraint instrument_families_name_key unique (name),
  constraint instrument_families_display_order_key unique (display_order),
  constraint instrument_families_display_order_positive_check check (display_order > 0)
);

create table if not exists public.instruments (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.instrument_families (id) on delete restrict,
  name text not null,
  display_order integer not null,
  is_active boolean not null default true,
  constraint instruments_family_name_key unique (family_id, name),
  constraint instruments_family_display_order_key unique (family_id, display_order),
  constraint instruments_display_order_positive_check check (display_order > 0)
);

create table if not exists public.site_percussion_inventory (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  item_name text not null,
  display_order integer not null,
  notes text,
  constraint site_percussion_inventory_site_item_key unique (site_id, item_name),
  constraint site_percussion_inventory_site_display_order_key unique (site_id, display_order),
  constraint site_percussion_inventory_display_order_positive_check check (display_order > 0)
);

create index if not exists idx_instruments_family_id
  on public.instruments (family_id);

create index if not exists idx_site_percussion_inventory_site_id
  on public.site_percussion_inventory (site_id);

comment on table public.sites is
  'Physical locations where MPA events are hosted.';

comment on table public.instrument_families is
  'Display groupings for the standard instrument list.';

comment on table public.instruments is
  'Standard instrument taxonomy used for event-entry instrumentation.';

comment on table public.site_percussion_inventory is
  'Site-specific percussion equipment available for ensemble requests.';
