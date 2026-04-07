-- 037: Admin rollback přechody
-- Admin musí mít možnost vrátit stav zpět pokud se splete
-- (např. nechtěně potvrdit doručení, špatně označit shipped, atd.)
--
-- Tyto přechody jsou výhradně pro admin roli — service/buyer/seller je nemůžou použít.

INSERT INTO public.dpt_status_transitions (from_status, to_status, allowed_actor_role, reason_required)
VALUES
  -- Vrátit z dokončeno
  ('completed', 'delivered', 'admin', true),
  ('completed', 'shipped', 'admin', true),
  ('completed', 'paid', 'admin', true),
  ('completed', 'disputed', 'admin', true),

  -- Vrátit z auto_completed
  ('auto_completed', 'delivered', 'admin', true),
  ('auto_completed', 'shipped', 'admin', true),
  ('auto_completed', 'disputed', 'admin', true),

  -- Vrátit z delivered
  ('delivered', 'shipped', 'admin', true),
  ('delivered', 'paid', 'admin', true),

  -- Vrátit z shipped
  ('shipped', 'paid', 'admin', true),

  -- Vrátit z paid
  ('paid', 'partial_paid', 'admin', true),
  ('paid', 'created', 'admin', true),

  -- Vrátit z partial_paid
  ('partial_paid', 'created', 'admin', true),

  -- Vrátit z disputed
  ('disputed', 'paid', 'admin', true),
  ('disputed', 'shipped', 'admin', true),
  ('disputed', 'delivered', 'admin', true),

  -- Vrátit z hold
  ('hold', 'paid', 'admin', true),
  ('hold', 'shipped', 'admin', true),
  ('hold', 'delivered', 'admin', true),

  -- Vrátit z payout_sent (pokud se výplata neprovedla nebo selhala)
  ('payout_sent', 'completed', 'admin', true),
  ('payout_sent', 'auto_completed', 'admin', true),
  ('payout_sent', 'disputed', 'admin', true),
  ('payout_sent', 'hold', 'admin', true)
ON CONFLICT (from_status, to_status, allowed_actor_role) DO NOTHING;
