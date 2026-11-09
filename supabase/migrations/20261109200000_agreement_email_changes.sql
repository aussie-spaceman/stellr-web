-- Bounced signing emails: who is told, and who may fix the address (9 Nov 2026).
--
-- 1. agreement_recipients.bounce_notified_email: the address a bounce notice
--    was last sent for. A notice is sent only when the row's current address
--    differs from it, claimed with a compare-and-set, so DocuSign Connect, the
--    reminder cron, the roster refresh and the Resend webhook can all notice
--    the same bounce and only one of them announces it. A corrected address
--    that bounces again is a new address, so it is announced again.
--    Backfilled for every signer already bounced, so deploying this does not
--    re-announce old bounces.
--
-- 2. agreement_email_changes: every correction of a bounced address that did
--    not come from staff, and every suggestion waiting for an adult:
--      organiser   the group's teacher, student manager or nominated teacher
--                  corrected it in Your group (applied at once)
--      direct      the parent/guardian on the form corrected the student's
--                  address through a one-time link (applied at once)
--      suggestion  the student suggested a parent/guardian address through a
--                  one-time link; applied only when an adult approves
--    A one-time link is stored as a SHA-256 hash, never the token itself.

ALTER TABLE public.agreement_recipients
  ADD COLUMN IF NOT EXISTS bounce_notified_email text;

UPDATE public.agreement_recipients
   SET bounce_notified_email = lower(email)
 WHERE status = 'autoresponded'
   AND bounce_notified_email IS NULL
   AND email IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.agreement_email_changes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id          uuid NOT NULL REFERENCES public.agreements (id) ON DELETE CASCADE,
  -- The signer, by the engine's recipient id (stable across corrections).
  recipient_id          text NOT NULL CHECK (char_length(recipient_id) BETWEEN 1 AND 100),
  role_name             text CHECK (role_name IS NULL OR char_length(role_name) <= 100),
  kind                  text NOT NULL CHECK (kind IN ('organiser', 'direct', 'suggestion')),
  status                text NOT NULL DEFAULT 'link_sent'
                          CHECK (status IN ('link_sent', 'pending', 'applied', 'rejected', 'superseded')),
  old_email             text NOT NULL CHECK (char_length(old_email) <= 320),
  new_email             text CHECK (new_email IS NULL OR char_length(new_email) <= 320),
  -- Who asked: the other signer's role and the address the link went to, or
  -- the organiser's member id for kind 'organiser'.
  requested_by_role     text CHECK (requested_by_role IS NULL OR char_length(requested_by_role) <= 100),
  requested_by_email    text CHECK (requested_by_email IS NULL OR char_length(requested_by_email) <= 320),
  requested_by_member   uuid,
  token_hash            text UNIQUE CHECK (token_hash IS NULL OR char_length(token_hash) = 64),
  token_expires_at      timestamptz,
  used_at               timestamptz,
  decided_by_member     uuid,
  decided_by_label      text CHECK (decided_by_label IS NULL OR char_length(decided_by_label) <= 300),
  decided_at            timestamptz,
  tenant_id             uuid REFERENCES public.tenants (id) ON DELETE RESTRICT,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agreement_email_changes_tenant_id_idx ON public.agreement_email_changes (tenant_id);
CREATE INDEX IF NOT EXISTS agreement_email_changes_agreement_idx ON public.agreement_email_changes (agreement_id, recipient_id);
CREATE INDEX IF NOT EXISTS agreement_email_changes_pending_idx ON public.agreement_email_changes (status) WHERE status = 'pending';

DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.agreement_email_changes;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF agreement_id, tenant_id ON public.agreement_email_changes
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_inherit_tenant_id('agreement_id', 'agreements');

ALTER TABLE public.agreement_email_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agreement_email_changes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agreement_email_changes TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role full access agreement_email_changes"
    ON public.agreement_email_changes FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Tenant isolation (S4): read-only to tenant_app, like agreement_recipients.
GRANT SELECT ON public.agreement_email_changes TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.agreement_email_changes;
CREATE POLICY tenant_isolation ON public.agreement_email_changes AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.agreement_email_changes;
CREATE POLICY tenant_isolation_guard ON public.agreement_email_changes AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (agreement_email_changes.agreement_id IS NULL OR EXISTS (SELECT 1 FROM public.agreements p WHERE p.id = agreement_email_changes.agreement_id)));

-- An agreement moved to another tenant takes its change rows with it, as it
-- does its signers and logs (20261106074112_via_parent_tenant_carry.sql).
DROP TRIGGER IF EXISTS zzz_tenancy_carry_children ON public.agreements;
CREATE TRIGGER zzz_tenancy_carry_children
  AFTER UPDATE ON public.agreements
  FOR EACH ROW
  WHEN (OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NOT NULL AND OLD.tenant_id <> NEW.tenant_id)
  EXECUTE FUNCTION public.tenancy_carry_children('agreement_recipients', 'envelope_row', 'esign_access_log', 'envelope_row', 'esign_audit_events', 'envelope_row', 'agreement_email_changes', 'agreement_id');

COMMENT ON TABLE public.agreement_email_changes IS
  'Corrections of a bounced signing address made outside staff tools, and student suggestions awaiting an adult (lib/esign/email-changes.ts).';
COMMENT ON COLUMN public.agreement_recipients.bounce_notified_email IS
  'Lower-cased address the last bounce notice was sent for (lib/esign/bounce-notices.ts).';
