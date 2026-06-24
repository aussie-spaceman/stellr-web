-- 082_resource_links_dedup.sql
-- Global Resources Catalogue — PR2 (contribution + dedup-on-upload).
--
-- Two changes to community_resources (the stored-binary table):
--   1. Support LINK resources, not just uploaded files. A link has no storage
--      object, so storage_path becomes nullable; the destination lives in
--      source_url and file_type is set to 'link'.
--   2. Dedup keys. On contribute we hash the file (content_hash = sha256 hex) or
--      normalise the URL (normalised_url) and look for an existing binary the
--      contributor can already reach — soft-warn + attach-by-reference instead of
--      storing the same bytes / link twice (handover §5).
--
-- Additive + idempotent. Existing file rows keep storage_path and NULL dedup keys
-- (they were uploaded before hashing existed; backfilling hashes is optional and
-- not required for new-upload dedup to work).

ALTER TABLE public.community_resources
  ALTER COLUMN storage_path DROP NOT NULL;

ALTER TABLE public.community_resources
  ADD COLUMN IF NOT EXISTS source_url      text,
  ADD COLUMN IF NOT EXISTS content_hash    text,
  ADD COLUMN IF NOT EXISTS normalised_url  text;

-- Dedup lookups hit these on every contribute.
CREATE INDEX IF NOT EXISTS community_resources_content_hash_idx
  ON public.community_resources (content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS community_resources_normalised_url_idx
  ON public.community_resources (normalised_url) WHERE normalised_url IS NOT NULL;

COMMENT ON COLUMN public.community_resources.source_url IS
  'Destination of a LINK resource (file_type=''link''). NULL for uploaded files.';
COMMENT ON COLUMN public.community_resources.content_hash IS
  'sha256 hex of an uploaded file''s bytes — dedup key (Resources Catalogue §5).';
COMMENT ON COLUMN public.community_resources.normalised_url IS
  'Canonicalised source_url (tracking params / trailing slash stripped) — link dedup key.';
