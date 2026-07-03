-- Migration 121: Volunteer program foundation (PRD §15 — Volunteer Registration / Event Sign Up)
--
-- Four parts:
--   1. event_role_type gains 'volunteer' — the public volunteer signup sets it as
--      the member's registration classification (the additive member_roles row is
--      synced from it, and can also be granted independently by an admin).
--   2. docusign_envelopes.envelope_type gains 'volunteer' — the Volunteer Agreement,
--      dispatched at volunteer onboarding and reusable for 3 years like the others.
--   3. volunteer_event_interest — a volunteer's "I can support this event/campaign"
--      signal. Admins see interested volunteers on the event roster and assign
--      manually; assignment itself is a participants row (event_role='volunteer').
--   4. Signup grant rules — volunteers land on the free tier for their bracket:
--      college → Alumni, adult → Educator (priority 50 beats the bracket defaults).
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block; run each
-- statement on its own (the Supabase SQL editor does this automatically).

ALTER TYPE public.event_role_type ADD VALUE IF NOT EXISTS 'volunteer';

-- ─── 2. Volunteer Agreement envelope type ────────────────────────────────────
ALTER TABLE public.docusign_envelopes
  DROP CONSTRAINT IF EXISTS docusign_envelopes_envelope_type_check;
ALTER TABLE public.docusign_envelopes
  ADD CONSTRAINT docusign_envelopes_envelope_type_check
  CHECK (envelope_type IN ('minor', 'adult', 'mentor', 'volunteer'));

COMMENT ON COLUMN public.docusign_envelopes.envelope_type IS
  'Agreement type: minor (parental consent), adult, mentor, or volunteer agreement.';

-- ─── 3. volunteer_event_interest ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.volunteer_event_interest (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  event_slug  text NOT NULL,
  event_title text NOT NULL,
  status      text NOT NULL DEFAULT 'interested' CHECK (status IN ('interested', 'withdrawn')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, event_slug)
);

CREATE INDEX IF NOT EXISTS volunteer_event_interest_event_idx
  ON public.volunteer_event_interest(event_slug, status);
CREATE INDEX IF NOT EXISTS volunteer_event_interest_member_idx
  ON public.volunteer_event_interest(member_id, status);

ALTER TABLE public.volunteer_event_interest ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access volunteer_event_interest"
    ON public.volunteer_event_interest FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 3b. Volunteer assignment rails ──────────────────────────────────────────
-- Admin assignment puts the volunteer on the event-level container roster with a
-- distinct relationship (portal access, same rail as direct grants), and records
-- an event_participations row marked role='volunteer' (member history).
ALTER TABLE public.cohort_members DROP CONSTRAINT IF EXISTS cohort_members_relationship_check;
ALTER TABLE public.cohort_members
  ADD CONSTRAINT cohort_members_relationship_check
  CHECK (relationship IN ('participant', 'host', 'manager', 'volunteer'));

ALTER TABLE public.event_participations
  ADD COLUMN IF NOT EXISTS role text;
COMMENT ON COLUMN public.event_participations.role IS
  'How the member took part: NULL = attendee/competitor (default), ''volunteer'' = assigned event volunteer.';

-- ─── 4. Volunteer signup grant rules ─────────────────────────────────────────
-- Volunteers get member access via the free tier for their bracket. Priority 50
-- beats the bracket catch-alls (30/40) so the volunteer-specific rule wins.
DO $$
DECLARE
  t_alumni   uuid := (SELECT id FROM public.membership_tiers WHERE name = 'Alumni'   LIMIT 1);
  t_educator uuid := (SELECT id FROM public.membership_tiers WHERE name = 'Educator' LIMIT 1);
BEGIN
  IF t_alumni IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tier_grant_rules WHERE name = 'Signup: volunteer (college) → Alumni') THEN
    INSERT INTO public.tier_grant_rules (name, trigger_type, conditions, grant_tier_id, duration_kind, replaces_free, priority)
    VALUES ('Signup: volunteer (college) → Alumni', 'signup',
            '{"age_bracket":"college","event_role":"volunteer"}'::jsonb, t_alumni, 'lifetime', false, 50);
  END IF;
  IF t_educator IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tier_grant_rules WHERE name = 'Signup: volunteer (adult) → Educator') THEN
    INSERT INTO public.tier_grant_rules (name, trigger_type, conditions, grant_tier_id, duration_kind, replaces_free, priority)
    VALUES ('Signup: volunteer (adult) → Educator', 'signup',
            '{"age_bracket":"adult","event_role":"volunteer"}'::jsonb, t_educator, 'lifetime', false, 50);
  END IF;
END $$;
