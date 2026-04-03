-- Depozitka Core - Add label column to dpt_api_keys (v12)
-- Missing column caused 400 error on frontend SELECT, breaking page load.

alter table public.dpt_api_keys
add column if not exists label text;

comment on column public.dpt_api_keys.label is 'Human-readable label for the API key (e.g. Production key)';
