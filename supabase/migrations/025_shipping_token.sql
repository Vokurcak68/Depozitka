-- Shipping token for secure public ship page access
ALTER TABLE dpt_transactions ADD COLUMN IF NOT EXISTS shipping_token uuid DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS idx_dpt_tx_shipping_token ON dpt_transactions(shipping_token) WHERE shipping_token IS NOT NULL;

-- Backfill existing rows
UPDATE dpt_transactions SET shipping_token = gen_random_uuid() WHERE shipping_token IS NULL;
