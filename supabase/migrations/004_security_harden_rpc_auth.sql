-- Security hardening (v4)
-- Goal: block role spoofing in RPC calls and enforce actor identity from auth context.

-- ============================================
-- Helper: resolve actor role safely from context
-- ============================================
create or replace function public.dpt_effective_actor_role(
  p_requested_role public.dpt_user_role default null
)
returns public.dpt_user_role
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role public.dpt_user_role;
begin
  -- Service role may act as explicit role (for backend jobs/integrations).
  if auth.role() = 'service_role' then
    return coalesce(p_requested_role, 'service'::public.dpt_user_role);
  end if;

  -- Authenticated users always derive role from profile to prevent spoofing.
  v_role := public.dpt_current_role();
  return coalesce(v_role, 'buyer'::public.dpt_user_role);
end;
$$;

revoke all on function public.dpt_effective_actor_role(public.dpt_user_role) from public;
grant execute on function public.dpt_effective_actor_role(public.dpt_user_role) to authenticated, service_role;

-- ============================================
-- Harden dpt_create_transaction
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
-- Harden dpt_change_status
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

comment on function public.dpt_change_status(text, public.dpt_tx_status, public.dpt_user_role, text, text)
  is 'Security hardened: actor role/email are derived from auth context for non-service callers.';

comment on function public.dpt_create_transaction(text, text, text, text, text, text, text, text, numeric, public.dpt_payment_method, jsonb)
  is 'Security hardened: only service role or admin/support can call directly.';

comment on function public.dpt_effective_actor_role(public.dpt_user_role)
  is 'Returns safe actor role from auth context; prevents client role spoofing.';

-- End of migration v4
