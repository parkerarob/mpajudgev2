-- Refactor selected RLS policies to use helper functions and avoid recursive policy evaluation.

drop policy if exists event_entries_select on public.event_entries;
create policy event_entries_select
on public.event_entries
for select
to authenticated
using (
  public.is_admin()
  or public.is_director_for_event_entry(id)
  or public.is_event_chair(event_id)
  or public.is_event_judge(event_id)
);

drop policy if exists event_entries_insert on public.event_entries;
create policy event_entries_insert
on public.event_entries
for insert
to authenticated
with check (
  registered_by = public.current_user_id()
  and (
    public.is_admin()
    or public.is_director_for_school(public.school_id_for_ensemble(ensemble_id))
  )
);

drop policy if exists event_entries_update on public.event_entries;
create policy event_entries_update
on public.event_entries
for update
to authenticated
using (
  public.is_admin()
  or public.is_director_for_event_entry(id)
  or public.is_event_chair(event_id)
)
with check (
  public.is_admin()
  or public.is_director_for_event_entry(id)
  or public.is_event_chair(event_id)
);

drop policy if exists packets_select_released_or_privileged on public.packets;
create policy packets_select_released_or_privileged
on public.packets
for select
to authenticated
using (
  public.is_admin()
  or release_status = 'released'
  or public.is_director_for_event_entry(event_entry_id)
  or public.is_event_chair(public.event_id_for_event_entry(event_entry_id))
);

drop policy if exists score_sheets_select on public.score_sheets;
create policy score_sheets_select
on public.score_sheets
for select
to authenticated
using (
  public.is_admin()
  or public.assigned_user_id_for_score_sheet(id) = public.current_user_id()
  or public.is_event_chair(public.event_id_for_score_sheet(id))
  or public.packet_is_released_for_event_entry(event_entry_id)
);

drop policy if exists caption_ratings_select on public.caption_ratings;
create policy caption_ratings_select
on public.caption_ratings
for select
to authenticated
using (
  public.is_admin()
  or public.assigned_user_id_for_score_sheet(score_sheet_id) = public.current_user_id()
  or public.is_event_chair(public.event_id_for_score_sheet(score_sheet_id))
  or public.packet_is_released_for_event_entry(public.event_entry_id_for_score_sheet(score_sheet_id))
);

drop policy if exists canonical_tapes_select on public.canonical_tapes;
create policy canonical_tapes_select
on public.canonical_tapes
for select
to authenticated
using (
  public.is_admin()
  or public.assigned_user_id_for_score_sheet(score_sheet_id) = public.current_user_id()
  or public.is_event_chair(public.event_id_for_score_sheet(score_sheet_id))
  or public.packet_is_released_for_event_entry(public.event_entry_id_for_score_sheet(score_sheet_id))
);
