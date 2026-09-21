-- Verifiable credentials: one record per achievement, one public page, one
-- share flow. See docs/PLAN-credentials-linkedin-2026-09-21.md.
--
-- Replaces training_certificates (kept in place until prod is verified; the
-- rows are backfilled below). Display fields are SNAPSHOTTED at issue — the
-- same reason training_certificates captured `issuer` — so renaming a course
-- later never rewrites what somebody already put on LinkedIn.

-- ─── credentials ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.credentials (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- STL-2026-7K3MQ8ZD: the credential ID on LinkedIn, the URL path, and what a
  -- verifier types. Crockford base32 (no I/L/O/U) so it survives being read
  -- aloud. Legacy STL-2026-XXXXXX (6 hex) numbers are carried over unchanged.
  number           text NOT NULL UNIQUE,
  source           text NOT NULL CHECK (source IN ('course', 'event', 'manual')),
  member_id        uuid REFERENCES public.members(id) ON DELETE SET NULL,
  participant_id   uuid REFERENCES public.participants(id) ON DELETE SET NULL,
  module_id        uuid REFERENCES public.training_modules(id) ON DELETE SET NULL,
  event_slug       text,
  -- snapshot at issue
  recipient_name   text NOT NULL,
  title            text NOT NULL,                     -- LinkedIn "Name"
  description      text,
  criteria         text,
  skills           text[] NOT NULL DEFAULT '{}',
  issuer           text NOT NULL DEFAULT 'Stellr Education',
  role_label       text,                              -- Student / Teacher / Mentor …
  award            text,                              -- participants.award
  theme            text CHECK (theme IS NULL OR theme IN ('space', 'environmental', 'campaign')),
  badge_path       text,                              -- optional uploaded PNG override
  -- lifecycle
  issued_at        timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz,
  status           text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'revoked')),
  revoked_at       timestamptz,
  revoked_reason   text,
  revoked_by       uuid REFERENCES public.members(id) ON DELETE SET NULL,
  -- Right-to-erasure: the number still resolves (a verifier with a CV in hand
  -- gets an answer) but the name is gone.
  tombstoned_at    timestamptz,
  -- sharing
  visibility       text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  is_minor         boolean NOT NULL DEFAULT false,    -- at issue, from DOB
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- One credential per member per course, one per participant per event.
CREATE UNIQUE INDEX IF NOT EXISTS credentials_course_once
  ON public.credentials (member_id, module_id) WHERE source = 'course';
CREATE UNIQUE INDEX IF NOT EXISTS credentials_event_once
  ON public.credentials (participant_id, event_slug) WHERE source = 'event';
CREATE INDEX IF NOT EXISTS credentials_member_idx     ON public.credentials (member_id);
CREATE INDEX IF NOT EXISTS credentials_event_slug_idx ON public.credentials (event_slug);

ALTER TABLE public.credentials ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access credentials"
    ON public.credentials FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── credential_events ───────────────────────────────────────────────────────
-- Share/view telemetry. LinkedIn gives no callback, so a "linkedin_add" is a
-- click, not a confirmed profile entry. Read by the admin analytics (later).
CREATE TABLE IF NOT EXISTS public.credential_events (
  id            bigserial PRIMARY KEY,
  credential_id uuid NOT NULL REFERENCES public.credentials(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('view', 'linkedin_add', 'linkedin_share', 'copy_link', 'pdf')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credential_events_credential_idx
  ON public.credential_events (credential_id, kind);

ALTER TABLE public.credential_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access credential_events"
    ON public.credential_events FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Per-parent defaults, used at issue time ─────────────────────────────────
ALTER TABLE public.training_modules
  ADD COLUMN IF NOT EXISTS credential_title       text,
  ADD COLUMN IF NOT EXISTS credential_description text,
  ADD COLUMN IF NOT EXISTS credential_criteria    text,
  ADD COLUMN IF NOT EXISTS credential_skills      text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.event_settings
  ADD COLUMN IF NOT EXISTS credential_title       text,
  ADD COLUMN IF NOT EXISTS credential_description text,
  ADD COLUMN IF NOT EXISTS credential_criteria    text,
  ADD COLUMN IF NOT EXISTS credential_skills      text[] NOT NULL DEFAULT '{}';

-- ─── Minor sharing consent (D1, 21 Sept 2026: opt-out model) ─────────────────
-- The parental consent form reads as the guardian opting the child IN unless
-- they note otherwise. A valid completed minor envelope therefore grants
-- sharing unless this flag is set. Set by the admin today; by the form itself
-- once docs/handovers/FOLLOW-ON-docusign-minor-credential-optout.md lands.
ALTER TABLE public.docusign_envelopes
  ADD COLUMN IF NOT EXISTS credential_sharing_opt_out boolean NOT NULL DEFAULT false;

-- ─── Backfill from training_certificates ─────────────────────────────────────
INSERT INTO public.credentials (
  number, source, member_id, module_id, recipient_name, title, theme, issuer,
  issued_at, is_minor, created_at
)
SELECT
  tc.cert_number,
  'course',
  tc.member_id,
  tc.module_id,
  trim(concat_ws(' ', m.first_name, m.last_name)),
  coalesce(tm.credential_title, tm.title),
  tm.theme,
  tc.issuer,
  tc.issued_at,
  (m.date_of_birth > (current_date - interval '18 years')::date),
  tc.issued_at
FROM public.training_certificates tc
JOIN public.members m           ON m.id  = tc.member_id
JOIN public.training_modules tm ON tm.id = tc.module_id
ON CONFLICT (number) DO NOTHING;

COMMENT ON TABLE public.credentials IS
  'Verifiable credentials (course completions, event participation). Public page at /credentials/<number>; private by default.';
COMMENT ON COLUMN public.docusign_envelopes.credential_sharing_opt_out IS
  'Guardian opted the minor OUT of public credential pages. Default false = opted in (D1, 21 Sept 2026).';
