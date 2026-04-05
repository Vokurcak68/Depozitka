-- 021: Allow admin to perform all status transitions
-- Previously some transitions (created→partial_paid, created→paid, shipped→delivered, etc.)
-- were only allowed for 'service' role, which meant admin UI couldn't use them.

insert into public.dpt_status_transitions (from_status, to_status, allowed_actor_role, reason_required)
values
  -- Admin can manually mark payments
  ('created', 'partial_paid', 'admin', false),
  ('created', 'paid', 'admin', false),
  ('partial_paid', 'paid', 'admin', false),

  -- Admin can mark shipment stages
  ('paid', 'shipped', 'admin', false),
  ('shipped', 'delivered', 'admin', false),

  -- Admin can complete
  ('delivered', 'completed', 'admin', false),
  ('delivered', 'auto_completed', 'admin', false),

  -- Admin can confirm payout
  ('payout_sent', 'payout_confirmed', 'admin', false)
on conflict (from_status, to_status, allowed_actor_role) do nothing;
