-- 023: Bank transactions enhancements for manual matching + ignore + overpaid

-- Add columns for ignore/overpaid workflow
ALTER TABLE dpt_bank_transactions
  ADD COLUMN IF NOT EXISTS ignored boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ignored_reason text,
  ADD COLUMN IF NOT EXISTS overpaid boolean NOT NULL DEFAULT false;

-- Ensure matched_transaction_id references dpt_transactions
-- (may already exist as FK — use DO block to avoid error)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'dpt_bank_transactions_matched_transaction_id_fkey'
      AND table_name = 'dpt_bank_transactions'
  ) THEN
    ALTER TABLE dpt_bank_transactions
      ADD CONSTRAINT dpt_bank_transactions_matched_transaction_id_fkey
      FOREIGN KEY (matched_transaction_id) REFERENCES dpt_transactions(id);
  END IF;
END $$;

-- Index for quick filtering
CREATE INDEX IF NOT EXISTS idx_dpt_bank_tx_matched ON dpt_bank_transactions(matched);
CREATE INDEX IF NOT EXISTS idx_dpt_bank_tx_ignored ON dpt_bank_transactions(ignored);

-- RPC: Manual match a bank payment to a transaction
CREATE OR REPLACE FUNCTION dpt_manual_match_payment(
  p_bank_tx_id text,
  p_transaction_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bank_amount numeric;
  v_tx_amount numeric;
  v_tx_paid numeric;
  v_new_paid numeric;
  v_new_status text;
  v_tx_code text;
BEGIN
  -- Get bank transaction
  SELECT amount INTO v_bank_amount
  FROM dpt_bank_transactions
  WHERE bank_tx_id = p_bank_tx_id AND matched = false AND ignored = false;

  IF v_bank_amount IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bank transaction not found or already matched/ignored');
  END IF;

  -- Get escrow transaction
  SELECT amount_czk, COALESCE(paid_amount, 0), transaction_code, status
  INTO v_tx_amount, v_tx_paid, v_tx_code, v_new_status
  FROM dpt_transactions
  WHERE id = p_transaction_id;

  IF v_tx_amount IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Transaction not found');
  END IF;

  -- Only allow matching to payable states
  IF v_new_status NOT IN ('created', 'partial_paid') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Transaction is not in payable state (' || v_new_status || ')');
  END IF;

  -- Calculate new paid amount
  v_new_paid := v_tx_paid + v_bank_amount;

  IF v_new_paid >= v_tx_amount THEN
    v_new_status := 'paid';
  ELSE
    v_new_status := 'partial_paid';
  END IF;

  -- Update escrow transaction
  UPDATE dpt_transactions
  SET paid_amount = v_new_paid,
      status = v_new_status,
      paid_at = CASE WHEN v_new_paid >= v_tx_amount THEN now() ELSE paid_at END,
      updated_at = now()
  WHERE id = p_transaction_id;

  -- Mark bank tx as matched
  UPDATE dpt_bank_transactions
  SET matched = true,
      matched_transaction_id = p_transaction_id,
      overpaid = (v_new_paid > v_tx_amount)
  WHERE bank_tx_id = p_bank_tx_id;

  -- Log event
  INSERT INTO dpt_status_log (transaction_id, event_type, old_status, new_status, note, created_at)
  VALUES (
    p_transaction_id,
    'status_changed',
    (SELECT status FROM dpt_transactions WHERE id = p_transaction_id),
    v_new_status,
    'Manual bank payment match (bank_tx_id=' || p_bank_tx_id || ', amount=' || v_bank_amount || ')',
    now()
  );

  RETURN jsonb_build_object(
    'ok', true,
    'transaction_code', v_tx_code,
    'new_status', v_new_status,
    'new_paid', v_new_paid,
    'overpaid', (v_new_paid > v_tx_amount)
  );
END;
$$;

-- RPC: Ignore a bank payment
CREATE OR REPLACE FUNCTION dpt_ignore_bank_payment(
  p_bank_tx_id text,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE dpt_bank_transactions
  SET ignored = true, ignored_reason = p_reason
  WHERE bank_tx_id = p_bank_tx_id AND matched = false;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bank transaction not found or already matched');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;
