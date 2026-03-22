-- Directors must not see unreleased packets.

drop policy if exists packets_select_released_or_privileged on public.packets;

create policy packets_select_released_or_privileged
on public.packets
for select
to authenticated
using (
  public.is_admin()
  or release_status = 'released'
  or public.is_event_chair(public.event_id_for_event_entry(event_entry_id))
);
