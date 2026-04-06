-- 034: Povolit kupujícímu potvrdit doručení přímo ze stavu shipped
-- (ne jen z delivered — ShieldTrack auto-deliver nemusí proběhnout)
INSERT INTO public.dpt_status_transitions (from_status, to_status, allowed_actor_role, reason_required)
VALUES ('shipped', 'completed', 'buyer', false)
ON CONFLICT (from_status, to_status, allowed_actor_role) DO NOTHING;
