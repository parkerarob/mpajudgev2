-- Organization and school ownership structure.

create table if not exists public.districts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug citext not null,
  constraint districts_name_key unique (name),
  constraint districts_slug_key unique (slug)
);

create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  district_id uuid not null references public.districts (id) on delete restrict,
  constraint schools_district_name_key unique (district_id, name)
);

create table if not exists public.director_schools (
  director_id uuid not null references public.users (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete cascade,
  primary key (director_id, school_id)
);

create index if not exists idx_schools_district_id
  on public.schools (district_id);

create index if not exists idx_director_schools_school_id
  on public.director_schools (school_id);

comment on table public.districts is
  'NCBA districts. Seeded reference data.';

comment on table public.director_schools is
  'Many-to-many mapping between directors and schools.';
