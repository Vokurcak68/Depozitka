-- Depozitka Core - Fix pgcrypto schema qualification in API auth (v17)
-- dpt_create_transaction_safe -> dpt_api_auth_marketplace used unqualified crypt(),
-- which fails when pgcrypto functions live in `extensions` schema.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.dpt_api_auth_marketplace(
  p_marketplace_code text,
  p_api_key text,
  p_required_scope text default 'transactions:create'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marketplace_id uuid;
  v_key record;
begin
  if coalesce(trim(p_marketplace_code), '') = '' then
    raise exception 'p_marketplace_code je povinný';
  end if;

  if coalesce(trim(p_api_key), '') = '' then
    raise exception 'p_api_key je povinný';
  end if;

  select id
    into v_marketplace_id
  from public.dpt_marketplaces
  where code = trim(p_marketplace_code)
    and active = true
  limit 1;

  if v_marketplace_id is null then
    raise exception 'Neznámý marketplace code: %', p_marketplace_code;
  end if;

  select id, key_prefix
    into v_key
  from public.dpt_api_keys
  where marketplace_id = v_marketplace_id
    and active = true
    and revoked_at is null
    and (expires_at is null or expires_at > now())
    and (p_required_scope is null or p_required_scope = any(scopes))
    and extensions.crypt(p_api_key, key_hash) = key_hash
  order by created_at desc
  limit 1;

  if v_key.id is null then
    raise exception 'Neplatný API klíč nebo scope';
  end if;

  update public.dpt_api_keys
  set last_used_at = now()
  where id = v_key.id;

  return v_marketplace_id;
end;
$$;

revoke all on function public.dpt_api_auth_marketplace(text, text, text) from public;
grant execute on function public.dpt_api_auth_marketplace(text, text, text) to authenticated, service_role;

comment on function public.dpt_api_auth_marketplace(text, text, text)
is 'Validates marketplace API key (active/expiry/scope) using extensions.pgcrypto and returns marketplace_id.';
