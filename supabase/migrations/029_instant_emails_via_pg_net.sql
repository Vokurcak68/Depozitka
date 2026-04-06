-- Enable pg_net for async HTTP calls from DB triggers
create extension if not exists pg_net with schema net;

-- ---------------------------------------------------------------------------
-- Replace queue-based trigger with instant HTTP send via pg_net
-- ---------------------------------------------------------------------------

-- Helper: fire-and-forget email send via engine /api/send-email
create or replace function public.dpt_send_email_instant(
  p_transaction_id uuid,
  p_template_key text,
  p_to_email text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_engine_url text;
  v_cron_secret text;
  v_body jsonb;
begin
  -- Get engine URL + CRON_SECRET from dpt_settings
  select
    coalesce(value->>'engine_url', 'https://depozitka-engine.vercel.app'),
    value->>'cron_secret'
  into v_engine_url, v_cron_secret
  from public.dpt_settings
  where key = 'engine';

  if v_engine_url is null then
    v_engine_url := 'https://depozitka-engine.vercel.app';
  end if;

  v_body := jsonb_build_object(
    'transaction_id', p_transaction_id::text,
    'template_key', p_template_key,
    'to_email', p_to_email,
    'token', coalesce(v_cron_secret, '')
  );

  -- Fire-and-forget async HTTP POST via pg_net
  perform net.http_post(
    url := v_engine_url || '/api/send-email',
    body := v_body
  );
end;
$$;

revoke all on function public.dpt_send_email_instant(uuid, text, text) from public;
grant execute on function public.dpt_send_email_instant(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- New trigger: instant emails (replaces queue-based trigger)
-- ---------------------------------------------------------------------------
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

  select coalesce(value->>'replyTo', value->>'from', 'info@depozitka.cz')
    into v_admin_email
  from public.dpt_settings
  where key = 'emails';

  -- Also log to dpt_email_logs for audit trail (status = 'sending')
  -- The actual sending happens via pg_net HTTP call

  if new.event_type = 'transaction_created' then
    perform public.dpt_send_email_instant(v_tx.id, 'tx_created_buyer', v_tx.buyer_email);
    perform public.dpt_send_email_instant(v_tx.id, 'tx_created_seller', v_tx.seller_email);
    perform public.dpt_send_email_instant(v_tx.id, 'tx_created_admin', v_admin_email);
    return new;
  end if;

  if new.event_type = 'status_changed' then
    case new.new_status
      when 'paid' then
        perform public.dpt_send_email_instant(v_tx.id, 'payment_received_buyer', v_tx.buyer_email);
        perform public.dpt_send_email_instant(v_tx.id, 'payment_received_seller', v_tx.seller_email);

      when 'shipped' then
        perform public.dpt_send_email_instant(v_tx.id, 'shipped_buyer', v_tx.buyer_email);

      when 'delivered' then
        perform public.dpt_send_email_instant(v_tx.id, 'delivered_buyer', v_tx.buyer_email);
        perform public.dpt_send_email_instant(v_tx.id, 'delivered_seller', v_tx.seller_email);

      when 'completed', 'auto_completed' then
        perform public.dpt_send_email_instant(v_tx.id, 'completed_buyer', v_tx.buyer_email);
        perform public.dpt_send_email_instant(v_tx.id, 'completed_seller', v_tx.seller_email);

      when 'disputed' then
        perform public.dpt_send_email_instant(v_tx.id, 'dispute_opened_buyer', v_tx.buyer_email);
        perform public.dpt_send_email_instant(v_tx.id, 'dispute_opened_seller', v_tx.seller_email);
        perform public.dpt_send_email_instant(v_tx.id, 'dispute_opened_admin', v_admin_email);

      when 'hold' then
        perform public.dpt_send_email_instant(v_tx.id, 'hold_set_buyer', v_tx.buyer_email);
        perform public.dpt_send_email_instant(v_tx.id, 'hold_set_seller', v_tx.seller_email);

      when 'refunded' then
        perform public.dpt_send_email_instant(v_tx.id, 'refunded_buyer', v_tx.buyer_email);
        perform public.dpt_send_email_instant(v_tx.id, 'refunded_seller', v_tx.seller_email);

      when 'payout_sent', 'payout_confirmed' then
        perform public.dpt_send_email_instant(v_tx.id, 'payout_seller', v_tx.seller_email);
        perform public.dpt_send_email_instant(v_tx.id, 'payout_admin', v_admin_email);

      when 'partial_paid' then
        perform public.dpt_send_email_instant(v_tx.id, 'partial_paid_buyer', v_tx.buyer_email);
        perform public.dpt_send_email_instant(v_tx.id, 'partial_paid_seller', v_tx.seller_email);

      else
        null;
    end case;
  end if;

  return new;
end;
$$;

-- Trigger already exists, this just replaces the function body
-- No need to recreate the trigger itself

comment on function public.dpt_send_email_instant(uuid, text, text)
  is 'Sends email instantly via engine /api/send-email using pg_net async HTTP POST.';

-- ---------------------------------------------------------------------------
-- Seed engine settings (engine_url + cron_secret)
-- IMPORTANT: After migration, update the cron_secret value to match
-- the CRON_SECRET env var on your Vercel engine deployment!
-- ---------------------------------------------------------------------------
insert into public.dpt_settings(key, value, description)
values (
  'engine',
  '{"engine_url":"https://depozitka-engine.vercel.app","cron_secret":"REPLACE_WITH_ACTUAL_CRON_SECRET"}'::jsonb,
  'Engine URL a autentizace pro pg_net volání'
)
on conflict (key) do nothing;
