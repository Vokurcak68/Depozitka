-- Deals V2 (robust "Bezpečná platba mezi lidmi")
-- Canonical schema lives in depozitka-core migrations.

-- =========================
-- ENUM-LIKE CHECKS
-- =========================
-- (Using text + CHECK for flexibility.)

-- =========================
-- DEALS
-- =========================
create table if not exists public.dpt_deals (
  id uuid primary key default gen_random_uuid(),
  deal_no bigint generated always as identity,

  status text not null default 'draft',
  initiator_role text not null,

  initiator_email text not null,
  initiator_phone text,
  counterparty_email text not null,
  counterparty_phone text,

  title text not null,
  description text,

  total_amount_czk numeric(12,2) not null check (total_amount_czk > 0),

  external_url text,
  external_snapshot jsonb,
  external_image_storage_path text,

  -- public view token (no login); only hash stored in DB
  view_token_hash text not null,
  view_token_expires_at timestamptz not null,

  -- deal expiry (e.g. 48h)
  expires_at timestamptz not null,

  -- supersede chain ("update and resend")
  previous_deal_id uuid references public.dpt_deals(id) on delete set null,
  superseded_at timestamptz,

  -- once accepted, we create an escrow transaction and link it here
  transaction_id uuid references public.dpt_transactions(id) on delete set null,

  -- anti-abuse / auditing
  ip_hash text,
  user_agent text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint dpt_deals_status_chk check (status in (
    'draft','sent','accepted','rejected','expired','cancelled','superseded'
  )),
  constraint dpt_deals_initiator_role_chk check (initiator_role in ('buyer','seller'))
);

create unique index if not exists idx_dpt_deals_deal_no on public.dpt_deals(deal_no);
create index if not exists idx_dpt_deals_created_at on public.dpt_deals(created_at desc);
create index if not exists idx_dpt_deals_status on public.dpt_deals(status);
create index if not exists idx_dpt_deals_counterparty_email on public.dpt_deals(lower(counterparty_email));
create index if not exists idx_dpt_deals_initiator_email on public.dpt_deals(lower(initiator_email));
create unique index if not exists idx_dpt_deals_view_token_hash on public.dpt_deals(view_token_hash);

-- updated_at trigger

drop trigger if exists trg_dpt_deals_updated_at on public.dpt_deals;
create trigger trg_dpt_deals_updated_at
before update on public.dpt_deals
for each row execute function public.dpt_set_updated_at();

-- =========================
-- DEAL ATTACHMENTS (snapshot of uploads)
-- =========================
create table if not exists public.dpt_deal_attachments (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.dpt_deals(id) on delete cascade,

  storage_path text not null,
  file_name text not null,
  content_type text not null,
  file_size bigint not null check (file_size > 0),

  created_at timestamptz not null default now()
);

create index if not exists idx_dpt_deal_attachments_deal_id on public.dpt_deal_attachments(deal_id);

-- =========================
-- DEAL OTPS (separate table for logging + reset)
-- =========================
create table if not exists public.dpt_deal_otps (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.dpt_deals(id) on delete cascade,

  target_email text not null,

  otp_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  last_sent_at timestamptz not null,
  consumed_at timestamptz,

  created_at timestamptz not null default now(),

  constraint dpt_deal_otps_attempts_chk check (attempts >= 0)
);

create index if not exists idx_dpt_deal_otps_deal_id on public.dpt_deal_otps(deal_id, created_at desc);
create index if not exists idx_dpt_deal_otps_expires_at on public.dpt_deal_otps(expires_at);

-- =========================
-- TRX linkage for filtering (optional but recommended)
-- =========================
alter table public.dpt_transactions
  add column if not exists source text not null default 'marketplace';

alter table public.dpt_transactions
  add column if not exists deal_id uuid references public.dpt_deals(id) on delete set null;

create index if not exists idx_dpt_transactions_deal_id on public.dpt_transactions(deal_id);

-- =========================
-- RLS
-- =========================
alter table public.dpt_deals enable row level security;
alter table public.dpt_deal_attachments enable row level security;
alter table public.dpt_deal_otps enable row level security;

-- Admin UI access

drop policy if exists "dpt_deals_admin_select" on public.dpt_deals;
create policy "dpt_deals_admin_select"
on public.dpt_deals
for select
using (public.dpt_is_admin());

drop policy if exists "dpt_deals_admin_update" on public.dpt_deals;
create policy "dpt_deals_admin_update"
on public.dpt_deals
for update
using (public.dpt_is_admin())
with check (public.dpt_is_admin());

drop policy if exists "dpt_deal_attachments_admin_select" on public.dpt_deal_attachments;
create policy "dpt_deal_attachments_admin_select"
on public.dpt_deal_attachments
for select
using (public.dpt_is_admin());

drop policy if exists "dpt_deal_otps_admin_select" on public.dpt_deal_otps;
create policy "dpt_deal_otps_admin_select"
on public.dpt_deal_otps
for select
using (public.dpt_is_admin());

-- =========================
-- STORAGE
-- =========================
-- NOTE: upload/download handled via engine with signed URLs (service role).
-- Admin UI needs storage.objects select to create signed URLs client-side.

insert into storage.buckets (id, name, public)
values ('dpt-deal-attachments', 'dpt-deal-attachments', false)
on conflict (id) do nothing;

drop policy if exists "dpt_deal_attachments_storage_admin_read" on storage.objects;
create policy "dpt_deal_attachments_storage_admin_read"
on storage.objects
for select
using (
  bucket_id = 'dpt-deal-attachments'
  and public.dpt_is_admin()
);
