-- Transactional RPCs for packet release state changes.

create or replace function public.release_packet(
  target_packet_id uuid
)
returns public.packets
language plpgsql
security definer
set search_path = public
as $$
declare
  target_packet public.packets%rowtype;
  target_event_id uuid;
  actor_id uuid;
begin
  actor_id := public.current_user_id();

  if actor_id is null then
    raise exception 'Authentication required';
  end if;

  select p.*
  into target_packet
  from public.packets p
  where p.id = target_packet_id
  for update;

  if target_packet.id is null then
    raise exception 'Packet not found';
  end if;

  select ee.event_id
  into target_event_id
  from public.event_entries ee
  where ee.id = target_packet.event_entry_id;

  if target_event_id is null then
    raise exception 'Packet event not found';
  end if;

  if not (public.is_admin(actor_id) or public.is_event_chair(target_event_id, actor_id)) then
    raise exception 'Not authorized to release this packet';
  end if;

  perform public.recompute_packet_state(target_packet.event_entry_id);

  select *
  into target_packet
  from public.packets p
  where p.id = target_packet_id
  for update;

  if target_packet.assembly_status <> 'complete' then
    raise exception 'Packet must be complete before release';
  end if;

  update public.packets
  set
    release_status = 'released',
    released_at = timezone('utc', now()),
    released_by = actor_id
  where id = target_packet_id
  returning *
  into target_packet;

  return target_packet;
end;
$$;

create or replace function public.unrelease_packet(
  target_packet_id uuid
)
returns public.packets
language plpgsql
security definer
set search_path = public
as $$
declare
  target_packet public.packets%rowtype;
  target_event_id uuid;
  actor_id uuid;
begin
  actor_id := public.current_user_id();

  if actor_id is null then
    raise exception 'Authentication required';
  end if;

  select p.*
  into target_packet
  from public.packets p
  where p.id = target_packet_id
  for update;

  if target_packet.id is null then
    raise exception 'Packet not found';
  end if;

  select ee.event_id
  into target_event_id
  from public.event_entries ee
  where ee.id = target_packet.event_entry_id;

  if target_event_id is null then
    raise exception 'Packet event not found';
  end if;

  if not (public.is_admin(actor_id) or public.is_event_chair(target_event_id, actor_id)) then
    raise exception 'Not authorized to unrelease this packet';
  end if;

  update public.packets
  set
    release_status = 'unreleased',
    released_at = null,
    released_by = null
  where id = target_packet_id
  returning *
  into target_packet;

  return target_packet;
end;
$$;

revoke all on function public.release_packet(uuid) from public;
revoke all on function public.unrelease_packet(uuid) from public;

grant execute on function public.release_packet(uuid) to authenticated;
grant execute on function public.unrelease_packet(uuid) to authenticated;

comment on function public.release_packet(uuid) is
  'Security-definer RPC that recomputes packet state and releases only complete packets for authorized chair/admin users.';

comment on function public.unrelease_packet(uuid) is
  'Security-definer RPC that pulls back a released packet for authorized chair/admin users.';
