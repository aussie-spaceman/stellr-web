-- 125_admin_access_convergence.sql
-- Phase 0 of the admin/access console convergence (design/admin-access handover,
-- RETIREMENT-DIFF.md Phase 0). The handover planned this as 114, written against
-- main@113; migrations 114–124 (entitlements, volunteer program, space sources &
-- roles) landed in between, so it ships as 125. 123 already covers the
-- object→Space inheritance half of the design; this migration adds the rest.
--
-- Six parts:
--   1. tier_grant_rules — 'object_created' trigger, object anchor, tier_min,
--      grant kinds 'attach_object' / 'roster_add', fixed-date duration.
--   2. object_type_relations — 7×7 "row type may attach column type" matrix,
--      seeded from the design contract (access-data.js SEED_MATRIX).
--   3. Singleton object roles — one Coach per workshop, one Mentor per cohort
--      (config table + partial unique indexes on member_roles).
--   4. member_groups — Teacher / Student Manager group tracking.
--   5. Tier-Space + role-Space provisioning seed (community_space_tiers /
--      community_space_roles from 069/123).
--   6. access_redundancy_audit view — feeds the Rules-tab Conflicts panel.

-- ─── 1. Grant-rules extension ────────────────────────────────────────────────
-- Trigger vocabulary: DB stays snake_case ('object_created'); the design
-- contract's 'object-created' is mapped at the API layer.
ALTER TABLE public.tier_grant_rules DROP CONSTRAINT IF EXISTS tier_grant_rules_trigger_type_check;
ALTER TABLE public.tier_grant_rules
  ADD CONSTRAINT tier_grant_rules_trigger_type_check CHECK (trigger_type IN (
    'signup', 'event_attendance', 'event_award', 'mentor_at_event',
    'subscribe_website', 'graduation', 'manual', 'campaign_enrollment',
    'competition_registration', 'tier_purchased', 'object_created'));

-- Anchor: which object (type, or one specific object) the rule is about.
-- object_anchor_ref is text, not uuid — events are keyed by slug, containers by
-- uuid (same polymorphism as object_roles.object_id / member_roles.object_id).
ALTER TABLE public.tier_grant_rules
  ADD COLUMN IF NOT EXISTS object_type text
    CHECK (object_type IN ('space', 'course', 'workshop', 'cohort', 'event', 'campaign', 'resource')),
  ADD COLUMN IF NOT EXISTS object_anchor_ref text,
  -- Minimum membership tier filter, by canonical tier name (lib/tiers.ts).
  ADD COLUMN IF NOT EXISTS tier_min text;

-- Grant kinds: attach an object to the triggering object, or add the triggering
-- member to an object's roster. Payload mirrors the anchor shape. grant_role is
-- the member_roles value a roster_add lands with (default 'member' at runtime).
-- is_dynamic marks rules whose grant target is chosen at creation time by the
-- New Object wizard (seed r13) — grant_object_ref stays NULL for those.
ALTER TABLE public.tier_grant_rules
  ADD COLUMN IF NOT EXISTS grant_object_type text
    CHECK (grant_object_type IN ('space', 'course', 'workshop', 'cohort', 'event', 'campaign', 'resource')),
  ADD COLUMN IF NOT EXISTS grant_object_ref text,
  ADD COLUMN IF NOT EXISTS grant_role text,
  ADD COLUMN IF NOT EXISTS is_dynamic boolean NOT NULL DEFAULT false;

ALTER TABLE public.tier_grant_rules DROP CONSTRAINT IF EXISTS tier_grant_rules_grant_kind_check;
ALTER TABLE public.tier_grant_rules
  ADD CONSTRAINT tier_grant_rules_grant_kind_check
  CHECK (grant_kind IN ('tier', 'credits', 'attach_object', 'roster_add'));

-- Fixed-date duration (design contract: duration {type:'until', until:date}).
ALTER TABLE public.tier_grant_rules
  ADD COLUMN IF NOT EXISTS duration_until date;
ALTER TABLE public.tier_grant_rules DROP CONSTRAINT IF EXISTS tier_grant_rules_duration_kind_check;
ALTER TABLE public.tier_grant_rules
  ADD CONSTRAINT tier_grant_rules_duration_kind_check CHECK (duration_kind IN (
    'months', 'until_grad_july1', 'lifetime', 'match_source', 'until_date'));

ALTER TABLE public.tier_grant_rules DROP CONSTRAINT IF EXISTS tier_grant_rules_grant_shape_check;
ALTER TABLE public.tier_grant_rules
  ADD CONSTRAINT tier_grant_rules_grant_shape_check CHECK (
    (grant_kind = 'tier'    AND grant_tier_id IS NOT NULL)
    OR
    (grant_kind = 'credits' AND grant_credit_type IS NOT NULL AND grant_quantity IS NOT NULL AND grant_quantity > 0)
    OR
    (grant_kind IN ('attach_object', 'roster_add')
      AND grant_object_type IS NOT NULL
      AND (grant_object_ref IS NOT NULL OR is_dynamic))
  );

-- An object_created rule must say which object type it fires for.
ALTER TABLE public.tier_grant_rules DROP CONSTRAINT IF EXISTS tier_grant_rules_object_anchor_check;
ALTER TABLE public.tier_grant_rules
  ADD CONSTRAINT tier_grant_rules_object_anchor_check CHECK (
    trigger_type <> 'object_created' OR object_type IS NOT NULL);

CREATE INDEX IF NOT EXISTS tier_grant_rules_object_trigger_idx
  ON public.tier_grant_rules (object_type, is_active)
  WHERE trigger_type = 'object_created';

-- ─── 2. Object-type relationship matrix ─────────────────────────────────────
-- Row type "may attach" column type. Read by every attach endpoint (containers
-- contents, training assignments, space resources, cohort links) before writing,
-- and rendered as the editable 7×7 grid on the Rules tab.
CREATE TABLE IF NOT EXISTS public.object_type_relations (
  from_type  text NOT NULL
    CHECK (from_type IN ('space', 'course', 'workshop', 'cohort', 'event', 'campaign', 'resource')),
  to_type    text NOT NULL
    CHECK (to_type IN ('space', 'course', 'workshop', 'cohort', 'event', 'campaign', 'resource')),
  allowed    boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (from_type, to_type)
);

ALTER TABLE public.object_type_relations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY object_type_relations_service_all ON public.object_type_relations
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Seed = SEED_MATRIX in design/admin-access/access-data.js, verbatim.
INSERT INTO public.object_type_relations (from_type, to_type, allowed) VALUES
  ('event',    'event', false), ('event',    'campaign', false), ('event',    'space', true ), ('event',    'course', true ), ('event',    'resource', true ), ('event',    'workshop', false), ('event',    'cohort', false),
  ('campaign', 'event', false), ('campaign', 'campaign', false), ('campaign', 'space', true ), ('campaign', 'course', false), ('campaign', 'resource', false), ('campaign', 'workshop', false), ('campaign', 'cohort', true ),
  ('space',    'event', true ), ('space',    'campaign', true ), ('space',    'space', false), ('space',    'course', true ), ('space',    'resource', true ), ('space',    'workshop', false), ('space',    'cohort', true ),
  ('course',   'event', true ), ('course',   'campaign', true ), ('course',   'space', true ), ('course',   'course', false), ('course',   'resource', false), ('course',   'workshop', false), ('course',   'cohort', true ),
  ('resource', 'event', true ), ('resource', 'campaign', true ), ('resource', 'space', true ), ('resource', 'course', true ), ('resource', 'resource', false), ('resource', 'workshop', true ), ('resource', 'cohort', true ),
  ('workshop', 'event', false), ('workshop', 'campaign', false), ('workshop', 'space', false), ('workshop', 'course', true ), ('workshop', 'resource', true ), ('workshop', 'workshop', false), ('workshop', 'cohort', false),
  ('cohort',   'event', false), ('cohort',   'campaign', false), ('cohort',   'space', false), ('cohort',   'course', true ), ('cohort',   'resource', true ), ('cohort',   'workshop', false), ('cohort',   'cohort', false)
ON CONFLICT (from_type, to_type) DO NOTHING;

-- The unified Managers tab spans all seven object types; widen the legacy
-- object_roles vocabulary additively (old values stay valid).
ALTER TABLE public.object_roles DROP CONSTRAINT IF EXISTS object_roles_object_type_check;
ALTER TABLE public.object_roles
  ADD CONSTRAINT object_roles_object_type_check CHECK (object_type IN (
    'event', 'group', 'container',
    'space', 'course', 'workshop', 'cohort', 'campaign', 'resource'));

-- ─── 3. Singleton object roles ───────────────────────────────────────────────
-- One Coach per workshop, one Mentor per cohort (SINGLETON_ROLE_BY_TYPE in the
-- design contract). Config table read by lib/object-roles.ts write guards;
-- partial unique indexes are the hard backstop on member_roles.
CREATE TABLE IF NOT EXISTS public.object_type_singleton_roles (
  object_type text PRIMARY KEY
    CHECK (object_type IN ('space', 'course', 'workshop', 'cohort', 'event', 'campaign', 'resource')),
  role public.member_role_type NOT NULL
);

ALTER TABLE public.object_type_singleton_roles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY object_type_singleton_roles_service_all ON public.object_type_singleton_roles
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO public.object_type_singleton_roles (object_type, role) VALUES
  ('workshop', 'coach'),
  ('cohort',   'mentor')
ON CONFLICT (object_type) DO NOTHING;

-- Dedupe before tightening: keep the earliest grant per object, drop later ones.
-- The coaching match flow already assumes one Coach (see
-- app/api/admin/coaching/requests/[id]/match), so surviving rows are the truth.
DELETE FROM public.member_roles mr
USING public.member_roles keeper
WHERE mr.scope = 'object' AND keeper.scope = 'object'
  AND mr.object_type = keeper.object_type
  AND mr.object_id IS NOT DISTINCT FROM keeper.object_id
  AND mr.role = keeper.role
  AND ((mr.object_type = 'workshop' AND mr.role = 'coach')
    OR (mr.object_type = 'cohort'   AND mr.role = 'mentor'))
  AND keeper.created_at < mr.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS member_roles_singleton_workshop_coach_idx
  ON public.member_roles (object_type, object_id)
  WHERE scope = 'object' AND object_type = 'workshop' AND role = 'coach';

CREATE UNIQUE INDEX IF NOT EXISTS member_roles_singleton_cohort_mentor_idx
  ON public.member_roles (object_type, object_id)
  WHERE scope = 'object' AND object_type = 'cohort' AND role = 'mentor';

-- ─── 4. Member groups (Teacher / Student Manager group tracking) ────────────
CREATE TABLE IF NOT EXISTS public.member_groups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  name       text NOT NULL,
  event_slug text,  -- set when the group came from a bulk event registration
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.member_group_members (
  group_id  uuid NOT NULL REFERENCES public.member_groups(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, member_id)
);

CREATE INDEX IF NOT EXISTS member_groups_owner_idx ON public.member_groups (owner_id);
CREATE INDEX IF NOT EXISTS member_group_members_member_idx ON public.member_group_members (member_id);

ALTER TABLE public.member_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_group_members ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY member_groups_service_all ON public.member_groups
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY member_group_members_service_all ON public.member_group_members
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 5. Tier-Space + role-Space provisioning seed ────────────────────────────
-- One Space per canonical membership tier (auto-roster via community_space_tiers)
-- and one per adult web-app role (auto-access via community_space_roles, 123).
-- Private: reachable only through the tier/role grant, but visible once held.
DO $$
DECLARE
  t record;
  s_id uuid;
  r text;
  role_names text[] := ARRAY['staff', 'coach', 'mentor', 'moderator', 'teacher', 'volunteer'];
  role_labels text[] := ARRAY['Staff Room', 'Coaches'' Room', 'Mentors'' Room', 'Moderators'' Room', 'Teachers'' Room', 'Volunteers'' Room'];
  i int;
BEGIN
  -- Tier Spaces
  FOR t IN
    SELECT id, name FROM public.membership_tiers
    WHERE name IN ('Explorer', 'Pathfinder', 'Scholar', 'Alumni', 'Contributor',
                   'Counselor', 'Educator', 'Catalyst', 'Innovator', 'Trailblazer')
  LOOP
    INSERT INTO public.community_spaces (slug, name, description, access_type, min_tier_rank, display_order)
    VALUES ('tier-' || lower(t.name), t.name || ' Tier Space',
            'Members-only space for everyone on the ' || t.name || ' tier.',
            'private', 0, 100)
    ON CONFLICT (slug) DO NOTHING;

    SELECT id INTO s_id FROM public.community_spaces WHERE slug = 'tier-' || lower(t.name);
    INSERT INTO public.community_space_tiers (space_id, tier_id)
    VALUES (s_id, t.id)
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Role Spaces (adult web-app roles)
  FOR i IN 1..array_length(role_names, 1) LOOP
    r := role_names[i];
    INSERT INTO public.community_spaces (slug, name, description, access_type, min_tier_rank, display_order)
    VALUES ('role-' || r, role_labels[i],
            'Space for everyone holding the ' || r || ' role.',
            'private', 0, 110)
    ON CONFLICT (slug) DO NOTHING;

    SELECT id INTO s_id FROM public.community_spaces WHERE slug = 'role-' || r;
    INSERT INTO public.community_space_roles (space_id, role)
    VALUES (s_id, r)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- Group-chat channel for each newly seeded space (mirrors 120's Commons seed).
INSERT INTO public.community_channels (space_id, slug, name, display_order)
SELECT s.id, 'general', 'General', 0
FROM public.community_spaces s
WHERE (s.slug LIKE 'tier-%' OR s.slug LIKE 'role-%')
  AND NOT EXISTS (
    SELECT 1 FROM public.community_channels c
    WHERE c.space_id = s.id AND c.slug = 'general')
;

-- ─── 6. Redundancy audit (Rules-tab Conflicts panel) ────────────────────────
-- Members who reach the same object twice: an object-scoped roster/consume role
-- in member_roles PLUS either a manage-role on the same object or a legacy
-- object_roles manager row. Read-only; the panel just SELECTs it.
CREATE OR REPLACE VIEW public.access_redundancy_audit AS
SELECT a.member_id,
       a.object_type,
       a.object_id,
       a.role::text  AS roster_role,
       b.role::text  AS manager_role,
       'member_roles'::text AS manager_source
FROM public.member_roles a
JOIN public.member_roles b
  ON b.member_id = a.member_id
 AND b.object_type = a.object_type
 AND b.object_id IS NOT DISTINCT FROM a.object_id
WHERE a.scope = 'object' AND b.scope = 'object'
  AND a.role IN ('member', 'participant')
  AND b.role IN ('moderator', 'mentor', 'coach')
UNION ALL
SELECT mr.member_id,
       mr.object_type,
       mr.object_id,
       mr.role::text,
       orl.role,
       'object_roles'
FROM public.member_roles mr
JOIN public.object_roles orl
  ON orl.member_id = mr.member_id
 AND orl.object_type = mr.object_type
 AND orl.object_id = mr.object_id
WHERE mr.scope = 'object'
  AND mr.role IN ('member', 'participant');
