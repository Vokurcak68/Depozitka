-- Depozitka Core - Allow authenticated users to READ marketplaces (v13)
-- The original policy was admin-only for ALL operations,
-- which broke transaction loading via foreign key join.
-- Split: read for all authenticated, write for admin only.

-- Drop the overly restrictive all-in-one policy
drop policy if exists "dpt_marketplaces_admin_only" on public.dpt_marketplaces;

-- Read: any authenticated user
create policy "dpt_marketplaces_read_authenticated"
on public.dpt_marketplaces
for select
using (auth.role() = 'authenticated');

-- Write: admin/support only
create policy "dpt_marketplaces_write_admin"
on public.dpt_marketplaces
for insert
with check (public.dpt_is_admin());

create policy "dpt_marketplaces_update_admin"
on public.dpt_marketplaces
for update
using (public.dpt_is_admin())
with check (public.dpt_is_admin());

create policy "dpt_marketplaces_delete_admin"
on public.dpt_marketplaces
for delete
using (public.dpt_is_admin());
