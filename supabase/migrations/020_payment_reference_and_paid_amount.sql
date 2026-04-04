-- 020: Fix payment flow — auto-generate payment_reference (VS) + add paid_amount
-- Fixes: fio-sync referenced nonexistent columns (total_amount, paid_amount, payment_vs)

-- 1) Add paid_amount to track cumulative payments
alter table public.dpt_transactions
  add column if not exists paid_amount numeric(12,2) not null default 0;

-- 2) Auto-generate payment_reference from transaction_code
--    DPT-2026-123456 → VS 2026123456
--    Trigger fires on INSERT, sets payment_reference if not explicitly provided.
create or replace function public.dpt_auto_payment_reference()
returns trigger
language plpgsql
as $$
begin
  if new.payment_reference is null or trim(new.payment_reference) = '' then
    -- Extract digits from transaction_code: "DPT-2026-123456" → "2026123456"
    -- Czech VS max 10 digits — right-trim to 10 if longer
    new.payment_reference := left(regexp_replace(new.transaction_code, '[^0-9]', '', 'g'), 10);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_dpt_tx_auto_payment_ref on public.dpt_transactions;
create trigger trg_dpt_tx_auto_payment_ref
  before insert on public.dpt_transactions
  for each row
  execute function public.dpt_auto_payment_reference();

-- 3) Backfill existing transactions that have NULL payment_reference
update public.dpt_transactions
  set payment_reference = left(regexp_replace(transaction_code, '[^0-9]', '', 'g'), 10)
  where payment_reference is null or trim(payment_reference) = '';

-- 4) Index for fast VS lookup during fio-sync
create index if not exists idx_dpt_transactions_payment_ref
  on public.dpt_transactions(payment_reference);
