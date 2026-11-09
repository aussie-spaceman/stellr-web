-- S5 B9 (docs/TENANCY-S5.md): community and training belong to Stellr, enforced by
-- the database.
--
-- Community is Stellr-only under the Social Media Minimum Age guardrail (plan decision
-- 12). Tenant hosts cannot reach it (lib/tenancy/tenant-surface.ts), and this is the
-- backstop under that. Four of the Stellr-only product tables carry a tenant_id
-- derived from an event, so without this rule a row naming another tenant's event
-- would be stamped with that tenant. Now the write is refused with 23514:
--
--   community_spaces     (sanity_event_id)   a Space
--   community_resources  (event_ref)         a library resource
--   mentoring_cohorts    (sanity_event_id)   cohorts, workshops, event containers
--   training_modules     (event_ref)         a course
--
-- Coaching workshops are mentoring_cohorts rows, and training items hang off
-- training_modules, so a workshop or lesson named by id is never another tenant's.
--
-- NULL stays allowed: rows the backfill has not reached may still be NULL until
-- tenancy_cutover_checks section D shows 0, as elsewhere in S5.
--
-- ── What this does to live writes ────────────────────────────────────────────
-- Stellr's own rows pass. A row with no event key, or with an event the mirror does
-- not know, is stamped Stellr by tenancy_derive_tenant_id. A row naming a Stellr event
-- derives Stellr. Only a row naming an event whose public.events row belongs to
-- another tenant is refused. lib/event-space-sync.ts writes nothing for such an event.
--
-- Containers made by lib/container-sync.ts carry a campaign_ref and no sanity_event_id,
-- so they are stamped Stellr whichever event they serve, as they are today. Any reader
-- that wants a tenant's event container matches on campaign_ref.
--
-- A later slice must not pass a resolved tenant to a writer of these four tables.
--
-- VALIDATE fails, and this whole file rolls back, if any of the four already holds a
-- row for another tenant.
--
-- ── Locks ────────────────────────────────────────────────────────────────────
-- ADD CONSTRAINT takes ACCESS EXCLUSIVE on each table. VALIDATE alone would need only
-- SHARE UPDATE EXCLUSIVE, but this file is one transaction, so the earlier locks stay
-- held through commit, and the four VALIDATE scans run under them. Reads and writes on
-- these four tables wait for that time: the length of four small sequential scans.
-- Nothing is rewritten. If a lock cannot be had within lock_timeout the whole file
-- rolls back, and it can be run again. Mentoring_cohorts comes last, because the
-- registration path writes to it. Apply outside event hours.
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.training_modules
  ADD CONSTRAINT training_modules_stellr_only
  CHECK (tenant_id IS NULL OR tenant_id = '00000000-0000-4000-8000-000000000001'::uuid) NOT VALID;
ALTER TABLE public.community_resources
  ADD CONSTRAINT community_resources_stellr_only
  CHECK (tenant_id IS NULL OR tenant_id = '00000000-0000-4000-8000-000000000001'::uuid) NOT VALID;
ALTER TABLE public.community_spaces
  ADD CONSTRAINT community_spaces_stellr_only
  CHECK (tenant_id IS NULL OR tenant_id = '00000000-0000-4000-8000-000000000001'::uuid) NOT VALID;
ALTER TABLE public.mentoring_cohorts
  ADD CONSTRAINT mentoring_cohorts_stellr_only
  CHECK (tenant_id IS NULL OR tenant_id = '00000000-0000-4000-8000-000000000001'::uuid) NOT VALID;

ALTER TABLE public.training_modules VALIDATE CONSTRAINT training_modules_stellr_only;
ALTER TABLE public.community_resources VALIDATE CONSTRAINT community_resources_stellr_only;
ALTER TABLE public.community_spaces VALIDATE CONSTRAINT community_spaces_stellr_only;
ALTER TABLE public.mentoring_cohorts VALIDATE CONSTRAINT mentoring_cohorts_stellr_only;
