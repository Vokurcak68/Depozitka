-- Depozitka Core - Fix pgcrypto schema qualification for API key generation (v15)
-- Supabase commonly installs extension functions in schema `extensions`.
-- With function search_path set to `public`, unqualified crypt/gen_salt may fail.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.dpt_generate_api_key(
  p_marketplace_id uuid,
  p_key_prefix text,
  p_raw_key text,
  p_scopes text[],
  p_label text default null,
  p_expires_in_days integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key_id uuid;
  v_expires timestamptz;
begin
  if not public.dpt_is_admin() then
    raise exception 'Pouze admin/support může generovat API klíče';
  end if;

  if p_marketplace_id is null then
    raise exception 'p_marketplace_id je povinný';
  end if;

  if not exists (select 1 from public.dpt_marketplaces where id = p_marketplace_id and active = true) then
    raise exception 'Marketplace neexistuje nebo není aktivní';
  end if;

  if coalesce(trim(p_key_prefix), '') = '' or char_length(trim(p_key_prefix)) < 6 then
    raise exception 'p_key_prefix musí mít alespoň 6 znaků';
  end if;

  if coalesce(trim(p_raw_key), '') = '' or char_length(p_raw_key) < 20 then
    raise exception 'p_raw_key musí mít alespoň 20 znaků';
  end if;

  if p_scopes is null or array_length(p_scopes, 1) = 0 then
    raise exception 'Alespoň jeden scope je povinný';
  end if;

  if p_expires_in_days is not null and p_expires_in_days > 0 then
    v_expires := now() + (p_expires_in_days || ' days')::interval;
  end if;

  insert into public.dpt_api_keys (
    marketplace_id,
    key_prefix,
    key_hash,
    scopes,
    label,
    created_by_profile_id,
    expires_at
  )
  values (
    p_marketplace_id,
    trim(p_key_prefix),
    extensions.crypt(p_raw_key, extensions.gen_salt('bf')),
    p_scopes,
    nullif(trim(coalesce(p_label, '')), ''),
    auth.uid(),
    v_expires
  )
  returning id into v_key_id;

  insert into public.dpt_audit_log (actor_id, actor_email, action, entity_type, entity_id, detail)
  values (
    auth.uid()::text,
    public.dpt_me_email(),
    'api_key.created',
    'dpt_api_keys',
    v_key_id::text,
    jsonb_build_object(
      'marketplace_id', p_marketplace_id,
      'key_prefix', trim(p_key_prefix),
      'scopes', to_jsonb(p_scopes),
      'label', coalesce(p_label, ''),
      'expires_at', v_expires
    )
  );

  return v_key_id;
end;
$$;

revoke all on function public.dpt_generate_api_key(uuid, text, text, text[], text, integer) from public;
grant execute on function public.dpt_generate_api_key(uuid, text, text, text[], text, integer)
  to authenticated;

comment on function public.dpt_generate_api_key(uuid, text, text, text[], text, integer)
is 'Admin RPC: vygeneruje API klíč pro marketplace, uloží bcrypt hash (extensions.pgcrypto), vrátí key ID.';
