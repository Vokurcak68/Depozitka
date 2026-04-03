-- Depozitka Core - API-first endpoint contract + seller portal guardy (v9)
-- 1) API key validation + scope checks for transaction create contract
-- 2) Idempotency via request_id log
-- 3) Seller self-service RPC with stricter input validation

-- ==========================================
-- API REQUEST IDEMPOTENCY LOG
-- ==========================================
create table if not exists public.dpt_api_request_log (
  id uuid primary key default gen_random_uuid(),
  marketplace_id uuid not null references public.dpt_marketplaces(id) on delete cascade,
  endpoint text not null,
  request_id text not null,
  transaction_id uuid references public.dpt_transactions(id) on delete set null,
  payload_hash text,
  created_at timestamptz not null default now(),
  unique (marketplace_id, endpoint, request_id)
);

create index if not exists idx_dpt_api_request_log_tx on public.dpt_api_request_log(transaction_id);
create index if not exists idx_dpt_api_request_log_marketplace_created on public.dpt_api_request_log(marketplace_id, created_at desc);

alter table public.dpt_api_request_log enable row level security;

drop policy if exists "dpt_api_request_log_admin_only" on public.dpt_api_request_log;
create policy "dpt_api_request_log_admin_only"
on public.dpt_api_request_log
for all
using (public.dpt_is_admin())
with check (public.dpt_is_admin());

-- ==========================================
-- HELPER: API KEY VALIDATION (scope + expiry + active)
-- ==========================================
create or replace function public.dpt_api_auth_marketplace(
  p_marketplace_code text,
  p_api_key text,
  p_required_scope text default 'transactions:create'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marketplace_id uuid;
  v_key record;
begin
  if coalesce(trim(p_marketplace_code), '') = '' then
    raise exception 'p_marketplace_code je povinný';
  end if;

  if coalesce(trim(p_api_key), '') = '' then
    raise exception 'p_api_key je povinný';
  end if;

  select id
    into v_marketplace_id
  from public.dpt_marketplaces
  where code = trim(p_marketplace_code)
    and active = true
  limit 1;

  if v_marketplace_id is null then
    raise exception 'Neznámý marketplace code: %', p_marketplace_code;
  end if;

  select id, key_prefix
    into v_key
  from public.dpt_api_keys
  where marketplace_id = v_marketplace_id
    and active = true
    and revoked_at is null
    and (expires_at is null or expires_at > now())
    and (p_required_scope is null or p_required_scope = any(scopes))
    and crypt(p_api_key, key_hash) = key_hash
  order by created_at desc
  limit 1;

  if v_key.id is null then
    raise exception 'Neplatný API klíč nebo scope';
  end if;

  update public.dpt_api_keys
  set last_used_at = now()
  where id = v_key.id;

  return v_marketplace_id;
end;
$$;

revoke all on function public.dpt_api_auth_marketplace(text, text, text) from public;
grant execute on function public.dpt_api_auth_marketplace(text, text, text) to authenticated, service_role;

comment on function public.dpt_api_auth_marketplace(text, text, text)
is 'Ověří API klíč pro marketplace (active/expiry/scope) a vrátí marketplace_id.';

-- ==========================================
-- API-FIRST CONTRACT: CREATE TRANSACTION SAFE
-- ==========================================
create or replace function public.dpt_create_transaction_safe(
  p_marketplace_code text,
  p_api_key text,
  p_request_id text,
  p_external_order_id text,
  p_listing_id text,
  p_listing_title text,
  p_buyer_name text,
  p_buyer_email text,
  p_seller_name text,
  p_seller_email text,
  p_amount_czk numeric,
  p_payment_method public.dpt_payment_method default 'escrow',
  p_metadata jsonb default '{}'::jsonb
)
returns public.dpt_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marketplace_id uuid;
  v_tx public.dpt_transactions;
  v_existing_tx public.dpt_transactions;
  v_request_id text;
  v_metadata jsonb;
  v_principal text;
begin
  v_request_id := nullif(trim(coalesce(p_request_id, '')), '');
  if v_request_id is null then
    raise exception 'p_request_id je povinný (idempotency key)';
  end if;

  if char_length(v_request_id) < 8 or char_length(v_request_id) > 128 then
    raise exception 'p_request_id musí mít délku 8-128 znaků';
  end if;

  if coalesce(trim(p_external_order_id), '') = '' then
    raise exception 'p_external_order_id je povinný';
  end if;

  if char_length(trim(p_external_order_id)) > 120 then
    raise exception 'p_external_order_id je příliš dlouhé (max 120)';
  end if;

  if coalesce(trim(p_buyer_name), '') = '' or coalesce(trim(p_seller_name), '') = '' then
    raise exception 'buyer/seller name je povinné';
  end if;

  if coalesce(trim(p_buyer_email), '') = '' or coalesce(trim(p_seller_email), '') = '' then
    raise exception 'buyer/seller email je povinný';
  end if;

  if not (lower(trim(p_buyer_email)) ~ '^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$') then
    raise exception 'buyer email není validní';
  end if;

  if not (lower(trim(p_seller_email)) ~ '^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$') then
    raise exception 'seller email není validní';
  end if;

  if p_amount_czk is null or p_amount_czk <= 0 or p_amount_czk > 10000000 then
    raise exception 'p_amount_czk musí být v intervalu (0, 10 000 000]';
  end if;

  v_marketplace_id := public.dpt_api_auth_marketplace(p_marketplace_code, p_api_key, 'transactions:create');

  -- Idempotency short-circuit
  select t.*
    into v_existing_tx
  from public.dpt_api_request_log r
  join public.dpt_transactions t on t.id = r.transaction_id
  where r.marketplace_id = v_marketplace_id
    and r.endpoint = 'transactions.create.v1'
    and r.request_id = v_request_id
  limit 1;

  if v_existing_tx.id is not null then
    return v_existing_tx;
  end if;

  -- API scope rate-limit
  v_principal := 'api:' || v_marketplace_id::text;
  perform public.dpt_assert_rate_limit('api.transactions.create', v_principal, 90, 60);

  v_metadata := coalesce(p_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'request_id', v_request_id,
      'api_contract', 'transactions.create.v1',
      'source', coalesce((p_metadata->>'source'), 'marketplace-api')
    );

  begin
    v_tx := public.dpt_create_transaction(
      p_marketplace_code,
      trim(p_external_order_id),
      nullif(trim(coalesce(p_listing_id, '')), ''),
      nullif(trim(coalesce(p_listing_title, '')), ''),
      trim(p_buyer_name),
      lower(trim(p_buyer_email)),
      trim(p_seller_name),
      lower(trim(p_seller_email)),
      p_amount_czk,
      p_payment_method,
      v_metadata
    );
  exception
    when unique_violation then
      -- fallback for race between same request/order id
      select * into v_tx
      from public.dpt_transactions
      where marketplace_id = v_marketplace_id
        and external_order_id = trim(p_external_order_id)
      order by created_at desc
      limit 1;

      if v_tx.id is null then
        raise;
      end if;
  end;

  insert into public.dpt_api_request_log (marketplace_id, endpoint, request_id, transaction_id, payload_hash)
  values (
    v_marketplace_id,
    'transactions.create.v1',
    v_request_id,
    v_tx.id,
    encode(digest(coalesce(v_metadata::text, ''), 'sha256'), 'hex')
  )
  on conflict (marketplace_id, endpoint, request_id)
  do update set transaction_id = excluded.transaction_id;

  return v_tx;
end;
$$;

revoke all on function public.dpt_create_transaction_safe(
  text, text, text, text, text, text, text, text, text, text, numeric, public.dpt_payment_method, jsonb
) from public;
grant execute on function public.dpt_create_transaction_safe(
  text, text, text, text, text, text, text, text, text, text, numeric, public.dpt_payment_method, jsonb
) to authenticated, service_role;

comment on function public.dpt_create_transaction_safe(
  text, text, text, text, text, text, text, text, text, text, numeric, public.dpt_payment_method, jsonb
)
is 'API-first create endpoint contract v1: API key auth + idempotency + input validation + rate-limit.';

-- ==========================================
-- SELLER SELF-SERVICE CONTRACT (fallback)
-- ==========================================
create or replace function public.dpt_seller_portal_set_payout_account(
  p_transaction_code text,
  p_iban text,
  p_account_name text default null,
  p_bic text default null,
  p_client_request_id text default null
)
returns public.dpt_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.dpt_user_role;
  v_email text;
  v_iban text;
  v_bic text;
  v_req text;
  v_principal text;
begin
  if auth.role() = 'service_role' then
    raise exception 'Seller portal endpoint nelze volat přes service role';
  end if;

  v_role := public.dpt_current_role();
  if v_role <> 'seller' then
    raise exception 'Pouze role seller může použít seller portal endpoint';
  end if;

  v_email := public.dpt_me_email();
  if coalesce(v_email, '') = '' then
    raise exception 'Nelze určit identitu sellera';
  end if;

  if coalesce(trim(p_transaction_code), '') = '' then
    raise exception 'p_transaction_code je povinný';
  end if;

  v_iban := upper(regexp_replace(coalesce(p_iban, ''), '\s+', '', 'g'));
  if not (v_iban ~ '^[A-Z]{2}[A-Z0-9]{13,32}$') then
    raise exception 'p_iban není v validním formátu';
  end if;

  v_bic := upper(nullif(trim(coalesce(p_bic, '')), ''));
  if v_bic is not null and not (v_bic ~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$') then
    raise exception 'p_bic není v validním formátu';
  end if;

  v_req := nullif(trim(coalesce(p_client_request_id, '')), '');
  if v_req is not null and (char_length(v_req) < 8 or char_length(v_req) > 128) then
    raise exception 'p_client_request_id musí mít délku 8-128 znaků';
  end if;

  v_principal := public.dpt_security_principal(v_email);
  perform public.dpt_assert_rate_limit('seller.portal.set_payout', v_principal, 30, 60);

  return public.dpt_set_seller_payout_account(
    p_transaction_code,
    v_iban,
    p_account_name,
    v_bic,
    'seller_portal',
    coalesce('Seller self-service update' || case when v_req is not null then ' · request_id=' || v_req else '' end, 'Seller self-service update')
  );
end;
$$;

revoke all on function public.dpt_seller_portal_set_payout_account(text, text, text, text, text) from public;
grant execute on function public.dpt_seller_portal_set_payout_account(text, text, text, text, text)
  to authenticated;

comment on function public.dpt_seller_portal_set_payout_account(text, text, text, text, text)
is 'Seller self-service fallback endpoint s validačními guardy a rate-limitem.';

-- End of migration v9
