-- Email preparation (v7)
-- Goal: prepare transactional emails for sending by queueing rows into dpt_email_logs.

-- ============================================
-- Email content templates
-- ============================================
create table if not exists public.dpt_email_templates (
  template_key text primary key references public.dpt_email_template_catalog(key) on delete cascade,
  subject_template text not null,
  body_template text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create trigger trg_dpt_email_templates_updated_at
before update on public.dpt_email_templates
for each row
execute function public.dpt_set_updated_at();

alter table public.dpt_email_templates enable row level security;

drop policy if exists "dpt_email_templates_read" on public.dpt_email_templates;
create policy "dpt_email_templates_read"
on public.dpt_email_templates
for select
using (public.dpt_is_authenticated());

drop policy if exists "dpt_email_templates_write_admin" on public.dpt_email_templates;
create policy "dpt_email_templates_write_admin"
on public.dpt_email_templates
for all
using (public.dpt_is_admin())
with check (public.dpt_is_admin());

insert into public.dpt_email_templates (template_key, subject_template, body_template)
values
  ('tx_created_buyer', 'Depozitka: Transakce {{transaction_code}} byla vytvořena', 'Dobrý den {{buyer_name}}, transakce {{transaction_code}} k objednávce {{external_order_id}} byla založena. Částka: {{amount_czk}} Kč.'),
  ('tx_created_seller', 'Depozitka: Nová transakce {{transaction_code}}', 'Dobrý den {{seller_name}}, byla vytvořena transakce {{transaction_code}} pro objednávku {{external_order_id}}. Částka: {{amount_czk}} Kč.'),
  ('tx_created_admin', 'Depozitka: Nová transakce {{transaction_code}}', 'Nová transakce {{transaction_code}} (marketplace: {{marketplace_code}}) byla vytvořena. Částka: {{amount_czk}} Kč.'),
  ('payment_received_buyer', 'Depozitka: Platba přijata ({{transaction_code}})', 'Platba byla přijata. Transakce {{transaction_code}} je nyní ve stavu „Zaplaceno“.'),
  ('payment_received_seller', 'Depozitka: Kupující zaplatil ({{transaction_code}})', 'Kupující zaplatil. Můžete připravit odeslání. Transakce {{transaction_code}}.'),
  ('shipped_buyer', 'Depozitka: Zboží odesláno ({{transaction_code}})', 'Prodávající označil zásilku jako odeslanou. Transakce {{transaction_code}}.'),
  ('delivered_buyer', 'Depozitka: Zásilka doručena ({{transaction_code}})', 'Zásilka byla označena jako doručená. Potvrďte prosím převzetí u transakce {{transaction_code}}.'),
  ('delivered_seller', 'Depozitka: Zásilka doručena ({{transaction_code}})', 'Kupujícímu byla doručena zásilka. Transakce {{transaction_code}}.'),
  ('completed_buyer', 'Depozitka: Transakce dokončena ({{transaction_code}})', 'Transakce {{transaction_code}} byla dokončena.'),
  ('completed_seller', 'Depozitka: Transakce dokončena ({{transaction_code}})', 'Transakce {{transaction_code}} byla dokončena. Výplata bude zpracována dle pravidel.'),
  ('dispute_opened_buyer', 'Depozitka: Otevřen spor ({{transaction_code}})', 'U transakce {{transaction_code}} byl otevřen spor. Brzy se vám ozveme.'),
  ('dispute_opened_seller', 'Depozitka: Otevřen spor ({{transaction_code}})', 'U transakce {{transaction_code}} byl otevřen spor. Brzy se vám ozveme.'),
  ('dispute_opened_admin', 'Depozitka: Nový spor ({{transaction_code}})', 'Byl otevřen spor u transakce {{transaction_code}}. Zkontrolujte admin panel.'),
  ('hold_set_buyer', 'Depozitka: Transakce pozastavena ({{transaction_code}})', 'Transakce {{transaction_code}} byla dočasně pozastavena. Důvod: {{note}}'),
  ('hold_set_seller', 'Depozitka: Transakce pozastavena ({{transaction_code}})', 'Transakce {{transaction_code}} byla dočasně pozastavena. Důvod: {{note}}'),
  ('refunded_buyer', 'Depozitka: Platba vrácena ({{transaction_code}})', 'Kupujícímu byla vrácena platba za transakci {{transaction_code}}.'),
  ('refunded_seller', 'Depozitka: Refundace provedena ({{transaction_code}})', 'U transakce {{transaction_code}} byla provedena refundace kupujícímu.'),
  ('payout_seller', 'Depozitka: Výplata odeslána ({{transaction_code}})', 'Výplata k transakci {{transaction_code}} byla odeslána.'),
  ('payout_admin', 'Depozitka: Výplata zpracována ({{transaction_code}})', 'Výplata k transakci {{transaction_code}} byla zpracována.')
on conflict (template_key) do update
set
  subject_template = excluded.subject_template,
  body_template = excluded.body_template,
  enabled = true,
  updated_at = now();

-- ============================================
-- Helper: render placeholders
-- ============================================
create or replace function public.dpt_render_email_template(
  p_template_key text,
  p_transaction public.dpt_transactions,
  p_note text default null
)
returns table(subject text, body_preview text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subject text;
  v_body text;
  v_marketplace_code text;
begin
  select code into v_marketplace_code
  from public.dpt_marketplaces
  where id = p_transaction.marketplace_id;

  select et.subject_template, et.body_template
    into v_subject, v_body
  from public.dpt_email_templates et
  where et.template_key = p_template_key
    and et.enabled = true
  limit 1;

  if v_subject is null then
    raise exception 'Email template % nenalezena nebo není aktivní', p_template_key;
  end if;

  v_subject := replace(v_subject, '{{transaction_code}}', p_transaction.transaction_code);
  v_subject := replace(v_subject, '{{external_order_id}}', coalesce(p_transaction.external_order_id, ''));

  v_body := replace(v_body, '{{transaction_code}}', p_transaction.transaction_code);
  v_body := replace(v_body, '{{external_order_id}}', coalesce(p_transaction.external_order_id, ''));
  v_body := replace(v_body, '{{buyer_name}}', coalesce(p_transaction.buyer_name, ''));
  v_body := replace(v_body, '{{seller_name}}', coalesce(p_transaction.seller_name, ''));
  v_body := replace(v_body, '{{amount_czk}}', trim(to_char(p_transaction.amount_czk, 'FM999999999990D00')));
  v_body := replace(v_body, '{{marketplace_code}}', coalesce(v_marketplace_code, ''));
  v_body := replace(v_body, '{{note}}', coalesce(p_note, '-'));

  subject := v_subject;
  body_preview := left(v_body, 400);
  return next;
end;
$$;

revoke all on function public.dpt_render_email_template(text, public.dpt_transactions, text) from public;
grant execute on function public.dpt_render_email_template(text, public.dpt_transactions, text) to authenticated, service_role;

-- ============================================
-- Helper: queue single email row
-- ============================================
create or replace function public.dpt_queue_email(
  p_transaction_id uuid,
  p_template_key text,
  p_to_email text,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx public.dpt_transactions;
  v_subject text;
  v_body_preview text;
  v_email_id uuid;
begin
  if p_transaction_id is null then
    raise exception 'p_transaction_id je povinný';
  end if;

  if coalesce(trim(p_template_key), '') = '' then
    raise exception 'p_template_key je povinný';
  end if;

  if coalesce(trim(p_to_email), '') = '' then
    raise exception 'p_to_email je povinný';
  end if;

  select * into v_tx
  from public.dpt_transactions
  where id = p_transaction_id
  limit 1;

  if v_tx.id is null then
    raise exception 'Transakce % neexistuje', p_transaction_id;
  end if;

  select r.subject, r.body_preview
    into v_subject, v_body_preview
  from public.dpt_render_email_template(p_template_key, v_tx, p_note) r;

  insert into public.dpt_email_logs (
    transaction_id,
    template_key,
    to_email,
    subject,
    body_preview,
    status
  ) values (
    p_transaction_id,
    p_template_key,
    lower(trim(p_to_email)),
    v_subject,
    v_body_preview,
    'queued'
  )
  returning id into v_email_id;

  return v_email_id;
end;
$$;

revoke all on function public.dpt_queue_email(uuid, text, text, text) from public;
grant execute on function public.dpt_queue_email(uuid, text, text, text) to authenticated, service_role;

-- ============================================
-- Trigger: auto-queue emails from tx events
-- ============================================
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
        -- no email mapping for this status
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

comment on table public.dpt_email_templates
  is 'Email subject/body templates with placeholders for transactional notifications.';

comment on function public.dpt_queue_email(uuid, text, text, text)
  is 'Queues one email into dpt_email_logs with rendered template placeholders.';

comment on function public.dpt_enqueue_transaction_emails()
  is 'Auto-queues recipient emails when transaction events/status changes are inserted.';

-- End of migration v7
