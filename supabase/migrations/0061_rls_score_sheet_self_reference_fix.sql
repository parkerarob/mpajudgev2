-- Avoid self-referential helper lookups inside score_sheets RLS policies.

drop policy if exists score_sheets_select on public.score_sheets;
create policy score_sheets_select
on public.score_sheets
for select
to authenticated
using (
  public.is_admin()
  or public.user_id_for_judge_assignment(judge_assignment_id) = public.current_user_id()
  or public.is_event_chair(public.event_id_for_event_entry(event_entry_id))
  or public.packet_is_released_for_event_entry(event_entry_id)
);

drop policy if exists score_sheets_update on public.score_sheets;
create policy score_sheets_update
on public.score_sheets
for update
to authenticated
using (
  public.is_admin()
  or public.user_id_for_judge_assignment(judge_assignment_id) = public.current_user_id()
  or public.is_event_chair(public.event_id_for_event_entry(event_entry_id))
)
with check (
  public.is_admin()
  or public.user_id_for_judge_assignment(judge_assignment_id) = public.current_user_id()
  or public.is_event_chair(public.event_id_for_event_entry(event_entry_id))
);
