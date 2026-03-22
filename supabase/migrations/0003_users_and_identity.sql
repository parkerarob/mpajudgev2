-- User profile table and sync bridge from Supabase auth.

create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  email citext not null unique,
  is_admin boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);

comment on table public.users is
  'Application-level user profile extending auth.users.';

comment on column public.users.is_admin is
  'Global system administrator flag. Event roles remain contextual.';

create or replace function public.handle_auth_user_sync()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.email is null then
    raise exception 'auth.users.email cannot be null for MPAapp profiles';
  end if;

  insert into public.users as profile (
    id,
    display_name,
    email
  )
  values (
    new.id,
    public.sync_user_display_name(new.email, new.raw_user_meta_data),
    new.email
  )
  on conflict (id) do update
  set
    display_name = excluded.display_name,
    email = excluded.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_or_updated on auth.users;

create trigger on_auth_user_created_or_updated
after insert or update of email, raw_user_meta_data
on auth.users
for each row
execute function public.handle_auth_user_sync();

insert into public.users (
  id,
  display_name,
  email
)
select
  auth_user.id,
  public.sync_user_display_name(auth_user.email, auth_user.raw_user_meta_data),
  auth_user.email
from auth.users as auth_user
where auth_user.email is not null
on conflict (id) do update
set
  display_name = excluded.display_name,
  email = excluded.email;
