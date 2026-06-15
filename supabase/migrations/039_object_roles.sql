-- Migration 039: object roles (access-model Phase 3 — the "manage" axis)
--
-- Generalises the per-event event_manager_assignments into ONE explicit,
-- auditable grant of management authority over a single object + its children.
-- Replaces group control that was previously DERIVED from registration email
-- matching (a latent bug: it broke on email changes and mis-stored Student
-- Managers as school_students).
--
-- Decisions:
--   D4 — a single all-or-nothing 'manager' role (add capabilities later if needed)
--   D5 — the grantee must be a member (members row) but need NOT hold any tier
--        (so an external partner gets a members row, then a manager grant)

CREATE TABLE IF NOT EXISTS public.object_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  object_type text NOT NULL CHECK (object_type IN ('event', 'group', 'container')),
  object_id   text NOT NULL,                -- event_slug, registration id, or container id
  role        text NOT NULL DEFAULT 'manager' CHECK (role IN ('manager')),
  granted_by  uuid REFERENCES public.members(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, object_type, object_id, role)
);

CREATE INDEX IF NOT EXISTS object_roles_member_idx ON public.object_roles(member_id);
CREATE INDEX IF NOT EXISTS object_roles_object_idx ON public.object_roles(object_type, object_id);

ALTER TABLE public.object_roles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access object_roles"
    ON public.object_roles FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backfill existing Event Manager assignments so no delegation is lost. Maps each
-- assignment's clerk_user_id → members.id; rows without a matching member are
-- skipped (the assigner can re-add them once a members row exists, per D5).
INSERT INTO public.object_roles (member_id, object_type, object_id, role)
SELECT m.id, 'event', ema.event_slug, 'manager'
FROM public.event_manager_assignments ema
JOIN public.members m ON m.clerk_user_id = ema.clerk_user_id
WHERE ema.event_slug IS NOT NULL
ON CONFLICT (member_id, object_type, object_id, role) DO NOTHING;
