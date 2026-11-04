-- S3 "Tenant and event data model" (multi-tenancy plan), step 2 of 5.
--
-- public.events — a Postgres MIRROR of Sanity's event documents. Sanity stays
-- the source of truth for event content in S3 (S8 moves events into Postgres).
-- The mirror exists so the database can answer "which tenant owns this
-- event?" for the tenant_id derivation trigger (step 3) and, later, for RLS.
--
-- Fed by:
--   * the existing event webhook, POST /api/admin/sanity/event-sync, which now
--     also calls lib/events/sync.ts — additively, inside try/catch, so a mirror
--     failure never fails the webhook;
--   * lib/events/repo.ts, which syncs an event on a mirror miss (never awaited
--     on the live registration path);
--   * scripts/backfill-events-mirror.ts (dry run by default).
--
-- Every Stellr event belongs to Stellr (tenant #1); the sync sets tenant_id to
-- STELLR_TENANT_ID until S8 gives events an editor and an owner.
--
-- slug is globally unique in release 1 (tenant-scoped uniqueness is S8). Event
-- documents hold no personal data (Sanity's free datasets are public), so raw
-- is safe to keep.
--
-- Security: RLS on, no anon/authenticated access, explicit service_role GRANTs.

CREATE TABLE IF NOT EXISTS public.events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES public.tenants (id) ON DELETE RESTRICT,
  slug                 text NOT NULL UNIQUE CHECK (char_length(slug) BETWEEN 1 AND 200),
  -- The Sanity document _id ("drafts." ids are never mirrored).
  sanity_id            text NOT NULL UNIQUE
                         CHECK (char_length(sanity_id) BETWEEN 1 AND 200 AND sanity_id NOT LIKE 'drafts.%'),
  title                text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  -- 'live_event' | 'campaign' (Sanity activityType; unset documents are live events).
  activity_type        text NOT NULL DEFAULT 'live_event' CHECK (activity_type IN ('live_event', 'campaign')),
  -- starts_at: local midnight of the first day in time_zone. ends_at: the
  -- EXCLUSIVE end, local midnight after the last day. Null for campaigns and
  -- undated events.
  starts_at            timestamptz,
  ends_at              timestamptz,
  time_zone            text NOT NULL CHECK (time_zone ~ '^[A-Za-z_]+(?:/[A-Za-z0-9_+-]+)+$' OR time_zone = 'UTC'),
  -- ISO 3166-1 alpha-2 of the venue. Not limited to US/AU: Stellr runs events
  -- elsewhere (the tenant's country is what is limited).
  country              text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  currency             text NOT NULL CHECK (currency IN ('usd', 'aud')),
  grade_system         text NOT NULL CHECK (grade_system IN ('us_grades', 'au_years')),
  -- Null = the tenant's minimum applies. Never below 14 unless the tenant is
  -- the platform owner; enforced by the S5 eligibility gate, not here, because
  -- a CHECK cannot read the tenants row.
  min_participant_age  int CHECK (min_participant_age IS NULL OR min_participant_age BETWEEN 0 AND 99),
  status               text CHECK (status IS NULL OR char_length(status) <= 40),
  -- The mirrored projection of the Sanity document (lib/events/sync.ts).
  raw                  jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw) = 'object'),
  -- Sanity's _updatedAt when this copy was taken, and when we took it.
  source_updated_at    timestamptz,
  synced_at            timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_dates_check CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at)
);

CREATE INDEX IF NOT EXISTS events_tenant_id_idx ON public.events (tenant_id);
CREATE INDEX IF NOT EXISTS events_starts_at_idx ON public.events (starts_at);

COMMENT ON TABLE public.events IS
  'Mirror of Sanity event documents (lib/events/sync.ts). S3: background only; Sanity remains the source of truth and no live read path depends on this table.';

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role full access events"
    ON public.events FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
