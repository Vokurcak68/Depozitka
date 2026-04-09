-- 044_drop_email_queue.sql
-- ---------------------------------------------------------------------------
-- Depozitka — konsolidace email logů na jednu tabulku
-- ---------------------------------------------------------------------------
-- Migrujeme zbytkové záznamy z deprecated `dpt_email_queue` do `dpt_email_logs`
-- a pak starou tabulku dropneme. Core admin UI i engine runtime od této
-- migrace pracuje pouze s `dpt_email_logs` (jeden zdroj pravdy).
--
-- Datum: 2026-04-09
-- Issue: dvě paralelní fronty → část odeslaných emailů se neobjevila v admin
-- logu, protože šly jen do dpt_email_queue.
-- ---------------------------------------------------------------------------

-- 1. Pokud dpt_email_queue existuje, přemigruj zbytek do dpt_email_logs
DO $$
DECLARE
  queue_exists BOOLEAN;
  migrated_count INT := 0;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'dpt_email_queue'
  ) INTO queue_exists;

  IF queue_exists THEN
    -- Přesuneme VŠE (sent / pending / failed) aby historie nezmizela.
    -- Mapování statusů:
    --   pending → queued
    --   sent    → sent
    --   failed  → failed
    INSERT INTO dpt_email_logs (
      transaction_id,
      template_key,
      to_email,
      subject,
      body_preview,
      provider,
      status,
      error_message,
      sent_at,
      created_at
    )
    SELECT
      NULL::uuid AS transaction_id,
      'legacy_queue'::text AS template_key,
      q.to_email,
      q.subject,
      LEFT(COALESCE(q.text_body, q.html_body, ''), 400) AS body_preview,
      'smtp'::text AS provider,
      CASE
        WHEN q.status = 'pending' THEN 'queued'
        WHEN q.status = 'sent' THEN 'sent'
        WHEN q.status = 'failed' THEN 'failed'
        ELSE 'failed'
      END AS status,
      q.last_error AS error_message,
      q.sent_at,
      COALESCE(q.created_at, NOW()) AS created_at
    FROM dpt_email_queue q;

    GET DIAGNOSTICS migrated_count = ROW_COUNT;
    RAISE NOTICE 'Migrated % rows from dpt_email_queue → dpt_email_logs', migrated_count;

    -- 2. Droopni deprecated tabulku
    DROP TABLE dpt_email_queue CASCADE;
    RAISE NOTICE 'Dropped table dpt_email_queue';
  ELSE
    RAISE NOTICE 'Table dpt_email_queue does not exist, nothing to migrate';
  END IF;
END $$;
