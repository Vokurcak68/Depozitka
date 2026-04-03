-- Depozitka Core - marketplace registry hardening + payout account flow
-- 1) marketplace evidence (settlement/revshare/api keys)
-- 2) payout destination snapshot on transaction
-- 3) API-first account ingest (from metadata) + seller-portal fallback RPC

-- ==========================================
-- MARKETPLACE CONFIG EXTENSIONS
-- ==========================================
alter table public.dpt_marketplaces
  add column if not exists fee_share_percent numeric(5,2) not null default 0 check (fee_share_percent >= 0 and fee_share_percent <= 100),
  add column if not exists settlement_account_name text,
  add column if not exists settlement_iban text,
  add column if not exists settlement_bic text,
  add column if not exists notes text;

comment on column public.dpt_marketplaces.fee_share_percent is 'Podíl provize pro marketplace (0-100 %)';
comment on column public.dpt_marketplaces.settlement_account_name is 'Název účtu marketplace pro settlement/revshare';
comment on column public.dpt_marketplaces.settlement_iban is 'IBAN účtu marketplace pro settlement/revshare';
comment on column public.dpt_marketplaces.settlement_bic is 'BIC/SWIFT účtu marketplace pro settlement/revshare';

-- ==========================================
-- API KEYS REGISTRY (ROTACE / AUDIT)
-- ==========================================
create table if not exists public.dpt_api_keys (
  id uuid primary key default gen_random_uuid(),
  marketplace_id uuid not null references public.dpt_marketplaces(id) on delete cascade,
  key_prefix text not null,
  key_hash text not null,
  scopes text[] not null default array['transactions:create','transactions:status:write','webhook:send'],
  active boolean not null default true,
  created_by_profile_id uuid references public.dpt_profiles(id) on delete set null,
  rotated_from_key_id uuid references public.dpt_api_keys(id) on delete set null,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (marketplace_id, key_prefix),
  check (char_length(key_prefix) between 6 and 32)
);

create index if not exists idx_dpt_api_keys_marketplace on public.dpt_api_keys(marketplace_id, active);
create index if not exists idx_dpt_api_keys_last_used on public.dpt_api_keys(last_used_at desc nulls last);

create trigger trg_dpt_api_keys_updated_at
before update on public.dpt_api_keys
for each row
execute function public.dpt_set_updated_at();

alter table public.dpt_api_keys enable row level security;

drop policy if exists "dpt_api_keys_admin_only" on public.dpt_api_keys;
create policy "dpt_api_keys_admin_only"
on public.dpt_api_keys
for all
using (public.dpt_is_admin())
with check (public.dpt_is_admin());

-- ==========================================
-- TRANSACTION PAYOUT DESTINATION SNAPSHOT
-- ==========================================
alter table public.dpt_transactions
  add column if not exists seller_payout_account_name text,
  add column if not exists seller_payout_iban text,
  add column if not exists seller_payout_bic text,
  add column if not exists seller_payout_source text not null default 'unknown',
  add column if not exists seller_payout_locked_at timestamptz;

create index if not exists idx_dpt_transactions_seller_payout_iban on public.dpt_transactions(seller_payout_iban);

comment on column public.dpt_transactions.seller_payout_account_name is 'Snapshot názvu účtu prodávajícího určeného pro výplatu';
comment on column public.dpt_transactions.seller_payout_iban is 'Snapshot IBAN účtu prodávajícího určeného pro výplatu';
comment on column public.dpt_transactions.seller_payout_bic is 'Snapshot BIC/SWIFT účtu prodávajícího určeného pro výplatu';
comment on column public.dpt_transactions.seller_payout_source is 'Zdroj payout účtu: marketplace_api | seller_portal | admin_override | unknown';
comment on column public.dpt_transactions.seller_payout_locked_at is 'Čas uzamčení payout účtu (typicky při paid)';

-- ==========================================
-- API-FIRST: INGEST ACCOUNT FROM METADATA
-- metadata keys: seller_payout_iban, seller_payout_account_name, seller_payout_bic
-- ==========================================
create or replace function public.dpt_extract_seller_payout_from_metadata()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_iban text;
  v_name text;
  v_bic text;
begin
  if new.metadata is null then
    return new;
  end if;

  if coalesce(new.seller_payout_iban, '') <> '' then
    return new;
  end if;

  v_iban := upper(regexp_replace(coalesce(new.metadata->>'seller_payout_iban', ''), '\\s+', '', 'g'));
  v_name := nullif(trim(coalesce(new.metadata->>'seller_payout_account_name', '')), '');
  v_bic := upper(nullif(trim(coalesce(new.metadata->>'seller_payout_bic', '')), ''));

  if v_iban = '' then
    return new;
  end if;

  if char_length(v_iban) < 15 or char_length(v_iban) > 34 then
    raise exception 'seller_payout_iban v metadata má neplatnou délku';
  end if;

  new.seller_payout_iban := v_iban;
  new.seller_payout_account_name := v_name;
  new.seller_payout_bic := v_bic;
  new.seller_payout_source := case
    when auth.role() = 'service_role' then 'marketplace_api'
    else coalesce(nullif(new.seller_payout_source, ''), 'unknown')
  end;

  return new;
end;
$$;

drop trigger if exists trg_dpt_extract_seller_payout_from_metadata on public.dpt_transactions;
create trigger trg_dpt_extract_seller_payout_from_metadata
before insert on public.dpt_transactions
for each row
execute function public.dpt_extract_seller_payout_from_metadata();

-- ==========================================
-- LOCK PAYOUT ACCOUNT WHEN TX REACHES PAID
-- ==========================================
create or replace function public.dpt_lock_seller_payout_on_paid()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'paid' and new.status = 'paid' and new.seller_payout_locked_at is null then
    new.seller_payout_locked_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_dpt_lock_seller_payout_on_paid on public.dpt_transactions;
create trigger trg_dpt_lock_seller_payout_on_paid
before update on public.dpt_transactions
for each row
execute function public.dpt_lock_seller_payout_on_paid();

-- ==========================================
-- SELLER PORTAL FALLBACK (RPC)
-- Allows seller to set payout account before paid-lock.
-- Admin/support/service can override with audit note.
-- ==========================================
create or replace function public.dpt_set_seller_payout_account(
  p_transaction_code text,
  p_iban text,
  p_account_name text default null,
  p_bic text default null,
  p_source text default null,
  p_note text default null
)
returns public.dpt_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx public.dpt_transactions;
  v_role public.dpt_user_role;
  v_email text;
  v_iban text;
  v_name text;
  v_bic text;
  v_source text;
begin
  if coalesce(trim(p_transaction_code), '') = '' then
    raise exception 'p_transaction_code je povinný';
  end if;

  v_iban := upper(regexp_replace(coalesce(p_iban, ''), '\\s+', '', 'g'));
  if v_iban = '' then
    raise exception 'p_iban je povinný';
  end if;

  if char_length(v_iban) < 15 or char_length(v_iban) > 34 then
    raise exception 'p_iban má neplatnou délku';
  end if;

  v_name := nullif(trim(coalesce(p_account_name, '')), '');
  v_bic := upper(nullif(trim(coalesce(p_bic, '')), ''));

  select *
    into v_tx
  from public.dpt_transactions
  where transaction_code = p_transaction_code
  limit 1;

  if v_tx.id is null then
    raise exception 'Transaction % not found', p_transaction_code;
  end if;

  if auth.role() = 'service_role' then
    v_role := 'service'::public.dpt_user_role;
    v_source := 'marketplace_api';
  else
    v_role := public.dpt_current_role();
    v_email := public.dpt_me_email();

    if v_role in ('admin', 'support') then
      v_source := coalesce(nullif(trim(p_source), ''), 'admin_override');
    else
      if v_role <> 'seller' then
        raise exception 'Pouze seller/admin/support může nastavit payout účet';
      end if;

      if lower(coalesce(v_tx.seller_email, '')) <> lower(coalesce(v_email, '')) then
        raise exception 'Seller může upravovat jen vlastní transakce';
      end if;

      if v_tx.seller_payout_locked_at is not null or v_tx.status not in ('created', 'partial_paid') then
        raise exception 'Payout účet je už zamčený pro úpravy';
      end if;

      v_source := 'seller_portal';
    end if;
  end if;

  update public.dpt_transactions
  set
    seller_payout_iban = v_iban,
    seller_payout_account_name = v_name,
    seller_payout_bic = v_bic,
    seller_payout_source = v_source
  where id = v_tx.id
  returning * into v_tx;

  insert into public.dpt_transaction_events (
    transaction_id,
    event_type,
    actor_role,
    actor_email,
    old_status,
    new_status,
    note,
    payload
  ) values (
    v_tx.id,
    'note_added',
    v_role,
    case when auth.role() = 'service_role' then null else v_email end,
    v_tx.status,
    v_tx.status,
    coalesce(nullif(trim(p_note), ''), 'Seller payout účet aktualizován'),
    jsonb_build_object(
      'action', 'seller_payout_account_set',
      'source', v_source,
      'iban_masked', left(v_iban, 4) || '****' || right(v_iban, 4)
    )
  );

  return v_tx;
end;
$$;

revoke all on function public.dpt_set_seller_payout_account(text, text, text, text, text, text) from public;
grant execute on function public.dpt_set_seller_payout_account(text, text, text, text, text, text) to authenticated, service_role;

comment on function public.dpt_set_seller_payout_account(text, text, text, text, text, text)
is 'Nastaví payout účet prodávajícího; seller jen před paid lockem, admin/service kdykoliv s auditem.';

-- Keep existing test marketplace aligned with defaults.
update public.dpt_marketplaces
set
  fee_share_percent = coalesce(fee_share_percent, 0)
where code = 'depozitka-test-bazar';
