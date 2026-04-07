-- 042: Email templaty pro dispute payouts
-- Dva nové template keys: dispute_payout_buyer, dispute_payout_seller

-- 1) Catalog entries
INSERT INTO public.dpt_email_template_catalog (key, title, description)
VALUES
  ('dispute_payout_buyer', 'Vypořádání sporu (kupující)', 'Informace o vyplacené částce ze sporu'),
  ('dispute_payout_seller', 'Vypořádání sporu (prodávající)', 'Informace o vyplacené částce ze sporu')
ON CONFLICT (key) DO NOTHING;

-- 2) Šablony obsahu
INSERT INTO public.dpt_email_templates (template_key, subject_template, body_template, enabled)
VALUES
  (
    'dispute_payout_buyer',
    'Vypořádání sporu — transakce {{transaction_code}}',
    E'Dobrý den {{buyer_name}},\n\n' ||
    E'admin vypořádal spor u transakce {{transaction_code}}.\n\n' ||
    E'Vámi obdržená částka byla odeslána na Váš účet.\n' ||
    E'Detaily najdete v Lokopolis Bazar v sekci Bezpečná platba.\n\n' ||
    E'V případě dotazů pište na info@lokopolis.cz.\n\n' ||
    E'S pozdravem,\nLokopolis Bazar'
  ),
  (
    'dispute_payout_seller',
    'Vypořádání sporu — transakce {{transaction_code}}',
    E'Dobrý den {{seller_name}},\n\n' ||
    E'admin vypořádal spor u transakce {{transaction_code}}.\n\n' ||
    E'Vámi obdržená částka byla odeslána na Váš účet (pokud Vám byla přiznána).\n' ||
    E'Detaily najdete v Lokopolis Bazar v sekci Bezpečná platba.\n\n' ||
    E'V případě dotazů pište na info@lokopolis.cz.\n\n' ||
    E'S pozdravem,\nLokopolis Bazar'
  )
ON CONFLICT (template_key) DO UPDATE
SET
  subject_template = EXCLUDED.subject_template,
  body_template = EXCLUDED.body_template,
  enabled = EXCLUDED.enabled;
