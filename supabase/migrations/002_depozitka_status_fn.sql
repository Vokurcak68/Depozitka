-- Helpers for status change + event logging

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
begin
  select * into v_tx
  from public.dpt_transactions
  where transaction_code = p_transaction_code
  limit 1;

  if v_tx.id is null then
    raise exception 'Transaction % not found', p_transaction_code;
  end if;

  select reason_required into v_reason_required
  from public.dpt_status_transitions
  where from_status = v_tx.status
    and to_status = p_new_status
    and allowed_actor_role = p_actor_role
  limit 1;

  if v_reason_required is null then
    -- fallback for admin/support if exact role row is missing
    if p_actor_role in ('admin', 'support') then
      select reason_required into v_reason_required
      from public.dpt_status_transitions
      where from_status = v_tx.status
        and to_status = p_new_status
        and allowed_actor_role = 'admin'
      limit 1;
    end if;
  end if;

  if v_reason_required is null then
    raise exception 'Transition % -> % is not allowed for role %', v_tx.status, p_new_status, p_actor_role;
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
    p_actor_role,
    p_actor_email,
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
