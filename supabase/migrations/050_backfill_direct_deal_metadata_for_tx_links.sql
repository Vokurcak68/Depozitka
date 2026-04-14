-- 050_backfill_direct_deal_metadata_for_tx_links.sql
-- Backfill direct deal metadata into dpt_transactions so core UI can always render
-- "Otevřít nabídku (Direct Deal)" link from tx metadata without depending on cross-table lookup.

update public.dpt_transactions t
set
  source = 'direct_deal',
  metadata = coalesce(t.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'source', 'direct_deal',
      'direct_deal_id', d.id,
      'direct_deal_public_token', d.public_token,
      'direct_deal_version_id', v.id,
      'direct_deal_version_no', v.version_no
    )
from public.dpt_direct_deal_versions v
join public.dpt_direct_deals d on d.id = v.deal_id
where v.transaction_id = t.id
  and (
    (t.metadata->>'direct_deal_public_token') is null
    or (t.metadata->>'direct_deal_public_token') = ''
    or (t.source is distinct from 'direct_deal')
  );
