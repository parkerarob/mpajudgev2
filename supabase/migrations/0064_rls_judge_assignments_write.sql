-- Allow admin and event chairs to manage per-event judge assignments.

create policy judge_assignments_write
on public.judge_assignments
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
