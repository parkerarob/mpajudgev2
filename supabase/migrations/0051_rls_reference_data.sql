-- RLS for globally readable or admin-managed reference data.

create policy users_self_select
on public.users
for select
to authenticated
using (id = public.current_user_id() or public.is_admin());

create policy users_admin_update
on public.users
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy districts_read
on public.districts
for select
to authenticated
using (true);

create policy districts_admin_write
on public.districts
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy schools_read
on public.schools
for select
to authenticated
using (true);

create policy schools_admin_write
on public.schools
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy graded_list_versions_read
on public.graded_list_versions
for select
to authenticated
using (true);

create policy graded_list_versions_admin_write
on public.graded_list_versions
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy pieces_read
on public.pieces
for select
to authenticated
using (true);

create policy pieces_admin_write
on public.pieces
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy sites_read
on public.sites
for select
to authenticated
using (true);

create policy sites_admin_write
on public.sites
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy instrument_families_read
on public.instrument_families
for select
to authenticated
using (true);

create policy instrument_families_admin_write
on public.instrument_families
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy instruments_read
on public.instruments
for select
to authenticated
using (true);

create policy instruments_admin_write
on public.instruments
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy site_percussion_inventory_read
on public.site_percussion_inventory
for select
to authenticated
using (true);

create policy site_percussion_inventory_admin_write
on public.site_percussion_inventory
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy marches_read
on public.marches
for select
to authenticated
using (true);

create policy marches_director_insert
on public.marches
for insert
to authenticated
with check (
  submitted_by = public.current_user_id()
  and is_user_submitted = true
);

create policy marches_director_update_own
on public.marches
for update
to authenticated
using (
  public.is_admin()
  or submitted_by = public.current_user_id()
)
with check (
  public.is_admin()
  or (submitted_by = public.current_user_id() and is_user_submitted = true)
);

create policy marches_admin_delete
on public.marches
for delete
to authenticated
using (public.is_admin());
