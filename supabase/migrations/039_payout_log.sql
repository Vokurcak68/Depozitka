-- 039: Audit log výplat
-- Slouží pro UI přehled "Výplaty" v Core admin

CREATE TABLE IF NOT EXISTS public.dpt_payout_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.dpt_transactions(id) ON DELETE CASCADE,
  transaction_code text NOT NULL,
  amount_czk numeric(12,2) NOT NULL,
  iban text NOT NULL,
  account_name text,
  variable_symbol text,
  fio_response text,
  status text NOT NULL DEFAULT 'sent', -- sent | failed
  error_message text,
  triggered_by text, -- email admina nebo 'cron' / 'service'
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dpt_payout_log_transaction_id_idx ON public.dpt_payout_log(transaction_id);
CREATE INDEX IF NOT EXISTS dpt_payout_log_created_at_idx ON public.dpt_payout_log(created_at DESC);

ALTER TABLE public.dpt_payout_log ENABLE ROW LEVEL SECURITY;

-- Pouze admin/support a service role mají SELECT
DROP POLICY IF EXISTS dpt_payout_log_select ON public.dpt_payout_log;
CREATE POLICY dpt_payout_log_select ON public.dpt_payout_log
  FOR SELECT
  TO authenticated
  USING (public.dpt_current_role() IN ('admin', 'support'));

-- Service role (engine) má INSERT (přes service_role JWT obchází RLS, ale pro jistotu policy)
DROP POLICY IF EXISTS dpt_payout_log_insert ON public.dpt_payout_log;
CREATE POLICY dpt_payout_log_insert ON public.dpt_payout_log
  FOR INSERT
  TO authenticated
  WITH CHECK (public.dpt_current_role() IN ('admin', 'support'));

GRANT SELECT, INSERT ON public.dpt_payout_log TO authenticated, service_role;

COMMENT ON TABLE public.dpt_payout_log IS 'Audit log výplat — každá iniciovaná FIO výplata se sem zapíše';
