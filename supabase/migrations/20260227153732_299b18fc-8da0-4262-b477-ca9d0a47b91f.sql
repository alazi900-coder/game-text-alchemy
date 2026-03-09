
-- Create storage bucket for bundled translations (public read)
INSERT INTO storage.buckets (id, name, public) VALUES ('bundled-translations', 'bundled-translations', true);

-- Anyone can download the bundled translations
CREATE POLICY "Public can read bundled translations"
ON storage.objects FOR SELECT
USING (bucket_id = 'bundled-translations');

-- Authenticated users can upload/update bundled translations
CREATE POLICY "Authenticated users can upload bundled translations"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'bundled-translations');

CREATE POLICY "Authenticated users can update bundled translations"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'bundled-translations');
