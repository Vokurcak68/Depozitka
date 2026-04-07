-- 040: Audit log cron běhů
-- Engine zapisuje po každém běhu cron jobu (daily-jobs + sub-jobs)

CREATE TABLE IF NOT EXISTS public.dpt_cron_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  status text NOT NULL DEFAULT 'running', -- running | success | error
  result jsonb,
  error_message text,
  triggered_by text DEFAULT 'vercel_cron' -- vercel_cron | manual | api
);

CREATE INDEX IF NOT EXISTS dpt_cron_runs_job_started_idx
  ON public.dpt_cron_runs(job_name, started_at DESC);
CREATE INDEX IF NOT EXISTS dpt_cron_runs_started_idx
  ON public.dpt_cron_runs(started_at DESC);

ALTER TABLE public.dpt_cron_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dpt_cron_runs_select ON public.dpt_cron_runs;
CREATE POLICY dpt_cron_runs_select ON public.dpt_cron_runs
  FOR SELECT
  TO authenticated
  USING (public.dpt_current_role() IN ('admin', 'support'));

DROP POLICY IF EXISTS dpt_cron_runs_insert ON public.dpt_cron_runs;
CREATE POLICY dpt_cron_runs_insert ON public.dpt_cron_runs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.dpt_current_role() IN ('admin', 'support'));

GRANT SELECT, INSERT, UPDATE ON public.dpt_cron_runs TO authenticated, service_role;

COMMENT ON TABLE public.dpt_cron_runs IS 'Audit log cron běhů — každý cron job se sem zapíše';
