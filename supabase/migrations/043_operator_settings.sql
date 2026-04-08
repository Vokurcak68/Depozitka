-- 043: Operátorské údaje (Depozitka jako provozovatel)
-- Místo brát logo/firmu z dpt_marketplaces (= jednotlivé bazary), bereme to
-- centrálně z dpt_settings.operator. Marketplace zůstává jen pro název bazaru
-- v textech/subjectech, ale branding (logo, firma, IČO, kontakt) je provozovatel.

-- 1) Vložit defaultní řádek do dpt_settings (key='operator')
INSERT INTO public.dpt_settings (key, value, description)
VALUES (
  'operator',
  jsonb_build_object(
    'companyName', 'Depozitka s.r.o.',
    'companyAddress', '',
    'companyId', '',
    'companyVatId', '',
    'logoUrl', '',
    'accentColor', '#2563eb',
    'supportEmail', 'noreplay@depozitka.eu',
    'websiteUrl', 'https://depozitka.eu'
  ),
  'Údaje o provozovateli Depozitky (zobrazují se v patičce všech emailů)'
)
ON CONFLICT (key) DO NOTHING;

-- 2) Storage bucket pro logo provozovatele (public read)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'dpt-operator',
  'dpt-operator',
  true,
  2097152, -- 2 MB
  ARRAY['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 3) Storage policy: public read, authenticated write
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'dpt_operator_public_read'
  ) THEN
    CREATE POLICY "dpt_operator_public_read"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'dpt-operator');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'dpt_operator_auth_write'
  ) THEN
    CREATE POLICY "dpt_operator_auth_write"
      ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'dpt-operator' AND auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'dpt_operator_auth_update'
  ) THEN
    CREATE POLICY "dpt_operator_auth_update"
      ON storage.objects FOR UPDATE
      USING (bucket_id = 'dpt-operator' AND auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'dpt_operator_auth_delete'
  ) THEN
    CREATE POLICY "dpt_operator_auth_delete"
      ON storage.objects FOR DELETE
      USING (bucket_id = 'dpt-operator' AND auth.role() = 'authenticated');
  END IF;
END $$;
