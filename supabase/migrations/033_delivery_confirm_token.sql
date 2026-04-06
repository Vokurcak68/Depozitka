-- 033: Přidání sloupců pro potvrzení doručení kupujícím a spory
-- Token pro stránku potvrzení doručení / otevření sporu
ALTER TABLE dpt_transactions ADD COLUMN IF NOT EXISTS delivery_confirm_token uuid;

-- Spor
ALTER TABLE dpt_transactions ADD COLUMN IF NOT EXISTS dispute_reason text;
ALTER TABLE dpt_transactions ADD COLUMN IF NOT EXISTS dispute_evidence_urls text[] DEFAULT '{}';
ALTER TABLE dpt_transactions ADD COLUMN IF NOT EXISTS disputed_at timestamptz;

-- Index pro vyhledávání přes token
CREATE INDEX IF NOT EXISTS idx_dpt_tx_delivery_confirm_token ON dpt_transactions(delivery_confirm_token) WHERE delivery_confirm_token IS NOT NULL;
