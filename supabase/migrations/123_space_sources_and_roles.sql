-- Access Convergence: Object → Space inheritance + role-based Space access.
--
-- Two additive grant mechanisms for Spaces, alongside the existing tier grants
-- (community_space_tiers):
--
--   1. community_space_sources — link an Object (Event / Training / Mentor Cohort
--      / Coaching Workshop) to a Space. Members assigned to the Object inherit an
--      active roster row (base 'member'). This is how members get into a Space —
--      they can't be invited in, only inherit (the admin "invite" flow only ever
--      grants the Moderator role on top).
--
--   2. community_space_roles — grant a Space to a Web-App role (the 11 canonical
--      member_roles, e.g. 'volunteer'). Anyone holding the role can enter. Serves
--      the volunteer user-story: a dedicated Volunteer Space granted to role
--      'volunteer', which every volunteer can reach.

-- 1. Object → Space links ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.community_space_sources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id    uuid NOT NULL REFERENCES public.community_spaces(id) ON DELETE CASCADE,
  object_type text NOT NULL CHECK (object_type IN ('event', 'training', 'mentoring', 'coaching')),
  object_ref  text NOT NULL,  -- event slug | training_module uuid | cohort uuid | coaching cohort uuid (as text)
  created_by  uuid REFERENCES public.members(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (space_id, object_type, object_ref)
);

-- Fast lookup from an object (at assignment time) back to the spaces to roster into.
CREATE INDEX IF NOT EXISTS community_space_sources_object_idx
  ON public.community_space_sources (object_type, object_ref);

ALTER TABLE public.community_space_sources ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role" ON public.community_space_sources
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Role → Space grants ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.community_space_roles (
  space_id   uuid NOT NULL REFERENCES public.community_spaces(id) ON DELETE CASCADE,
  role       text NOT NULL,  -- one of the canonical member_roles values
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, role)
);

ALTER TABLE public.community_space_roles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role" ON public.community_space_roles
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
