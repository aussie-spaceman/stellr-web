-- Team profiles (7 Oct 2026): the short pre-event form each student fills in
-- so companies can be balanced, replacing the per-event Google Form.
--
-- One row per participant (one student, one event). The row is the invitation
-- and the answers together: it is created when the student's permission form
-- is complete and the first email goes out, and the answers stay editable
-- until the event starts. A student's history is their rows across events,
-- so "how my answers changed" needs nothing more than this table.
--
-- The link token is derived (HMAC of id + token_version, lib/team-profile/
-- tokens.ts); only its SHA-256 is stored. Bumping token_version revokes it.

CREATE TABLE IF NOT EXISTS public.team_profiles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id      uuid NOT NULL UNIQUE REFERENCES public.participants(id) ON DELETE CASCADE,
  member_id           uuid REFERENCES public.members(id) ON DELETE SET NULL,
  event_slug          text NOT NULL,
  token_hash          text NOT NULL UNIQUE,
  token_version       int  NOT NULL DEFAULT 1,
  -- The returning student's previous answers this row was pre-filled from.
  prefilled_from      uuid REFERENCES public.team_profiles(id) ON DELETE SET NULL,
  -- Question set the answers were given against (lib/team-profile/questions.ts).
  definition_version  int  NOT NULL DEFAULT 1,
  -- { questionKey: value }. Pre-filled answers sit here before submitted_at is set.
  answers             jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at        timestamptz,
  first_sent_at       timestamptz,
  last_sent_at        timestamptz,
  send_count          int  NOT NULL DEFAULT 0,
  last_send_error     text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS team_profiles_event_slug_idx ON public.team_profiles (event_slug);
CREATE INDEX IF NOT EXISTS team_profiles_member_idx ON public.team_profiles (member_id, submitted_at DESC);

COMMENT ON TABLE public.team_profiles IS
  'Pre-event team profile per student participant: invitation + answers. Used to balance companies.';

-- Students an admin or event manager placed by hand. Auto-assign leaves them
-- where they are; moving a student back to "unassigned" clears it.
ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS company_locked boolean NOT NULL DEFAULT false;

ALTER TABLE public.team_profiles ENABLE ROW LEVEL SECURITY;
-- Service role only: every read and write goes through the app's server code.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_profiles TO service_role;
