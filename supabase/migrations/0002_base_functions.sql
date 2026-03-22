-- Table-independent helper functions used by later migrations.

create or replace function public.current_user_id()
returns uuid
language sql
stable
as $$
  select auth.uid()
$$;

create or replace function public.current_actor_id()
returns uuid
language plpgsql
stable
as $$
declare
  actor_id text;
begin
  actor_id := nullif(current_setting('app.current_actor_id', true), '');
  if actor_id is not null then
    return actor_id::uuid;
  end if;

  return auth.uid();
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create or replace function public.sync_user_display_name(
  user_email text,
  raw_user_meta_data jsonb
)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(trim(raw_user_meta_data ->> 'display_name'), ''),
    nullif(trim(raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(raw_user_meta_data ->> 'name'), ''),
    nullif(trim(split_part(coalesce(user_email, ''), '@', 1)), ''),
    'User'
  )
$$;

comment on function public.current_actor_id() is
  'Resolves the actor for audit logging. Prefers app.current_actor_id when explicitly set, otherwise falls back to auth.uid().';
