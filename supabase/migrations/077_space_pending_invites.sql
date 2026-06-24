-- Migration 077: Spaces — pending invites by email (auto-claim on signup)
--   (Renumbered from 074 — that slot, plus 075/076, were taken by parallel
--    sessions already applied in prod. This independent, unapplied migration
--    moves after the remote head. No SQL change.)
--
-- Closes the invite #1 gap: an admin can invite an email that has NO account yet.
-- We can't put them on a space roster (community_space_members.member_id is a hard
-- FK to members), so the invite is parked here by email and CLAIMED when that
-- person first signs up — the Clerk user.created webhook converts the pending row
-- into a real 'invited' roster row, so they see the normal accept/decline banner.

CREATE TABLE IF NOT EXISTS public.community_space_invites (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id          uuid NOT NULL REFERENCES public.community_spaces(id) ON DELETE CASCADE,
  email             text NOT NULL,                 -- stored normalized (lowercased/trimmed)
  role              text NOT NULL DEFAULT 'member' CHECK (role IN ('mentor', 'member')),
  invited_by        uuid REFERENCES public.members(id) ON DELETE SET NULL,
  invited_at        timestamptz NOT NULL DEFAULT now(),
  claimed_at        timestamptz,
  claimed_member_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
  UNIQUE (space_id, email)
);

-- Lookup by email when a new member signs up (claim path).
CREATE INDEX IF NOT EXISTS community_space_invites_email_idx
  ON public.community_space_invites(email) WHERE claimed_at IS NULL;

ALTER TABLE public.community_space_invites ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access community_space_invites"
    ON public.community_space_invites FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
