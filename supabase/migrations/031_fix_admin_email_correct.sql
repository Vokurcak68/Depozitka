-- Fix admin notification email — MUST be vokurcak68@gmail.com (admin's actual email)
-- NOT the SMTP_FROM address (noreplay@depozitka.eu) which is just the sender

-- 1. Add dedicated admin_email setting
INSERT INTO public.dpt_settings(key, value, description)
VALUES (
  'admin_email',
  '"vokurcak68@gmail.com"'::jsonb,
  'Email pro admin notifikace (kam chodí upozornění o nových transakcích, sporech atd.)'
)
ON CONFLICT (key) DO UPDATE SET value = '"vokurcak68@gmail.com"'::jsonb;

-- 2. Fix emails setting — from/replyTo is SMTP sender, not admin inbox
UPDATE public.dpt_settings
SET value = '{"from":"noreplay@depozitka.eu","replyTo":"noreplay@depozitka.eu"}'::jsonb
WHERE key = 'emails';

-- 3. Rewrite trigger to use admin_email setting (not emails.replyTo)
CREATE OR REPLACE FUNCTION public.dpt_enqueue_transaction_emails()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx public.dpt_transactions;
  v_admin_email text;
BEGIN
  SELECT * INTO v_tx
  FROM public.dpt_transactions
  WHERE id = new.transaction_id
  LIMIT 1;

  IF v_tx.id IS NULL THEN
    RETURN new;
  END IF;

  -- Read admin email from dedicated setting
  SELECT trim(both '"' from (value)::text)
    INTO v_admin_email
  FROM public.dpt_settings
  WHERE key = 'admin_email';

  IF v_admin_email IS NULL OR v_admin_email = '' THEN
    v_admin_email := 'vokurcak68@gmail.com';
  END IF;

  IF new.event_type = 'transaction_created' THEN
    BEGIN
      PERFORM public.dpt_send_email_instant(v_tx.id, 'tx_created_buyer', v_tx.buyer_email);
      PERFORM public.dpt_send_email_instant(v_tx.id, 'tx_created_seller', v_tx.seller_email);
      PERFORM public.dpt_send_email_instant(v_tx.id, 'tx_created_admin', v_admin_email);
    EXCEPTION WHEN undefined_function THEN
      PERFORM public.dpt_queue_email(v_tx.id, 'tx_created_buyer', v_tx.buyer_email, new.note);
      PERFORM public.dpt_queue_email(v_tx.id, 'tx_created_seller', v_tx.seller_email, new.note);
      PERFORM public.dpt_queue_email(v_tx.id, 'tx_created_admin', v_admin_email, new.note);
    END;
    RETURN new;
  END IF;

  IF new.event_type = 'status_changed' THEN
    CASE new.new_status
      WHEN 'paid' THEN
        BEGIN
          PERFORM public.dpt_send_email_instant(v_tx.id, 'payment_received_buyer', v_tx.buyer_email);
          PERFORM public.dpt_send_email_instant(v_tx.id, 'payment_received_seller', v_tx.seller_email);
        EXCEPTION WHEN undefined_function THEN
          PERFORM public.dpt_queue_email(v_tx.id, 'payment_received_buyer', v_tx.buyer_email, new.note);
          PERFORM public.dpt_queue_email(v_tx.id, 'payment_received_seller', v_tx.seller_email, new.note);
        END;

      WHEN 'shipped' THEN
        BEGIN
          PERFORM public.dpt_send_email_instant(v_tx.id, 'shipped_buyer', v_tx.buyer_email);
        EXCEPTION WHEN undefined_function THEN
          PERFORM public.dpt_queue_email(v_tx.id, 'shipped_buyer', v_tx.buyer_email, new.note);
        END;

      WHEN 'delivered' THEN
        BEGIN
          PERFORM public.dpt_send_email_instant(v_tx.id, 'delivered_buyer', v_tx.buyer_email);
          PERFORM public.dpt_send_email_instant(v_tx.id, 'delivered_seller', v_tx.seller_email);
        EXCEPTION WHEN undefined_function THEN
          PERFORM public.dpt_queue_email(v_tx.id, 'delivered_buyer', v_tx.buyer_email, new.note);
          PERFORM public.dpt_queue_email(v_tx.id, 'delivered_seller', v_tx.seller_email, new.note);
        END;

      WHEN 'completed', 'auto_completed' THEN
        BEGIN
          PERFORM public.dpt_send_email_instant(v_tx.id, 'completed_buyer', v_tx.buyer_email);
          PERFORM public.dpt_send_email_instant(v_tx.id, 'completed_seller', v_tx.seller_email);
        EXCEPTION WHEN undefined_function THEN
          PERFORM public.dpt_queue_email(v_tx.id, 'completed_buyer', v_tx.buyer_email, new.note);
          PERFORM public.dpt_queue_email(v_tx.id, 'completed_seller', v_tx.seller_email, new.note);
        END;

      WHEN 'disputed' THEN
        BEGIN
          PERFORM public.dpt_send_email_instant(v_tx.id, 'dispute_opened_buyer', v_tx.buyer_email);
          PERFORM public.dpt_send_email_instant(v_tx.id, 'dispute_opened_seller', v_tx.seller_email);
          PERFORM public.dpt_send_email_instant(v_tx.id, 'dispute_opened_admin', v_admin_email);
        EXCEPTION WHEN undefined_function THEN
          PERFORM public.dpt_queue_email(v_tx.id, 'dispute_opened_buyer', v_tx.buyer_email, new.note);
          PERFORM public.dpt_queue_email(v_tx.id, 'dispute_opened_seller', v_tx.seller_email, new.note);
          PERFORM public.dpt_queue_email(v_tx.id, 'dispute_opened_admin', v_admin_email, new.note);
        END;

      WHEN 'hold' THEN
        BEGIN
          PERFORM public.dpt_send_email_instant(v_tx.id, 'hold_set_buyer', v_tx.buyer_email);
          PERFORM public.dpt_send_email_instant(v_tx.id, 'hold_set_seller', v_tx.seller_email);
        EXCEPTION WHEN undefined_function THEN
          PERFORM public.dpt_queue_email(v_tx.id, 'hold_set_buyer', v_tx.buyer_email, new.note);
          PERFORM public.dpt_queue_email(v_tx.id, 'hold_set_seller', v_tx.seller_email, new.note);
        END;

      WHEN 'refunded' THEN
        BEGIN
          PERFORM public.dpt_send_email_instant(v_tx.id, 'refunded_buyer', v_tx.buyer_email);
          PERFORM public.dpt_send_email_instant(v_tx.id, 'refunded_seller', v_tx.seller_email);
        EXCEPTION WHEN undefined_function THEN
          PERFORM public.dpt_queue_email(v_tx.id, 'refunded_buyer', v_tx.buyer_email, new.note);
          PERFORM public.dpt_queue_email(v_tx.id, 'refunded_seller', v_tx.seller_email, new.note);
        END;

      WHEN 'payout_sent', 'payout_confirmed' THEN
        BEGIN
          PERFORM public.dpt_send_email_instant(v_tx.id, 'payout_seller', v_tx.seller_email);
          PERFORM public.dpt_send_email_instant(v_tx.id, 'payout_admin', v_admin_email);
        EXCEPTION WHEN undefined_function THEN
          PERFORM public.dpt_queue_email(v_tx.id, 'payout_seller', v_tx.seller_email, new.note);
          PERFORM public.dpt_queue_email(v_tx.id, 'payout_admin', v_admin_email, new.note);
        END;

      WHEN 'partial_paid' THEN
        BEGIN
          PERFORM public.dpt_send_email_instant(v_tx.id, 'partial_paid_buyer', v_tx.buyer_email);
          PERFORM public.dpt_send_email_instant(v_tx.id, 'partial_paid_seller', v_tx.seller_email);
        EXCEPTION WHEN undefined_function THEN
          PERFORM public.dpt_queue_email(v_tx.id, 'partial_paid_buyer', v_tx.buyer_email, new.note);
          PERFORM public.dpt_queue_email(v_tx.id, 'partial_paid_seller', v_tx.seller_email, new.note);
        END;

      ELSE
        NULL;
    END CASE;
  END IF;

  RETURN new;
END;
$$;
