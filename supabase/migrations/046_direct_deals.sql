-- Direct deals ("Depozitka mezi lidmi")
-- Canonical schema lives in depozitka-core migrations.

-- =========================
-- MARKETPLACE SEED (direct)
-- =========================
-- We reuse the existing transactions engine. Direct deals create escrow transactions under this marketplace.
insert into public.dpt_marketplaces (code, name, active)
values ('depozitka-direct', 'Depozitka (Direct deals)', true)
on conflict (code) do nothing;

-- =========================
-- ENUM-LIKE CHECKS
-- =========================
-- (Using text + CHECK for flexibility, consistent with support tickets approach.)

-- =========================
-- TABLES
-- =========================
create table if not exists public.dpt_direct_deals (
  id uuid primary key default gen_random_uuid(),
  deal_no bigint generated always as identity,

  status text not null default 'draft',
  -- who initiated the deal (affects mapping into buyer/seller when escrow transaction is created)
  initiator_role text not null,

  initiator_name text not null,
  initiator_email text not null,
  counterparty_name text,
  counterparty_email text not null,

  -- public links
  public_token uuid not null default gen_random_uuid(),
  edit_token uuid not null default gen_random_uuid(),

  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint dpt_direct_deals_status_chk check (status in ('draft','pending','accepted','rejected','cancelled')),
  constraint dpt_direct_deals_initiator_role_chk check (initiator_role in ('buyer','seller'))
);

create unique index if not exists idx_dpt_direct_deals_deal_no on public.dpt_direct_deals(deal_no);
create unique index if not exists idx_dpt_direct_deals_public_token on public.dpt_direct_deals(public_token);
create unique index if not exists idx_dpt_direct_deals_edit_token on public.dpt_direct_deals(edit_token);
create index if not exists idx_dpt_direct_deals_created_at on public.dpt_direct_deals(created_at desc);
create index if not exists idx_dpt_direct_deals_counterparty_email on public.dpt_direct_deals(lower(counterparty_email));

create table if not exists public.dpt_direct_deal_versions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.dpt_direct_deals(id) on delete cascade,
  version_no int not null,
  status text not null default 'draft',

  subject text not null,
  message text,

  amount_czk numeric(12,2) not null check (amount_czk > 0),

  -- Always shipping (no pickup/cash); carrier is required.
  shipping_carrier text not null,

  -- anti-abuse / auditing
  ip_hash text,
  user_agent text,

  -- once accepted, we create an escrow transaction and link it here
  transaction_id uuid references public.dpt_transactions(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint dpt_direct_deal_versions_status_chk check (status in ('draft','pending_otp','pending_response','accepted','rejected','superseded','cancelled')),
  constraint dpt_direct_deal_versions_unique_per_deal unique (deal_id, version_no)
);

create index if not exists idx_dpt_direct_deal_versions_deal_id on public.dpt_direct_deal_versions(deal_id, version_no desc);
create index if not exists idx_dpt_direct_deal_versions_status on public.dpt_direct_deal_versions(status);

create table if not exists public.dpt_direct_deal_otps (
  id uuid primary key default gen_random_uuid(),
  deal_version_id uuid not null references public.dpt_direct_deal_versions(id) on delete cascade,

  otp_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  consumed_at timestamptz,

  created_at timestamptz not null default now(),

  constraint dpt_direct_deal_otps_attempts_chk check (attempts >= 0)
);

create index if not exists idx_dpt_direct_deal_otps_version_id on public.dpt_direct_deal_otps(deal_version_id);
create index if not exists idx_dpt_direct_deal_otps_expires_at on public.dpt_direct_deal_otps(expires_at);

-- =========================
-- TRIGGERS
-- =========================

drop trigger if exists trg_dpt_direct_deals_updated_at on public.dpt_direct_deals;
create trigger trg_dpt_direct_deals_updated_at
before update on public.dpt_direct_deals
for each row execute function public.dpt_set_updated_at();

drop trigger if exists trg_dpt_direct_deal_versions_updated_at on public.dpt_direct_deal_versions;
create trigger trg_dpt_direct_deal_versions_updated_at
before update on public.dpt_direct_deal_versions
for each row execute function public.dpt_set_updated_at();

-- =========================
-- RLS
-- =========================

alter table public.dpt_direct_deals enable row level security;
alter table public.dpt_direct_deal_versions enable row level security;
alter table public.dpt_direct_deal_otps enable row level security;

-- Admin UI access (service role bypasses RLS)
drop policy if exists "dpt_direct_deals_admin_select" on public.dpt_direct_deals;
create policy "dpt_direct_deals_admin_select"
on public.dpt_direct_deals
for select
using (public.dpt_is_admin());

drop policy if exists "dpt_direct_deals_admin_update" on public.dpt_direct_deals;
create policy "dpt_direct_deals_admin_update"
on public.dpt_direct_deals
for update
using (public.dpt_is_admin())
with check (public.dpt_is_admin());

drop policy if exists "dpt_direct_deal_versions_admin_select" on public.dpt_direct_deal_versions;
create policy "dpt_direct_deal_versions_admin_select"
on public.dpt_direct_deal_versions
for select
using (public.dpt_is_admin());

drop policy if exists "dpt_direct_deal_otps_admin_select" on public.dpt_direct_deal_otps;
create policy "dpt_direct_deal_otps_admin_select"
on public.dpt_direct_deal_otps
for select
using (public.dpt_is_admin());
