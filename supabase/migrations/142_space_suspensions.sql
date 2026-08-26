-- 142 — community_space_suspensions: per-member negative grants on a Space.
--
-- Until now the only per-member levers were community_space_members.muted (read
-- but not post) and deleting the roster row. Deleting is useless against derived
-- access: tier, role and open grants are resolved at READ time and write no
-- roster row at all, so the member walks straight back in — and an
-- Object-inherited member is re-added by syncObjectSpaceRoster on the next
-- registration or reconcile pass. Revoking access therefore has to be a NEGATIVE
-- grant that outranks every positive one, not the absence of a positive one.
--
-- Two scopes, deliberately separate:
--   'access'  — revoked. Cannot enter or read the Space, does not appear in its
--               audience, and is dropped from announcement fan-out.
--   'posting' — suspended. May read, may not post. This supersedes
--               community_space_members.muted, which only ever existed for
--               roster members and so could not suspend a tier- or role-granted
--               member at all.
--
-- resolveSpaceAccess() checks this table before every grant branch except the
-- platform-admin bypass, so it beats open / tier / role / roster equally.
--
-- expires_at NULL = indefinite (lifted only by an admin). A row in the past is
-- treated as lifted by the resolver rather than deleted, so the history of who
-- suspended whom, and why, survives.

CREATE TABLE IF NOT EXISTS public.community_space_suspensions (
  space_id   uuid NOT NULL REFERENCES public.community_spaces(id) ON DELETE CASCADE,
  member_id  uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  scope      text NOT NULL CHECK (scope IN ('access', 'posting')),
  reason     text,
  created_by uuid REFERENCES public.members(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  PRIMARY KEY (space_id, member_id, scope)
);

-- The resolver's hot path is "every suspension on this space" (building the
-- audience) and "every suspension on this member" (the member record panel).
CREATE INDEX IF NOT EXISTS community_space_suspensions_space_idx
  ON public.community_space_suspensions (space_id, scope);
CREATE INDEX IF NOT EXISTS community_space_suspensions_member_idx
  ON public.community_space_suspensions (member_id, scope);

ALTER TABLE public.community_space_suspensions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access community_space_suspensions"
    ON public.community_space_suspensions FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Backfill the existing mutes ─────────────────────────────────────────────
-- community_space_members.muted is left in place and still READ by the resolver
-- for one release, so a rollback of the application code cannot lose an active
-- mute. New mutes are written here; the column is dropped in a later migration
-- once nothing reads it.
INSERT INTO public.community_space_suspensions (space_id, member_id, scope, reason)
  SELECT space_id, member_id, 'posting', 'Migrated from community_space_members.muted'
  FROM public.community_space_members
  WHERE muted IS TRUE
ON CONFLICT (space_id, member_id, scope) DO NOTHING;
