-- RLS for chair/admin event operations and audit visibility.

create policy event_chairs_select
on public.event_chairs
for select
to authenticated
using (
  public.is_admin()
  or user_id = public.current_user_id()
  or public.is_event_chair(event_id)
);

create policy event_chairs_write
on public.event_chairs
for all
to authenticated
using (
  public.is_admin()
  or public.is_event_chair(event_id)
)
with check (
  public.is_admin()
  or public.is_event_chair(event_id)
);

create policy event_volunteers_select
on public.event_volunteers
for select
to authenticated
using (
  public.is_admin()
  or user_id = public.current_user_id()
  or public.is_event_chair(event_id)
);

create policy event_volunteers_write
on public.event_volunteers
for all
to authenticated
using (
  public.is_admin()
  or public.is_event_chair(event_id)
)
with check (
  public.is_admin()
  or public.is_event_chair(event_id)
);

create policy event_day_start_times_select
on public.event_day_start_times
for select
to authenticated
using (true);

create policy event_day_start_times_write
on public.event_day_start_times
for all
to authenticated
using (
  public.is_admin()
  or public.is_event_chair(event_id)
)
with check (
  public.is_admin()
  or public.is_event_chair(event_id)
);

create policy events_update
on public.events
for update
to authenticated
using (
  public.is_admin()
  or public.is_event_chair(id)
)
with check (
  public.is_admin()
  or public.is_event_chair(id)
);

create policy events_insert_admin_only
on public.events
for insert
to authenticated
with check (public.is_admin());

create policy event_lunch_items_write
on public.event_lunch_items
for all
to authenticated
using (
  public.is_admin()
  or public.is_event_chair(event_id)
)
with check (
  public.is_admin()
  or public.is_event_chair(event_id)
);

create policy event_fees_write
on public.event_fees
for all
to authenticated
using (
  public.is_admin()
  or public.is_event_chair(event_id)
)
with check (
  public.is_admin()
  or public.is_event_chair(event_id)
);

create policy event_entry_fees_write
on public.event_entry_fees
for all
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.event_entries ee
    where ee.id = event_entry_fees.event_entry_id
      and public.is_event_chair(ee.event_id)
  )
)
with check (
  public.is_admin()
  or exists (
    select 1
    from public.event_entries ee
    where ee.id = event_entry_fees.event_entry_id
      and public.is_event_chair(ee.event_id)
  )
);

create policy schedule_slots_write
on public.schedule_slots
for all
to authenticated
using (
  public.is_admin()
  or public.is_event_chair(event_id)
)
with check (
  public.is_admin()
  or public.is_event_chair(event_id)
);

create policy packets_update
on public.packets
for update
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.event_entries ee
    where ee.id = packets.event_entry_id
      and public.is_event_chair(ee.event_id)
  )
)
with check (
  public.is_admin()
  or exists (
    select 1
    from public.event_entries ee
    where ee.id = packets.event_entry_id
      and public.is_event_chair(ee.event_id)
  )
);

create policy audit_log_select
on public.audit_log
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.score_sheets ss
    join public.event_entries ee on ee.id = ss.event_entry_id
    where audit_log.table_name = 'score_sheets'
      and audit_log.record_id = ss.id
      and public.is_event_chair(ee.event_id)
  )
  or exists (
    select 1
    from public.packets p
    join public.event_entries ee on ee.id = p.event_entry_id
    where audit_log.table_name = 'packets'
      and audit_log.record_id = p.id
      and public.is_event_chair(ee.event_id)
  )
);
