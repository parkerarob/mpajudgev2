-- Refactor judge-owned write policies to use helper functions instead of policy-dependent joins.

drop policy if exists score_sheets_insert on public.score_sheets;
create policy score_sheets_insert
on public.score_sheets
for insert
to authenticated
with check (
  public.is_admin()
  or public.user_id_for_judge_assignment(judge_assignment_id) = public.current_user_id()
);

drop policy if exists score_sheets_update on public.score_sheets;
create policy score_sheets_update
on public.score_sheets
for update
to authenticated
using (
  public.is_admin()
  or public.user_id_for_judge_assignment(judge_assignment_id) = public.current_user_id()
  or public.is_event_chair(public.event_id_for_score_sheet(id))
)
with check (
  public.is_admin()
  or public.user_id_for_judge_assignment(judge_assignment_id) = public.current_user_id()
  or public.is_event_chair(public.event_id_for_event_entry(event_entry_id))
);

drop policy if exists caption_ratings_write on public.caption_ratings;
create policy caption_ratings_write
on public.caption_ratings
for all
to authenticated
using (
  public.is_admin()
  or public.assigned_user_id_for_score_sheet(score_sheet_id) = public.current_user_id()
  or public.is_event_chair(public.event_id_for_score_sheet(score_sheet_id))
)
with check (
  public.is_admin()
  or public.assigned_user_id_for_score_sheet(score_sheet_id) = public.current_user_id()
  or public.is_event_chair(public.event_id_for_score_sheet(score_sheet_id))
);

drop policy if exists tape_segments_write on public.tape_segments;
create policy tape_segments_write
on public.tape_segments
for all
to authenticated
using (
  public.is_admin()
  or public.assigned_user_id_for_score_sheet(score_sheet_id) = public.current_user_id()
)
with check (
  public.is_admin()
  or public.assigned_user_id_for_score_sheet(score_sheet_id) = public.current_user_id()
);

drop policy if exists canonical_tapes_write on public.canonical_tapes;
create policy canonical_tapes_write
on public.canonical_tapes
for all
to authenticated
using (
  public.is_admin()
  or public.assigned_user_id_for_score_sheet(score_sheet_id) = public.current_user_id()
  or public.is_event_chair(public.event_id_for_score_sheet(score_sheet_id))
)
with check (
  public.is_admin()
  or public.assigned_user_id_for_score_sheet(score_sheet_id) = public.current_user_id()
  or public.is_event_chair(public.event_id_for_score_sheet(score_sheet_id))
);
