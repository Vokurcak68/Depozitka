-- Buyer token (unique link for buyer to fill delivery address)
ALTER TABLE dpt_transactions ADD COLUMN IF NOT EXISTS buyer_token uuid DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS idx_dpt_tx_buyer_token ON dpt_transactions(buyer_token) WHERE buyer_token IS NOT NULL;
UPDATE dpt_transactions SET buyer_token = gen_random_uuid() WHERE buyer_token IS NULL;

-- Flag: buyer filled delivery address
ALTER TABLE dpt_transactions ADD COLUMN IF NOT EXISTS buyer_address_filled boolean NOT NULL DEFAULT false;

-- New email template key
INSERT INTO dpt_email_template_catalog (key, title, description)
VALUES ('payment_details_buyer', 'Platební údaje po vyplnění adresy (kupující)', 'Platební údaje + QR kód po vyplnění doručovací adresy')
ON CONFLICT (key) DO NOTHING;
