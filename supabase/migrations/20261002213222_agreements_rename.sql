-- The agreement tables get engine-neutral names: they hold Stellr signing's
-- agreements as well as DocuSign's, and will outlive DocuSign.
-- (docs/PLAN-esign-2026-10-02.md, Phase 3: "table rename behind compatibility views")
--
-- Step 1 of 2. Rename, and leave views under the old names so that code
-- deployed before this migration keeps working while the new code rolls out.
-- Simple views over one table are updatable, so inserts, updates and deletes
-- through them reach the tables.
--
-- Step 2 (docs/esign/migration-step-2-drop-compat-views.sql) drops the views.
-- Run it only once a deployment using the new names is live.
--
-- Constraint, index and policy names keep their docusign_* names: renaming
-- them changes nothing that runs, and their history is easier to follow.

ALTER TABLE public.docusign_envelopes RENAME TO agreements;
ALTER TABLE public.docusign_envelope_recipients RENAME TO agreement_recipients;

COMMENT ON TABLE public.agreements IS
  'One row per agreement issued for signing, by DocuSign or by Stellr signing (provider). Formerly docusign_envelopes.';
COMMENT ON TABLE public.agreement_recipients IS
  'The signers of each agreement, in routing order. Formerly docusign_envelope_recipients.';

-- security_invoker: the caller's own rights apply, never the view owner's.
CREATE VIEW public.docusign_envelopes WITH (security_invoker = true) AS
  SELECT * FROM public.agreements;
CREATE VIEW public.docusign_envelope_recipients WITH (security_invoker = true) AS
  SELECT * FROM public.agreement_recipients;

COMMENT ON VIEW public.docusign_envelopes IS
  'Compatibility view for code deployed before the rename. Dropped by step 2.';
COMMENT ON VIEW public.docusign_envelope_recipients IS
  'Compatibility view for code deployed before the rename. Dropped by step 2.';

REVOKE ALL ON public.docusign_envelopes, public.docusign_envelope_recipients FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.docusign_envelopes, public.docusign_envelope_recipients TO service_role;

-- The tables kept their grants and policies through the rename; restate the
-- service role's access explicitly (MCP-applied migrations have needed it).
REVOKE ALL ON public.agreements, public.agreement_recipients FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agreements, public.agreement_recipients TO service_role;

NOTIFY pgrst, 'reload schema';
