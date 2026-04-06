-- Fix pg_net HTTP call — explicit Content-Type header + debug-friendly
CREATE OR REPLACE FUNCTION public.dpt_send_email_instant(
  p_transaction_id uuid,
  p_template_key text,
  p_to_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_engine_url text;
  v_cron_secret text;
  v_body jsonb;
BEGIN
  SELECT
    coalesce(value->>'engine_url', 'https://depozitka-engine.vercel.app'),
    value->>'cron_secret'
  INTO v_engine_url, v_cron_secret
  FROM public.dpt_settings
  WHERE key = 'engine';

  IF v_engine_url IS NULL THEN
    v_engine_url := 'https://depozitka-engine.vercel.app';
  END IF;

  v_body := jsonb_build_object(
    'transaction_id', p_transaction_id::text,
    'template_key', p_template_key,
    'to_email', p_to_email,
    'token', coalesce(v_cron_secret, '')
  );

  -- Fire-and-forget async HTTP POST via pg_net with explicit headers
  PERFORM net.http_post(
    url := v_engine_url || '/api/send-email',
    body := v_body,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dpt_send_email_instant(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.dpt_send_email_instant(uuid, text, text) TO service_role;
