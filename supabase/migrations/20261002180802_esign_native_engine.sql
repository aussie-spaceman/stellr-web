-- The in-app signing engine ("Stellr signing"): templates, per-signer signing
-- state, a tamper-evident audit trail, and the daily email budget.
--
-- WHY (2 Oct 2026): see docs/PLAN-esign-2026-10-02.md. DocuSign's 40-envelope
-- monthly allowance is not enough; this engine takes agreements when DocuSign
-- cannot and replaces it when the contract ends.
--
-- Agreements issued by this engine reuse docusign_envelopes and
-- docusign_envelope_recipients (provider = 'native'), so every status surface,
-- reminder and report keeps working unchanged. Everything only this engine
-- needs is new, and named esign_* from the start.
--
-- Additive and idempotent: safe to run twice.

-- ── 1. Templates ─────────────────────────────────────────────────────────────
-- One row per published version of a document. A version never changes once
-- published: an agreement pins the exact version its signers saw, and the PDF
-- is identified by its hash.
CREATE TABLE IF NOT EXISTS public.esign_templates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- minor | adult | mentor | membership_adult | membership_minor
  key                text NOT NULL,
  version            int NOT NULL CHECK (version > 0),
  title              text NOT NULL,
  -- Object path in the private agreement-templates bucket.
  pdf_path           text NOT NULL,
  pdf_sha256         text NOT NULL,
  page_count         int NOT NULL CHECK (page_count > 0),
  -- Where each field sits and who fills it (lib/esign/native/template.ts).
  field_map          jsonb NOT NULL,
  -- The agreement's text as accessible HTML, shown beside the PDF (WCAG).
  text_html          text,
  -- Version of the electronic-records disclosure signers must accept.
  disclosure_version text NOT NULL,
  source             text NOT NULL DEFAULT 'docusign-export',
  approved_by        text,
  approved_at        timestamptz,
  active             boolean NOT NULL DEFAULT false,
  created_by         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (key, version)
);

COMMENT ON TABLE public.esign_templates IS
  'Published versions of each agreement document for the in-app signing engine. Immutable once approved.';

-- At most one active version per document.
CREATE UNIQUE INDEX IF NOT EXISTS esign_templates_one_active_idx
  ON public.esign_templates (key) WHERE active;

-- An approved version cannot be edited, only superseded. Toggling `active` is
-- the one permitted change (publishing a newer version retires the old one).
CREATE OR REPLACE FUNCTION public.esign_templates_freeze()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.approved_at IS NOT NULL AND (
       NEW.pdf_path    IS DISTINCT FROM OLD.pdf_path
    OR NEW.pdf_sha256  IS DISTINCT FROM OLD.pdf_sha256
    OR NEW.field_map   IS DISTINCT FROM OLD.field_map
    OR NEW.text_html   IS DISTINCT FROM OLD.text_html
    OR NEW.disclosure_version IS DISTINCT FROM OLD.disclosure_version
    OR NEW.key         IS DISTINCT FROM OLD.key
    OR NEW.version     IS DISTINCT FROM OLD.version
    OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
  ) THEN
    RAISE EXCEPTION 'esign_templates: version % of % is approved and cannot be changed', OLD.version, OLD.key;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS esign_templates_freeze ON public.esign_templates;
CREATE TRIGGER esign_templates_freeze
  BEFORE UPDATE ON public.esign_templates
  FOR EACH ROW EXECUTE FUNCTION public.esign_templates_freeze();

REVOKE EXECUTE ON FUNCTION public.esign_templates_freeze() FROM PUBLIC;

ALTER TABLE public.esign_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.esign_templates FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.esign_templates TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role full access esign_templates"
    ON public.esign_templates FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO storage.buckets (id, name, public)
VALUES ('agreement-templates', 'agreement-templates', false)
ON CONFLICT (id) DO NOTHING;

-- ── 2. The agreement pins its template and what was pre-filled ───────────────
ALTER TABLE public.docusign_envelopes
  ADD COLUMN IF NOT EXISTS template_id       uuid REFERENCES public.esign_templates(id),
  ADD COLUMN IF NOT EXISTS prefill           jsonb,
  ADD COLUMN IF NOT EXISTS signed_pdf_bytes  bigint,
  ADD COLUMN IF NOT EXISTS certificate_bytes bigint,
  ADD COLUMN IF NOT EXISTS sealed_at         timestamptz,
  ADD COLUMN IF NOT EXISTS seal_kind         text,
  ADD COLUMN IF NOT EXISTS issue_error       text;

COMMENT ON COLUMN public.docusign_envelopes.template_id IS
  'Native engine only: the exact template version the signers saw.';
COMMENT ON COLUMN public.docusign_envelopes.prefill IS
  'Native engine only: the values pre-filled into the document when it was issued.';
COMMENT ON COLUMN public.docusign_envelopes.seal_kind IS
  'How the signed PDF is sealed: hash (SHA-256 recorded here and in the audit trail) or pades (certificate signature with a trusted timestamp).';
COMMENT ON COLUMN public.docusign_envelopes.issue_error IS
  'Why the agreement could not be issued on either engine. Set with status ''created''; listed in admin as needing paperwork.';

-- ── 3. Per-signer state for the native engine ────────────────────────────────
ALTER TABLE public.docusign_envelope_recipients
  ADD COLUMN IF NOT EXISTS invite_sent_at        timestamptz,
  ADD COLUMN IF NOT EXISTS invite_attempts       int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invite_error          text,
  ADD COLUMN IF NOT EXISTS invite_email_id       text,
  ADD COLUMN IF NOT EXISTS token_version         int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS token_expires_at      timestamptz,
  ADD COLUMN IF NOT EXISTS failed_token_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS viewed_at             timestamptz,
  ADD COLUMN IF NOT EXISTS consented_at          timestamptz,
  ADD COLUMN IF NOT EXISTS disclosure_version    text,
  ADD COLUMN IF NOT EXISTS attested_at           timestamptz,
  ADD COLUMN IF NOT EXISTS signed_ip             text,
  ADD COLUMN IF NOT EXISTS signed_user_agent     text,
  ADD COLUMN IF NOT EXISTS signature_kind        text CHECK (signature_kind IN ('typed', 'drawn')),
  ADD COLUMN IF NOT EXISTS signature_text        text,
  ADD COLUMN IF NOT EXISTS signature_image_path  text,
  ADD COLUMN IF NOT EXISTS signer_values         jsonb,
  ADD COLUMN IF NOT EXISTS declined_reason       text,
  ADD COLUMN IF NOT EXISTS member_id             uuid REFERENCES public.members(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.docusign_envelope_recipients.token_version IS
  'Native engine: bumped on void, reissue or completion so every earlier signing link stops working.';
COMMENT ON COLUMN public.docusign_envelope_recipients.signer_values IS
  'Native engine: every field value this signer entered, by field name, exactly as typed.';
COMMENT ON COLUMN public.docusign_envelope_recipients.member_id IS
  'The member signing, when the signer has an account: lets them sign from their account page.';

-- The invite outbox: native signers whose signing email has not gone yet.
CREATE INDEX IF NOT EXISTS docusign_envelope_recipients_outbox_idx
  ON public.docusign_envelope_recipients (routing_order, created_at)
  WHERE invite_sent_at IS NULL AND status = 'sent';

-- ── 4. Audit trail: append-only, hash-chained per agreement ──────────────────
CREATE TABLE IF NOT EXISTS public.esign_audit_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- docusign_envelopes.id. Not a foreign key: the trail must not vanish by
  -- cascade; it is removed only with the record, at the end of retention.
  envelope_row  uuid NOT NULL,
  recipient_row uuid,
  event         text NOT NULL CHECK (event IN (
                  'issued', 'invite_sent', 'viewed', 'consented', 'attested',
                  'field_completed', 'signed', 'declined', 'countersigned',
                  'sealed', 'completed', 'voided', 'reminded', 'downloaded',
                  'restricted', 'archived')),
  at            timestamptz NOT NULL DEFAULT clock_timestamp(),
  ip            text,
  user_agent    text,
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash     text,
  hash          text NOT NULL
);

COMMENT ON TABLE public.esign_audit_events IS
  'Everything that happened to a native-engine agreement. Append-only; each row hashes the previous one for the same agreement, so an edited or removed row breaks the chain. Written only through esign_append_audit().';

CREATE INDEX IF NOT EXISTS esign_audit_events_envelope_idx
  ON public.esign_audit_events (envelope_row, id);

-- The canonical text a row's hash covers. jsonb::text is key-sorted, so the
-- same row always hashes the same way.
CREATE OR REPLACE FUNCTION public.esign_audit_digest(
  p_prev text, p_envelope uuid, p_recipient uuid, p_event text,
  p_at timestamptz, p_ip text, p_ua text, p_detail jsonb
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(extensions.digest(
    concat_ws('|',
      coalesce(p_prev, ''),
      p_envelope::text,
      coalesce(p_recipient::text, ''),
      p_event,
      to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      coalesce(p_ip, ''),
      coalesce(p_ua, ''),
      coalesce(p_detail, '{}'::jsonb)::text
    ), 'sha256'), 'hex')
$$;

-- Appends one event. Serialised per agreement so two simultaneous events
-- cannot both claim the same predecessor and fork the chain.
CREATE OR REPLACE FUNCTION public.esign_append_audit(
  p_envelope uuid, p_recipient uuid, p_event text,
  p_ip text DEFAULT NULL, p_ua text DEFAULT NULL, p_detail jsonb DEFAULT '{}'::jsonb
) RETURNS public.esign_audit_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_prev text;
  v_at   timestamptz := clock_timestamp();
  v_row  public.esign_audit_events;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('esign_audit:' || p_envelope::text, 0));
  SELECT hash INTO v_prev FROM public.esign_audit_events
   WHERE envelope_row = p_envelope ORDER BY id DESC LIMIT 1;
  INSERT INTO public.esign_audit_events (envelope_row, recipient_row, event, at, ip, user_agent, detail, prev_hash, hash)
  VALUES (p_envelope, p_recipient, p_event, v_at, p_ip, p_ua, coalesce(p_detail, '{}'::jsonb), v_prev,
          public.esign_audit_digest(v_prev, p_envelope, p_recipient, p_event, v_at, p_ip, p_ua, coalesce(p_detail, '{}'::jsonb)))
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;

-- Recomputes an agreement's chain. Returns the id of the first row that does
-- not match, or NULL when the whole chain is intact.
CREATE OR REPLACE FUNCTION public.esign_verify_audit(p_envelope uuid)
RETURNS bigint LANGUAGE plpgsql STABLE SET search_path = public, extensions AS $$
DECLARE
  r      record;
  v_prev text := NULL;
BEGIN
  FOR r IN SELECT * FROM public.esign_audit_events WHERE envelope_row = p_envelope ORDER BY id LOOP
    IF r.prev_hash IS DISTINCT FROM v_prev
       OR r.hash <> public.esign_audit_digest(v_prev, r.envelope_row, r.recipient_row, r.event, r.at, r.ip, r.user_agent, r.detail) THEN
      RETURN r.id;
    END IF;
    v_prev := r.hash;
  END LOOP;
  RETURN NULL;
END $$;

-- The trail cannot be edited, and rows are removed only by the retention purge
-- (esign_purge_audit), which sets a transaction-local flag first.
CREATE OR REPLACE FUNCTION public.esign_audit_events_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('esign.purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'esign_audit_events is append-only (% refused)', TG_OP;
END $$;

DROP TRIGGER IF EXISTS esign_audit_events_guard ON public.esign_audit_events;
CREATE TRIGGER esign_audit_events_guard
  BEFORE UPDATE OR DELETE ON public.esign_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.esign_audit_events_guard();

-- Removes one agreement's trail at the end of its retention period.
CREATE OR REPLACE FUNCTION public.esign_purge_audit(p_envelope uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  PERFORM set_config('esign.purge', 'on', true);
  DELETE FROM public.esign_audit_events WHERE envelope_row = p_envelope;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('esign.purge', 'off', true);
  RETURN n;
END $$;

-- The head of every agreement's chain, for the daily off-database anchor.
CREATE OR REPLACE FUNCTION public.esign_audit_heads()
RETURNS TABLE (envelope_row uuid, last_id bigint, hash text)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT ON (envelope_row) envelope_row, id, hash
    FROM public.esign_audit_events
   ORDER BY envelope_row, id DESC
$$;

ALTER TABLE public.esign_audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.esign_audit_events FROM anon, authenticated;
GRANT SELECT, INSERT ON public.esign_audit_events TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role append esign_audit_events"
    ON public.esign_audit_events FOR INSERT TO service_role WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "service role read esign_audit_events"
    ON public.esign_audit_events FOR SELECT TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Functions are executable by PUBLIC by default; only the server may call these.
REVOKE EXECUTE ON FUNCTION public.esign_audit_digest(text, uuid, uuid, text, timestamptz, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.esign_append_audit(uuid, uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.esign_verify_audit(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.esign_audit_events_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.esign_purge_audit(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.esign_audit_heads() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.esign_append_audit(uuid, uuid, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.esign_verify_audit(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.esign_purge_audit(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.esign_audit_heads() TO service_role;
GRANT EXECUTE ON FUNCTION public.esign_audit_digest(text, uuid, uuid, text, timestamptz, text, text, jsonb) TO service_role;

-- ── 5. Daily email budget ────────────────────────────────────────────────────
-- Resend's free plan allows 100 emails a day across everything Stellr sends.
-- Signing emails draw on that through a counter, with a reserve kept back for
-- payment and registration mail.
CREATE TABLE IF NOT EXISTS public.esign_email_budget (
  day  date PRIMARY KEY,
  sent int NOT NULL DEFAULT 0 CHECK (sent >= 0)
);

COMMENT ON TABLE public.esign_email_budget IS
  'Signing emails sent per UTC day, so the outbox stays inside the email plan''s daily limit.';

-- Claims one send from today's budget. Returns false when it is spent.
CREATE OR REPLACE FUNCTION public.esign_claim_email(p_day date, p_limit int)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v int;
BEGIN
  INSERT INTO public.esign_email_budget (day, sent) VALUES (p_day, 0) ON CONFLICT (day) DO NOTHING;
  UPDATE public.esign_email_budget SET sent = sent + 1
   WHERE day = p_day AND sent < p_limit
  RETURNING sent INTO v;
  RETURN v IS NOT NULL;
END $$;

ALTER TABLE public.esign_email_budget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.esign_email_budget FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.esign_email_budget TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role full access esign_email_budget"
    ON public.esign_email_budget FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.esign_claim_email(date, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.esign_claim_email(date, int) TO service_role;

-- ── 6. Which school data terms a group registration accepted ─────────────────
ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS school_data_terms_version text,
  ADD COLUMN IF NOT EXISTS school_data_terms_sha256  text;

COMMENT ON COLUMN public.registrations.school_data_terms_version IS
  'Version of /school-data-terms the registering teacher accepted (school_dpa_agreed_at records when).';
