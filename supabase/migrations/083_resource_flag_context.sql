-- 083_resource_flag_context.sql
-- Global Resources Catalogue — PR3 (flagging reuses the chat moderation pipeline).
--
-- community_flags already accepts content_type='resource' (migration 069) and the
-- flag API already de-dupes per member. This adds the two context fields the
-- handover §4.3 asks a resource report to capture beyond the shared columns:
--   • note               — optional free-text, separate from the reason enum
--   • viewed_in_container — the container the resource was viewed in when flagged
--     (the same binary can be fine in one object and not another). Lets the admin
--     queue show the source object and remove just that one attachment.
--
-- Additive + idempotent. Existing post/comment flags are unaffected (both NULL).

ALTER TABLE public.community_flags
  ADD COLUMN IF NOT EXISTS note                 text,
  ADD COLUMN IF NOT EXISTS viewed_in_container  text;

COMMENT ON COLUMN public.community_flags.note IS
  'Optional reporter free-text, distinct from the reason enum (Resources Catalogue §4.3).';
COMMENT ON COLUMN public.community_flags.viewed_in_container IS
  'For resource flags: the container (mentoring_cohorts.id) the resource was viewed in.';
