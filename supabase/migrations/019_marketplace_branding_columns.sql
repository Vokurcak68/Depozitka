-- Depozitka Core: Marketplace branding columns for variabilní email šablony
-- Každý bazar má vlastní logo, barvy, firemní údaje pro zákaznické emaily.

alter table public.dpt_marketplaces
  add column if not exists logo_url text,
  add column if not exists accent_color text default '#2563eb',
  add column if not exists company_name text,
  add column if not exists company_address text,
  add column if not exists company_id text,        -- IČO / DIČ
  add column if not exists support_email text,
  add column if not exists website_url text;

comment on column public.dpt_marketplaces.logo_url is 'URL loga marketplace pro emaily (ideálně ~200px, průhledné PNG)';
comment on column public.dpt_marketplaces.accent_color is 'Primární barva (hex) pro emaily, default #2563eb';
comment on column public.dpt_marketplaces.company_name is 'Obchodní jméno / právní název firmy';
comment on column public.dpt_marketplaces.company_address is 'Adresa sídla firmy';
comment on column public.dpt_marketplaces.company_id is 'IČO / DIČ';
comment on column public.dpt_marketplaces.support_email is 'Kontaktní email zákaznické podpory';
comment on column public.dpt_marketplaces.website_url is 'URL webu marketplace';

-- Také přidáme escrow platební údaje na úrovni settings (globální)
-- nebo na úrovni marketplace, pokud je více escrow účtů.
-- Prozatím globální přes dpt_settings:
-- Escrow platební údaje (globální nastavení)
-- account_number = české číslo účtu (zobrazí se kupujícímu)
-- iban = pro generování QR kódu (SPD formát)
insert into public.dpt_settings (key, value, description)
values (
  'escrow_account',
  '{"account_number":"","iban":"","bank_name":"Fio banka"}'::jsonb,
  'Escrow účet pro přijímání plateb od kupujících (account_number pro zobrazení, iban pro QR kód)'
)
on conflict (key) do nothing;

-- End of migration 019
