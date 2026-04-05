-- Add dedicated email templates for partial payment status

insert into public.dpt_email_template_catalog (key, title, description)
values
  ('partial_paid_buyer', 'Částečná platba (kupující)', 'Potvrzení kupujícímu o částečné úhradě'),
  ('partial_paid_seller', 'Částečná platba (prodávající)', 'Informace prodávajícímu o částečné úhradě kupujícím'),
  ('partial_paid_admin', 'Částečná platba (admin)', 'Admin notifikace o částečné úhradě')
on conflict (key) do nothing;

insert into public.dpt_email_templates (template_key, subject_template, body_template, enabled)
values
  (
    'partial_paid_buyer',
    'Depozitka: Evidujeme částečnou platbu ({{transaction_code}})',
    'Dobrý den {{buyer_name}}, evidujeme částečnou úhradu pro transakci {{transaction_code}}. Pro pokračování doplaťte zbývající částku. Variabilní symbol: {{payment_reference}}.',
    true
  ),
  (
    'partial_paid_seller',
    'Depozitka: Kupující uhradil část platby ({{transaction_code}})',
    'Dobrý den {{seller_name}}, kupující uhradil část platby pro transakci {{transaction_code}}. Na odeslání vyčkejte až po plné úhradě.',
    true
  ),
  (
    'partial_paid_admin',
    'Depozitka: Částečná platba ({{transaction_code}})',
    'Admin notifikace: u transakce {{transaction_code}} byla přijata částečná úhrada.',
    true
  )
on conflict (template_key) do update
set
  subject_template = excluded.subject_template,
  body_template = excluded.body_template,
  enabled = excluded.enabled,
  updated_at = now();

-- Auto-queue partial-paid notifications for DB-trigger path
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

  if new.event_type = 'transaction_created' then
    perform public.dpt_queue_email(v_tx.id, 'tx_created_buyer', v_tx.buyer_email, new.note);
    perform public.dpt_queue_email(v_tx.id, 'tx_created_seller', v_tx.seller_email, new.note);
    perform public.dpt_queue_email(v_tx.id, 'tx_created_admin', v_admin_email, new.note);
    return new;
  end if;

  if new.event_type = 'status_changed' then
    case new.new_status
      when 'partial_paid' then
        perform public.dpt_queue_email(v_tx.id, 'partial_paid_buyer', v_tx.buyer_email, new.note);
        perform public.dpt_queue_email(v_tx.id, 'partial_paid_seller', v_tx.seller_email, new.note);
        perform public.dpt_queue_email(v_tx.id, 'partial_paid_admin', v_admin_email, new.note);

      when 'paid' then
        perform public.dpt_queue_email(v_tx.id, 'payment_received_buyer', v_tx.buyer_email, new.note);
        perform public.dpt_queue_email(v_tx.id, 'payment_received_seller', v_tx.seller_email, new.note);

      when 'shipped' then
        perform public.dpt_queue_email(v_tx.id, 'shipped_buyer', v_tx.buyer_email, new.note);

      when 'delivered' then
        perform public.dpt_queue_email(v_tx.id, 'delivered_buyer', v_tx.buyer_email, new.note);
        perform public.dpt_queue_email(v_tx.id, 'delivered_seller', v_tx.seller_email, new.note);

      when 'completed', 'auto_completed' then
        perform public.dpt_queue_email(v_tx.id, 'completed_buyer', v_tx.buyer_email, new.note);
        perform public.dpt_queue_email(v_tx.id, 'completed_seller', v_tx.seller_email, new.note);

      when 'disputed' then
        perform public.dpt_queue_email(v_tx.id, 'dispute_opened_buyer', v_tx.buyer_email, new.note);
        perform public.dpt_queue_email(v_tx.id, 'dispute_opened_seller', v_tx.seller_email, new.note);
        perform public.dpt_queue_email(v_tx.id, 'dispute_opened_admin', v_admin_email, new.note);

      when 'hold' then
        perform public.dpt_queue_email(v_tx.id, 'hold_set_buyer', v_tx.buyer_email, new.note);
        perform public.dpt_queue_email(v_tx.id, 'hold_set_seller', v_tx.seller_email, new.note);

      when 'refunded' then
        perform public.dpt_queue_email(v_tx.id, 'refunded_buyer', v_tx.buyer_email, new.note);
        perform public.dpt_queue_email(v_tx.id, 'refunded_seller', v_tx.seller_email, new.note);

      when 'payout_sent', 'payout_confirmed' then
        perform public.dpt_queue_email(v_tx.id, 'payout_seller', v_tx.seller_email, new.note);
        perform public.dpt_queue_email(v_tx.id, 'payout_admin', v_admin_email, new.note);

      else
        null;
    end case;
  end if;

  return new;
end;
$$;

revoke all on function public.dpt_enqueue_transaction_emails() from public;
grant execute on function public.dpt_enqueue_transaction_emails() to authenticated, service_role;

drop trigger if exists trg_dpt_enqueue_transaction_emails on public.dpt_transaction_events;
create trigger trg_dpt_enqueue_transaction_emails
after insert on public.dpt_transaction_events
for each row
execute function public.dpt_enqueue_transaction_emails();

comment on function public.dpt_enqueue_transaction_emails()
  is 'Auto-queues recipient emails when transaction events/status changes are inserted (incl. partial_paid).';
