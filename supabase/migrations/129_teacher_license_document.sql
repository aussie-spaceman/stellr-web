-- 129_teacher_license_document.sql
-- Teacher license image upload.
--
-- Teachers can attach a photo/scan of their teaching license to their license
-- record (Account → Background Check & License). The image is sensitive PII, so
-- it lives in a PRIVATE storage bucket and is only ever served via short-lived
-- signed URLs. The member can delete the image at any time (clears document_path
-- and removes the object).

ALTER TABLE public.member_teacher_licenses
  ADD COLUMN IF NOT EXISTS document_path text;

-- Private bucket for license images (mirrors campaign-proposals in migration 120).
INSERT INTO storage.buckets (id, name, public)
VALUES ('teacher-licenses', 'teacher-licenses', false)
ON CONFLICT (id) DO NOTHING;
