-- 036: Admin smí ručně nastavit shipped → delivered
-- Důvod: pokud kupující nepotvrdí přes email a ShieldTrack auto-deliver neproběhne,
-- admin musí mít možnost stav nastavit ručně z UI.

INSERT INTO public.dpt_status_transitions (from_status, to_status, allowed_actor_role, reason_required)
VALUES ('shipped', 'delivered', 'admin', false)
ON CONFLICT (from_status, to_status, allowed_actor_role) DO NOTHING;
