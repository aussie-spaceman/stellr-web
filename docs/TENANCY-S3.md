# Tenancy S3: tenant and event data model

Stage 3 of the multi-tenancy plan. Stellr becomes tenant #1, and the data model
for tenants, events and event-scoped tables is put in place. **It all runs in
the background.** No live flow reads it: registration, check-in, payments,
e-sign and uploads behave exactly as before. The Clerk `role` claim,
`staff_roles` and `event_manager_assignments` are still what every guard checks.

## What S3 adds

| Piece | Where | What it does |
|---|---|---|
| `tenants`, `tenant_domains`, `tenant_memberships`, `platform_admins` | `20261104100000_tenancy_core.sql` | The future authority on who belongs where. Stellr is seeded as tenant #1 with the fixed id `STELLR_TENANT_ID` (`lib/tenancy/constants.ts`). |
| `events` (Postgres mirror of Sanity events) | `20261104110000_events_mirror.sql` | Records which tenant owns each event. Sanity stays the source of truth. |
| `tenancy_settings`, `tenancy_derivation_log`, `tenancy_derive_tenant_id()` | `20261104120000_tenancy_derivation.sql` | Derives `tenant_id` from the event key. Log mode by default. |
| Nullable `tenant_id`, an index and the trigger on 32 tables | `20261104130000_tenant_id_expand.sql` | The expand step: 27 `event_slug` tables and 5 tables keyed by a Sanity `_id`. |
| Backfill of existing rows to Stellr | `20261104140000_tenant_id_backfill.sql` | Safe, because every row today is Stellr's. |
| Events sync | `lib/events/sync.ts` | Called from the existing event webhook (`/api/admin/sanity/event-sync`), last and inside try/catch. |
| Events facade | `lib/events/repo.ts` | Reads Sanity as today. `{ mirror: true }` syncs a missing event after the response and is never awaited. |
| Mirror backfill | `scripts/backfill-events-mirror.ts` | Dry run by default. |
| Table registry | `lib/tenancy/registry.ts` | Classifies every table: tenant_scoped, event_scoped, platform, stellr_only, identity or system. |
| Migration lint | `scripts/check-migration-tenancy.mjs` | Runs in `npm run lint:migrations`, in prebuild and as a CI step. |
| Role mapping | `lib/tenancy/role-mapping.ts`, `scripts/map-tenancy-roles.ts` | Writes data only. Platform admins are an owner action. |
| pgTAP | `supabase/tests/database/tenancy.test.sql` | Generated from the registry by `scripts/gen-tenancy-pgtap.mjs`. The CI `db` job runs it. |
| Cut-over checks | `supabase/tests/tenancy_cutover_checks.sql` | Read-only SQL, run by hand. |

## How `tenant_id` is derived

The `zz_tenancy_derive_tenant_id` trigger runs BEFORE INSERT, and BEFORE UPDATE
of the event key or `tenant_id`. It looks the row's event key up in
`public.events`, by `slug` or by `sanity_id`.

**Log mode** (`tenancy_settings.derivation_mode = 'log'`, the default) never
blocks a write. When it cannot derive a tenant, it sets Stellr's id (unless a
`tenant_id` was supplied) and adds one to a daily counter in
`tenancy_derivation_log`. The counter is keyed by table, reason and UTC day.
Every exception is caught. The reasons are:

- `no_key`: the event key is null. This is expected on tables where the event
  is optional: `store_orders`, `member_groups`, `refund_policies`,
  `community_resources`, `community_spaces`, `mentoring_cohorts` and
  `training_modules`.
- `no_event`: the key is set, but the mirror has no such event. **Orphan.**
- `mismatch`: a supplied `tenant_id` disagrees with the event's tenant. The
  derived value wins. **Orphan.**
- `error`: something raised. Only the SQLSTATE is stored, never the message.
  **Orphan.**

**Enforce mode** refuses a row whose tenant cannot be established:

- an unknown event with no `tenant_id` supplied (`23503`);
- a supplied `tenant_id` that disagrees with the event's (`23514`);
- no event key and no `tenant_id` (`23502`).

A supplied `tenant_id` with a null key is kept.

The function is SECURITY DEFINER. That is unavoidable: whoever writes the row
fires the trigger, and the trigger has to read tables those roles cannot see.
It pins `search_path`, and EXECUTE is revoked from PUBLIC, anon and
authenticated.

## Table registry rules

These rules are enforced by `npm run lint:migrations` and
`lib/tenancy/registry.test.ts`:

1. Every table in `public` and `entitlements` is in the registry, and every
   registry entry is a real table. The schema is read from
   `supabase/baseline.sql` plus the timestamped migrations, following renames
   and drops.
2. A tenant- or event-scoped table names how it reaches its tenant:
   - `own`: it carries `tenant_id NOT NULL`;
   - `derived`: the trigger sets it;
   - `via_parent`: it reaches its tenant through a parent table. This is only
     allowed for tables that existed before S3, and S4 adds their own column
     and composite foreign keys.
3. Tables using `own` or `derived` have `tenant_id`, an index led by
   `tenant_id`, and RLS.
4. A `derived` table has the trigger, with arguments that match its event key.
5. Any table with an `event_slug`, `event_ref` or `sanity_event_id` column must
   be `event_scoped` / `derived`.
6. Every table has RLS.

**When you add a table:** add it to `lib/tenancy/registry.ts` in the same PR.
Then regenerate the pgTAP file:
`node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/gen-tenancy-pgtap.mjs`.
A new event table gets `tenant_id uuid REFERENCES tenants(id)`, an index on it
and the `zz_tenancy_derive_tenant_id` trigger.

## Rehearsal (before any production apply)

Plan gate: rehearse each migration on a restored copy, after an owner-run full
dump. There is no point-in-time recovery on this plan.

1. **Owner:** take a full dump of production (`docs/RUNBOOK-backups.md`) and
   keep it offline.
2. Restore it into a scratch database. That can be a local Postgres 17, or the
   CI-style container from `docs/RUNBOOK-ci-database.md`.
3. Apply the five migrations in order, each one in a single transaction:
   `psql -v ON_ERROR_STOP=1 --single-transaction -f <file>`. Record the time
   each one takes. `20261104130000` and `20261104140000` set
   `lock_timeout = 5s`, so a held lock fails fast instead of queueing writers.
4. Run `supabase/tests/security_checks.sql` and the pgTAP files in
   `supabase/tests/database/`. Every test must pass.
5. Run section D of `supabase/tests/tenancy_cutover_checks.sql`. It must show 0
   rows with a NULL `tenant_id`.
6. Spot-check that the backfill left `updated_at` alone. Compare
   `registrations.updated_at` before and after: it must be unchanged.
7. Point a local app at the scratch copy (never at production). Run a test
   registration, a check-in and a refund dry run, and confirm that each insert
   succeeds and logs only expected reasons.

This lane checked steps 3–6 on PGlite (Postgres 17), against the baseline plus
every migration, with historic rows inserted before S3. It has not rehearsed on
a production restore. That is the owner's step.

**Do not apply to production on an event day** (Nevada, 6 Nov). Apply outside
event hours.

## Enforce cut-over checklist

Do not flip to `enforce` until every box is ticked. Use
`supabase/tests/tenancy_cutover_checks.sql`, sections A–F.

- [ ] All five S3 migrations are applied to production through the Production
      migration Action, and `npm run db:status -- --prod` shows them.
- [ ] The mirror has been backfilled on production:
      `npx tsx scripts/backfill-events-mirror.ts --apply --production` (owner).
      Rerun the dry run and confirm 0 inserts, 0 updates and 0 conflicts.
- [ ] The event webhook is confirmed to write the mirror. Publish a test edit in
      Sanity, then check that `events.synced_at` moved and the webhook JSON says
      `"mirror":"synced"`.
- [ ] **7 consecutive days of production traffic in log mode with trigger-derived
      ids.** Section C shows at least 7 days since the expand migration, and new
      rows in the derived tables carry a `tenant_id`.
- [ ] **0 orphans:** section B returns no rows for the last 7 days (no
      `no_event`, `mismatch` or `error`).
- [ ] Section D shows 0 NULL `tenant_id` in all 32 tables.
- [ ] Section E returns no rows: every event key used in the last 7 days is in
      the mirror.
- [ ] Section F has been reviewed. `no_key` appears only on the optional-event
      tables listed above. The app writes an explicit `tenant_id` on those
      tables before enforce (S5), or the cut-over leaves them out.
- [ ] No live event falls in the cut-over window.
- [ ] The owner approves the flip.

Flip (owner, SQL editor or a migration):

```sql
UPDATE public.tenancy_settings
   SET derivation_mode = 'enforce', updated_at = now(), note = 'S3 cut-over: 7 days clean'
 WHERE id;
```

To roll back, set it back to `'log'`. Nothing else changes. The NOT NULL
constraints are a separate contract migration, after a further clean week in
enforce mode (S4).

## Owner actions

1. **Apply the migrations** to dev, then production, through the Production
   migration Action, after the rehearsal above. Not on 6 Nov.
2. **Backfill the mirror:** run `npx tsx scripts/backfill-events-mirror.ts` as
   a dry run first, then with `--apply` (add `--production` for production).
3. **Map roles.** Run `npx tsx scripts/map-tenancy-roles.ts` as a dry run and
   read the platform-admin list. Then run it with `--apply` to write Stellr
   memberships. Only the owner adds `--platform-admins`, which writes
   `platform_admins`. Keep the dry-run output off the repo, because it lists
   account ids.
4. **Fill in Stellr's tenant record:** the EIN and the legal entity name, if
   they differ from "Stellr Education":
   `UPDATE public.tenants SET ein = '..-.......', legal_name = '...' WHERE slug = 'stellr';`
5. **Backups:** once the migrations are on production, add `public.tenants`,
   `public.tenant_memberships`, `public.platform_admins` and `public.events` to
   `ops/backups/critical-tables.txt`. Adding them earlier would fail the
   `--strict-names` dump.
6. **Run the enforce cut-over** when the checklist above is complete.

## What S3 deliberately does not do

- It changes no guard and no read path on a live flow, and does not route by
  host.
- It adds no FORCE RLS, tenant JWT or `tenantDb()`, and no composite foreign
  keys (S4).
- It adds no NOT NULL on the derived `tenant_id` columns. That is the contract
  step, after enforce.
- It gives no `tenant_id` column to `via_parent` child tables such as
  `participants` and `agreement_recipients` (S4).
- It never deletes from the mirror. An event removed from Sanity keeps its row,
  because rows in 32 tables may still point at it.
