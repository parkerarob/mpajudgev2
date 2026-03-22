-- Shared-player declarations and school-level repertoire history.

create table if not exists public.school_repertoire_history (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  season_year text not null,
  piece_id uuid references public.pieces (id) on delete set null,
  piece_title text not null,
  piece_composer text,
  piece_grade public.piece_grade,
  entered_by uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.shared_players (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete cascade,
  student_identifier text not null,
  instrument_id uuid references public.instruments (id) on delete restrict,
  custom_instrument_name text,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint shared_players_instrument_reference_check check (
    (instrument_id is not null and custom_instrument_name is null)
    or (instrument_id is null and nullif(trim(custom_instrument_name), '') is not null)
  )
);

create table if not exists public.shared_player_event_entries (
  shared_player_id uuid not null references public.shared_players (id) on delete cascade,
  event_entry_id uuid not null references public.event_entries (id) on delete cascade,
  primary key (shared_player_id, event_entry_id)
);

create index if not exists idx_school_repertoire_history_school_id
  on public.school_repertoire_history (school_id);

create index if not exists idx_school_repertoire_history_piece_id
  on public.school_repertoire_history (piece_id);

create index if not exists idx_shared_players_event_id
  on public.shared_players (event_id);

create index if not exists idx_shared_players_school_id
  on public.shared_players (school_id);

create unique index if not exists idx_shared_players_standard_unique
  on public.shared_players (event_id, school_id, lower(student_identifier), instrument_id)
  where instrument_id is not null;

create unique index if not exists idx_shared_players_custom_unique
  on public.shared_players (event_id, school_id, lower(student_identifier), lower(custom_instrument_name))
  where instrument_id is null;

create index if not exists idx_shared_player_event_entries_event_entry_id
  on public.shared_player_event_entries (event_entry_id);

comment on table public.school_repertoire_history is
  'Pre-system school-level repertoire history used for the four-year non-repeat rule.';

comment on table public.shared_players is
  'Declared shared players for an event and school, normalized by instrument classification.';

comment on table public.shared_player_event_entries is
  'Join table linking a shared-player declaration to the event entries the student appears in.';
