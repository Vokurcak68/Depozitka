-- Fix: RLS recursion / stack depth exceeded
-- Cause: policies queried dpt_profiles directly; dpt_profiles policy referenced dpt_is_admin()
-- which queried dpt_profiles again => recursive policy evaluation.

create or replace function public.dpt_current_role()
returns public.dpt_user_role
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.role from public.dpt_profiles p where p.auth_user_id = auth.uid() limit 1),
    'buyer'::public.dpt_user_role
  );
$$;

create or replace function public.dpt_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.dpt_current_role() in ('admin','support');
$$;

create or replace function public.dpt_me_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(p.email)
  from public.dpt_profiles p
  where p.auth_user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.dpt_current_role() from public;
revoke all on function public.dpt_is_admin() from public;
revoke all on function public.dpt_me_email() from public;

grant execute on function public.dpt_current_role() to authenticated, service_role;
grant execute on function public.dpt_is_admin() to authenticated, service_role;
grant execute on function public.dpt_me_email() to authenticated, service_role;

-- Recreate policies that referenced dpt_profiles directly in subqueries

drop policy if exists "dpt_transactions_select_participant_or_admin" on public.dpt_transactions;
create policy "dpt_transactions_select_participant_or_admin"
on public.dpt_transactions
for select
using (
  public.dpt_is_admin()
  or lower(buyer_email) = coalesce(public.dpt_me_email(), '')
  or lower(seller_email) = coalesce(public.dpt_me_email(), '')
);

drop policy if exists "dpt_events_select_participant_or_admin" on public.dpt_transaction_events;
create policy "dpt_events_select_participant_or_admin"
on public.dpt_transaction_events
for select
using (
  public.dpt_is_admin()
  or exists (
    select 1 from public.dpt_transactions t
    where t.id = transaction_id
      and (
        lower(t.buyer_email) = coalesce(public.dpt_me_email(), '')
        or lower(t.seller_email) = coalesce(public.dpt_me_email(), '')
      )
  )
);

drop policy if exists "dpt_disputes_select_participant_or_admin" on public.dpt_disputes;
create policy "dpt_disputes_select_participant_or_admin"
on public.dpt_disputes
for select
using (
  public.dpt_is_admin()
  or exists (
    select 1 from public.dpt_transactions t
    where t.id = transaction_id
      and (
        lower(t.buyer_email) = coalesce(public.dpt_me_email(), '')
        or lower(t.seller_email) = coalesce(public.dpt_me_email(), '')
      )
  )
);

drop policy if exists "dpt_addresses_select_participant_or_admin" on public.dpt_transaction_addresses;
create policy "dpt_addresses_select_participant_or_admin"
on public.dpt_transaction_addresses
for select
using (
  public.dpt_is_admin()
  or exists (
    select 1 from public.dpt_transactions t
    where t.id = transaction_id
      and (
        lower(t.buyer_email) = coalesce(public.dpt_me_email(), '')
        or lower(t.seller_email) = coalesce(public.dpt_me_email(), '')
      )
  )
);
