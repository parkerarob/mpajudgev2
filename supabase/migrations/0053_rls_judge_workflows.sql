-- RLS for judge-owned score sheets, captions, and audio.

create policy judge_assignments_select
on public.judge_assignments
for select
to authenticated
using (
  public.is_admin()
  or public.is_event_chair(event_id)
  or user_id = public.current_user_id()
);

create policy score_sheets_select
on public.score_sheets
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.judge_assignments ja
    where ja.id = score_sheets.judge_assignment_id
      and ja.user_id = public.current_user_id()
  )
  or exists (
    select 1
    from public.event_entries ee
    where ee.id = score_sheets.event_entry_id
      and public.is_event_chair(ee.event_id)
  )
  or exists (
    select 1
    from public.packets p
    where p.event_entry_id = score_sheets.event_entry_id
      and p.release_status = 'released'
  )
);

create policy score_sheets_insert
on public.score_sheets
for insert
to authenticated
with check (
  public.is_admin()
  or exists (
    select 1
    from public.judge_assignments ja
    where ja.id = score_sheets.judge_assignment_id
      and ja.user_id = public.current_user_id()
  )
);

create policy score_sheets_update
on public.score_sheets
for update
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.judge_assignments ja
    where ja.id = score_sheets.judge_assignment_id
      and (
        ja.user_id = public.current_user_id()
        or public.is_event_chair(ja.event_id)
      )
  )
)
with check (
  public.is_admin()
  or exists (
    select 1
    from public.judge_assignments ja
    where ja.id = score_sheets.judge_assignment_id
      and (
        ja.user_id = public.current_user_id()
        or public.is_event_chair(ja.event_id)
      )
  )
);

create policy caption_ratings_select
on public.caption_ratings
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.score_sheets ss
    join public.judge_assignments ja on ja.id = ss.judge_assignment_id
    where ss.id = caption_ratings.score_sheet_id
      and (
        ja.user_id = public.current_user_id()
        or public.is_event_chair(ja.event_id)
        or exists (
          select 1
          from public.packets p
          where p.event_entry_id = ss.event_entry_id
            and p.release_status = 'released'
        )
      )
  )
);

create policy caption_ratings_write
on public.caption_ratings
for all
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.score_sheets ss
    join public.judge_assignments ja on ja.id = ss.judge_assignment_id
    where ss.id = caption_ratings.score_sheet_id
      and (
        ja.user_id = public.current_user_id()
        or public.is_event_chair(ja.event_id)
      )
  )
)
with check (
  public.is_admin()
  or exists (
    select 1
    from public.score_sheets ss
    join public.judge_assignments ja on ja.id = ss.judge_assignment_id
    where ss.id = caption_ratings.score_sheet_id
      and (
        ja.user_id = public.current_user_id()
        or public.is_event_chair(ja.event_id)
      )
  )
);

create policy tape_segments_select
on public.tape_segments
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.score_sheets ss
    join public.judge_assignments ja on ja.id = ss.judge_assignment_id
    where ss.id = tape_segments.score_sheet_id
      and (
        ja.user_id = public.current_user_id()
        or public.is_event_chair(ja.event_id)
      )
  )
);

create policy tape_segments_write
on public.tape_segments
for all
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.score_sheets ss
    join public.judge_assignments ja on ja.id = ss.judge_assignment_id
    where ss.id = tape_segments.score_sheet_id
      and ja.user_id = public.current_user_id()
  )
)
with check (
  public.is_admin()
  or exists (
    select 1
    from public.score_sheets ss
    join public.judge_assignments ja on ja.id = ss.judge_assignment_id
    where ss.id = tape_segments.score_sheet_id
      and ja.user_id = public.current_user_id()
  )
);

create policy canonical_tapes_select
on public.canonical_tapes
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.score_sheets ss
    join public.judge_assignments ja on ja.id = ss.judge_assignment_id
    where ss.id = canonical_tapes.score_sheet_id
      and (
        ja.user_id = public.current_user_id()
        or public.is_event_chair(ja.event_id)
        or exists (
          select 1
          from public.packets p
          where p.event_entry_id = ss.event_entry_id
            and p.release_status = 'released'
        )
      )
  )
);

create policy canonical_tapes_write
on public.canonical_tapes
for all
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.score_sheets ss
    join public.judge_assignments ja on ja.id = ss.judge_assignment_id
    where ss.id = canonical_tapes.score_sheet_id
      and (
        ja.user_id = public.current_user_id()
        or public.is_event_chair(ja.event_id)
      )
  )
)
with check (
  public.is_admin()
  or exists (
    select 1
    from public.score_sheets ss
    join public.judge_assignments ja on ja.id = ss.judge_assignment_id
    where ss.id = canonical_tapes.score_sheet_id
      and (
        ja.user_id = public.current_user_id()
        or public.is_event_chair(ja.event_id)
      )
  )
);
