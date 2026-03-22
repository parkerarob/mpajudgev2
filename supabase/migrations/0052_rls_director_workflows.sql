-- RLS for director-managed data and director visibility into released results.

create policy director_schools_select
on public.director_schools
for select
to authenticated
using (
  public.is_admin()
  or director_id = public.current_user_id()
);

create policy director_schools_insert
on public.director_schools
for insert
to authenticated
with check (
  public.is_admin()
  or director_id = public.current_user_id()
);

create policy director_schools_delete
on public.director_schools
for delete
to authenticated
using (
  public.is_admin()
  or director_id = public.current_user_id()
);

create policy ensembles_select
on public.ensembles
for select
to authenticated
using (
  public.is_admin()
  or public.is_director_for_school(school_id)
  or exists (
    select 1
    from public.event_entries ee
    join public.events e on e.id = ee.event_id
    join public.packets p on p.event_entry_id = ee.id
    where ee.ensemble_id = ensembles.id
      and (
        public.is_event_chair(e.id)
        or public.is_event_judge(e.id)
        or p.release_status = 'released'
      )
  )
);

create policy ensembles_insert
on public.ensembles
for insert
to authenticated
with check (
  public.is_admin()
  or public.is_director_for_school(school_id)
);

create policy ensembles_update
on public.ensembles
for update
to authenticated
using (
  public.is_admin()
  or public.is_director_for_school(school_id)
)
with check (
  public.is_admin()
  or public.is_director_for_school(school_id)
);

create policy events_select
on public.events
for select
to authenticated
using (true);

create policy event_entries_select
on public.event_entries
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.ensembles en
    where en.id = event_entries.ensemble_id
      and public.is_director_for_school(en.school_id)
  )
  or public.is_event_chair(event_entries.event_id)
  or public.is_event_judge(event_entries.event_id)
);

create policy event_entries_insert
on public.event_entries
for insert
to authenticated
with check (
  registered_by = public.current_user_id()
  and (
    public.is_admin()
    or exists (
      select 1
      from public.ensembles en
      where en.id = event_entries.ensemble_id
        and public.is_director_for_school(en.school_id)
    )
  )
);

create policy event_entries_update
on public.event_entries
for update
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.ensembles en
    where en.id = event_entries.ensemble_id
      and public.is_director_for_school(en.school_id)
  )
  or public.is_event_chair(event_entries.event_id)
)
with check (
  public.is_admin()
  or exists (
    select 1
    from public.ensembles en
    where en.id = event_entries.ensemble_id
      and public.is_director_for_school(en.school_id)
  )
  or public.is_event_chair(event_entries.event_id)
);

create policy repertoire_select
on public.repertoire
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.event_entries ee
    join public.ensembles en on en.id = ee.ensemble_id
    where ee.id = repertoire.event_entry_id
      and (
        public.is_director_for_school(en.school_id)
        or public.is_event_chair(ee.event_id)
        or public.is_event_judge(ee.event_id)
      )
  )
);

create policy repertoire_insert
on public.repertoire
for insert
to authenticated
with check (
  public.is_admin()
  or exists (
    select 1
    from public.event_entries ee
    join public.ensembles en on en.id = ee.ensemble_id
    where ee.id = repertoire.event_entry_id
      and public.is_director_for_school(en.school_id)
  )
);

create policy repertoire_update
on public.repertoire
for update
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.event_entries ee
    join public.ensembles en on en.id = ee.ensemble_id
    where ee.id = repertoire.event_entry_id
      and (
        public.is_director_for_school(en.school_id)
        or public.is_event_chair(ee.event_id)
      )
  )
)
with check (
  public.is_admin()
  or exists (
    select 1
    from public.event_entries ee
    join public.ensembles en on en.id = ee.ensemble_id
    where ee.id = repertoire.event_entry_id
      and (
        public.is_director_for_school(en.school_id)
        or public.is_event_chair(ee.event_id)
      )
  )
);

create policy repertoire_delete
on public.repertoire
for delete
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.event_entries ee
    join public.ensembles en on en.id = ee.ensemble_id
    where ee.id = repertoire.event_entry_id
      and public.is_director_for_school(en.school_id)
  )
);

create policy instrumentation_select
on public.instrumentation
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.event_entries ee
    join public.ensembles en on en.id = ee.ensemble_id
    where ee.id = instrumentation.event_entry_id
      and (
        public.is_director_for_school(en.school_id)
        or public.is_event_chair(ee.event_id)
        or public.is_event_judge(ee.event_id)
      )
  )
);

create policy instrumentation_write
on public.instrumentation
for all
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.event_entries ee
    join public.ensembles en on en.id = ee.ensemble_id
    where ee.id = instrumentation.event_entry_id
      and public.is_director_for_school(en.school_id)
  )
)
with check (
  public.is_admin()
  or exists (
    select 1
    from public.event_entries ee
    join public.ensembles en on en.id = ee.ensemble_id
    where ee.id = instrumentation.event_entry_id
      and public.is_director_for_school(en.school_id)
  )
);

create policy event_entry_percussion_requests_select
on public.event_entry_percussion_requests
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.event_entries ee
    join public.ensembles en on en.id = ee.ensemble_id
    where ee.id = event_entry_percussion_requests.event_entry_id
      and (
        public.is_director_for_school(en.school_id)
        or public.is_event_chair(ee.event_id)
      )
  )
);

create policy event_entry_percussion_requests_write
on public.event_entry_percussion_requests
for all
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.event_entries ee
    join public.ensembles en on en.id = ee.ensemble_id
    where ee.id = event_entry_percussion_requests.event_entry_id
      and public.is_director_for_school(en.school_id)
  )
)
with check (
  public.is_admin()
  or exists (
    select 1
    from public.event_entries ee
    join public.ensembles en on en.id = ee.ensemble_id
    where ee.id = event_entry_percussion_requests.event_entry_id
      and public.is_director_for_school(en.school_id)
  )
);

create policy event_entry_seating_select
on public.event_entry_seating
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.event_entries ee
    join public.ensembles en on en.id = ee.ensemble_id
    where ee.id = event_entry_seating.event_entry_id
      and (
        public.is_director_for_school(en.school_id)
        or public.is_event_chair(ee.event_id)
      )
  )
);

create policy event_entry_seating_write
on public.event_entry_seating
for all
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.event_entries ee
    join public.ensembles en on en.id = ee.ensemble_id
    where ee.id = event_entry_seating.event_entry_id
      and public.is_director_for_school(en.school_id)
  )
)
with check (
  public.is_admin()
  or exists (
    select 1
    from public.event_entries ee
    join public.ensembles en on en.id = ee.ensemble_id
    where ee.id = event_entry_seating.event_entry_id
      and public.is_director_for_school(en.school_id)
  )
);

create policy event_lunch_items_select
on public.event_lunch_items
for select
to authenticated
using (true);

create policy event_entry_lunch_orders_select
on public.event_entry_lunch_orders
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.event_entries ee
    join public.ensembles en on en.id = ee.ensemble_id
    where ee.id = event_entry_lunch_orders.event_entry_id
      and (
        public.is_director_for_school(en.school_id)
        or public.is_event_chair(ee.event_id)
      )
  )
);

create policy event_entry_lunch_orders_write
on public.event_entry_lunch_orders
for all
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.event_entries ee
    join public.ensembles en on en.id = ee.ensemble_id
    where ee.id = event_entry_lunch_orders.event_entry_id
      and public.is_director_for_school(en.school_id)
  )
)
with check (
  public.is_admin()
  or exists (
    select 1
    from public.event_entries ee
    join public.ensembles en on en.id = ee.ensemble_id
    where ee.id = event_entry_lunch_orders.event_entry_id
      and public.is_director_for_school(en.school_id)
  )
);

create policy event_fees_select
on public.event_fees
for select
to authenticated
using (true);

create policy event_entry_fees_select
on public.event_entry_fees
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.event_entries ee
    join public.ensembles en on en.id = ee.ensemble_id
    where ee.id = event_entry_fees.event_entry_id
      and (
        public.is_director_for_school(en.school_id)
        or public.is_event_chair(ee.event_id)
      )
  )
);

create policy school_repertoire_history_select
on public.school_repertoire_history
for select
to authenticated
using (
  public.is_admin()
  or public.is_director_for_school(school_id)
  or exists (
    select 1
    from public.schools s
    where s.id = school_repertoire_history.school_id
  )
);

create policy school_repertoire_history_write
on public.school_repertoire_history
for all
to authenticated
using (
  public.is_admin()
  or public.is_director_for_school(school_id)
)
with check (
  public.is_admin()
  or (
    entered_by = public.current_user_id()
    and public.is_director_for_school(school_id)
  )
);

create policy shared_players_select
on public.shared_players
for select
to authenticated
using (
  public.is_admin()
  or public.is_director_for_school(school_id)
  or public.is_event_chair(event_id)
);

create policy shared_players_write
on public.shared_players
for all
to authenticated
using (
  public.is_admin()
  or public.is_director_for_school(school_id)
)
with check (
  public.is_admin()
  or public.is_director_for_school(school_id)
);

create policy shared_player_event_entries_select
on public.shared_player_event_entries
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.shared_players sp
    where sp.id = shared_player_event_entries.shared_player_id
      and (
        public.is_director_for_school(sp.school_id)
        or public.is_event_chair(sp.event_id)
      )
  )
);

create policy shared_player_event_entries_write
on public.shared_player_event_entries
for all
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.shared_players sp
    where sp.id = shared_player_event_entries.shared_player_id
      and public.is_director_for_school(sp.school_id)
  )
)
with check (
  public.is_admin()
  or exists (
    select 1
    from public.shared_players sp
    where sp.id = shared_player_event_entries.shared_player_id
      and public.is_director_for_school(sp.school_id)
  )
);

create policy schedule_slots_select
on public.schedule_slots
for select
to authenticated
using (true);

create policy packets_select_released_or_privileged
on public.packets
for select
to authenticated
using (
  public.is_admin()
  or release_status = 'released'
  or exists (
    select 1
    from public.event_entries ee
    join public.ensembles en on en.id = ee.ensemble_id
    where ee.id = packets.event_entry_id
      and (
        public.is_director_for_school(en.school_id)
        or public.is_event_chair(ee.event_id)
      )
  )
);
