-- Migration 048: enable RLS on docusign_envelopes (Supabase security advisor 0013).
--
-- The Supabase linter flagged `public.docusign_envelopes` as RLS-disabled in a
-- PostgREST-exposed schema. Because the `anon` and `authenticated` roles hold
-- table grants on every public table, an RLS-disabled table is fully readable
-- AND writable by anyone holding the public anon key (shipped to every browser).
-- This table holds PII: signer names/emails and minor names.
--
-- Every code path that touches docusign_envelopes uses the service-role client
-- (supabaseServer(), SUPABASE_SERVICE_ROLE_KEY), which BYPASSES RLS — so enabling
-- RLS here has ZERO impact on the app. After this, anon/authenticated have no
-- applicable policy and are denied; the service role keeps full access.
--
-- NOTE: the policy below is intentionally scoped `TO service_role`, NOT `TO public`.
-- Most older tables in this project use a "service role full access" policy that
-- is actually granted to {public} with USING(true) — which leaves them open to
-- the anon key despite RLS being "enabled". Do not copy that pattern here.
-- (See the systemic re-scoping follow-up.)

ALTER TABLE public.docusign_envelopes ENABLE ROW LEVEL SECURITY;

-- Documentary policy so the table doesn't trip the "rls_enabled_no_policy"
-- advisor. service_role already bypasses RLS; this changes nothing for it and
-- grants nothing to anon/authenticated.
DROP POLICY IF EXISTS "service role full access docusign_envelopes" ON public.docusign_envelopes;
CREATE POLICY "service role full access docusign_envelopes"
  ON public.docusign_envelopes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
