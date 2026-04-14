-- Deals V2: rejection reason

alter table public.dpt_deals
  add column if not exists rejection_reason text;
