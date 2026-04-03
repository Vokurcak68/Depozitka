-- Security hardening (v5)
-- Anti-bot / anti-bruteforce guardrails for critical RPC actions.

-- ============================================
-- Rate limit counters
-- ============================================
create table if not exists public.dpt_rate_limit_counters (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  principal text not null,
  bucket_start timestamptz not null,
  hits int not null default 0 check (hits >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (action, principal, bucket_start)
);

create index if not exists idx_dpt_rate_limit_lookup
  on public.dpt_rate_limit_counters(action, principal, bucket_start desc);

create trigger trg_dpt_rate_limit_updated_at
before update on public.dpt_rate_limit_counters
for each row
execute function public.dpt_set_updated_at();

alter table public.dpt_rate_limit_counters enable row level security;

drop policy if exists "dpt_rate_limit_admin_only" on public.dpt_rate_limit_counters;
create policy "dpt_rate_limit_admin_only"
on public.dpt_rate_limit_counters
for all
using (public.dpt_is_admin())
with check (public.dpt_is_admin());

-- ============================================
-- Helpers
-- ============================================
create or replace function public.dpt_security_principal(
  p_fallback text default null
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid text;
  v_email text;
begin
  if auth.role() = 'service_role' then
    return 'service:' || coalesce(nullif(trim(p_fallback), ''), 'system');
  end if;

  v_uid := nullif(auth.uid()::text, '');
  if v_uid is not null then
    return 'uid:' || v_uid;
  end if;

  v_email := nullif(trim(public.dpt_me_email()), '');
  if v_email is not null then
    return 'email:' || lower(v_email);
  end if;

  return 'unknown';
end;
$$;

revoke all on function public.dpt_security_principal(text) from public;
grant execute on function public.dpt_security_principal(text) to authenticated, service_role;

create or replace function public.dpt_assert_rate_limit(
  p_action text,
  p_principal text,
  p_limit int,
  p_window_minutes int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now_bucket timestamptz;
  v_window_start timestamptz;
  v_total int;
begin
  if coalesce(trim(p_action), '') = '' then
    raise exception 'p_action je povinný';
  end if;

  if coalesce(trim(p_principal), '') = '' then
    raise exception 'p_principal je povinný';
  end if;

  if p_limit <= 0 then
    raise exception 'p_limit musí být > 0';
  end if;

  if p_window_minutes <= 0 then
    raise exception 'p_window_minutes musí být > 0';
  end if;

  v_now_bucket := date_trunc('minute', now());
  v_window_start := v_now_bucket - make_interval(mins => p_window_minutes - 1);

  select coalesce(sum(hits), 0)
    into v_total
  from public.dpt_rate_limit_counters
  where action = p_action
    and principal = p_principal
    and bucket_start >= v_window_start;

  if v_total >= p_limit then
    raise exception 'Rate limit exceeded for action %', p_action;
  end if;

  insert into public.dpt_rate_limit_counters (action, principal, bucket_start, hits)
  values (p_action, p_principal, v_now_bucket, 1)
  on conflict (action, principal, bucket_start)
  do update set
    hits = public.dpt_rate_limit_counters.hits + 1,
    updated_at = now();

  -- Lightweight cleanup of stale buckets to keep table bounded.
  delete from public.dpt_rate_limit_counters
  where bucket_start < now() - interval '2 days';
end;
$$;

revoke all on function public.dpt_assert_rate_limit(text, text, int, int) from public;
grant execute on function public.dpt_assert_rate_limit(text, text, int, int) to authenticated, service_role;

-- ============================================
-- Harden dpt_create_transaction with RL
-- ============================================
create or replace function public.dpt_create_transaction(
  p_marketplace_code text,
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
  v_fee_percent numeric(5,2);
  v_min_fee numeric(12,2);
  v_fee_amount numeric(12,2);
  v_payout_amount numeric(12,2);
  v_tx public.dpt_transactions;
  v_role public.dpt_user_role;
  v_principal text;
begin
  -- Only service role or admin/support can create transactions directly via RPC.
  if auth.role() <> 'service_role' then
    v_role := public.dpt_current_role();

    if v_role not in ('admin', 'support') then
      raise exception 'Neoprávněné volání dpt_create_transaction pro roli %', v_role;
    end if;
  end if;

  if coalesce(trim(p_marketplace_code), '') = '' then
    raise exception 'p_marketplace_code je povinný';
  end if;

  if coalesce(trim(p_external_order_id), '') = '' then
    raise exception 'p_external_order_id je povinný';
  end if;

  if coalesce(trim(p_buyer_email), '') = '' or coalesce(trim(p_seller_email), '') = '' then
    raise exception 'buyer/seller email je povinný';
  end if;

  if p_amount_czk is null or p_amount_czk <= 0 then
    raise exception 'p_amount_czk musí být > 0';
  end if;

  -- Rate limit (non-service callers).
  if auth.role() <> 'service_role' then
    v_principal := public.dpt_security_principal(public.dpt_me_email());
    perform public.dpt_assert_rate_limit('rpc.create_transaction', v_principal, 30, 60);
  end if;

  select id into v_marketplace_id
  from public.dpt_marketplaces
  where code = p_marketplace_code and active = true;

  if v_marketplace_id is null then
    raise exception 'Neznámý marketplace code: %', p_marketplace_code;
  end if;

  select coalesce((value->>'percent')::numeric, 5), coalesce((value->>'minCzk')::numeric, 15)
    into v_fee_percent, v_min_fee
  from public.dpt_settings
  where key = 'fees';

  v_fee_amount := greatest(v_min_fee, round(p_amount_czk * (v_fee_percent/100), 2));
  v_payout_amount := p_amount_czk - v_fee_amount;

  insert into public.dpt_transactions (
    transaction_code,
    marketplace_id,
    external_order_id,
    listing_id,
    listing_title,
    payment_method,
    buyer_name,
    buyer_email,
    seller_name,
    seller_email,
    amount_czk,
    fee_percent,
    fee_amount_czk,
    payout_amount_czk,
    status,
    payment_due_at,
    ship_due_at,
    delivery_confirm_due_at,
    auto_complete_at,
    metadata
  ) values (
    public.dpt_generate_transaction_code(),
    v_marketplace_id,
    p_external_order_id,
    p_listing_id,
    p_listing_title,
    p_payment_method,
    p_buyer_name,
    lower(p_buyer_email),
    p_seller_name,
    lower(p_seller_email),
    p_amount_czk,
    v_fee_percent,
    v_fee_amount,
    v_payout_amount,
    'created',
    now() + interval '24 hours',
    now() + interval '5 days',
    now() + interval '7 days',
    now() + interval '14 days',
    coalesce(p_metadata, '{}'::jsonb)
  ) returning * into v_tx;

  insert into public.dpt_transaction_events (
    transaction_id, event_type, actor_role, actor_email, old_status, new_status, note
  ) values (
    v_tx.id,
    'transaction_created',
    case when auth.role() = 'service_role' then 'service'::public.dpt_user_role else public.dpt_current_role() end,
    case when auth.role() = 'service_role' then null else public.dpt_me_email() end,
    null,
    'created',
    'Transaction created via API'
  );

  return v_tx;
end;
$$;

revoke all on function public.dpt_create_transaction(
  text, text, text, text, text, text, text, text, numeric, public.dpt_payment_method, jsonb
) from public;
grant execute on function public.dpt_create_transaction(
  text, text, text, text, text, text, text, text, numeric, public.dpt_payment_method, jsonb
) to authenticated, service_role;

-- ============================================
-- Harden dpt_change_status with RL
-- ============================================
create or replace function public.dpt_change_status(
  p_transaction_code text,
  p_new_status public.dpt_tx_status,
  p_actor_role public.dpt_user_role default 'admin',
  p_actor_email text default null,
  p_note text default null
)
returns public.dpt_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx public.dpt_transactions;
  v_old_status public.dpt_tx_status;
  v_reason_required boolean;
  v_effective_role public.dpt_user_role;
  v_effective_email text;
  v_principal text;
begin
  if coalesce(trim(p_transaction_code), '') = '' then
    raise exception 'p_transaction_code je povinný';
  end if;

  select * into v_tx
  from public.dpt_transactions
  where transaction_code = p_transaction_code
  limit 1;

  if v_tx.id is null then
    raise exception 'Transaction % not found', p_transaction_code;
  end if;

  -- Derive identity from auth context (prevents role/email spoofing by client).
  v_effective_role := public.dpt_effective_actor_role(p_actor_role);
  v_effective_email := case
    when auth.role() = 'service_role' then nullif(trim(p_actor_email), '')
    else public.dpt_me_email()
  end;

  -- Rate limits (non-service callers).
  if auth.role() <> 'service_role' then
    v_principal := public.dpt_security_principal(v_effective_email);
    perform public.dpt_assert_rate_limit('rpc.change_status', v_principal, 120, 60);

    if p_new_status in ('refunded', 'cancelled', 'payout_sent') then
      perform public.dpt_assert_rate_limit('rpc.change_status_critical', v_principal, 15, 60);
    end if;
  end if;

  -- Participant scope for non-admin/support/service users.
  if v_effective_role not in ('admin', 'support', 'service') then
    if coalesce(v_effective_email, '') = '' then
      raise exception 'Nelze určit email aktéra';
    end if;

    if v_effective_role = 'buyer' and lower(v_tx.buyer_email) <> lower(v_effective_email) then
      raise exception 'Buyer může měnit jen vlastní transakce';
    end if;

    if v_effective_role = 'seller' and lower(v_tx.seller_email) <> lower(v_effective_email) then
      raise exception 'Seller může měnit jen vlastní transakce';
    end if;
  end if;

  select reason_required into v_reason_required
  from public.dpt_status_transitions
  where from_status = v_tx.status
    and to_status = p_new_status
    and allowed_actor_role = v_effective_role
  limit 1;

  if v_reason_required is null then
    -- fallback for admin/support if exact role row is missing
    if v_effective_role in ('admin', 'support') then
      select reason_required into v_reason_required
      from public.dpt_status_transitions
      where from_status = v_tx.status
        and to_status = p_new_status
        and allowed_actor_role = 'admin'
      limit 1;
    end if;
  end if;

  if v_reason_required is null then
    raise exception 'Transition % -> % is not allowed for role %', v_tx.status, p_new_status, v_effective_role;
  end if;

  if v_reason_required and coalesce(trim(p_note), '') = '' then
    raise exception 'Note/reason is required for transition % -> %', v_tx.status, p_new_status;
  end if;

  v_old_status := v_tx.status;

  update public.dpt_transactions
  set
    status = p_new_status,
    hold_reason = case when p_new_status = 'hold' then p_note else hold_reason end,
    dispute_reason = case when p_new_status = 'disputed' then p_note else dispute_reason end,
    paid_at = case when p_new_status = 'paid' and paid_at is null then now() else paid_at end,
    shipped_at = case when p_new_status = 'shipped' and shipped_at is null then now() else shipped_at end,
    delivered_at = case when p_new_status = 'delivered' and delivered_at is null then now() else delivered_at end,
    completed_at = case when p_new_status in ('completed', 'auto_completed') and completed_at is null then now() else completed_at end,
    cancelled_at = case when p_new_status = 'cancelled' and cancelled_at is null then now() else cancelled_at end,
    refunded_at = case when p_new_status = 'refunded' and refunded_at is null then now() else refunded_at end
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
    'status_changed',
    v_effective_role,
    v_effective_email,
    v_old_status,
    p_new_status,
    p_note,
    jsonb_build_object('transaction_code', p_transaction_code)
  );

  return v_tx;
end;
$$;

revoke all on function public.dpt_change_status(text, public.dpt_tx_status, public.dpt_user_role, text, text) from public;
grant execute on function public.dpt_change_status(text, public.dpt_tx_status, public.dpt_user_role, text, text)
  to authenticated, service_role;

comment on table public.dpt_rate_limit_counters
  is 'Sliding-window counters for anti-bot / anti-bruteforce limits on RPC actions.';

comment on function public.dpt_assert_rate_limit(text, text, int, int)
  is 'Enforces action-based rate limits per principal over minute buckets.';

comment on function public.dpt_security_principal(text)
  is 'Builds stable principal key from auth context (uid/email/service).';

-- End of migration v5
