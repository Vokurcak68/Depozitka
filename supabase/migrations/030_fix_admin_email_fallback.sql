-- Fix admin email: info@depozitka.cz does NOT exist.
-- Correct domain is depozitka.eu, correct email is noreplay@depozitka.eu

-- 1. Fix dpt_settings seed
UPDATE public.dpt_settings
SET value = '{"from":"noreplay@depozitka.eu","replyTo":"noreplay@depozitka.eu"}'::jsonb
WHERE key = 'emails';

-- 2. Fix trigger fallback (dpt_enqueue_transaction_emails — both old queue and new instant version)
create or replace function public.dpt_enqueue_transaction_emails()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx public.dpt_transactions;
  v_admin_email text;
begin
  select * into v_tx
  from public.dpt_transactions
  where id = new.transaction_id
  limit 1;

  if v_tx.id is null then
    return new;
  end if;

  select coalesce(value->>'replyTo', value->>'from', 'noreplay@depozitka.eu')
    into v_admin_email
  from public.dpt_settings
  where key = 'emails';

  if v_admin_email is null then
    v_admin_email := 'noreplay@depozitka.eu';
  end if;

  -- Check if dpt_send_email_instant exists (pg_net enabled)
  -- If not, fall back to dpt_queue_email
  if new.event_type = 'transaction_created' then
    begin
      perform public.dpt_send_email_instant(v_tx.id, 'tx_created_buyer', v_tx.buyer_email);
      perform public.dpt_send_email_instant(v_tx.id, 'tx_created_seller', v_tx.seller_email);
      perform public.dpt_send_email_instant(v_tx.id, 'tx_created_admin', v_admin_email);
    exception when undefined_function then
      perform public.dpt_queue_email(v_tx.id, 'tx_created_buyer', v_tx.buyer_email, new.note);
      perform public.dpt_queue_email(v_tx.id, 'tx_created_seller', v_tx.seller_email, new.note);
      perform public.dpt_queue_email(v_tx.id, 'tx_created_admin', v_admin_email, new.note);
    end;
    return new;
  end if;

  if new.event_type = 'status_changed' then
    case new.new_status
      when 'paid' then
        begin
          perform public.dpt_send_email_instant(v_tx.id, 'payment_received_buyer', v_tx.buyer_email);
          perform public.dpt_send_email_instant(v_tx.id, 'payment_received_seller', v_tx.seller_email);
        exception when undefined_function then
          perform public.dpt_queue_email(v_tx.id, 'payment_received_buyer', v_tx.buyer_email, new.note);
          perform public.dpt_queue_email(v_tx.id, 'payment_received_seller', v_tx.seller_email, new.note);
        end;

      when 'shipped' then
        begin
          perform public.dpt_send_email_instant(v_tx.id, 'shipped_buyer', v_tx.buyer_email);
        exception when undefined_function then
          perform public.dpt_queue_email(v_tx.id, 'shipped_buyer', v_tx.buyer_email, new.note);
        end;

      when 'delivered' then
        begin
          perform public.dpt_send_email_instant(v_tx.id, 'delivered_buyer', v_tx.buyer_email);
          perform public.dpt_send_email_instant(v_tx.id, 'delivered_seller', v_tx.seller_email);
        exception when undefined_function then
          perform public.dpt_queue_email(v_tx.id, 'delivered_buyer', v_tx.buyer_email, new.note);
          perform public.dpt_queue_email(v_tx.id, 'delivered_seller', v_tx.seller_email, new.note);
        end;

      when 'completed', 'auto_completed' then
        begin
          perform public.dpt_send_email_instant(v_tx.id, 'completed_buyer', v_tx.buyer_email);
          perform public.dpt_send_email_instant(v_tx.id, 'completed_seller', v_tx.seller_email);
        exception when undefined_function then
          perform public.dpt_queue_email(v_tx.id, 'completed_buyer', v_tx.buyer_email, new.note);
          perform public.dpt_queue_email(v_tx.id, 'completed_seller', v_tx.seller_email, new.note);
        end;

      when 'disputed' then
        begin
          perform public.dpt_send_email_instant(v_tx.id, 'dispute_opened_buyer', v_tx.buyer_email);
          perform public.dpt_send_email_instant(v_tx.id, 'dispute_opened_seller', v_tx.seller_email);
          perform public.dpt_send_email_instant(v_tx.id, 'dispute_opened_admin', v_admin_email);
        exception when undefined_function then
          perform public.dpt_queue_email(v_tx.id, 'dispute_opened_buyer', v_tx.buyer_email, new.note);
          perform public.dpt_queue_email(v_tx.id, 'dispute_opened_seller', v_tx.seller_email, new.note);
          perform public.dpt_queue_email(v_tx.id, 'dispute_opened_admin', v_admin_email, new.note);
        end;

      when 'hold' then
        begin
          perform public.dpt_send_email_instant(v_tx.id, 'hold_set_buyer', v_tx.buyer_email);
          perform public.dpt_send_email_instant(v_tx.id, 'hold_set_seller', v_tx.seller_email);
        exception when undefined_function then
          perform public.dpt_queue_email(v_tx.id, 'hold_set_buyer', v_tx.buyer_email, new.note);
          perform public.dpt_queue_email(v_tx.id, 'hold_set_seller', v_tx.seller_email, new.note);
        end;

      when 'refunded' then
        begin
          perform public.dpt_send_email_instant(v_tx.id, 'refunded_buyer', v_tx.buyer_email);
          perform public.dpt_send_email_instant(v_tx.id, 'refunded_seller', v_tx.seller_email);
        exception when undefined_function then
          perform public.dpt_queue_email(v_tx.id, 'refunded_buyer', v_tx.buyer_email, new.note);
          perform public.dpt_queue_email(v_tx.id, 'refunded_seller', v_tx.seller_email, new.note);
        end;

      when 'payout_sent', 'payout_confirmed' then
        begin
          perform public.dpt_send_email_instant(v_tx.id, 'payout_seller', v_tx.seller_email);
          perform public.dpt_send_email_instant(v_tx.id, 'payout_admin', v_admin_email);
        exception when undefined_function then
          perform public.dpt_queue_email(v_tx.id, 'payout_seller', v_tx.seller_email, new.note);
          perform public.dpt_queue_email(v_tx.id, 'payout_admin', v_admin_email, new.note);
        end;

      when 'partial_paid' then
        begin
          perform public.dpt_send_email_instant(v_tx.id, 'partial_paid_buyer', v_tx.buyer_email);
          perform public.dpt_send_email_instant(v_tx.id, 'partial_paid_seller', v_tx.seller_email);
        exception when undefined_function then
          perform public.dpt_queue_email(v_tx.id, 'partial_paid_buyer', v_tx.buyer_email, new.note);
          perform public.dpt_queue_email(v_tx.id, 'partial_paid_seller', v_tx.seller_email, new.note);
        end;

      else
        null;
    end case;
  end if;

  return new;
end;
$$;
