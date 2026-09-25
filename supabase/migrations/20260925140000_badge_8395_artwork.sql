-- Name badges on a second Avery product (lib/badge-layout.ts).
-- badge_artwork_path stays the Avery 5392 (4×3″ insert) background; 8395
-- (3⅜×2⅓″ adhesive label) is a different shape, so it has its own.
ALTER TABLE public.event_settings
  ADD COLUMN IF NOT EXISTS badge_8395_artwork_path text;

COMMENT ON COLUMN public.event_settings.badge_artwork_path IS
  'Name badge background for Avery 5392 (4x3in inserts). Path in community-resources.';
COMMENT ON COLUMN public.event_settings.badge_8395_artwork_path IS
  'Name badge background for Avery 8395 (3.375x2.333in labels). Path in community-resources.';
