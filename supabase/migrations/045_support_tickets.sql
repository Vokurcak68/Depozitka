-- Support tickets (public intake via engine API) + attachments
-- Canonical schema lives in depozitka-core migrations.

-- =========================
-- TABLES
-- =========================
create table if not exists public.dpt_support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_no bigint generated always as identity,
  status text not null default 'draft',

  email text,
  name text,
  category text,
  subject text,
  message text,
  page_url text,
  transaction_ref text,

  ip_hash text,
  user_agent text,

  -- protects the attachment upload URL endpoint from abuse after the initial Turnstile check
  upload_token_hash text,
  upload_token_expires_at timestamptz,

  submitted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint dpt_support_tickets_status_chk check (status in ('draft','open','closed','spam'))
);

create unique index if not exists idx_dpt_support_tickets_ticket_no on public.dpt_support_tickets(ticket_no);
create index if not exists idx_dpt_support_tickets_created_at on public.dpt_support_tickets(created_at desc);
create index if not exists idx_dpt_support_tickets_ip_hash_created_at on public.dpt_support_tickets(ip_hash, created_at desc);

create table if not exists public.dpt_support_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.dpt_support_tickets(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  content_type text,
  file_size bigint,
  created_at timestamptz not null default now()
);

create index if not exists idx_dpt_support_attachments_ticket_id on public.dpt_support_attachments(ticket_id);

-- =========================
-- TRIGGERS
-- =========================

drop trigger if exists trg_dpt_support_tickets_updated_at on public.dpt_support_tickets;
create trigger trg_dpt_support_tickets_updated_at
before update on public.dpt_support_tickets
for each row execute function public.dpt_set_updated_at();

-- =========================
-- RLS
-- =========================

alter table public.dpt_support_tickets enable row level security;
alter table public.dpt_support_attachments enable row level security;

-- Admin/support UI access
-- NOTE: Service role bypasses RLS (engine writes via SUPABASE_SERVICE_ROLE_KEY).
drop policy if exists "dpt_support_tickets_admin_select" on public.dpt_support_tickets;
create policy "dpt_support_tickets_admin_select"
on public.dpt_support_tickets
for select
using (public.dpt_is_admin());

drop policy if exists "dpt_support_tickets_admin_update" on public.dpt_support_tickets;
create policy "dpt_support_tickets_admin_update"
on public.dpt_support_tickets
for update
using (public.dpt_is_admin())
with check (public.dpt_is_admin());

drop policy if exists "dpt_support_attachments_admin_select" on public.dpt_support_attachments;
create policy "dpt_support_attachments_admin_select"
on public.dpt_support_attachments
for select
using (public.dpt_is_admin());

-- =========================
-- STORAGE
-- =========================

-- Storage bucket for attachments (private)
insert into storage.buckets (id, name, public)
values ('dpt-support-attachments', 'dpt-support-attachments', false)
on conflict (id) do nothing;

-- Allow admin/support users to read storage objects metadata so they can create signed URLs client-side.
-- (Uploading is done via signed upload URLs issued by engine service-role.)
drop policy if exists "dpt_support_attachments_storage_admin_read" on storage.objects;
create policy "dpt_support_attachments_storage_admin_read"
on storage.objects
for select
using (
  bucket_id = 'dpt-support-attachments'
  and public.dpt_is_admin()
);
