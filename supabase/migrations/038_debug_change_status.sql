-- 038: Debug funkce pro dpt_change_status
-- Vrátí všechny mezivýpočty (effective_role, lookup result) bez aplikace změny.
-- Smazat po vyřešení záhady.

CREATE OR REPLACE FUNCTION public.dpt_debug_change_status(
  p_transaction_code text,
  p_new_status public.dpt_tx_status,
  p_actor_role public.dpt_user_role DEFAULT 'admin'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tx public.dpt_transactions;
  v_effective_role public.dpt_user_role;
  v_reason_required boolean;
  v_reason_required_fallback boolean;
  v_auth_role text;
  v_auth_uid uuid;
  v_count_direct int;
BEGIN
  -- Auth context
  v_auth_role := auth.role();
  v_auth_uid := auth.uid();

  -- Tx
  SELECT * INTO v_tx FROM public.dpt_transactions WHERE transaction_code = p_transaction_code LIMIT 1;

  -- Effective role
  v_effective_role := public.dpt_effective_actor_role(p_actor_role);

  -- Lookup #1 (exact role)
  SELECT reason_required INTO v_reason_required
  FROM public.dpt_status_transitions
  WHERE from_status = v_tx.status
    AND to_status = p_new_status
    AND allowed_actor_role = v_effective_role
  LIMIT 1;

  -- Lookup #2 (admin fallback)
  SELECT reason_required INTO v_reason_required_fallback
  FROM public.dpt_status_transitions
  WHERE from_status = v_tx.status
    AND to_status = p_new_status
    AND allowed_actor_role = 'admin'::public.dpt_user_role
  LIMIT 1;

  -- Count rows for debugging
  SELECT count(*) INTO v_count_direct
  FROM public.dpt_status_transitions
  WHERE from_status = v_tx.status
    AND to_status = p_new_status
    AND allowed_actor_role = v_effective_role;

  RETURN jsonb_build_object(
    'auth_role', v_auth_role,
    'auth_uid', v_auth_uid,
    'tx_found', v_tx.id IS NOT NULL,
    'tx_status', v_tx.status::text,
    'requested_status', p_new_status::text,
    'requested_actor_role', p_actor_role::text,
    'effective_role', v_effective_role::text,
    'effective_role_text', v_effective_role::text,
    'reason_required_exact', v_reason_required,
    'reason_required_fallback', v_reason_required_fallback,
    'rows_count_direct', v_count_direct,
    'dpt_current_role', public.dpt_current_role()::text,
    'dpt_me_email', public.dpt_me_email()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.dpt_debug_change_status(text, public.dpt_tx_status, public.dpt_user_role)
  TO authenticated, service_role;
