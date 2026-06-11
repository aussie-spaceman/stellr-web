-- Migration 025: Membership Studio — tier metadata, grant-rules engine, grant provenance.
--
-- Adds the admin-configurable layer the PRD calls for (§9: "configurable pricing
-- and tier rules without code changes"). Three parts:
--   1. membership_tiers   — descriptive/marketing metadata + a default grant length.
--                           PRICE stays in Stripe (stripe_price_id); we never store $.
--   2. member_memberships — provenance columns so every grant records HOW it happened
--                           (stripe | rule | manual | system) and WHICH rule fired.
--   3. tier_grant_rules   — the new rules table: "when <trigger> [matching <conditions>]
--                           grant <tier> for <duration>". Replaces the hardcoded logic
--                           in lib/membership-rules.ts and the inline event/alumni grants.
--
-- Conventions follow prior migrations: IF NOT EXISTS guards, service-role RLS,
-- gen_random_uuid() PKs. member_memberships / membership_tiers predate the tracked
-- migrations (live-DB baseline) so all column adds are defensive.

-- ─── 1. membership_tiers metadata ──────────────────────────────────────────
ALTER TABLE public.membership_tiers
  ADD COLUMN IF NOT EXISTS description          text,
  ADD COLUMN IF NOT EXISTS marketing_copy       text,
  ADD COLUMN IF NOT EXISTS badge_color          text,      -- tailwind ramp key e.g. 'green' | 'blue' | 'amber' | 'purple'
  ADD COLUMN IF NOT EXISTS default_grant_months integer,   -- default duration when granted by a rule (null = lifetime)
  ADD COLUMN IF NOT EXISTS eligible_roles       text[];    -- event_role enum values this tier may be assigned to

-- Seed sensible metadata for the known tiers (PRD §2). Only fills blanks.
UPDATE public.membership_tiers SET badge_color = COALESCE(badge_color, CASE WHEN is_free THEN 'green' ELSE 'blue' END);
UPDATE public.membership_tiers SET default_grant_months = COALESCE(default_grant_months, CASE WHEN is_free THEN NULL ELSE 12 END);

UPDATE public.membership_tiers SET description = COALESCE(description, 'Access all public content.')               WHERE name = 'Guest';
UPDATE public.membership_tiers SET description = COALESCE(description, 'Top-of-funnel subscriber via the website.') WHERE name = 'Subscriber';
UPDATE public.membership_tiers SET description = COALESCE(description, 'Free tier for high-school students (SQL).')  WHERE name = 'Explorer';
UPDATE public.membership_tiers SET description = COALESCE(description, 'Lowest paid student tier — 1yr free if event participant.') WHERE name = 'Pathfinder';
UPDATE public.membership_tiers SET description = COALESCE(description, 'Event award winner tier.')                  WHERE name = 'Scholar';
UPDATE public.membership_tiers SET description = COALESCE(description, 'Free tier — auto-granted July 1 of the graduating year.') WHERE name = 'Alumni';
UPDATE public.membership_tiers SET description = COALESCE(description, 'Lowest paid mentor tier — 1yr free if mentor at an event.') WHERE name = 'Contributor';
UPDATE public.membership_tiers SET description = COALESCE(description, 'Free educator tier — using our material / bringing participants.') WHERE name = 'Educator';
UPDATE public.membership_tiers SET description = COALESCE(description, 'Lowest paid educator tier — 1yr free if event participant.') WHERE name = 'Innovator';

-- ─── 2. member_memberships provenance ──────────────────────────────────────
ALTER TABLE public.member_memberships
  ADD COLUMN IF NOT EXISTS source           text NOT NULL DEFAULT 'manual',  -- 'stripe'|'rule'|'manual'|'system'
  ADD COLUMN IF NOT EXISTS granted_by_rule  uuid;

-- Backfill provenance for rows that predate this migration.
UPDATE public.member_memberships SET source = 'stripe' WHERE stripe_subscription_id IS NOT NULL AND source = 'manual';
UPDATE public.member_memberships SET source = 'system' WHERE is_complimentary = true       AND source = 'manual';

CREATE INDEX IF NOT EXISTS member_memberships_source_idx ON public.member_memberships(source);
CREATE INDEX IF NOT EXISTS member_memberships_rule_idx   ON public.member_memberships(granted_by_rule);

-- ─── 3. tier_grant_rules ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tier_grant_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  trigger_type    text NOT NULL CHECK (trigger_type IN (
                    'signup', 'event_attendance', 'event_award',
                    'mentor_at_event', 'subscribe_website', 'graduation', 'manual')),
  -- Optional match constraints. Recognised keys (all optional, AND-ed together):
  --   age_bracket     text   — member.age_bracket must equal this
  --   event_role      text   — member.event_role must equal this
  --   award_contains  text   — case-insensitive substring of the award (event_award only)
  conditions      jsonb NOT NULL DEFAULT '{}'::jsonb,
  grant_tier_id   uuid NOT NULL REFERENCES public.membership_tiers(id) ON DELETE CASCADE,
  -- Duration of the grant.
  --   'months'           → expires_at = now + duration_months
  --   'until_grad_july1' → expires on July 1 of member.graduation_year (Alumni)
  --   'lifetime'         → no practical expiry
  duration_kind   text NOT NULL DEFAULT 'months'
                    CHECK (duration_kind IN ('months', 'until_grad_july1', 'lifetime')),
  duration_months integer,
  -- When true, granting this tier expires the member's active FREE memberships.
  replaces_free   boolean NOT NULL DEFAULT true,
  -- Higher priority wins when several rules match the same trigger for a member.
  priority        integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES public.members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tier_grant_rules_trigger_idx
  ON public.tier_grant_rules(trigger_type, is_active, priority DESC);

ALTER TABLE public.tier_grant_rules ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access tier_grant_rules"
    ON public.tier_grant_rules FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Seed starter rules (mirrors lib/membership-rules.ts + PRD §2 table) ────
-- Each insert is guarded so re-running the migration is idempotent.
DO $$
DECLARE
  t_pathfinder  uuid := (SELECT id FROM public.membership_tiers WHERE name = 'Pathfinder'  LIMIT 1);
  t_scholar     uuid := (SELECT id FROM public.membership_tiers WHERE name = 'Scholar'     LIMIT 1);
  t_contributor uuid := (SELECT id FROM public.membership_tiers WHERE name = 'Contributor' LIMIT 1);
  t_innovator   uuid := (SELECT id FROM public.membership_tiers WHERE name = 'Innovator'   LIMIT 1);
  t_alumni      uuid := (SELECT id FROM public.membership_tiers WHERE name = 'Alumni'      LIMIT 1);
BEGIN
  IF t_pathfinder IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tier_grant_rules WHERE name = 'Student attends event → Pathfinder (1yr)') THEN
    INSERT INTO public.tier_grant_rules (name, trigger_type, conditions, grant_tier_id, duration_kind, duration_months, priority)
    VALUES ('Student attends event → Pathfinder (1yr)', 'event_attendance',
            '{"event_role":"school_student"}'::jsonb, t_pathfinder, 'months', 12, 10);
  END IF;

  IF t_scholar IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tier_grant_rules WHERE name = 'Award winner → Scholar (1yr)') THEN
    INSERT INTO public.tier_grant_rules (name, trigger_type, conditions, grant_tier_id, duration_kind, duration_months, priority)
    VALUES ('Award winner → Scholar (1yr)', 'event_award',
            '{"event_role":"school_student"}'::jsonb, t_scholar, 'months', 12, 50);
  END IF;

  IF t_contributor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tier_grant_rules WHERE name = 'Mentor at event → Contributor (1yr)') THEN
    INSERT INTO public.tier_grant_rules (name, trigger_type, conditions, grant_tier_id, duration_kind, duration_months, priority)
    VALUES ('Mentor at event → Contributor (1yr)', 'mentor_at_event',
            '{"event_role":"mentor"}'::jsonb, t_contributor, 'months', 12, 10);
  END IF;

  IF t_innovator IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tier_grant_rules WHERE name = 'Teacher attends event → Innovator (1yr)') THEN
    INSERT INTO public.tier_grant_rules (name, trigger_type, conditions, grant_tier_id, duration_kind, duration_months, priority)
    VALUES ('Teacher attends event → Innovator (1yr)', 'event_attendance',
            '{"event_role":"teacher"}'::jsonb, t_innovator, 'months', 12, 10);
  END IF;

  IF t_alumni IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tier_grant_rules WHERE name = 'Graduation → Alumni (July 1)') THEN
    INSERT INTO public.tier_grant_rules (name, trigger_type, conditions, grant_tier_id, duration_kind, priority)
    VALUES ('Graduation → Alumni (July 1)', 'graduation', '{}'::jsonb, t_alumni, 'until_grad_july1', 10);
  END IF;
END $$;

-- Signup default-tier rules (replaces the hardcoded map in app/api/members/onboarding).
-- These grant the member's freemium tier on profile completion. Lifetime, and
-- replaces_free=false (they ARE the free tier — nothing to expire). The evaluator
-- picks the highest-priority matching rule, so role-specific beats the Subscriber
-- catch-all. Looked up by the exact tier names the onboarding code resolves today.
DO $$
DECLARE
  s_explorer uuid := (SELECT id FROM public.membership_tiers WHERE name = 'Explorer'        LIMIT 1);
  s_advisor  uuid := (SELECT id FROM public.membership_tiers WHERE name = 'Advisor'         LIMIT 1);
  s_educator uuid := (SELECT id FROM public.membership_tiers WHERE name = 'Educator'        LIMIT 1);
  s_donor    uuid := (SELECT id FROM public.membership_tiers WHERE name = 'Donor'           LIMIT 1);
  s_parent   uuid := (SELECT id FROM public.membership_tiers WHERE name = 'Parent/Guardian' LIMIT 1);
  s_subscr   uuid := (SELECT id FROM public.membership_tiers WHERE name = 'Subscriber'      LIMIT 1);
BEGIN
  IF s_explorer IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tier_grant_rules WHERE name = 'Signup: high-school → Explorer') THEN
    INSERT INTO public.tier_grant_rules (name, trigger_type, conditions, grant_tier_id, duration_kind, replaces_free, priority)
    VALUES ('Signup: high-school → Explorer', 'signup', '{"age_bracket":"high_school"}'::jsonb, s_explorer, 'lifetime', false, 30);
  END IF;
  IF s_advisor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tier_grant_rules WHERE name = 'Signup: college → Advisor') THEN
    INSERT INTO public.tier_grant_rules (name, trigger_type, conditions, grant_tier_id, duration_kind, replaces_free, priority)
    VALUES ('Signup: college → Advisor', 'signup', '{"age_bracket":"college"}'::jsonb, s_advisor, 'lifetime', false, 30);
  END IF;
  IF s_educator IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tier_grant_rules WHERE name = 'Signup: teacher → Educator') THEN
    INSERT INTO public.tier_grant_rules (name, trigger_type, conditions, grant_tier_id, duration_kind, replaces_free, priority)
    VALUES ('Signup: teacher → Educator', 'signup', '{"age_bracket":"adult","event_role":"teacher"}'::jsonb, s_educator, 'lifetime', false, 40);
  END IF;
  IF s_donor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tier_grant_rules WHERE name = 'Signup: adult mentor → Donor') THEN
    INSERT INTO public.tier_grant_rules (name, trigger_type, conditions, grant_tier_id, duration_kind, replaces_free, priority)
    VALUES ('Signup: adult mentor → Donor', 'signup', '{"age_bracket":"adult","event_role":"mentor"}'::jsonb, s_donor, 'lifetime', false, 40);
  END IF;
  IF s_parent IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tier_grant_rules WHERE name = 'Signup: parent → Parent/Guardian') THEN
    INSERT INTO public.tier_grant_rules (name, trigger_type, conditions, grant_tier_id, duration_kind, replaces_free, priority)
    VALUES ('Signup: parent → Parent/Guardian', 'signup', '{"age_bracket":"adult","event_role":"parent"}'::jsonb, s_parent, 'lifetime', false, 40);
  END IF;
  IF s_subscr IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tier_grant_rules WHERE name = 'Signup: default → Subscriber') THEN
    INSERT INTO public.tier_grant_rules (name, trigger_type, conditions, grant_tier_id, duration_kind, replaces_free, priority)
    VALUES ('Signup: default → Subscriber', 'signup', '{}'::jsonb, s_subscr, 'lifetime', false, 0);
  END IF;
END $$;
