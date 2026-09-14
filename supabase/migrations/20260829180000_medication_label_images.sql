/**
 * A place to actually keep the label photo a medication was scanned or
 * added from — `medications.image_url` already existed in the schema but
 * nothing ever wrote to it or had a bucket to write it into. The scan
 * pipeline (api/src/pipeline/medication-label.ts) reads a photo once and
 * discards it; there was no way to look at the original label again after
 * the fact, the same gap trip_documents closed for trip e-tickets.
 *
 * Private bucket, not the public trip-photos-style pattern — a label photo
 * routinely shows a real patient's name, hospital number, and prescribing
 * doctor (confirmed directly from real labels transcribed this session),
 * which is exactly the kind of sensitive scan the `documents` bucket
 * comment already draws this line for.
 *
 * Despite the column being named `image_url`, this stores a STORAGE PATH,
 * not a public URL — resolved to a signed URL on read, same as
 * trip_documents.file_path. Renaming the column would be a larger,
 * unrelated migration for no functional gain; a code comment at every
 * write/read site says so instead.
 */
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('medication-labels', 'medication-labels', false, 15728640)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "medication_labels_storage" ON storage.objects FOR ALL
  USING (
    bucket_id = 'medication-labels'
    AND ((storage.foldername(name))[1])::uuid = auth.uid()
  );
