-- Allow multiple API keys with the same prefix per marketplace
-- The key_hash is already unique; prefix is just for display/identification
DROP INDEX IF EXISTS dpt_api_keys_marketplace_id_key_prefix_key;

-- Add a non-unique index instead (for lookups)
CREATE INDEX IF NOT EXISTS idx_dpt_api_keys_marketplace_prefix
  ON dpt_api_keys(marketplace_id, key_prefix);
