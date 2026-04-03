-- Security hardening (v6)
-- Webhook signature verification + replay protection (timestamp + nonce).

-- ============================================
-- Nonce guard table
-- ============================================
create table if not exists public.dpt_webhook_nonce_guard (
  id uuid primary key default gen_random_uuid(),
  marketplace_id uuid not null references public.dpt_marketplaces(id) on delete cascade,
  nonce text not null,
  signature text not null,
  payload_hash text not null,
  used_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (marketplace_id, nonce)
);

create index if not exists idx_dpt_webhook_nonce_guard_exp
  on public.dpt_webhook_nonce_guard(expires_at);

alter table public.dpt_webhook_nonce_guard enable row level security;

drop policy if exists "dpt_webhook_nonce_guard_admin_only" on public.dpt_webhook_nonce_guard;
create policy "dpt_webhook_nonce_guard_admin_only"
on public.dpt_webhook_nonce_guard
for all
using (public.dpt_is_admin())
with check (public.dpt_is_admin());

-- ============================================
-- Helper: canonical payload for signing
-- ============================================
create or replace function public.dpt_webhook_canonical_message(
  p_timestamp bigint,
  p_nonce text,
  p_payload jsonb
)
returns text
language sql
immutable
as $$
  select p_timestamp::text || '.' || p_nonce || '.' || coalesce(p_payload::text, '{}');
$$;

revoke all on function public.dpt_webhook_canonical_message(bigint, text, jsonb) from public;
grant execute on function public.dpt_webhook_canonical_message(bigint, text, jsonb) to authenticated, service_role;

-- ============================================
-- Helper: compute HMAC signature (hex)
-- ============================================
create or replace function public.dpt_webhook_signature_v1(
  p_timestamp bigint,
  p_nonce text,
  p_payload jsonb,
  p_secret text
)
returns text
language sql
stable
as $$
  select 'v1=' || encode(
    hmac(
      convert_to(public.dpt_webhook_canonical_message(p_timestamp, p_nonce, p_payload), 'utf8'),
      convert_to(p_secret, 'utf8'),
      'sha256'
    ),
    'hex'
  );
$$;

revoke all on function public.dpt_webhook_signature_v1(bigint, text, jsonb, text) from public;
grant execute on function public.dpt_webhook_signature_v1(bigint, text, jsonb, text) to authenticated, service_role;

-- ============================================
-- Main guard: verify signature + timestamp + nonce uniqueness
-- ============================================
create or replace function public.dpt_verify_webhook_request(
  p_marketplace_code text,
  p_timestamp bigint,
  p_nonce text,
  p_payload jsonb,
  p_signature text,
  p_secret text,
  p_max_skew_seconds int default 300,
  p_nonce_ttl_seconds int default 86400
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marketplace_id uuid;
  v_expected_sig text;
  v_now_epoch bigint;
  v_skew bigint;
  v_payload_hash text;
begin
  if coalesce(trim(p_marketplace_code), '') = '' then
    raise exception 'p_marketplace_code je povinný';
  end if;

  if coalesce(trim(p_nonce), '') = '' then
    raise exception 'p_nonce je povinný';
  end if;

  if coalesce(trim(p_signature), '') = '' then
    raise exception 'p_signature je povinný';
  end if;

  if coalesce(trim(p_secret), '') = '' then
    raise exception 'p_secret je povinný';
  end if;

  if p_max_skew_seconds <= 0 then
    raise exception 'p_max_skew_seconds musí být > 0';
  end if;

  if p_nonce_ttl_seconds <= 0 then
    raise exception 'p_nonce_ttl_seconds musí být > 0';
  end if;

  select id into v_marketplace_id
  from public.dpt_marketplaces
  where code = p_marketplace_code
    and active = true
  limit 1;

  if v_marketplace_id is null then
    raise exception 'Neznámý marketplace code: %', p_marketplace_code;
  end if;

  v_now_epoch := extract(epoch from now())::bigint;
  v_skew := abs(v_now_epoch - p_timestamp);

  if v_skew > p_max_skew_seconds then
    raise exception 'Webhook timestamp mimo povolené okno (%s s)', p_max_skew_seconds;
  end if;

  v_expected_sig := public.dpt_webhook_signature_v1(p_timestamp, p_nonce, p_payload, p_secret);

  if lower(trim(p_signature)) <> lower(v_expected_sig) then
    raise exception 'Webhook signature mismatch';
  end if;

  v_payload_hash := encode(
    digest(convert_to(coalesce(p_payload::text, '{}'), 'utf8'), 'sha256'),
    'hex'
  );

  -- replay protection (same marketplace + same nonce cannot be reused)
  insert into public.dpt_webhook_nonce_guard (
    marketplace_id,
    nonce,
    signature,
    payload_hash,
    expires_at
  ) values (
    v_marketplace_id,
    p_nonce,
    p_signature,
    v_payload_hash,
    now() + make_interval(secs => p_nonce_ttl_seconds)
  )
  on conflict (marketplace_id, nonce) do nothing;

  if not found then
    raise exception 'Webhook replay detected (nonce already used)';
  end if;

  -- lightweight cleanup
  delete from public.dpt_webhook_nonce_guard
  where expires_at < now();

  return true;
end;
$$;

revoke all on function public.dpt_verify_webhook_request(text, bigint, text, jsonb, text, text, int, int) from public;
grant execute on function public.dpt_verify_webhook_request(text, bigint, text, jsonb, text, text, int, int)
  to authenticated, service_role;

comment on table public.dpt_webhook_nonce_guard
  is 'Stores used webhook nonces per marketplace to prevent replay attacks.';

comment on function public.dpt_webhook_signature_v1(bigint, text, jsonb, text)
  is 'Builds v1 HMAC-SHA256 signature: v1=hex(hmac(timestamp.nonce.payload)).';

comment on function public.dpt_verify_webhook_request(text, bigint, text, jsonb, text, text, int, int)
  is 'Verifies webhook signature, timestamp skew and nonce uniqueness (replay protection).';

-- End of migration v6
