-- Deals V2: essential fields for shipping / delivery / terms consent

alter table public.dpt_deals
  add column if not exists initiator_name text;

alter table public.dpt_deals
  add column if not exists counterparty_name text;

-- delivery_method: personal (osobně) | carrier (dopravce)
alter table public.dpt_deals
  add column if not exists delivery_method text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    where c.conname = 'dpt_deals_delivery_method_chk'
      and c.conrelid = 'public.dpt_deals'::regclass
  ) then
    alter table public.dpt_deals
      add constraint dpt_deals_delivery_method_chk
      check (delivery_method is null or delivery_method in ('personal','carrier'));
  end if;
end $$;

-- shipping terms (who pays / how it is handled)
alter table public.dpt_deals
  add column if not exists shipping_terms text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    where c.conname = 'dpt_deals_shipping_terms_chk'
      and c.conrelid = 'public.dpt_deals'::regclass
  ) then
    alter table public.dpt_deals
      add constraint dpt_deals_shipping_terms_chk
      check (shipping_terms is null or shipping_terms in ('buyer_pays','seller_pays','included','split','other'));
  end if;
end $$;

alter table public.dpt_deals
  add column if not exists shipping_carrier text;

alter table public.dpt_deals
  add column if not exists shipping_note text;

-- optional estimate
alter table public.dpt_deals
  add column if not exists estimated_ship_date date;

-- terms consent (recorded at create)
alter table public.dpt_deals
  add column if not exists terms_accepted_at timestamptz;

alter table public.dpt_deals
  add column if not exists terms_version text;

-- Helpful indexes
create index if not exists idx_dpt_deals_delivery_method on public.dpt_deals(delivery_method);
create index if not exists idx_dpt_deals_shipping_carrier on public.dpt_deals(lower(shipping_carrier));
