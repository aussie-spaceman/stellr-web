-- Agreement tables rename, step 2 of 2: drop the compatibility views.
--
-- NOT in supabase/migrations on purpose. Step 1
-- (supabase/migrations/20261002213222_agreements_rename.sql) renamed the tables
-- and left views under the old names for code deployed before it. Run this
-- only after a production deployment that uses the new names (agreements,
-- agreement_recipients) is live and the previous deployment can no longer
-- serve requests. Then add it as a migration so every environment matches.
--
-- Check first that nothing still reads the views, e.g. no errors naming
-- docusign_envelopes in the Vercel runtime logs for a day after the deploy.

DROP VIEW IF EXISTS public.docusign_envelope_recipients;
DROP VIEW IF EXISTS public.docusign_envelopes;

NOTIFY pgrst, 'reload schema';
