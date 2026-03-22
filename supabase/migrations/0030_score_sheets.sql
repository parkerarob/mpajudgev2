-- Judge score sheets and caption-level ratings/comments.

create table if not exists public.score_sheets (
  id uuid primary key default gen_random_uuid(),
  event_entry_id uuid not null references public.event_entries (id) on delete cascade,
  judge_assignment_id uuid not null references public.judge_assignments (id) on delete cascade,
  status public.score_sheet_status not null default 'draft',
  caption_score_total integer,
  final_judge_rating public.final_judge_rating,
  submitted_at timestamptz,
  returned_at timestamptz,
  verified_at timestamptz,
  verified_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint score_sheets_event_entry_judge_assignment_key unique (event_entry_id, judge_assignment_id),
  constraint score_sheets_caption_score_total_range_check check (
    caption_score_total is null or caption_score_total between 7 and 35
  ),
  constraint score_sheets_submitted_at_check check (
    (status in ('submitted', 'returned', 'verified') and submitted_at is not null)
    or (status = 'draft' and submitted_at is null)
  ),
  constraint score_sheets_returned_at_check check (
    (status = 'returned' and returned_at is not null)
    or (status in ('draft', 'submitted', 'verified') and returned_at is null)
  ),
  constraint score_sheets_verified_fields_check check (
    (status = 'verified' and verified_at is not null and verified_by is not null)
    or (status in ('draft', 'submitted', 'returned') and verified_at is null and verified_by is null)
  )
);

create table if not exists public.caption_ratings (
  id uuid primary key default gen_random_uuid(),
  score_sheet_id uuid not null references public.score_sheets (id) on delete cascade,
  caption_order integer not null,
  caption_name text not null,
  rating public.caption_rating,
  modifier public.caption_modifier not null default 'none',
  numeric_value integer,
  comment text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint caption_ratings_score_sheet_caption_order_key unique (score_sheet_id, caption_order),
  constraint caption_ratings_caption_order_check check (caption_order between 1 and 7),
  constraint caption_ratings_numeric_value_range_check check (
    numeric_value is null or numeric_value between 1 and 5
  ),
  constraint caption_ratings_rating_numeric_pairing_check check (
    (rating is null and numeric_value is null)
    or (rating is not null and numeric_value is not null)
  )
);

create index if not exists idx_score_sheets_event_entry_id
  on public.score_sheets (event_entry_id);

create index if not exists idx_score_sheets_judge_assignment_id
  on public.score_sheets (judge_assignment_id);

create index if not exists idx_score_sheets_status
  on public.score_sheets (status);

create index if not exists idx_caption_ratings_score_sheet_id
  on public.caption_ratings (score_sheet_id);

create trigger score_sheets_set_updated_at
before update on public.score_sheets
for each row
execute function public.set_updated_at();

create trigger caption_ratings_set_updated_at
before update on public.caption_ratings
for each row
execute function public.set_updated_at();

comment on table public.score_sheets is
  'One judge''s evaluation of one ensemble, including computed total and final judge rating.';

comment on table public.caption_ratings is
  'Seven caption rows per score sheet in canonical order.';
