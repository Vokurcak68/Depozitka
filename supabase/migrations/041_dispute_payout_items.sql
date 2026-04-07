-- 041: Multi-payout pro spory
-- Tabulka dpt_payout_items — plán rozpadu výplaty (1 transakce = N příjemců)
-- Podporuje: full refund kupujícímu, split seller/buyer, custom provize, platform fee (interní log)

-- 1) Nový stav transakce — dispute_settled (finální stav po rozeslání všech items)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.dpt_statuses WHERE code = 'dispute_settled'
  ) THEN
    INSERT INTO public.dpt_statuses (code, label, description, is_terminal, sort_order)
    VALUES ('dispute_settled', 'Spor vypořádán', 'Výplaty ze sporu byly odeslány', true, 125);
  END IF;
END $$;

-- ALTER enumu dpt_escrow_status (pokud existuje)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dpt_escrow_status') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum
      WHERE enumtypid = 'public.dpt_escrow_status'::regtype
        AND enumlabel = 'dispute_settled'
    ) THEN
      ALTER TYPE public.dpt_escrow_status ADD VALUE 'dispute_settled';
    END IF;
  END IF;
END $$;

-- 2) Povolené přechody z disputed do dispute_settled (admin)
INSERT INTO public.dpt_status_transitions (from_status, to_status, actor_role, is_terminal)
VALUES ('disputed', 'dispute_settled', 'admin', true)
ON CONFLICT DO NOTHING;

-- 3) Tabulka dpt_payout_items
CREATE TABLE IF NOT EXISTS public.dpt_payout_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.dpt_transactions(id) ON DELETE CASCADE,
  recipient_type text NOT NULL CHECK (recipient_type IN ('buyer', 'seller', 'platform_fee')),
  recipient_name text,
  recipient_iban text, -- NULL pro platform_fee
  amount_czk numeric(12, 2) NOT NULL CHECK (amount_czk >= 0),
  variable_symbol text,
  note text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  fio_response text,
  error_message text,
  sent_at timestamptz,
  created_by text, -- email admina
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dpt_payout_items_transaction_id_idx
  ON public.dpt_payout_items(transaction_id);
CREATE INDEX IF NOT EXISTS dpt_payout_items_status_idx
  ON public.dpt_payout_items(status);
CREATE INDEX IF NOT EXISTS dpt_payout_items_created_at_idx
  ON public.dpt_payout_items(created_at DESC);

-- 4) Trigger pro updated_at
CREATE OR REPLACE FUNCTION public.dpt_payout_items_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dpt_payout_items_updated ON public.dpt_payout_items;
CREATE TRIGGER trg_dpt_payout_items_updated
  BEFORE UPDATE ON public.dpt_payout_items
  FOR EACH ROW
  EXECUTE FUNCTION public.dpt_payout_items_touch_updated_at();

-- 5) RLS
ALTER TABLE public.dpt_payout_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dpt_payout_items_select ON public.dpt_payout_items;
CREATE POLICY dpt_payout_items_select ON public.dpt_payout_items
  FOR SELECT
  TO authenticated
  USING (public.dpt_current_role() IN ('admin', 'support'));

DROP POLICY IF EXISTS dpt_payout_items_insert ON public.dpt_payout_items;
CREATE POLICY dpt_payout_items_insert ON public.dpt_payout_items
  FOR INSERT
  TO authenticated
  WITH CHECK (public.dpt_current_role() IN ('admin', 'support'));

DROP POLICY IF EXISTS dpt_payout_items_update ON public.dpt_payout_items;
CREATE POLICY dpt_payout_items_update ON public.dpt_payout_items
  FOR UPDATE
  TO authenticated
  USING (public.dpt_current_role() IN ('admin', 'support'))
  WITH CHECK (public.dpt_current_role() IN ('admin', 'support'));

DROP POLICY IF EXISTS dpt_payout_items_delete ON public.dpt_payout_items;
CREATE POLICY dpt_payout_items_delete ON public.dpt_payout_items
  FOR DELETE
  TO authenticated
  USING (
    public.dpt_current_role() IN ('admin', 'support')
    AND status = 'pending'
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dpt_payout_items TO authenticated, service_role;

COMMENT ON TABLE public.dpt_payout_items IS
  'Rozpad výplaty pro spory — každý řádek = jeden příjemce (kupující/prodávající/platforma)';
COMMENT ON COLUMN public.dpt_payout_items.recipient_type IS
  'buyer = refund kupujícímu, seller = kompenzace prodávajícímu, platform_fee = interní log (bez FIO převodu)';
