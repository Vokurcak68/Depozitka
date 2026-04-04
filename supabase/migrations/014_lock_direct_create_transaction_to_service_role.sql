-- Depozitka Core - Lock direct create RPC to service role only (v14)
-- Goal: marketplace clients must use dpt_create_transaction_safe (API key + idempotency)
-- and must not be able to call dpt_create_transaction directly over RPC.

revoke execute on function public.dpt_create_transaction(
  text, text, text, text, text, text, text, text, numeric, public.dpt_payment_method, jsonb
) from authenticated;

grant execute on function public.dpt_create_transaction(
  text, text, text, text, text, text, text, text, numeric, public.dpt_payment_method, jsonb
) to service_role;

comment on function public.dpt_create_transaction(
  text, text, text, text, text, text, text, text, numeric, public.dpt_payment_method, jsonb
)
is 'Internal create RPC. Direct external RPC usage is blocked for authenticated clients; use dpt_create_transaction_safe (API key contract).';

-- Keep execute on dpt_create_transaction_safe for authenticated/service_role,
-- so marketplace apps can call only the safe contract.
-- (No change needed here; retained from v9.)
