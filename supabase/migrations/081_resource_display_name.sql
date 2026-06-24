-- 081_resource_display_name.sql
-- Global Resources Catalogue (Resources_Refactor handover) — PR1, read path.
--
-- Decision 1 (rename propagation): a member-supplied name is PER-ATTACHMENT, not
-- per-binary. Renaming a resource in one container must not rewrite its title in
-- every other container it's attached to. The catalogue resolves the shown name as
--   COALESCE(container_contents.display_name, community_resources.title)
-- so a NULL display_name inherits the binary's title (the default for every
-- existing row). Edit is gated in the app to the binary's uploader (handover §4.4).
--
-- Additive + idempotent: no backfill, existing rows keep display_name = NULL and
-- therefore render exactly as today.

ALTER TABLE public.container_contents
  ADD COLUMN IF NOT EXISTS display_name text;

COMMENT ON COLUMN public.container_contents.display_name IS
  'Per-attachment override of the resource title (Resources Catalogue, decision 1). '
  'NULL inherits community_resources.title. Scoped to this attachment only.';
