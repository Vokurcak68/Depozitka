-- ShieldTrack integration columns
ALTER TABLE dpt_transactions ADD COLUMN IF NOT EXISTS shieldtrack_shipment_id text;
ALTER TABLE dpt_transactions ADD COLUMN IF NOT EXISTS st_score integer;
ALTER TABLE dpt_transactions ADD COLUMN IF NOT EXISTS st_status text;

CREATE INDEX IF NOT EXISTS idx_dpt_tx_shieldtrack_id ON dpt_transactions(shieldtrack_shipment_id) WHERE shieldtrack_shipment_id IS NOT NULL;
