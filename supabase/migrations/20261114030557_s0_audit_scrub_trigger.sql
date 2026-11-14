-- S0 audit scrub (docs/THREAT-MODEL.md TB4 I): stop the audit trigger copying
-- health and emergency-contact data into audit_log.
--
-- `audit_members()` (supabase/baseline.sql) is the trigger function behind
-- `trg_audit_members` on public.members. It wrote `to_jsonb(OLD)` and
-- `to_jsonb(NEW)` whole, so every change to a member copied
-- `health_conditions`, the emergency contact (`ec_*`) and, since S4, their
-- `*_enc` ciphertext and `*_bidx` blind indexes into `audit_log` in the clear.
--
-- This replaces the function so both row images lose those keys before the
-- insert. Everything else in the row (names, email, role, timestamps) is still
-- recorded, so the audit trail still shows who changed which member and when.
--
-- The key list is the S4 sensitive-column catalogue (lib/field-crypto-fields.ts):
-- every plaintext column on participants, members and member_pending_consent,
-- plus its `_enc` and, where one exists, `_bidx` shadow. The function names
-- only TG_TABLE_NAME, so the same list is right for any table it is attached
-- to. scripts/scrub-audit-health.ts holds the same list as SCRUB_KEYS, and
-- scripts/scrub-audit-health.test.ts fails if this array and that constant, or
-- that constant and the catalogue, ever differ.
--
-- Forward-only and non-destructive: no existing audit_log or deletion_archive
-- row is touched here. Rows written before this migration still hold the
-- values; scripts/scrub-audit-health.ts scrubs them, and only the owner runs it,
-- after a backup (docs/RUNBOOK-privacy-retention-and-deletion.md, Part E).
--
-- CREATE OR REPLACE keeps the function's owner, grants and the trigger that
-- calls it. Not SECURITY DEFINER (unchanged), so check-migration-security.mjs
-- has nothing to seal.

CREATE OR REPLACE FUNCTION public.audit_members() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  -- scrub-keys:begin (scripts/scrub-audit-health.ts SCRUB_KEYS; keep sorted)
  v_scrub CONSTANT text[] := ARRAY[
    'dietary_requirements',
    'dietary_requirements_enc',
    'ec_email',
    'ec_email_bidx',
    'ec_email_enc',
    'ec_first_name',
    'ec_first_name_enc',
    'ec_last_name',
    'ec_last_name_enc',
    'ec_phone',
    'ec_phone_bidx',
    'ec_phone_enc',
    'ec_relationship',
    'ec_relationship_enc',
    'emergency_contact_email',
    'emergency_contact_email_bidx',
    'emergency_contact_email_enc',
    'emergency_contact_first_name',
    'emergency_contact_first_name_enc',
    'emergency_contact_last_name',
    'emergency_contact_last_name_enc',
    'emergency_contact_phone',
    'emergency_contact_phone_bidx',
    'emergency_contact_phone_enc',
    'emergency_contact_relationship',
    'emergency_contact_relationship_enc',
    'guardian_email',
    'guardian_email_bidx',
    'guardian_email_enc',
    'guardian_name',
    'guardian_name_enc',
    'health_conditions',
    'health_conditions_enc'
  ]::text[];
  -- scrub-keys:end
BEGIN
  INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data)
  VALUES (
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP::public.audit_action_type,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) - v_scrub END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) - v_scrub END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.audit_members() IS
  'Audit trigger: copies the changed row into audit_log without health, dietary, emergency-contact or guardian-contact columns (S0 audit scrub). Key list mirrored by SCRUB_KEYS in scripts/scrub-audit-health.ts.';
