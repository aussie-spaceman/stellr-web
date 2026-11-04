-- S4 field encryption, shadow phase (multi-tenancy plan S4; lib/field-crypto.ts).
-- Runbook and column evidence: docs/FIELD-CRYPTO.md.
--
-- ADDITIVE ONLY. It adds:
--   1. public.tenant_data_keys: each tenant's data keys (DEKs), stored
--      wrapped by the master key, which lives only in the environment.
--   2. Nullable *_enc (versioned ciphertext) columns beside each sensitive
--      plaintext column, and *_bidx (keyed blind index) columns where an
--      equality lookup is useful, on participants, members and
--      member_pending_consent.
--
-- No plaintext column is dropped, changed or read differently. Nothing writes
-- the new columns unless FIELD_CRYPTO_MODE=shadow and a master key are set
-- (both unset by default). ADD COLUMN of a nullable column with no default is
-- a catalogue-only change; lock_timeout makes a held lock fail fast instead of
-- queueing live writers behind it.
--
-- Security: RLS on the new table, no anon/authenticated access, explicit
-- GRANTs to service_role. The service role gets no DELETE on tenant_data_keys:
-- deleting a DEK destroys every value written under it (crypto-shredding), an
-- owner-only action in the SQL editor. No SECURITY DEFINER, no function-level
-- SET, nothing that needs a superuser.

SET lock_timeout = '5s';

-- ── tenant_data_keys ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tenant_data_keys (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants (id) ON DELETE RESTRICT,
  -- The DEK's own id, written into every ciphertext and blind index it makes
  -- (lib/field-crypto.ts KEY_ID_PATTERN).
  key_id         text NOT NULL CHECK (key_id ~ '^[A-Za-z0-9_-]{1,32}$'),
  -- The master key that wraps it (FIELD_CRYPTO_KEY_ID at wrap time).
  master_key_id  text NOT NULL CHECK (master_key_id ~ '^[A-Za-z0-9_-]{1,32}$'),
  -- wk1.<master key id>.<base64url(IV | tag | ciphertext)>; AAD binds tenant and key id.
  wrapped_dek    text NOT NULL CHECK (wrapped_dek ~ '^wk1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]+$'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- Set when a DEK rotation replaces it. A retired DEK still decrypts; new
  -- values use the active one.
  retired_at     timestamptz,
  CONSTRAINT tenant_data_keys_key_unique UNIQUE (tenant_id, key_id),
  CONSTRAINT tenant_data_keys_master_matches CHECK (split_part(wrapped_dek, '.', 2) = master_key_id)
);

CREATE INDEX IF NOT EXISTS tenant_data_keys_tenant_id_idx ON public.tenant_data_keys (tenant_id);
-- At most one active DEK per tenant: two writers creating a first key race on
-- this, and the loser re-reads the winner's.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_data_keys_one_active
  ON public.tenant_data_keys (tenant_id) WHERE retired_at IS NULL;

COMMENT ON TABLE public.tenant_data_keys IS
  'Per-tenant field-encryption data keys, wrapped by the environment master key (lib/field-crypto.ts, docs/FIELD-CRYPTO.md). Never delete a row outside the documented crypto-shred procedure.';

ALTER TABLE public.tenant_data_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_data_keys FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tenant_data_keys TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role full access tenant_data_keys"
    ON public.tenant_data_keys FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Shadow columns ───────────────────────────────────────────────────────────
-- Names follow lib/field-crypto-fields.ts: <column>_enc, <column>_bidx.

ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS health_conditions_enc text,
  ADD COLUMN IF NOT EXISTS dietary_requirements_enc text,
  ADD COLUMN IF NOT EXISTS emergency_contact_first_name_enc text,
  ADD COLUMN IF NOT EXISTS emergency_contact_last_name_enc text,
  ADD COLUMN IF NOT EXISTS emergency_contact_email_enc text,
  ADD COLUMN IF NOT EXISTS emergency_contact_email_bidx text,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone_enc text,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone_bidx text,
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship_enc text;

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS health_conditions_enc text,
  ADD COLUMN IF NOT EXISTS ec_first_name_enc text,
  ADD COLUMN IF NOT EXISTS ec_last_name_enc text,
  ADD COLUMN IF NOT EXISTS ec_email_enc text,
  ADD COLUMN IF NOT EXISTS ec_email_bidx text,
  ADD COLUMN IF NOT EXISTS ec_phone_enc text,
  ADD COLUMN IF NOT EXISTS ec_phone_bidx text,
  ADD COLUMN IF NOT EXISTS ec_relationship_enc text;

ALTER TABLE public.member_pending_consent
  ADD COLUMN IF NOT EXISTS guardian_name_enc text,
  ADD COLUMN IF NOT EXISTS guardian_email_enc text,
  ADD COLUMN IF NOT EXISTS guardian_email_bidx text;

-- Blind-index lookups. Every value is NULL today, so the partial indexes are
-- empty; building them reads each table once under a SHARE lock (seconds on
-- these table sizes). Apply outside event hours (docs/FIELD-CRYPTO.md).
CREATE INDEX IF NOT EXISTS participants_emergency_contact_email_bidx_idx
  ON public.participants (emergency_contact_email_bidx) WHERE emergency_contact_email_bidx IS NOT NULL;
CREATE INDEX IF NOT EXISTS participants_emergency_contact_phone_bidx_idx
  ON public.participants (emergency_contact_phone_bidx) WHERE emergency_contact_phone_bidx IS NOT NULL;
CREATE INDEX IF NOT EXISTS members_ec_email_bidx_idx
  ON public.members (ec_email_bidx) WHERE ec_email_bidx IS NOT NULL;
CREATE INDEX IF NOT EXISTS members_ec_phone_bidx_idx
  ON public.members (ec_phone_bidx) WHERE ec_phone_bidx IS NOT NULL;
CREATE INDEX IF NOT EXISTS member_pending_consent_guardian_email_bidx_idx
  ON public.member_pending_consent (guardian_email_bidx) WHERE guardian_email_bidx IS NOT NULL;

COMMENT ON COLUMN public.participants.health_conditions_enc IS
  'S4 shadow ciphertext of health_conditions (sf1.<dek id>.<…>). Not read by the app yet. Cleared with the plaintext by the medical retention job.';
COMMENT ON COLUMN public.members.health_conditions_enc IS
  'S4 shadow ciphertext of health_conditions (sf1.<dek id>.<…>). Not read by the app yet. Cleared with the plaintext by the medical retention job.';

RESET lock_timeout;
