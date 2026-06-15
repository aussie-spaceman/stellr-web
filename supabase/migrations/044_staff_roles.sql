-- Migration 044: staff-roles function-scope seam (access-model D10 follow-up).
--
-- The platform RBAC axis. Today a single 'all' scope = full admin, and platform
-- admins are still recognised via Clerk role claims (unchanged, so nothing
-- breaks). This table is the seam: a future Graduations (or Events/Memberships)
-- staff role drops in as a scoped row without re-plumbing auth. Enforcement is
-- additive — lib/admin-auth.ts currentUserHasScope() returns true for Clerk
-- admins OR holders of the scope here.

CREATE TABLE IF NOT EXISTS public.staff_roles (
  member_id  uuid PRIMARY KEY REFERENCES public.members(id) ON DELETE CASCADE,
  scopes     text[] NOT NULL DEFAULT '{}',   -- e.g. {'all'} today; {'graduations'} later
  granted_by uuid REFERENCES public.members(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.staff_roles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access staff_roles"
    ON public.staff_roles FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
