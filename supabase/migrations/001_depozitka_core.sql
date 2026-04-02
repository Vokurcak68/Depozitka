-- Depozitka Core - Supabase schema (v1)
-- Safe to run repeatedly: uses IF NOT EXISTS guards where possible.

-- =========================
-- EXTENSIONS
-- =========================
create extension if not exists pgcrypto;

-- =========================
-- ENUMS
-- =========================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'dpt_user_role') then
    create type public.dpt_user_role as enum ('admin', 'support', 'buyer', 'seller', 'service');
  end if;

  if not exists (select 1 from pg_type where typname = 'dpt_tx_status') then
    create type public.dpt_tx_status as enum (
      'created',
      'partial_paid',
      'paid',
      'shipped',
      'delivered',
      'completed',
      'auto_completed',
      'disputed',
      'hold',
      'refunded',
      'cancelled',
      'payout_sent',
      'payout_confirmed'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'dpt_payment_method') then
    create type public.dpt_payment_method as enum ('escrow', 'bank_transfer', 'cash_on_delivery', 'cash');
  end if;

  if not exists (select 1 from pg_type where typname = 'dpt_event_type') then
    create type public.dpt_event_type as enum (
      'transaction_created',
      'status_changed',
      'payment_received',
      'shipment_added',
      'delivery_confirmed',
      'dispute_opened',
      'dispute_resolved',
      'hold_set',
      'hold_released',
      'refund_created',
      'payout_created',
      'payout_confirmed',
      'email_sent',
      'webhook_sent',
      'note_added'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'dpt_dispute_result') then
    create type public.dpt_dispute_result as enum ('pending', 'seller_wins', 'buyer_wins', 'split_refund', 'cancelled');
  end if;

  if not exists (select 1 from pg_type where typname = 'dpt_payout_status') then
    create type public.dpt_payout_status as enum ('pending', 'sent', 'confirmed', 'failed', 'cancelled');
  end if;

  if not exists (select 1 from pg_type where typname = 'dpt_refund_status') then
    create type public.dpt_refund_status as enum ('pending', 'sent', 'confirmed', 'failed', 'cancelled');
  end if;

  if not exists (select 1 from pg_type where typname = 'dpt_email_status') then
    create type public.dpt_email_status as enum ('queued', 'sent', 'failed', 'skipped');
  end if;

  if not exists (select 1 from pg_type where typname = 'dpt_webhook_status') then
    create type public.dpt_webhook_status as enum ('queued', 'sent', 'failed', 'retrying', 'dead');
  end if;
end
$$;

-- =========================
-- COMMON TRIGGERS
-- =========================
create or replace function public.dpt_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================
-- LOOKUP / CISELNIKY
-- =========================
create table if not exists public.dpt_status_catalog (
  code public.dpt_tx_status primary key,
  label text not null,
  description text,
  is_terminal boolean not null default false,
  sort_order int not null,
  created_at timestamptz not null default now()
);

insert into public.dpt_status_catalog (code, label, description, is_terminal, sort_order)
values
  ('created', 'Vytvořeno', 'Transakce byla založena', false, 10),
  ('partial_paid', 'Částečně zaplaceno', 'Byla připsána část platby', false, 20),
  ('paid', 'Zaplaceno', 'Platba je kompletně uhrazena', false, 30),
  ('shipped', 'Odesláno', 'Prodávající odeslal zásilku', false, 40),
  ('delivered', 'Doručeno', 'Zásilka doručena kupujícímu', false, 50),
  ('completed', 'Dokončeno', 'Kupující potvrdil dokončení', true, 60),
  ('auto_completed', 'Auto dokončeno', 'Dokončeno automaticky po lhůtě', true, 70),
  ('disputed', 'Spor', 'Byl otevřen spor', false, 80),
  ('hold', 'Hold', 'Transakce pozastavena administrátorem', false, 90),
  ('refunded', 'Refundováno', 'Platba vrácena kupujícímu', true, 100),
  ('cancelled', 'Zrušeno', 'Transakce zrušena', true, 110),
  ('payout_sent', 'Výplata odeslána', 'Výplata byla iniciována', false, 120),
  ('payout_confirmed', 'Výplata potvrzena', 'Výplata byla potvrzena', true, 130)
on conflict (code) do nothing;

create table if not exists public.dpt_status_transitions (
  id uuid primary key default gen_random_uuid(),
  from_status public.dpt_tx_status not null,
  to_status public.dpt_tx_status not null,
  allowed_actor_role public.dpt_user_role not null default 'admin',
  reason_required boolean not null default false,
  created_at timestamptz not null default now(),
  unique (from_status, to_status, allowed_actor_role)
);

insert into public.dpt_status_transitions (from_status, to_status, allowed_actor_role, reason_required)
values
  ('created', 'partial_paid', 'service', false),
  ('created', 'paid', 'service', false),
  ('created', 'cancelled', 'admin', true),
  ('partial_paid', 'paid', 'service', false),
  ('partial_paid', 'cancelled', 'admin', true),
  ('paid', 'shipped', 'seller', false),
  ('paid', 'disputed', 'buyer', true),
  ('paid', 'disputed', 'seller', true),
  ('paid', 'hold', 'admin', true),
  ('paid', 'refunded', 'admin', true),
  ('shipped', 'delivered', 'service', false),
  ('shipped', 'disputed', 'buyer', true),
  ('shipped', 'hold', 'admin', true),
  ('delivered', 'completed', 'buyer', false),
  ('delivered', 'auto_completed', 'service', false),
  ('delivered', 'disputed', 'buyer', true),
  ('delivered', 'hold', 'admin', true),
  ('disputed', 'hold', 'admin', true),
  ('disputed', 'refunded', 'admin', true),
  ('disputed', 'payout_sent', 'admin', false),
  ('disputed', 'cancelled', 'admin', true),
  ('hold', 'disputed', 'admin', true),
  ('hold', 'refunded', 'admin', true),
  ('hold', 'payout_sent', 'admin', false),
  ('hold', 'cancelled', 'admin', true),
  ('payout_sent', 'payout_confirmed', 'service', false)
on conflict (from_status, to_status, allowed_actor_role) do nothing;

create table if not exists public.dpt_email_template_catalog (
  key text primary key,
  title text not null,
  description text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.dpt_email_template_catalog (key, title, description)
values
  ('tx_created_buyer', 'Transakce vytvořena (kupující)', 'Potvrzení založení transakce kupujícímu'),
  ('tx_created_seller', 'Nová transakce (prodávající)', 'Informace prodávajícímu o nové transakci'),
  ('tx_created_admin', 'Nová transakce (admin)', 'Notifikace adminovi o nové transakci'),
  ('payment_received_buyer', 'Platba přijata (kupující)', 'Potvrzení přijetí platby'),
  ('payment_received_seller', 'Platba přijata (prodávající)', 'Informace prodávajícímu o zaplacení'),
  ('shipped_buyer', 'Zboží odesláno', 'Prodávající odeslal zásilku'),
  ('delivered_buyer', 'Zboží doručeno (kupující)', 'Informace o doručení'),
  ('delivered_seller', 'Zboží doručeno (prodávající)', 'Informace o doručení'),
  ('completed_buyer', 'Transakce dokončena (kupující)', 'Dokončení transakce'),
  ('completed_seller', 'Transakce dokončena (prodávající)', 'Dokončení transakce'),
  ('dispute_opened_buyer', 'Otevřen spor (kupující)', 'Spor byl otevřen'),
  ('dispute_opened_seller', 'Otevřen spor (prodávající)', 'Spor byl otevřen'),
  ('dispute_opened_admin', 'Nový spor (admin)', 'Spor čeká na řešení'),
  ('hold_set_buyer', 'Transakce na hold (kupující)', 'Transakce byla pozastavena'),
  ('hold_set_seller', 'Transakce na hold (prodávající)', 'Transakce byla pozastavena'),
  ('refunded_buyer', 'Vrácení platby (kupující)', 'Platba byla refundována'),
  ('refunded_seller', 'Vrácení platby (prodávající)', 'Kupujícímu byla vrácena platba'),
  ('payout_seller', 'Výplata prodávajícímu', 'Výplata byla zpracována'),
  ('payout_admin', 'Výplata zpracována (admin)', 'Admin notifikace výplaty')
on conflict (key) do nothing;

-- =========================
-- CORE TABLES
-- =========================
create table if not exists public.dpt_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  role public.dpt_user_role not null default 'buyer',
  full_name text not null,
  email text not null unique,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_dpt_profiles_updated_at
before update on public.dpt_profiles
for each row
execute function public.dpt_set_updated_at();

create table if not exists public.dpt_marketplaces (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  api_key_hash text,
  webhook_secret_hash text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_dpt_marketplaces_updated_at
before update on public.dpt_marketplaces
for each row
execute function public.dpt_set_updated_at();

create table if not exists public.dpt_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_code text not null unique,
  marketplace_id uuid not null references public.dpt_marketplaces(id) on delete restrict,
  external_order_id text not null,
  listing_id text,
  listing_title text,
  payment_method public.dpt_payment_method not null default 'escrow',

  buyer_profile_id uuid references public.dpt_profiles(id) on delete set null,
  seller_profile_id uuid references public.dpt_profiles(id) on delete set null,
  buyer_name text not null,
  buyer_email text not null,
  seller_name text not null,
  seller_email text not null,

  amount_czk numeric(12,2) not null check (amount_czk > 0),
  fee_percent numeric(5,2) not null default 5.00 check (fee_percent >= 0 and fee_percent <= 100),
  fee_amount_czk numeric(12,2) not null check (fee_amount_czk >= 0),
  payout_amount_czk numeric(12,2) not null check (payout_amount_czk >= 0),

  status public.dpt_tx_status not null default 'created',
  hold_reason text,
  dispute_reason text,

  shipping_carrier text,
  shipping_tracking_number text,
  shipping_tracking_url text,

  payment_reference text,
  bank_tx_id text,

  shipping_reminder_sent boolean not null default false,
  delivery_reminder_sent boolean not null default false,
  delivery_final_warning_sent boolean not null default false,

  payment_due_at timestamptz,
  ship_due_at timestamptz,
  delivery_confirm_due_at timestamptz,
  auto_complete_at timestamptz,

  paid_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  refunded_at timestamptz,

  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (marketplace_id, external_order_id)
);

create index if not exists idx_dpt_transactions_status on public.dpt_transactions(status);
create index if not exists idx_dpt_transactions_created_at on public.dpt_transactions(created_at desc);
create index if not exists idx_dpt_transactions_buyer_email on public.dpt_transactions(lower(buyer_email));
create index if not exists idx_dpt_transactions_seller_email on public.dpt_transactions(lower(seller_email));
create index if not exists idx_dpt_transactions_marketplace on public.dpt_transactions(marketplace_id);

create trigger trg_dpt_transactions_updated_at
before update on public.dpt_transactions
for each row
execute function public.dpt_set_updated_at();

create table if not exists public.dpt_transaction_addresses (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.dpt_transactions(id) on delete cascade,
  recipient_name text not null,
  phone text,
  street text,
  city text not null,
  postal_code text,
  country text not null default 'CZ',
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_dpt_transaction_addresses_tx on public.dpt_transaction_addresses(transaction_id);

create table if not exists public.dpt_transaction_events (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.dpt_transactions(id) on delete cascade,
  event_type public.dpt_event_type not null,
  actor_profile_id uuid references public.dpt_profiles(id) on delete set null,
  actor_role public.dpt_user_role,
  actor_email text,
  old_status public.dpt_tx_status,
  new_status public.dpt_tx_status,
  note text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_dpt_tx_events_tx on public.dpt_transaction_events(transaction_id, created_at desc);

create table if not exists public.dpt_disputes (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null unique references public.dpt_transactions(id) on delete cascade,
  opened_by_profile_id uuid references public.dpt_profiles(id) on delete set null,
  opened_by_role public.dpt_user_role,
  reason text not null,
  details text,
  result public.dpt_dispute_result not null default 'pending',
  resolved_by_profile_id uuid references public.dpt_profiles(id) on delete set null,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_dpt_disputes_updated_at
before update on public.dpt_disputes
for each row
execute function public.dpt_set_updated_at();

create table if not exists public.dpt_holds (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.dpt_transactions(id) on delete cascade,
  reason text not null,
  set_by_profile_id uuid references public.dpt_profiles(id) on delete set null,
  active boolean not null default true,
  released_at timestamptz,
  released_by_profile_id uuid references public.dpt_profiles(id) on delete set null,
  release_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_dpt_holds_tx on public.dpt_holds(transaction_id, active);

create trigger trg_dpt_holds_updated_at
before update on public.dpt_holds
for each row
execute function public.dpt_set_updated_at();

create table if not exists public.dpt_payouts (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.dpt_transactions(id) on delete cascade,
  seller_profile_id uuid references public.dpt_profiles(id) on delete set null,
  amount_czk numeric(12,2) not null check (amount_czk > 0),
  status public.dpt_payout_status not null default 'pending',
  external_provider text,
  external_reference text,
  sent_at timestamptz,
  confirmed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_dpt_payouts_tx on public.dpt_payouts(transaction_id);

create trigger trg_dpt_payouts_updated_at
before update on public.dpt_payouts
for each row
execute function public.dpt_set_updated_at();

create table if not exists public.dpt_refunds (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.dpt_transactions(id) on delete cascade,
  amount_czk numeric(12,2) not null check (amount_czk > 0),
  status public.dpt_refund_status not null default 'pending',
  reason text,
  external_provider text,
  external_reference text,
  sent_at timestamptz,
  confirmed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_dpt_refunds_tx on public.dpt_refunds(transaction_id);

create trigger trg_dpt_refunds_updated_at
before update on public.dpt_refunds
for each row
execute function public.dpt_set_updated_at();

create table if not exists public.dpt_email_logs (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid references public.dpt_transactions(id) on delete set null,
  template_key text not null references public.dpt_email_template_catalog(key) on delete restrict,
  to_email text not null,
  subject text not null,
  body_preview text,
  provider text,
  provider_message_id text,
  status public.dpt_email_status not null default 'queued',
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists idx_dpt_email_logs_tx on public.dpt_email_logs(transaction_id, created_at desc);
create index if not exists idx_dpt_email_logs_to on public.dpt_email_logs(lower(to_email));

create table if not exists public.dpt_webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  marketplace_id uuid not null references public.dpt_marketplaces(id) on delete cascade,
  target_url text not null,
  secret_hash text,
  active boolean not null default true,
  events text[] not null default array['transaction.created','transaction.updated','transaction.disputed'],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_dpt_webhook_subscriptions_updated_at
before update on public.dpt_webhook_subscriptions
for each row
execute function public.dpt_set_updated_at();

create table if not exists public.dpt_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.dpt_webhook_subscriptions(id) on delete set null,
  transaction_id uuid references public.dpt_transactions(id) on delete set null,
  event_name text not null,
  request_payload jsonb not null default '{}'::jsonb,
  response_status int,
  response_body text,
  attempt int not null default 1,
  status public.dpt_webhook_status not null default 'queued',
  next_retry_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists idx_dpt_webhook_deliveries_tx on public.dpt_webhook_deliveries(transaction_id, created_at desc);
create index if not exists idx_dpt_webhook_deliveries_status on public.dpt_webhook_deliveries(status, next_retry_at);

create table if not exists public.dpt_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by_profile_id uuid references public.dpt_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_dpt_settings_updated_at
before update on public.dpt_settings
for each row
execute function public.dpt_set_updated_at();

insert into public.dpt_settings(key, value, description)
values
  ('fees', '{"percent":5,"minCzk":15}'::jsonb, 'Základní poplatky escrow'),
  ('deadlines', '{"paymentHours":24,"shipDays":5,"confirmDays":7,"autoCompleteDays":14}'::jsonb, 'Lhůty pro stavy transakce'),
  ('emails', '{"from":"info@depozitka.cz","replyTo":"info@depozitka.cz"}'::jsonb, 'Nastavení emailů'),
  ('sandbox', '{"enabled":true}'::jsonb, 'Test/sandbox mód')
on conflict (key) do nothing;

-- =========================
-- STATUS TRANSITION VALIDATION
-- =========================
create or replace function public.dpt_validate_status_transition()
returns trigger
language plpgsql
as $$
declare
  v_allowed boolean;
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    select exists (
      select 1
      from public.dpt_status_transitions st
      where st.from_status = old.status
        and st.to_status = new.status
    ) into v_allowed;

    if not v_allowed then
      raise exception 'Nepovolený přechod stavu: % -> %', old.status, new.status;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_dpt_validate_status_transition on public.dpt_transactions;
create trigger trg_dpt_validate_status_transition
before update on public.dpt_transactions
for each row
execute function public.dpt_validate_status_transition();

-- =========================
-- HELPERS
-- =========================
create or replace function public.dpt_generate_transaction_code()
returns text
language plpgsql
as $$
declare
  v_code text;
begin
  v_code := format('DPT-%s-%s', to_char(now(), 'YYYY'), lpad((floor(random()*1000000))::int::text, 6, '0'));
  return v_code;
end;
$$;

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
begin
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
    v_tx.id, 'transaction_created', 'service', null, null, 'created', 'Transaction created via API'
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

-- =========================
-- RLS
-- =========================
alter table public.dpt_profiles enable row level security;
alter table public.dpt_marketplaces enable row level security;
alter table public.dpt_transactions enable row level security;
alter table public.dpt_transaction_addresses enable row level security;
alter table public.dpt_transaction_events enable row level security;
alter table public.dpt_disputes enable row level security;
alter table public.dpt_holds enable row level security;
alter table public.dpt_payouts enable row level security;
alter table public.dpt_refunds enable row level security;
alter table public.dpt_email_logs enable row level security;
alter table public.dpt_webhook_subscriptions enable row level security;
alter table public.dpt_webhook_deliveries enable row level security;
alter table public.dpt_settings enable row level security;
alter table public.dpt_status_catalog enable row level security;
alter table public.dpt_status_transitions enable row level security;
alter table public.dpt_email_template_catalog enable row level security;

create or replace function public.dpt_current_role()
returns public.dpt_user_role
language sql
stable
as $$
  select p.role
  from public.dpt_profiles p
  where p.auth_user_id = auth.uid()
  limit 1;
$$;

create or replace function public.dpt_is_admin()
returns boolean
language sql
stable
as $$
  select public.dpt_current_role() in ('admin','support');
$$;

-- profiles
create policy "dpt_profiles_select_own_or_admin"
on public.dpt_profiles
for select
using (auth.uid() = auth_user_id or public.dpt_is_admin());

create policy "dpt_profiles_update_own_or_admin"
on public.dpt_profiles
for update
using (auth.uid() = auth_user_id or public.dpt_is_admin())
with check (auth.uid() = auth_user_id or public.dpt_is_admin());

create policy "dpt_profiles_insert_admin"
on public.dpt_profiles
for insert
with check (public.dpt_is_admin());

-- read-only catalogs for authenticated users
create policy "dpt_status_catalog_read"
on public.dpt_status_catalog
for select
using (auth.role() = 'authenticated');

create policy "dpt_status_transitions_read"
on public.dpt_status_transitions
for select
using (auth.role() = 'authenticated');

create policy "dpt_email_template_catalog_read"
on public.dpt_email_template_catalog
for select
using (auth.role() = 'authenticated');

-- transactions: buyer/seller/admin visibility
create policy "dpt_transactions_select_participant_or_admin"
on public.dpt_transactions
for select
using (
  public.dpt_is_admin()
  or lower(buyer_email) = lower(coalesce((select email from public.dpt_profiles where auth_user_id = auth.uid()), ''))
  or lower(seller_email) = lower(coalesce((select email from public.dpt_profiles where auth_user_id = auth.uid()), ''))
);

create policy "dpt_transactions_insert_admin_or_service"
on public.dpt_transactions
for insert
with check (public.dpt_is_admin() or auth.role() = 'service_role');

create policy "dpt_transactions_update_admin_or_service"
on public.dpt_transactions
for update
using (public.dpt_is_admin() or auth.role() = 'service_role')
with check (public.dpt_is_admin() or auth.role() = 'service_role');

-- child tables follow transaction visibility
create policy "dpt_events_select_participant_or_admin"
on public.dpt_transaction_events
for select
using (
  public.dpt_is_admin()
  or exists (
    select 1 from public.dpt_transactions t
    where t.id = transaction_id
      and (
        lower(t.buyer_email) = lower(coalesce((select email from public.dpt_profiles where auth_user_id = auth.uid()), ''))
        or lower(t.seller_email) = lower(coalesce((select email from public.dpt_profiles where auth_user_id = auth.uid()), ''))
      )
  )
);

create policy "dpt_events_insert_admin_or_service"
on public.dpt_transaction_events
for insert
with check (public.dpt_is_admin() or auth.role() = 'service_role');

create policy "dpt_email_logs_select_admin_only"
on public.dpt_email_logs
for select
using (public.dpt_is_admin());

create policy "dpt_email_logs_write_admin_or_service"
on public.dpt_email_logs
for all
using (public.dpt_is_admin() or auth.role() = 'service_role')
with check (public.dpt_is_admin() or auth.role() = 'service_role');

create policy "dpt_disputes_select_participant_or_admin"
on public.dpt_disputes
for select
using (
  public.dpt_is_admin()
  or exists (
    select 1 from public.dpt_transactions t
    where t.id = transaction_id
      and (
        lower(t.buyer_email) = lower(coalesce((select email from public.dpt_profiles where auth_user_id = auth.uid()), ''))
        or lower(t.seller_email) = lower(coalesce((select email from public.dpt_profiles where auth_user_id = auth.uid()), ''))
      )
  )
);

create policy "dpt_disputes_write_admin_or_service"
on public.dpt_disputes
for all
using (public.dpt_is_admin() or auth.role() = 'service_role')
with check (public.dpt_is_admin() or auth.role() = 'service_role');

create policy "dpt_holds_select_admin_only"
on public.dpt_holds
for select
using (public.dpt_is_admin());

create policy "dpt_holds_write_admin_or_service"
on public.dpt_holds
for all
using (public.dpt_is_admin() or auth.role() = 'service_role')
with check (public.dpt_is_admin() or auth.role() = 'service_role');

create policy "dpt_payouts_select_admin_only"
on public.dpt_payouts
for select
using (public.dpt_is_admin());

create policy "dpt_payouts_write_admin_or_service"
on public.dpt_payouts
for all
using (public.dpt_is_admin() or auth.role() = 'service_role')
with check (public.dpt_is_admin() or auth.role() = 'service_role');

create policy "dpt_refunds_select_admin_only"
on public.dpt_refunds
for select
using (public.dpt_is_admin());

create policy "dpt_refunds_write_admin_or_service"
on public.dpt_refunds
for all
using (public.dpt_is_admin() or auth.role() = 'service_role')
with check (public.dpt_is_admin() or auth.role() = 'service_role');

create policy "dpt_addresses_select_participant_or_admin"
on public.dpt_transaction_addresses
for select
using (
  public.dpt_is_admin()
  or exists (
    select 1 from public.dpt_transactions t
    where t.id = transaction_id
      and (
        lower(t.buyer_email) = lower(coalesce((select email from public.dpt_profiles where auth_user_id = auth.uid()), ''))
        or lower(t.seller_email) = lower(coalesce((select email from public.dpt_profiles where auth_user_id = auth.uid()), ''))
      )
  )
);

create policy "dpt_addresses_write_admin_or_service"
on public.dpt_transaction_addresses
for all
using (public.dpt_is_admin() or auth.role() = 'service_role')
with check (public.dpt_is_admin() or auth.role() = 'service_role');

create policy "dpt_marketplaces_admin_only"
on public.dpt_marketplaces
for all
using (public.dpt_is_admin())
with check (public.dpt_is_admin());

create policy "dpt_webhook_subscriptions_admin_only"
on public.dpt_webhook_subscriptions
for all
using (public.dpt_is_admin())
with check (public.dpt_is_admin());

create policy "dpt_webhook_deliveries_admin_only"
on public.dpt_webhook_deliveries
for all
using (public.dpt_is_admin())
with check (public.dpt_is_admin());

create policy "dpt_settings_admin_only"
on public.dpt_settings
for all
using (public.dpt_is_admin())
with check (public.dpt_is_admin());

-- =========================
-- SEED MARKETPLACE (test)
-- =========================
insert into public.dpt_marketplaces (code, name, active)
values ('depozitka-test-bazar', 'Depozitka Test Bazar', true)
on conflict (code) do nothing;
