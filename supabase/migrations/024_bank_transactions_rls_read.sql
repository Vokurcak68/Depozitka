-- Allow authenticated users to read bank transactions (for Core admin UI)
CREATE POLICY "authenticated_read_bank_tx"
  ON dpt_bank_transactions
  FOR SELECT
  TO authenticated
  USING (true);
