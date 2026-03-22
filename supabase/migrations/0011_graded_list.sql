-- Graded list reference data and director-submitted marches.

create table if not exists public.graded_list_versions (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  published_date date,
  is_current boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  constraint graded_list_versions_label_key unique (label)
);

create unique index if not exists idx_graded_list_versions_one_current
  on public.graded_list_versions (is_current)
  where is_current = true;

create table if not exists public.pieces (
  id uuid primary key default gen_random_uuid(),
  graded_list_version_id uuid not null references public.graded_list_versions (id) on delete restrict,
  grade public.piece_grade not null,
  title text not null,
  composer text not null,
  publisher text,
  distributor text,
  special_instructions text,
  is_masterwork boolean not null default false,
  status public.piece_status not null default 'active',
  supplier_item_no text,
  year_added text,
  tags text[] not null default '{}',
  created_at timestamptz not null default timezone('utc', now()),
  constraint pieces_masterwork_grade_check check (grade = 'VI' or is_masterwork = false)
);

create index if not exists idx_pieces_graded_list_version_id
  on public.pieces (graded_list_version_id);

create index if not exists idx_pieces_grade
  on public.pieces (grade);

create index if not exists idx_pieces_title
  on public.pieces (title);

create table if not exists public.marches (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  composer text,
  is_user_submitted boolean not null default false,
  submitted_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint marches_submission_consistency_check check (
    (is_user_submitted = true and submitted_by is not null)
    or (is_user_submitted = false and submitted_by is null)
  )
);

create index if not exists idx_marches_submitted_by
  on public.marches (submitted_by);

create index if not exists idx_marches_title
  on public.marches (title);

comment on table public.graded_list_versions is
  'Annual NCBA graded list versions. Exactly one row may be current at a time.';

comment on table public.pieces is
  'Approved graded-list selections pinned to a specific annual list version.';

comment on table public.marches is
  'Director-choice marches, including preloaded and user-submitted entries.';
