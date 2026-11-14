# DRAFT: S5 wave 8 plan

> **DRAFT, not approved.** Written on 14 Nov 2026, before the K9 canary run that the tracker expects the wave 8 plan to follow (`docs/handovers/tracker/2026-11-11-s5-programme.md`, row `s5-programme.43`). Nothing here is scheduled until the owner approves it. K9's findings may reorder it or add slices; they go in [K9 findings](#k9-findings-placeholder-until-k9-runs). Every "owner decides" marker is an open question with the default each slice builds until it is answered. The defaults fail closed.

Plan of record: `docs/TENANCY-S5.md`. Owner decisions: `docs/S5-DECISION-REGISTER.md`; the earlier decisions not yet in it are drafted in `docs/S5-DECISION-BACKFILL-DRAFT.md` (cited here as `BF-<n>` and `SQ-<n>`). People are named by role only.

## Where wave 8 starts

Checked against `dev` at `1d9b6977`. Its S5 code is the same as production's: everything merged since the 13 Nov promotion (#680) is docs or non-S5 work.

- **Wave 7 is on production** (#680, `fba19669`, 13 Nov 2026), but its own exit has not happened: no tenancy switch has been on in a hosted environment, and the flip log holds only the P0 baseline (tracker `s5-programme.31`). K9 has not run (`docs/TENANCY-S5.md`, "Wave 7 status").
- **Wave 7 held these for wave 8** (`docs/TENANCY-S5.md`, "Wave 7 status" and tracker rows `.20`, `.23`, `.26`, `.28`): the M7 migrations and the code that uses them (B24, B25), A13a, C20a and A8b with the derivation enforce flip, C20b, C19a, A10c and F10 (waiting on P9's evidence), the rest of B26, K11, and the consent readiness guard.
- **Counts this wave moves** (generated baselines win over these): tenant-host cases 48 failing and 18 unproven of 124 (`test/baselines/tenant-host-idor.json`); 104 unaudited mutating handlers and 4 GET writers (`test/baselines/unaudited-mutations.json`); 117 legacy authorisation sites in 82 files (`test/baselines/authz-legacy-idioms.json`); `MAX_TENANT_DESTINED_STELLR_ONLY` 18 (`test/idor/stellr-only-dispositions.test.ts`).

## Rules carried from wave 7

- Each slice is about 30 files or fewer, one PR per slice, and at most four large PRs are open at once.
- Every runtime change sits behind a default-off flag, or is provably a no-op for Stellr (a platform-owner early return, the Stellr-or-NULL tenant filter, or a string check). Each slice below states its proof.
- New migrations are written with `npm run migration:new -- <name>` and proven by CI's `db` and pgTAP jobs only. Applying one to `dev` or production is a separate step with the owner's yes for that file; production goes through the Production migration Action (`docs/RUNBOOK-agent-controls.md`, section 3).
- Generated baselines are regenerated at merge, never hand-merged, and only fall. Cap scripts (`scripts/tenant-host-cap.mjs`, `scripts/audit-cap.mjs`) must not rise.
- Shared prose docs travel only in Lane D's docs trains. Code PRs name the docs hunk they leave pending.
- Any file in `.github/CODEOWNERS` needs the owner's review before merge. Most slices below touch one.
- Every `dev` flip has the owner's yes, is set by Claude with the Vercel CLI, and ends with the deployment check (`W7-2`, `W7-18`, `W7-19`).

## Order

Lane letters as in `docs/TENANCY-S5.md`. Slices in different lanes may run side by side within the four-PR limit; Lane C runs one PR at a time.

| Order | Id | Lane | Slice | Depends on | Gate in one line |
|---|---|---|---|---|---|
| 0 | B22 | B | Per-tenant `group-invoice-sync`, failing closed until S9 (carried from wave 7's stretch) | #625 | Must merge before A8b |
| 1 | M7 | B | Migrations: `email_outbox.tenant_id` and `tenant_host_map()` | none | Owner accepts the host-enumeration surface (`WD-1`) |
| 2 | A13a | A | Stripe and webhook handlers: audit actors and tenant resolution | C7 (on production) | Audit cap falls; Stellr's webhook answers unchanged |
| 3 | C20a | C | Explicit `tenant_id` on the remaining Lane C writers | none | Section F of the cut-over checks loses those tables |
| 4 | A8b | A | Explicit `tenant_id` on the remaining Lane A writers | B22, A13a | Section F empty for converted tables |
| 5 | ENF-dev | owner | Derivation `enforce` on the `dev` database | C20a, A8b, 7 clean days | Owner's yes; rollback is one UPDATE |
| 6 | C20b | C | Scholarships admin onto `lib/authz` and `loadScoped`, Stellr-only for other tenants | C20a | Ratchet falls; Stellr unchanged |
| 7 | C19a | C | Events credentials, artwork and admin check-in, first part | C20b (Lane C queue) | Ratchet falls; `W7-9` still holds |
| 8 | CONSENT | A | Consent pack: readiness guard, sweep regardless of the flag, staff pending marker | none | No production consent flip without it |
| 9 | REQ-EVT | C | `refuseUnlessStellrEvent` moved into `requireEventAccess` | C19a (Lane C queue) | The 10 routes keep their answers |
| 10 | A11 | A | E-sign participant side, agreement reuse inside one tenant only | CONSENT | Tenant-host leaks fall |
| 11 | A12 | A | Check-in participant side, links on the tenant's host | A11 | Tenant-host cases fall |
| 12 | B24 | B | Outbox per tenant, using `email_outbox.tenant_id` | M7 | Stellr's sends unchanged |
| 13 | B25 | B | Proxy host map through `tenant_host_map()`, not the secret key | M7, `WD-1` | No new database call for Stellr hosts |
| 14 | BOUNCE | A | Bounce-notice link on the tenant's host (`bounce-notices.9`) | A11 | `/sign/email` stays `pending` until it lands |
| 15 | C8-PG | C | A Postgres path in the events facade, and its callers | REQ-EVT (Lane C queue) | Facade baseline falls |
| 16 | A10c, F10 | C | `tenantDb` data modules; events-config tenant mode | P9 clean | Only if P9 passed |
| 17 | B26 | B | The rest of B26: cron fixtures and the cron ledger | B22 | Dev opt-in stays narrow |
| 18 | K11 | D/C | CI e2e of the canary flow, local stack only | B26 | Never writes to the hosted `dev` database |
| 19 | K9 | all | Slices for K9's findings | K9 | See below |
| 20 | D-train | D | Docs train: wave 8 status, register entries, flip log | each slice | `lint:pii` green |

## Slices

Each slice lists what it does, its dependencies, why it is off or a no-op for Stellr, the files it is likely to touch (CODEOWNERS paths marked **owned**), and its gate. "Owner decides" items are collected again under [Open decisions](#open-decisions-this-plan-depends-on).

### 0. B22: per-tenant `group-invoice-sync`

- **What.** Move `app/api/cron/group-invoice-sync/route.ts` onto `lib/cron-tenants.ts`, as B13 and B14 did for five other crons, so one tenant's backlog cannot starve Stellr's run. Another tenant's work list is skipped and recorded, because A7 refuses priced tenant events until S9 (`docs/S5-CRONS-LIMITS-SMMA.md`, "`group-invoice-sync` has no slice").
- **Depends on.** #625 (on production).
- **Flag-off proof.** No flag: with every event Stellr's, the per-tenant runner sees one tenant and the same work list; the parent `cron_runs` row keeps its result keys.
- **Files likely touched.** `app/api/cron/group-invoice-sync/route.ts`, `lib/cron-tenants.ts`, `lib/cron-scope.ts`, `test/cron-scope.test.ts` (**owned**), the route's tests.
- **Gate.** CI green; `cron_runs` result keys unchanged in tests; after promotion the first production run is read in `cron_runs` (owner-run checklist, tracker `s5-programme.34`).

### 1. M7: `email_outbox.tenant_id` and `tenant_host_map()`

- **What.** Two migrations in one small PR. (a) `email_outbox` gains a nullable `tenant_id` with an index, NULL counting as Stellr; the migration in `supabase/migrations/20261109224229_email_outbox.sql` has none today. (b) `tenant_host_map()`, a narrow SQL function returning only the host-to-tenant rows the proxy needs, for B25 to call in place of the secret key (tracker `s5-programme.46`).
- **Depends on.** Nothing. B24 and B25 follow it.
- **Flag-off proof.** Additive only: a nullable column nobody writes yet and a function nobody calls. Stellr's outbox rows keep NULL.
- **Files likely touched.** Two new files under `supabase/migrations/` (**owned**), `lib/tenancy/registry.ts` (**owned**), generated pgTAP under `supabase/tests/database/` (**owned**).
- **Gate.** CI `db` job green by step outcome; NULL counts as Stellr (**owner decides**, `WD-2`); the owner accepts the host-enumeration surface before the function is granted to anything but `service_role` (**owner decides**, `WD-1`); applied to `dev` and then production only with the owner's yes for each file.

### 2. A13a: Stripe and webhook audit actors, tenant resolution

- **What.** Audit the Stripe webhook and the other webhook handlers with the `webhook:<provider>` actor C7 added (`docs/TENANCY-S5.md`, Migrations, C7), and resolve each event's tenant from the stored registration or row, never from the payload alone.
- **Depends on.** C7, whose migration `20261105052154_platform_audit_webhook_actor.sql` is on production since #548.
- **Flag-off proof.** Audit writes only with `PLATFORM_AUDIT_ENABLED` on (off on both projects). Tenant resolution answers Stellr for every row today, so the handler's responses are unchanged.
- **Files likely touched.** `app/api/stripe/webhook/route.ts`, `app/api/webhooks/**` (**owned**), `lib/audit/actions.ts` (**owned**), `test/baselines/unaudited-mutations.json` (**owned**, shrinks).
- **Gate.** `scripts/audit-cap.mjs` falls; Stellr's webhook tests unchanged; which audit chain a tenant's payment event goes on is open (**owner decides**, `BF-4`; default: Stellr's chain, as B16 does).

### 3 and 4. C20a and A8b: explicit `tenant_id` on writers

- **What.** The writers left after C20c (#648) and A8 (#625) supply `tenant_id` explicitly, from the event's owner, so derivation `enforce` does not refuse their `no_key` writes (`docs/TENANCY-S3.md`, "Enforce cut-over checklist", Section F). C20a covers Lane C's money and scholarship writers; A8b covers Lane A's remaining participant and registration writers.
- **Depends on.** C20a: none. A8b: B22 (the wave 7 plan put B22 first) and A13a.
- **Flag-off proof.** In `log` mode the trigger keeps a supplied `tenant_id` that agrees with the event's, so Stellr's rows are written with the same value the trigger would have derived. A test per writer pins that.
- **Files likely touched.** C20a: `lib/refunds/**`, `lib/scholarship-*.ts`, `lib/group-payment-change.ts`, `app/api/admin/registrations/**`. A8b: `lib/registration/**`, `lib/group-billing.ts`, `lib/individual-payment.ts`, `app/api/members/teams/**`. Both: `test/optional-event-tenant-id.test.ts` (**owned**).
- **Gate.** `supabase/tests/tenancy_cutover_checks.sql` Section F no longer lists the converted tables on `dev`; Section H shows 0 `mismatch_rows`. A8b also gives the organiser-side payment writers their tenant checks (**owner decides**, `BF-58`; default: here, not S9).

### 5. ENF-dev: derivation `enforce` on `dev`

- **What.** An owner step, not code: once Sections B to H of the cut-over checks are clean for 7 days on `dev`, flip `derivation_mode` to `enforce` on the `dev` database only, with the owner's yes, outside CI's busiest hours.
- **Depends on.** C20a and A8b on `dev`; CI e2e fixtures that write unknown slugs either fixed or accepted, because the P0 baseline counted thousands of `no_event` and `no_key` rows from them (tracker `s5-programme.31`, P0 row).
- **Flag-off proof.** Not a flag. Rollback is one UPDATE back to `log` (`docs/TENANCY-S3.md`).
- **Gate.** The owner's yes for the flip (**owner decides**, `WD-3`). CI e2e and `tenant-host-routing` stay green by step outcome for 7 days after the flip. Production `enforce` stays the owner's sign-off after A7, A8, B16 and C20 and 7 clean production days (`docs/TENANCY-S5.md`, "Owner gates", Sign-offs), and needs the production mirror backfill first.

### 6. C20b: scholarships

- **What.** The scholarship admin routes move to `lib/authz` and `loadScoped`, with audit. Another tenant's event is refused, as C20c does for money routes, because scholarships draw on Stellr's coupons and Stripe account.
- **Depends on.** C20a.
- **Flag-off proof.** Converted routes decide through `lib/authz` under `AUTHZ_SOURCE=clerk` (the default) with today's answers; the refusal reads the event's owner once, and every event is Stellr's.
- **Files likely touched.** `lib/scholarship-admin.ts`, `lib/scholarship-offer.ts`, `app/api/admin/scholarships/**`, `test/baselines/authz-legacy-idioms.json` (**owned**).
- **Gate.** Authz ratchet and audit cap fall; whether tenants get scholarships at all is open (**owner decides**, `WD-4`; default: Stellr-only until S9).

### 7. C19a: events credentials, artwork and admin check-in (first part)

- **What.** The first of C19's three parts: the `stellr_only` configuration routes under `app/api/admin/events/[slug]` (credentials, badge and certificate templates, badges, certificates) move to `lib/authz` and `loadScoped`, keeping `W7-9` (no credential for another tenant's event until the tenant is the issuer). C19 also confirms the inventory still attributes the tables behind `companies`, `offerings` and `merch/commit` (`docs/TENANCY-S5.md`, PR amendments, "C19, after C18").
- **Depends on.** C18 (on production); Lane C's queue after C20b.
- **Flag-off proof.** Same as C20b.
- **Files likely touched.** `app/api/admin/events/[slug]/{credentials,badge-templates,badges,certificate-templates,certificates}/**`, `lib/security/stellr-only-dispositions.ts` (**owned**), `test/idor/**` (**owned**).
- **Gate.** `MAX_TENANT_DESTINED_STELLR_ONLY` falls below 18; authz ratchet falls.

### 8. CONSENT: readiness guard, sweep, staff marker

Three parts, one PR if it stays near 30 files, otherwise three.

- **(a) The consent readiness guard** (tracker `s5-programme.20`, `W7-14`). `TENANT_GUARDIAN_CONSENT_ENABLED` is honoured only when Lane C's refusals are live and `LOADSCOPED_MODE=enforce`; otherwise the flow behaves as if the flag were off and an `app_errors` row says why. Today the only signal is the informational `guardian_consent_without_tenant_mail` combination in `lib/tenancy/flags.ts`.
- **(b) The sweep runs regardless of the flag** (tracker `s5-programme.26`). `app/api/cron/membership-expiry/route.ts` runs the tenant consent sweep only with the flag on, while the A16 trigger opens pending rows whatever the flag says (`docs/TENANCY-S5.md`, PR amendments, "Any later tenant participant writer"). The sweep runs whenever non-signed rows exist, caps removal retries and escalates, and drops the pending row when a participant moves to a Stellr event.
- **(c) Staff see pending consent** (tracker `s5-programme.23`, T-23). A "waiting for guardian consent" marker on the tenant roster and the check-in desk, a staff resend, and the desk treating `guardian_consent_pending` as a failed scan. Failed invitations reach staff, not only `console.error` (`lib/registration/tenant-guardian-consent.ts`).
- **Depends on.** Nothing new; all three act only on tenant events.
- **Flag-off proof.** (a) only narrows when the flag is honoured. (b) finds no rows today: every event is Stellr's, and `tenant_guardian_consents` was empty on `dev` at the P0 baseline. (c) renders only for a tenant event's participants.
- **Files likely touched.** `lib/tenancy/flags.ts` (**owned**), `lib/registration/tenant-guardian-consent.ts` (**owned**), `lib/esign/tenant-guardian-consent.ts` (**owned**), `lib/check-in-consent.ts` (**owned**), `app/api/cron/membership-expiry/route.ts`, the roster and desk components, `test/registration/tenant-guardian-consent*.test.ts` (**owned**).
- **Gate.** Unit tests for every flag and mode combination; the sweep's purge sub-job still refused on `dev` (`docs/S5-CRONS-LIMITS-SMMA.md`, "The dev opt-in"). Open: the retry cap and who is told (**owner decides**, `WD-5`, `BF-45`), and the marker's wording (**owner decides**, `WD-6`).

### 9. REQ-EVT: the Stellr-only check inside `requireEventAccess`

- **What.** Ten route files call `refuseUnlessStellrEvent` (or `previewRefundOnStellrEvent`) by hand (`lib/tenancy/load-scoped.ts`; tracker `s5-programme.28`). `requireEventAccess` (`lib/authz.ts`, `lib/event-access.ts`) gains an explicit Stellr-only option, the ten routes use it, and a guard test fails when a route classed Stellr-only under `events/[slug]` reads a person without it.
- **Depends on.** Lane C's queue.
- **Flag-off proof.** Same reads in the same order for Stellr; each route's existing tests pin the 404 for another tenant's event and the retryable 503 on a failed owner read.
- **Files likely touched.** `lib/authz.ts` (**owned**), `lib/event-access.ts`, `lib/tenancy/load-scoped.ts` (**owned**), the ten routes, a new guard test under `test/` (**owned** by its name pattern).
- **Gate.** No route's answer changes; the new guard test fails on a deliberately unguarded fixture.

### 10. A11: e-sign participant side and agreement reuse

- **What.** A tenant check on `app/api/sign/**` before any read about a person; tenant scoping in `findValidAgreement`, `recordCoverage` and `loadMediaAgreements` (`lib/docusign-agreements.ts`), which today reuse an agreement by `member_id` with no tenant (`docs/TENANCY-S5.md`, PR amendments, "Agreement reuse across tenants"); the signing engine's tenant sender on the reminder path, as B14b built for the outbox. A migration only if the reuse lookup needs one.
- **Depends on.** A10 (on production), C0b (on production), CONSENT.
- **Flag-off proof.** Stellr's agreements are all Stellr's, so the scoped reuse finds the same rows; DocuSign stays Stellr-only (decision 15).
- **Files likely touched.** `app/api/sign/**`, `lib/docusign-agreements.ts`, `lib/esign/outbox.ts`, `lib/esign/completion.ts` (**owned**), `lib/esign/native/flow.ts` (**owned**), `test/idor/**` (**owned**).
- **Gate.** Tenant-host baseline falls (the leaks left for A11 number 8: register `W7-15`); agreement reuse never crosses tenants (**owner decides** whether a guardian's signature for one tenant may ever cover another's event, `WD-7`; default: never).

### 11. A12: check-in participant side

- **What.** `checkInCodeUrl` builds from `SITE_URL` (`lib/check-in-codes.ts`), so a tenant's QR and emailed code links open Stellr's host. A12 builds them from the tenant's host, passed in by the tenant wrapper, and adds the host-tenant check to the code page and the check-in routes.
- **Depends on.** A11 (shared e-sign and check-in files).
- **Flag-off proof.** For Stellr the host is `SITE_URL`, so every link is byte-identical (golden test).
- **Files likely touched.** `lib/check-in-codes.ts`, `app/api/check-in/**`, `app/api/check-in-desk/**`, the tenant flow wrapper under `app/%5Ft/`, `e2e/tenancy/**` (**owned**).
- **Gate.** Tenant-host baseline falls; group check-in with one pending minor keeps today's whole-group 409 until decided (**owner decides**, `BF-66`).

### 12 and 13. B24 and B25: the code that uses M7

- **B24.** `lib/email/outbox.ts` writes `tenant_id` on every queued row, drains per tenant with failure isolation, and gives staff a count of held signing invitations; `loadTenantSenders` pages its query before the tenant list nears PostgREST's row cap (`docs/TENANCY-S5.md`, PR amendments, "An admin count of held signing invitations").
- **B25.** `lib/tenancy/host.ts` reads the host map through `tenant_host_map()` with the publishable key, in place of the secret key, keeping the cached map and its TTL.
- **Depends on.** M7 on the target database; B25 also on `WD-1`.
- **Flag-off proof.** B24: Stellr's rows carry NULL or Stellr's id and drain in the same order. B25: runs only with `TENANT_ROUTING_ENABLED` on; for Stellr hosts the proxy still makes no database call (`docs/TENANCY-S5.md`, "Risks to keep in view", Active CPU).
- **Files likely touched.** B24: `lib/email/outbox.ts`, `lib/event-emails/tenant-mail.ts`, `app/api/cron/email-outbox/route.ts`. B25: `lib/tenancy/host.ts` (**owned**), `test/proxy-tenant-routing.test.ts` (**owned**), `test/rate-limit-proxy-closure.test.ts` (**owned**).
- **Gate.** B24: outbox tests by tenant; B25: the proxy import-closure tests stay green, and the host map TTL question is answered or defaulted (**owner decides**, `SQ-5`; default: 60 seconds, suspension also purges).

### 14. BOUNCE: bounce-notice link on the tenant's host

- **What.** `/sign/email` is `pending` in `lib/tenancy/tenant-surface.ts` and its links are built on Stellr's host (tracker `bounce-notices.9`). Build the link on the agreement's tenant's host and check the agreement's tenant against the host before showing anything.
- **Depends on.** A11 (same e-sign helpers).
- **Flag-off proof.** For a Stellr agreement the link is today's; the page's answer on Stellr's host is unchanged.
- **Files likely touched.** `lib/esign/bounce-notices.ts`, `app/api/sign/email/route.ts`, `app/(stellr)/(flow)/sign/email/page.tsx`, `lib/tenancy/tenant-surface.ts` (**owned**).
- **Gate.** The route leaves `pending` only with a tenant-host case proving the refusal.

### 15. C8-PG: a Postgres path in the events facade

- **What.** `lib/events/repo.ts` reads Sanity only. When it reads Postgres, `getEventBySlug`, `getEventsBySlugs` and `getEventsByIds` take an explicit tenant id from the registration or member row, never from headers or the Host; a missing tenant throws; crons loop over tenants explicitly (`docs/TENANCY-S5.md`, PR amendments, "C8, C25"). This slice converts the callers B19 reaches.
- **Depends on.** Lane C's queue; the production mirror backfill before any production read moves.
- **Flag-off proof.** The Postgres path sits behind a per-area switch like `TENANT_DB_AREAS`, unset; callers pass Stellr's id and still read Sanity.
- **Files likely touched.** `lib/events/repo.ts`, `lib/events/sync.ts`, callers such as `lib/admin-digest.ts`, `lib/training-reminders.ts` and `lib/event-emails/**`, `test/events-facade-ratchet.test.ts` (**owned**), `test/baselines/sanity-event-getters.json` (**owned**).
- **Gate.** A facade test shows a slug shared by two tenants resolving only within the tenant passed in; the events-facade baseline falls. Slugs stay globally unique in release 1 (**owner decides**, `WD-11`).

### 16. A10c and F10: only if P9 is clean

- **What.** A10c moves the A10 data modules (credentials, surveys, team profiles, volunteer interest) onto `tenantDb`; F10 lets `events-config` run in tenant mode on `dev`.
- **Depends on.** P9 (`events-config:shadow:1`) with 0 `TENANTDB` rows over 100 or more comparisons and no double write. P9 has not run.
- **Flag-off proof.** `TENANT_DB_ENABLED` and `TENANT_DB_AREAS` unset: nothing opens a connection (`docs/TENANCY-S5-data.md`).
- **Files likely touched.** `lib/tenancy/area-switch.ts` (**owned**), the A10 data paths in `lib/credentials.ts`, `lib/survey/**`, `lib/team-profile/**` and `lib/volunteer.ts`, `test/integration/two-tenant/**` (**owned**).
- **Gate.** `tenant-db` job green; whether F10's tenant mode is flipped on `dev` is the owner's yes at the time (**owner decides**, `WD-9`).

### 17. B26 (rest): cron fixtures and the cron ledger

- **What.** Per-tenant cron fixtures for the two-tenant kit, and a cron ledger that compares finished runs with `cron_runs` started rows, beyond B26a's dev opt-in (#651).
- **Depends on.** B22.
- **Flag-off proof.** Tests and tooling only; `CRON_NON_PROD_JOBS` keeps its two allowed values and never the minor-account purge.
- **Files likely touched.** `lib/cron-runs.ts`, `lib/cron-tenants.ts`, `test/cron-audit.test.ts` (**owned**), `lib/testing/**`.
- **Gate.** CI green; the purge sub-job still refused.

### 18. K11: CI e2e of the canary

- **What.** Run the K8 scenarios (`scripts/canary-tenant-flow.ts`) in CI against the local e2e stack, so the canary cannot rot between hosted runs.
- **Depends on.** B26.
- **Flag-off proof.** CI only.
- **Files likely touched.** `.github/workflows/ci.yml` (**owned**), `scripts/canary-tenant-flow.ts`, `lib/testing/canary-flow-scenarios.ts`.
- **Gate.** The job never targets the hosted `dev` database (**owner decides**, `WD-8`; default: local stack only), and a deliberately broken scenario turns it red once.

### 19. K9 findings (placeholder until K9 runs)

K9 phase A and phase B have not run (`docs/TENANCY-S5.md`, "How to run K9"). Each gap K9 finds is mapped to a slice here, by id, with its scenario and mode (`docs/TENANCY-S5-flow-checklist.md`, "The dev canary tenant (K8, K9)"). The known gaps K8 already names by slice (A11, A12, tracker `.23`, `.24` and `.29`) are covered above or under "Not in wave 8". Whether a finding goes into wave 8 or later is the owner's call (**owner decides**, `WD-10`).

### 20. Docs train

Wave 8 status in `docs/TENANCY-S5.md`, each answered decision into `docs/S5-DECISION-REGISTER.md`, the flip log rows, and the corrections each slice names. One docs PR at a time, `lint:pii` green.

## Not in wave 8

Listed so nothing is lost; each needs its own slice or decision later.

- **B23**, the marketing-cron audience, waits on what counts as a Stellr member for marketing (`BF-35`).
- **C21 to C25**, the rest of the admin conversion and the authz flip (C25 is the S6 candidate: `docs/PLAN-S6-DRAFT.md`). C23 waits on the sampling decision (`BF-14`).
- **B15** (held on limit values), **B5d** (deferred to S8 or S9), **B20** and **C18m** (decisions only; `BF-3`, `BF-44`, `BF-18`, `BF-52`).
- **Tracker rows** `s5-programme.24` (group check-in with one pending minor), `.25` (a date-of-birth edit that lifts the hold leaves a trace), `.27` (platform audit on the check-in POSTs, before `PLATFORM_AUDIT_ENABLED` on production), `.29` (Stellr-only admin lists read only Stellr's rows), `.32` (the database-enforced "not ready for tenants" lock), and `.12` (more A16 database test cases).
- **A guard for later tenant participant writers** (`docs/TENANCY-S5.md`, PR amendments, "Any later tenant participant writer").
- **The two community IDOR snapshot entries left for S5**, on the coaching request and training item-flag routes (`test/idor/idor-snapshot.json`; `docs/TENANCY-S5.md`, PR amendments, the paragraph after "Added by wave 6").
- **C18's leftovers**: the participant company move and Auto-Assign (`docs/TENANCY-S5-data.md`, "What C18 converted, and what it left").

## Open decisions this plan depends on

`WD-<n>` are new with this draft; `BF-<n>` and `SQ-<n>` are in `docs/S5-DECISION-BACKFILL-DRAFT.md`. Every one is **owner decides**. The default is what the slice builds until the owner answers.

| Id | Slice | Question | Proposed safe default |
|---|---|---|---|
| WD-1 | M7, B25 | `tenant_host_map()` readable with the publishable key lets anyone list the tenant hosts in the zone. Accept that surface? | Until accepted, EXECUTE for `service_role` only, and B25 waits. If accepted: the function returns host and tenant id for active hosts only, nothing else |
| WD-2 | M7, B24 | Does a NULL `email_outbox.tenant_id` count as Stellr's? | Yes, as for every other derived table in log mode |
| WD-3 | ENF-dev | Flip derivation to `enforce` on the `dev` database after 7 clean days? | Yes on `dev` only, with the owner's yes at the time; production stays the separate sign-off |
| WD-4 | C20b | Do tenants get scholarships in release 1? | No: refused for another tenant's event until S9 |
| WD-5 | CONSENT (b) | The consent sweep's removal retry cap, and who is told when it is reached | 5 tries, then one alert with ids and counts only to Stellr's platform staff (see `BF-45` for a per-tenant contact) |
| WD-6 | CONSENT (c) | Wording of the staff marker and the desk refusal for pending consent | "Waiting for guardian consent", and the desk's existing pending refusal text from A16 |
| WD-7 | A11 | May a guardian's signature collected for one tenant ever cover another tenant's event? | Never; each tenant's paperwork stands alone (decisions 3 and 15) |
| WD-8 | K11 | May a CI job write to the shared hosted `dev` database for the canary? | No: local stack only |
| BF-4 | A13a | Which audit chain a tenant's payment or webhook event goes on | Stellr's chain until decided, as B16 does |
| BF-45 | CONSENT | An alert contact for each tenant | Platform staff with personal data stripped |
| BF-66 | A12 | Group check-in with one consent-pending minor | Keep refusing the whole group (as built) |
| SQ-5 | B25 | Host map cache TTL and suspension | 60 seconds, and suspending a tenant also purges the cached map |
| SQ-16 | C19a, C20b | Which admin areas are tenant features in release 1 | Credentials and surveys tenant features later; scholarships, store and DocuSign Stellr-only |
| BF-14 | C23 (not in wave 8) | Sampling for `AUTHZ_SOURCE=shadow` | No call site serving ordinary members moves to `lib/authz` until decided |
| WD-9 | A10c, F10 | Flip `events-config` to tenant mode on `dev` once P9 is clean? | No standing flip: a supervised window with the owner's yes at the time, then back to shadow |
| WD-10 | K9 findings | Which K9 findings go into wave 8, and which wait | Any isolation leak or consent bypass goes into wave 8; everything else is listed under "Not in wave 8" with a reason |
| WD-11 | C8-PG | Slugs stay globally unique in release 1, or become unique per tenant? | Globally unique (the plan's target architecture); the facade still takes an explicit tenant id |
| BF-58 | A8b | Which slice gives the organiser-side payment writers their tenant checks | A8b, in this wave, before any priced tenant event |
| production consent | CONSENT | The production consent wording, identity assurance, caps, window and copy (`BF-60` to `BF-65`) | None of them is needed for wave 8: the flag stays off on production |

## How wave 8 ends

- Every slice above merged to `dev` with its gate, or moved to "Not in wave 8" with a reason.
- The counts in "Where wave 8 starts" lower, by generated baseline.
- `dev` running derivation `enforce` for 7 days, or the reason it could not.
- The owner's answer, or a recorded default, for every `WD` item.
- Promotion of wave 8 to production is a separate owner yes, as for every wave.
