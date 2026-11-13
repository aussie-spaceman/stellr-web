-- The Staff role, phase 2: who holds it, and what they must have first (13 Nov 2026).
--
-- Staff sits between Event Manager and Admin, Stellr only. An admin grants it from
-- the member page; it ACTIVATES ONLY when every prerequisite is met (owner
-- decision): a signed staff agreement, a cleared background check, MFA on their
-- Stellr login, and the staff safeguarding and privacy training. lib/staff.ts
-- decides; this records.
--
--   staff_grants         one row per grant. status moves pending → active, and
--                        active ↔ suspended when a prerequisite lapses or comes
--                        back; revoked and expired end it. At most one live
--                        (pending, active or suspended) grant per member.
--   staff_role_settings  one row: which training module is the staff training.
--   agreements           envelope_type gains 'staff', the staff agreement.
--
-- Stellr's alone: no tenant_id; a CHECK keeps any other tenant out if one is
-- ever added. Service role only, like every role table.

SET LOCAL lock_timeout = '5s';

-- ── 1. Grants ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.staff_grants (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id          uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  -- The Clerk login the role is set on, captured at activation.
  clerk_user_id      text,
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'active', 'suspended', 'revoked', 'expired')),
  granted_by         uuid REFERENCES public.members(id) ON DELETE SET NULL,
  granted_by_label   text,
  granted_at         timestamptz NOT NULL DEFAULT now(),
  activated_at       timestamptz,
  -- Never later than three years from activation, the background check's
  -- expiry, the agreement's expiry or the training's (lib/staff.ts).
  expires_at         timestamptz,
  suspended_at       timestamptz,
  -- What was missing when it last could not activate or was suspended, for the
  -- member page: codes from decideStaffEligibility.
  missing            text[] NOT NULL DEFAULT '{}',
  ended_at           timestamptz,
  ended_by           uuid REFERENCES public.members(id) ON DELETE SET NULL,
  ended_reason       text,
  -- The staff agreement this grant was issued, when one was sent.
  agreement_id       uuid REFERENCES public.agreements(id) ON DELETE SET NULL,
  reminded_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_grants_active_has_login CHECK (status <> 'active' OR (clerk_user_id IS NOT NULL AND activated_at IS NOT NULL AND expires_at IS NOT NULL)),
  CONSTRAINT staff_grants_ended CHECK ((status IN ('revoked', 'expired')) = (ended_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_grants_one_live
  ON public.staff_grants (member_id) WHERE status IN ('pending', 'active', 'suspended');
CREATE INDEX IF NOT EXISTS staff_grants_status_expires
  ON public.staff_grants (status, expires_at);
CREATE INDEX IF NOT EXISTS staff_grants_clerk_user
  ON public.staff_grants (clerk_user_id) WHERE clerk_user_id IS NOT NULL;

ALTER TABLE public.staff_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_grants TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role full access staff_grants"
    ON public.staff_grants FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE public.staff_grants IS
  'The Staff role (Stellr only, between Event Manager and Admin). A grant activates only when lib/staff.ts finds every prerequisite met: staff agreement, cleared background check, MFA, training. Service role only.';

-- ── 2. Settings ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.staff_role_settings (
  id                  boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- The Academy training module every Staff member completes. NULL: not chosen
  -- yet, and nobody can activate until it is (fails closed).
  training_module_id  uuid REFERENCES public.training_modules(id) ON DELETE SET NULL,
  updated_by          uuid REFERENCES public.members(id) ON DELETE SET NULL,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.staff_role_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.staff_role_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_role_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_role_settings TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role full access staff_role_settings"
    ON public.staff_role_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE public.staff_role_settings IS
  'One row: which training module is the Staff safeguarding and privacy training (lib/staff.ts). Service role only.';

-- ── 3. The staff agreement's envelope type ────────────────────────────────────

ALTER TABLE public.agreements
  DROP CONSTRAINT IF EXISTS docusign_envelopes_envelope_type_check;
ALTER TABLE public.agreements
  ADD CONSTRAINT docusign_envelopes_envelope_type_check
  CHECK (envelope_type IN ('minor', 'adult', 'mentor', 'volunteer', 'membership', 'tenant_guardian_consent', 'staff'));

COMMENT ON COLUMN public.agreements.envelope_type IS
  'Agreement type: minor (parental consent), adult, mentor, volunteer, membership agreement, tenant_guardian_consent (a guardian''s consent for another organiser''s event, S5 wave 6), or staff (the Staff agreement, 13 Nov 2026).';
