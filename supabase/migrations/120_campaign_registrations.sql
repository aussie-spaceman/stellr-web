-- 120_campaign_registrations.sql
-- Campaign Registrations feature.
--
-- Campaigns are a Competition sub-type: asynchronous, free (no payment gateway),
-- run over a Spring/Fall season, with a student PROPOSAL submitted before a
-- deadline. We reuse the existing `registrations` table rather than a parallel
-- one — a campaign registration is a lightweight row (no per-person roster, no
-- payment, no DocuSign) that shares event_slug/title + teacher_* contact fields
-- with event registrations.
--
-- Content (name/theme/season/deadline/deliverable) lives in Sanity; this table
-- only records WHO registered WHICH campaign slug and the proposal they submit.

-- ── registrations: allow the 'campaign' type + campaign-specific columns ──────
-- The base CHECK only permitted individual/group (see supabase/schema.sql).
ALTER TABLE public.registrations
  DROP CONSTRAINT IF EXISTS registrations_type_check;
ALTER TABLE public.registrations
  ADD CONSTRAINT registrations_type_check CHECK (type IN ('individual', 'group', 'campaign'));

ALTER TABLE public.registrations
  -- Group / class name entered in the registration modal (e.g. "Yr 11 Engineering").
  ADD COLUMN IF NOT EXISTS group_name             text,
  -- Free-text role of the registrant as typed in the modal (e.g. "Teacher").
  -- Distinct from the constrained registrant_role enum used by event group regos.
  ADD COLUMN IF NOT EXISTS contact_role           text,
  -- Proposal submission (one deliverable per campaign registration). File lives in
  -- the private `campaign-proposals` storage bucket; path is stored here.
  ADD COLUMN IF NOT EXISTS proposal_storage_path  text,
  ADD COLUMN IF NOT EXISTS proposal_file_name     text,
  ADD COLUMN IF NOT EXISTS proposal_notes         text,
  ADD COLUMN IF NOT EXISTS proposal_submitted_at  timestamptz;

-- Reuse existing columns for campaign rows:
--   event_slug / event_title  → the Sanity campaign slug + title
--   teacher_first/last/email  → the registrant (educator or student manager)
--   teacher_member_id         → link to their members row (added in an earlier migration)
--   student_count             → approx. students (added in an earlier migration)
--   status                    → 'confirmed' on register (campaigns need no payment step)

-- One registration per (member, campaign). Guards double-registration; the API
-- also checks by email for signed-out flows.
CREATE UNIQUE INDEX IF NOT EXISTS registrations_campaign_member_unique
  ON public.registrations (event_slug, teacher_member_id)
  WHERE type = 'campaign' AND teacher_member_id IS NOT NULL;

-- ── Storage: private bucket for uploaded proposals ───────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('campaign-proposals', 'campaign-proposals', false)
ON CONFLICT (id) DO NOTHING;

-- ── Educator Commons: the single free "global competition" Space ─────────────
-- Every free Educator / student manager is auto-enrolled. Because it is `open`,
-- resolveSpaceAccess() grants access to all members with no roster row required.
-- Free material + group chat, NO deadline and NO registered students — the space
-- prompts educators to move into a specific Campaign to get those.
INSERT INTO public.community_spaces (slug, name, description, theme, access_type, min_tier_rank, display_order)
VALUES (
  'educator-commons',
  'Educator Commons',
  'A single space for every educator and student manager. Grab free campaign material, ask questions in the group chat. No deadlines here — register a group in a Campaign when you''re ready to submit.',
  'campaign',
  'open',
  0,
  -10   -- surface near the top of the Spaces directory
)
ON CONFLICT (slug) DO NOTHING;

-- Group-chat channel for the Commons (reserved slug 'general').
INSERT INTO public.community_channels (space_id, slug, name, display_order)
SELECT id, 'general', 'Group chat', 0 FROM public.community_spaces WHERE slug = 'educator-commons'
ON CONFLICT (space_id, slug) DO NOTHING;

-- Assigned FREE resources (open to every educator via the open space). The
-- gated "Judging rubric & exemplar proposals — Catalyst tier" row is rendered as
-- a static upsell in the page, not seeded here: this database has no per-resource
-- tier-gating table deployed (community_resources.min_tier_rank was dropped in
-- migr 084 and community_resource_tiers is not present), so a seeded rubric would
-- be downloadable by all — which defeats the gate.
-- NOTE (ops): storage_path values are placeholders — upload the real files to the
-- resources bucket via Admin → Community → Resources and repoint these paths.
INSERT INTO public.community_resources (space_id, title, description, storage_path, file_type)
SELECT s.id, r.title, r.description, r.storage_path, r.file_type
FROM public.community_spaces s
CROSS JOIN (VALUES
  ('Campaign starter pack (PDF)',            'How to run a Campaign with your group, end to end.', 'educator-commons/campaign-starter-pack.pdf',      'application/pdf'),
  ('Space theme — workshop slides',          'Ready-to-teach slides for the Space theme.',         'educator-commons/space-workshop-slides.pdf',      'application/pdf'),
  ('Environmental theme — workshop slides',  'Ready-to-teach slides for the Environmental theme.', 'educator-commons/environmental-workshop-slides.pdf', 'application/pdf')
) AS r(title, description, storage_path, file_type)
WHERE s.slug = 'educator-commons'
  AND NOT EXISTS (
    SELECT 1 FROM public.community_resources cr
    WHERE cr.space_id = s.id AND cr.title = r.title
  );
