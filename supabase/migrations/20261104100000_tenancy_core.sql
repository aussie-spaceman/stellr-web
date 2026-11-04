-- S3 "Tenant and event data model" (multi-tenancy plan), step 1 of 5.
--
-- The four tables that will become the authority on who belongs where:
--
--   tenants             one row per organisation running events on the
--                       platform. Stellr Education is tenant #1 and the
--                       platform owner (seeded below with a fixed id, exported
--                       from lib/tenancy/constants.ts as STELLR_TENANT_ID).
--   tenant_domains      host -> tenant, for the S5 proxy rewrite.
--   tenant_memberships  who holds a role inside a tenant.
--   platform_admins     who administers the platform itself.
--
-- BACKGROUND ONLY. Nothing in the app reads these tables yet: Clerk metadata
-- and the existing guards stay the authority until S5. Nothing here changes a
-- live flow (registration, check-in, payments, e-sign, uploads).
--
-- Security: RLS on every table, no anon/authenticated access at all, explicit
-- GRANTs to service_role (a migration applied through the MCP otherwise
-- leaves new tables unreadable even to service_role). No SECURITY DEFINER.
-- docs/TENANCY-S3.md is the runbook.

-- ── tenants ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tenants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                text NOT NULL UNIQUE
                        CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
  legal_name          text NOT NULL CHECK (char_length(legal_name) BETWEEN 1 AND 200),
  display_name        text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  country             text NOT NULL CHECK (country IN ('US', 'AU')),
  payment_region      text NOT NULL CHECK (payment_region IN ('US', 'AU')),
  currency            text NOT NULL CHECK (currency IN ('usd', 'aud')),
  -- US Employer Identification Number, "12-3456789". AU tenants leave it null.
  ein                 text CHECK (ein IS NULL OR ein ~ '^[0-9]{2}-[0-9]{7}$'),
  -- Australian Business Number, 11 digits. US tenants leave it null.
  abn                 text CHECK (abn IS NULL OR abn ~ '^[0-9]{11}$'),
  gst_registered      boolean NOT NULL DEFAULT false,
  -- Logo, palette, sender name (S10). Never personal data.
  branding            jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(branding) = 'object'),
  -- IANA zone, e.g. America/Denver or Australia/Sydney. Shape-checked here;
  -- the S6 provisioning form validates it against Intl (a CHECK cannot query
  -- pg_timezone_names).
  time_zone           text NOT NULL CHECK (time_zone ~ '^[A-Za-z_]+(?:/[A-Za-z0-9_+-]+)+$' OR time_zone = 'UTC'),
  -- The platform owner (Stellr) is the only tenant allowed to admit
  -- participants younger than 14: its own events run under its COPPA consent
  -- flow. Every other tenant's events are 14+ (owner decision; plan §2).
  is_platform_owner   boolean NOT NULL DEFAULT false,
  min_participant_age int NOT NULL DEFAULT 14,
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('provisioning', 'active', 'suspended', 'archived')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenants_min_participant_age_check
    CHECK (min_participant_age >= 0 AND (min_participant_age >= 14 OR is_platform_owner)),
  -- Payments follow the region: US tenants settle in USD, AU tenants in AUD.
  CONSTRAINT tenants_region_currency_check
    CHECK ((payment_region = 'US' AND currency = 'usd') OR (payment_region = 'AU' AND currency = 'aud'))
);

-- At most one platform owner.
CREATE UNIQUE INDEX IF NOT EXISTS tenants_one_platform_owner
  ON public.tenants (is_platform_owner) WHERE is_platform_owner;

COMMENT ON TABLE public.tenants IS
  'Organisations running events on the platform. Stellr is tenant #1 (lib/tenancy/constants.ts STELLR_TENANT_ID). S3: background only, read by nothing yet.';

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenants FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role full access tenants"
    ON public.tenants FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Stellr Education, tenant #1. The id is a fixed constant so code, triggers
-- and tests can name it without a lookup. EIN left null: an owner action
-- (docs/TENANCY-S3.md).
INSERT INTO public.tenants (
  id, slug, legal_name, display_name, country, payment_region, currency,
  time_zone, is_platform_owner, min_participant_age, status
) VALUES (
  '00000000-0000-4000-8000-000000000001', 'stellr', 'Stellr Education', 'Stellr Education',
  'US', 'US', 'usd', 'America/Denver', true, 0, 'active'
) ON CONFLICT (id) DO NOTHING;

-- ── tenant_domains ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tenant_domains (
  host        text PRIMARY KEY
                CHECK (host = lower(host) AND host ~ '^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$'),
  tenant_id   uuid NOT NULL REFERENCES public.tenants (id) ON DELETE RESTRICT,
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenant_domains_tenant_id_idx ON public.tenant_domains (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_domains_one_primary
  ON public.tenant_domains (tenant_id) WHERE is_primary;

COMMENT ON TABLE public.tenant_domains IS
  'Host -> tenant map for the S5 proxy rewrite. Empty in S3: Stellr''s own hosts need no mapping (no host = Stellr).';

ALTER TABLE public.tenant_domains ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_domains FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_domains TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role full access tenant_domains"
    ON public.tenant_domains FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── tenant_memberships ───────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.tenant_role AS ENUM ('tenant_admin', 'event_manager', 'staff');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.tenant_memberships (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  -- A login (Clerk user id) and/or a member record. Staff roles are keyed by
  -- member today (staff_roles.member_id), event managers by Clerk id
  -- (event_manager_assignments.clerk_user_id); one of the two is required.
  clerk_user_id  text CHECK (clerk_user_id IS NULL OR char_length(clerk_user_id) BETWEEN 1 AND 100),
  member_id      uuid REFERENCES public.members (id) ON DELETE CASCADE,
  role           public.tenant_role NOT NULL,
  -- Where the row came from: 'role_mapping' (scripts/map-tenancy-roles.ts) or 'admin'.
  source         text NOT NULL DEFAULT 'admin' CHECK (char_length(source) BETWEEN 1 AND 40),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_memberships_subject_check CHECK (clerk_user_id IS NOT NULL OR member_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS tenant_memberships_tenant_id_idx ON public.tenant_memberships (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_memberships_clerk_unique
  ON public.tenant_memberships (tenant_id, clerk_user_id, role) WHERE clerk_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tenant_memberships_member_unique
  ON public.tenant_memberships (tenant_id, member_id, role) WHERE member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tenant_memberships_clerk_user_id_idx
  ON public.tenant_memberships (clerk_user_id) WHERE clerk_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tenant_memberships_member_id_idx
  ON public.tenant_memberships (member_id) WHERE member_id IS NOT NULL;

COMMENT ON TABLE public.tenant_memberships IS
  'Roles inside a tenant (tenant_admin | event_manager | staff). S3: data only, not yet an authority — no guard reads it.';

ALTER TABLE public.tenant_memberships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_memberships FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_memberships TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role full access tenant_memberships"
    ON public.tenant_memberships FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── platform_admins ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.platform_admins (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id  text NOT NULL UNIQUE CHECK (char_length(clerk_user_id) BETWEEN 1 AND 100),
  -- Who granted it: a Clerk user id, or 'owner' for the initial owner-run mapping.
  granted_by     text NOT NULL CHECK (char_length(granted_by) BETWEEN 1 AND 100),
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.platform_admins IS
  'Platform (super) administrators. Written only by the owner (docs/TENANCY-S3.md, owner action). S3: data only — admin access is still the Clerk role claim.';

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_admins FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_admins TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role full access platform_admins"
    ON public.platform_admins FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
