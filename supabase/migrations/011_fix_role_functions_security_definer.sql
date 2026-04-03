-- Depozitka Core - Fix role lookup functions to use SECURITY DEFINER (v11)
-- Without SECURITY DEFINER, dpt_current_role() is subject to RLS on dpt_profiles,
-- which causes circular dependency with dpt_is_admin() in policy checks.

create or replace function public.dpt_current_role()
returns public.dpt_user_role
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.dpt_profiles p
  where p.auth_user_id = auth.uid()
  limit 1;
$$;

create or replace function public.dpt_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.dpt_current_role() in ('admin','support'), false);
$$;

-- Also fix dpt_me_email to be security definer for consistency
create or replace function public.dpt_me_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.email
  from public.dpt_profiles p
  where p.auth_user_id = auth.uid()
  limit 1;
$$;
