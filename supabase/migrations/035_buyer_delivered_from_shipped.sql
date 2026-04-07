-- 035: Kupující potvrzuje doručení → stav "delivered" (ne "completed")
-- Logika: shipped → delivered (kupující potvrdil přijetí zásilky)
--         delivered → completed (admin nebo auto-complete po 7 dnech)
--         delivered/completed → payout_sent (výplata prodávajícímu)
-- Výplata prodávajícímu se uvolňuje až ve stavu delivered (nebo completed).

-- Povolit buyer: shipped → delivered
INSERT INTO public.dpt_status_transitions (from_status, to_status, allowed_actor_role, reason_required)
VALUES
  ('shipped', 'delivered', 'buyer', false),
  -- Výplata prodávajícímu (admin + service role, přes /api/payout)
  ('delivered', 'payout_sent', 'admin', false),
  ('delivered', 'payout_sent', 'service', false),
  ('completed', 'payout_sent', 'admin', false),
  ('completed', 'payout_sent', 'service', false),
  ('auto_completed', 'payout_sent', 'admin', false),
  ('auto_completed', 'payout_sent', 'service', false)
ON CONFLICT (from_status, to_status, allowed_actor_role) DO NOTHING;
