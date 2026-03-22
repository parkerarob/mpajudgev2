-- Audio segments and canonical tapes per score sheet.

create table if not exists public.tape_segments (
  id uuid primary key default gen_random_uuid(),
  score_sheet_id uuid not null references public.score_sheets (id) on delete cascade,
  segment_order integer not null,
  storage_path text not null,
  duration_seconds integer,
  created_at timestamptz not null default timezone('utc', now()),
  constraint tape_segments_score_sheet_segment_order_key unique (score_sheet_id, segment_order),
  constraint tape_segments_segment_order_check check (segment_order > 0),
  constraint tape_segments_duration_seconds_check check (
    duration_seconds is null or duration_seconds > 0
  )
);

create table if not exists public.canonical_tapes (
  id uuid primary key default gen_random_uuid(),
  score_sheet_id uuid not null references public.score_sheets (id) on delete cascade,
  storage_path text not null,
  duration_seconds integer,
  is_stitched boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  constraint canonical_tapes_score_sheet_id_key unique (score_sheet_id),
  constraint canonical_tapes_duration_seconds_check check (
    duration_seconds is null or duration_seconds > 0
  )
);

create index if not exists idx_tape_segments_score_sheet_id
  on public.tape_segments (score_sheet_id);

comment on table public.tape_segments is
  'One or more recorded audio segments for a score sheet.';

comment on table public.canonical_tapes is
  'The single official audio artifact per score sheet.';
