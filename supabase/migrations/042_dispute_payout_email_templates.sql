-- 042: Email templaty pro dispute payouts
-- Dva nové template keys: dispute_payout_buyer, dispute_payout_seller

-- 1) Catalog entries
INSERT INTO public.dpt_email_template_catalog (key, title, description)
VALUES
  ('dispute_payout_buyer', 'Vypořádání sporu (kupující)', 'Informace o vyplacené částce ze sporu'),
  ('dispute_payout_seller', 'Vypořádání sporu (prodávající)', 'Informace o vyplacené částce ze sporu')
ON CONFLICT (key) DO NOTHING;

-- 2) Šablony obsahu (sloupec 'enabled' má default true, nevyplňujeme ho)
INSERT INTO public.dpt_email_templates (template_key, subject_template, body_template)
VALUES
  (
    'dispute_payout_buyer',
    'Depozitka: Vypořádání sporu ({{transaction_code}})',
    'Dobrý den {{buyer_name}}, admin vypořádal spor u transakce {{transaction_code}}. Vámi obdržená částka byla odeslána na Váš účet. Detaily najdete v Lokopolis Bazar v sekci Bezpečná platba.'
  ),
  (
    'dispute_payout_seller',
    'Depozitka: Vypořádání sporu ({{transaction_code}})',
    'Dobrý den {{seller_name}}, admin vypořádal spor u transakce {{transaction_code}}. Vámi obdržená částka byla odeslána na Váš účet (pokud Vám byla přiznána). Detaily najdete v Lokopolis Bazar v sekci Bezpečná platba.'
  )
ON CONFLICT (template_key) DO UPDATE
SET
  subject_template = EXCLUDED.subject_template,
  body_template = EXCLUDED.body_template,
  enabled = true,
  updated_at = now();
