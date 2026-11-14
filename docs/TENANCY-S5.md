# Tenancy S5: plan of record

Stage 5 of the multi-tenancy plan converts the app to tenancy and moves authorisation onto one API, while Stellr runs as tenant #1 with no visible change (M1). This file says who owns what, what may merge when, how migrations are numbered, and which counts to trust.

It merges the six S5 area analyses with the review that followed them, at `dev` `c1e41eb8` (4 Nov 2026). Where this file disagrees with the plan or the scoping output, this file wins. Where it disagrees with a committed baseline (`test/baselines/**`), the baseline wins. Where it departs from the review, it says so and why.

Sibling records: `docs/TENANCY-S3.md`, `docs/TENANCY-S4.md`, `docs/S4-SPIKE.md`, `docs/TENANCY-S5-routing.md` (D2), `docs/AUTHZ.md` (D3), `docs/TENANCY-S5-registration.md` (D5), `docs/TENANCY-S5-flow-checklist.md` (D7), `docs/S5-CRONS-LIMITS-SMMA.md` and `docs/RUNBOOK-waf-rule.md` (D6). The SMMA self-assessment is held privately pending the owner's decision. D4's data, `loadScoped` and audit runbook is `docs/TENANCY-S5-data.md` (wave 5). What each wave built, and what it corrected here, is under [Wave 2 status](#wave-2-status), [Wave 3 status](#wave-3-status), [Wave 4 status](#wave-4-status), [Wave 5 status](#wave-5-status), [Wave 6 status](#wave-6-status) and [Wave 7 status](#wave-7-status). Wave 7's owner decisions are in `docs/S5-DECISION-REGISTER.md`. Open S5 items, each tagged with the gate it blocks, are in `docs/handovers/tracker/2026-11-11-s5-programme.md`.

## What may merge when

**Wave 1: A1, A2, B1, B2, C1, C2, C3, C4 and D1.** Each is tests, docs or a library nothing imports, so none changes live behaviour.

**No date hold (owner decision, 4 Nov 2026).** The owner lifted the hold around the Nevada event (6 Nov) and the 72-hour rule for this work. A later PR may merge to `dev` once its dependencies are in and its amendments are done. Promotion to production still needs the owner's explicit yes.

**Three PRs still owe fixes.** Scoping listed A3, B3 and B4 as first wave, but as scoped they are not inert:

| PR | What it must fix first |
|---|---|
| A3 | It contradicted itself (first wave, and "after Nevada plus 72 hours"), and its missing-events-row rule was undefined. That rule decides whether a Stellr registration can be refused. |
| B3 | Filtering `lastCronResult` on `parent_id` errors in PostgREST wherever the column does not exist yet (production until the owner applies it). `lastCronResult` then returns nothing and the `apollo-reconcile` `nextOffset` cursor restarts. |
| B4 | `proxy.ts` statically imports `lib/rate-limit.ts`, so new exports there join the bundle that runs on every request, with Active CPU near 90% on Hobby. The new gc call also errors in the live `entitlements` cron until the migration lands. |

The fixes for all three are under [PR amendments](#pr-amendments).

**Rules:**

- **Promotion.** Any merge to `dev` rides along on the next `dev` to `main` promotion, wave 1 included, so re-read `main..dev` right before one. Every promotion that carries S5 code needs the owner's approval.
- **Hotfix.** A production fix that must not carry S5 code goes as a cherry-pick branch to `main`, never as a `dev` promotion.
- **B13.** It edits the cron that sends post-event surveys, Nevada's included. After it lands, confirm in `cron_runs` that the cron still opens and invites.
- **Environment flips.** On `dev` first, each followed by a redeploy of the newest READY deployment.

Every runtime change sits behind a default-off flag: `TENANT_ROUTING_ENABLED`, `AUTHZ_SOURCE=clerk`, `LOADSCOPED_MODE=off`, `TENANT_DB_ENABLED` off and `TENANT_DB_AREAS` unset, `RATE_LIMIT_STORE=memory`, `PLATFORM_AUDIT_ENABLED` off, `TENANT_EVENT_MAIL_ENABLED` off (wave 5), `TENANT_GUARDIAN_CONSENT_ENABLED` off (wave 6). Where it cannot be, it must be provably a no-op for Stellr: a platform-owner early return, the Stellr-or-NULL tenant filter, or the zone-suffix string check.

## Lanes and file ownership

Lanes split by file ownership, not by mechanism. A file has one owner. Any `lib/**` file or root config file nobody claims belongs to Lane C.

**Paths after B5c.** B5c moved every Stellr route group under `app/(stellr)`, so Stellr has one root layout and the tenant tree another. URLs did not change. The globs below name the new paths. A branch opened before B5c that adds a file under `app/(public)`, `app/(flow)`, `app/(auth)`, `app/(member)` or `app/(admin)` runs `scripts/codemods/stellr-root-group.mjs` when it merges `origin/dev`. That codemod sits under Lane C's `scripts/codemods/**`; B5c added it as a cross-lane file.

### Lane A: participant flows and registration

- `app/api/register/**` (sole owner), `app/(stellr)/(flow)/**`, `app/(stellr)/(public)/credentials/**`
- `app/api/members/teams/**`
- `app/api/{check-in,check-in-desk,sign,survey,credentials,team-profile,volunteer,consent,uploads}/**`
- `app/api/stripe/**`, `app/api/webhooks/**`
- `lib/registration/**` (new), `lib/registration-eligibility.ts`, `lib/registration-checkout.ts`, `lib/group-billing.ts`, `lib/individual-payment.ts`, `lib/group-registration-setup.ts`
- `lib/sheet-participant-sync.ts`, `lib/age.ts`, `lib/pending-consent.ts`, `lib/guardian-consent.ts`
- `lib/esign/**`, all of it. C22 reads through Lane A's `lib/esign/data.ts`, and any C22 hunk here follows the cross-lane rule.
- `lib/credentials*.ts`, `lib/check-in*.ts`, `lib/team-profile/**` except `store.ts`
- `lib/survey/**` except `run.ts`, `retention.ts` (Lane B) and `admin-auth.ts` (Lane C)
- `test/registration/**`, `e2e/core/registration-*.spec.ts`, `e2e/fixtures/check-in.ts`, `supabase/tests/database/participant_eligibility.test.sql`

The scoped globs `lib/credentials/**` and `lib/check-in*/**` matched nothing, and `lib/team-profiles/` does not exist (the directory is `lib/team-profile/`). New data modules go at non-colliding paths such as `lib/credentials-data.ts`: a `lib/credentials/` directory beside `lib/credentials.ts` makes `@/lib/credentials` ambiguous. Moving an existing file into a directory is its own no-op PR.

### Lane B: tenant edge and platform

- `proxy.ts`, `next.config.mjs`, `lib/csp.ts`, `lib/request-nonce.ts`, `lib/private-routes.ts`, and their tests
- `lib/tenancy/{host,host-pure,tenant-surface,request-tenant,stellr-scope}.ts`, `lib/tenancy/registry.ts`
- `app/%5Ft/**` (the tenant tree), the Stellr root (`app/(stellr)/layout.tsx`, `app/(stellr)/document.tsx`, `app/(stellr)/not-found.tsx`) and `app/global-not-found.tsx` (B5c), `app/(stellr)/(public)/**` except `credentials/**`, `app/(stellr)/(auth)/**`, `app/(stellr)/(member)/**` except `app/(stellr)/(member)/layout.tsx`, `app/sitemap.ts` and the metadata routes
- `components/analytics/**`, `lib/analytics.ts`
- `lib/community.ts`, `lib/community/**`, `lib/member-session.ts`, `lib/event-participation-sync.ts`, `lib/auto-membership-grant.ts`, `lib/notify.ts`, `lib/email.ts`, `lib/event-emails/**`, `lib/email-budget.ts`
- `lib/event-space-sync.ts`, `lib/spaces*.ts`, `lib/space-*.ts`, `lib/resource-upload.ts`, `lib/resource-finalise.ts`, `lib/mentoring.ts`, `lib/coaching.ts`, `lib/container-sync.ts`
- `lib/cron.ts`, `lib/cron-runs.ts`, `lib/cron-tenants.ts`, `lib/cron-scope.ts`, `lib/cron-audit.ts`, `app/api/cron/**`
- `lib/admin-digest.ts`, `lib/compliance-notify.ts`, `lib/membership-grants.ts`, `lib/training-reminders.ts`, `lib/survey/run.ts`, `lib/survey/retention.ts`, `lib/team-profile/store.ts`
- `lib/rate-limit.ts`, `lib/rate-limit-store.ts`, and the async module B4 adds
- `app/api/members/**` except `teams/**`, `app/api/community/**`, and any non-admin `app/api/**` route Lane A does not claim
- `e2e/tenancy/**`, `e2e/core/tenant-host-smma.spec.ts`, `e2e/fixtures/tenant-hosts.ts`, `playwright.config.ts`

### Lane C: staff surface

- `lib/authz.ts`, `lib/authz/**`, `test/fixtures/authz-principal.ts`
- `lib/admin-auth.ts`, `lib/event-access.ts`, `lib/impersonation.ts`, `lib/deletion/**`, `lib/scholarship-*.ts`, `lib/refunds/**`, `lib/store/**`, `lib/uploads.ts`, `lib/training.ts`, `lib/activity-log.ts`, `lib/survey/admin-auth.ts`
- `lib/events/**`, `lib/audit/**`
- `lib/tenancy/{db,db-callers,driver,area-switch,load-scoped,scope-context,role-mapping,tenant-role,storage,constants}.ts`
- `lib/security/**`, `lib/testing/**`
- `app/api/admin/**`, `app/(stellr)/(admin)/**`, `app/(stellr)/(member)/layout.tsx`, `components/layout/NavUserButton.tsx`, `app/api/store/returns/route.ts`
- `test/idor/**`, `test/route-manifest.test.ts`, `test/route-guards.test.ts`, `test/admin-page-guards.test.ts`, `test/authz-*`, `test/baselines/**`, `test/*-ratchet.test.ts`, `test/audit-coverage.test.ts`, `test/optional-event-tenant-id.test.ts`, `test/integration/**`, `vitest.integration.config.mts`
- `scripts/codemods/**`, `scripts/s5-inventory.mjs`, `scripts/set-admin.ts`, `scripts/map-tenancy-roles.ts`, `scripts/ci-db-build.sh`
- `package.json`, `package-lock.json`, `.github/**`, `.semgrep/**`

**Lane C runs strictly one PR at a time.** C4, C6 and C12 edit the same harness, mocks and snapshot, and C8 touches 12 admin files that collide with C13 to C23.

### Lane D: docs

`docs/**`, `.env.local.example` (names only, never values), and `test/threat-model.test.ts` only if row anchors change. No code, no migrations. Code PRs do not edit `docs/**`, with the one exception in the merge rules below.

## Merge rules for shared files

| File | Owner | Rule for other lanes |
|---|---|---|
| `lib/security/route-manifest.ts`, `route-guards.ts`, `route-ast.ts` | C | Minimal hunks for their own routes or guard names only (B5 appends the `%5Ft` page entries; B4 and B15 the `rate_limit` names and the two `schools/search` and `store/checkout` allow-list removals). Lane C review plus CODEOWNERS. |
| `lib/tenancy/registry.ts` | B | Lane B review. C0b's `child()` changes are a Lane C hunk here. |
| `lib/tenancy/constants.ts` | C, frozen | No S5 edits. Import from it: `TENANT_MIN_PARTICIPANT_AGE` already lives there. |
| `package.json`, `package-lock.json` | C | No new dependency without the owner's approval. The only two proposed are `ts-morph` (C10) and `postgres` (C11), each exact-pinned, at least 2 weeks old, installed with `--before`. `postgres` (postgres.js) was approved by the owner on 9 Nov 2026. |
| `.github/workflows/ci.yml` | C | B10 may append one job block, with CODEOWNERS review. |
| `.github/CODEOWNERS` | C | A PR that adds a guard, gate test or security file appends its path in the same PR, as the file's own header asks: one added line per path, nothing reordered, Lane C review. |
| `test/integration/**` | C | An A or B hunk is allowed for its own area, with Lane C review. |
| `test/idor/idor-snapshot.json` | C | Regenerated by `npm run idor:snapshot` in Lane C PRs only. Other lanes state the expected diff and Lane C regenerates it. |
| `test/baselines/**` | C | Generated, never hand-edited. Other lanes state the expected shrink and Lane C regenerates. `unaudited-mutations.json` is the exception: `test/audit-coverage.test.ts` fails on any difference from the measurement, so a PR that adopts audit (B16 included) runs `npx tsx scripts/s5-inventory.mjs --write` itself and commits the shrink. A change that grows the list, which a new write in a helper a GET reaches can do, also needs `--allow-grow` and the `audit-cap-grow` label. |
| `docs/THREAT-MODEL.md`, `docs/SECURITY-route-manifest.md` | D | Code PRs do not edit them, with one exception. A PR that lands a path listed in THREAT-MODEL §10 moves it out of §10 and adds a change-log row in the same PR, because `test/threat-model.test.ts` fails otherwise. It may change that test only as far as the move needs. C1 does both. |

Any PR with a cross-lane hunk merges `origin/dev` in immediately before it merges (never rebases). A CONFLICTING PR gets no CI, and a green badge from before the merge proves nothing.

## Migrations

**No bands.** The scoped version bands (`202611050…` per lane) are withdrawn. They hand-pick versions, and they would sit in the past by the time these migrations are written.

1. **Stamp by wall clock when the file is created:** `npm run migration:new -- <name>`. Never hand-edit a version to reorder.
2. **Check for an exact version collision** across open branches before merging. `npm run lint:migrations` catches it inside one tree only.
3. **Applying to the dev database is an explicit manual step, and the PR names it.** CI's `db` job builds an ephemeral database from `supabase/baseline.sql` plus the migrations and never touches `dev`. Passing CI does not mean `dev` has the change. Re-read `npm run db:status` after applying.
4. **Production:** the `prod-migrate` Action, with owner approval, one named file at a time, applied before the code that needs it is promoted. Re-read `db:status --prod` after each. It refuses only a version or name already in the ledger, so an older version applied after a newer one is fine. There is no `--include-all` step.

Migrations S5 expects, with no version assigned until created:

| PR | Name | What it does |
|---|---|---|
| A3 | `participants_eligibility` | Three triggers and the check they share: `zzz_participants_assert_eligible`, which sorts after any `zz_tenancy_derive_tenant_id` trigger, `zzz_registrations_assert_eligible`, and the events-row re-check `zz_events_assert_participants_eligible` (see A3 below). |
| B3 | `cron_runs_tenant` | `cron_runs` gains nullable `tenant_id` and `parent_id`, plus a partial index. |
| B4 | `rate_limit` | UNLOGGED table and 2 functions, EXECUTE for `service_role` only. |
| B9 | `community_stellr_only_check` | CHECK (`tenant_id IS NULL OR` Stellr), NOT VALID then VALIDATE, on 4 tables: `community_spaces`, `community_resources`, `mentoring_cohorts`, `training_modules`. |
| C0b | `via_parent_tenant_expand`, `_backfill`, `_policies`, `_carry` | `tenant_id` on the 10 `child()` tables, with a trigger that copies it from the parent. The composite FK is held back: see [C0b](#pr-amendments). Created after A3. |
| C7 | `platform_audit_webhook_actor` | Widens `platform_audit_events.actor_kind` and the actor CHECK to `webhook`, with `actor ~ '^webhook:[a-z0-9_-]{1,32}$'`. |

Lane C's "reserved, none planned" no longer holds: C0b and C7 both need one.

## Measured baselines

Counted at `c1e41eb8`. **Checked** means re-run for this file with the command shown; count the lines a `grep -l` prints. **Checked on `s5/C2`** means read from C2's generated output, from the only committed generator here (`scripts/s5-inventory.mjs`), and not on `dev` until C2 merges. **Analysis** means taken from the area analysis, not re-run. Generated baselines replace these numbers as they land; a ratchet cap is never typed in from here.

The route counts use one regex: `MUT='export[[:space:]]+(async[[:space:]]+)?(function|const)[[:space:]]+(POST|PUT|PATCH|DELETE)\b'`.

| What | Plan or scoping said | Measured | How | Status |
|---|---|---|---|---|
| Crons | 22 | **22** | `ls app/api/cron/*/route.ts` | Checked |
| Crons without `maxDuration` | 12, then "10" in review | **12** (10 have it) | `grep -L 'export const maxDuration' app/api/cron/*/route.ts` | Checked |
| Mutating `app/api/members` files outside `teams` | 20 | **15** (plus 5 under `teams`, 20 in all) | `grep -rlE "$MUT" app/api/members --include='route.ts*'`, then the same on `app/api/members/teams` | Checked |
| Existing register tests | 8 / 24 / 13, "52" | individual **10**, group **27**, group-join **16** (53), plus pay **7** | `grep -cE '^\s*(it\|test)(\.each)?\('` | Checked |
| Route manifest | 473 | **473**: cron 22, webhook 12, participant 126, public 111, stellr_only 202 | `grep -cE "': '<class>'" lib/security/route-manifest.ts` for each class | Checked |
| Manifest `tenant_crew`, `platform_admin` | 0 | **0** | same | Checked |
| Route files | 310 | **306** under `app/api`, plus 4 file routes elsewhere (310) | `find app -name 'route.ts*'` | Checked |
| Pages | 158 | **158**, of which `(flow)` **16** | `find app -name page.tsx` | Checked |
| Mutating route files | 213 | **213** | `grep -rlE "$MUT" app --include='route.ts*'` | Checked |
| Mutating handlers | 266 | **266** | `grep -rhE "$MUT" app --include='route.ts*'` | Checked |
| Unaudited mutating handlers | 265 | **264**, plus 22 crons (`impersonation` audits both its POST and DELETE) | C2 `test/baselines/unaudited-mutations.json` | Checked on `s5/C2` |
| Service-role files | 409 | **417**: 408 callers of `supabaseServer` or `supabaseServerTyped` (409 counted `lib/supabase.ts`, which defines them), plus 9 files that build their own client with the secret key | C2 `test/baselines/service-role-files.json` | Checked on `s5/C2` |
| Sanity event-getter importers | 72 | **73** (the 72 missed a multi-line import) | C2 `test/baselines/sanity-event-getters.json` | Checked on `s5/C2` |
| Authz legacy idioms | ~192 in the plan; 222 files and ~295 sites in scoping; 194 in review | **Not fixed by hand.** The answer depends on the idiom list | C5a's committed script | See below |
| `requireAdminPage` pages | 33 | **33** | `grep -rl requireAdminPage app --include=page.tsx` | Checked |
| Tests mocking `admin-auth` or `event-access` | 27 | **27** | `grep -rlE "mock\(['\"]@/lib/(admin-auth\|event-access)['\"]" app lib test components` | Checked |
| IDOR targets | 227 | **227**: stellr_only 131, participant 64, public 30, webhook 2 | `idor-snapshot.json` | Checked |
| IDOR outcomes | | refused 283, ok 19, unexercised 16, error 9, honey_write 3, leak 1 | same | Checked |
| Global-id routes | ~82 | **131** files, **216** cases; **51** files (77 cases) tenant-destined | `idor-snapshot.json`; the 51 from Analysis | Checked (131, 216) |
| Rate-limiter importers | 30 | **30**, 5 under `app/api/register` | `grep -rl "from '@/lib/rate-limit'" app lib components proxy.ts --include='*.ts' --include='*.tsx'` | Checked |
| Registry `child()` tables | 10 | **10** | `grep -c 'child(' lib/tenancy/registry.ts` | Checked |
| Data-cache users | | **5**: `lib/price-cache.ts`, `lib/event-pricing.ts`, `lib/tier-pricing.ts`, `app/api/schools/lookup`, `app/api/webhooks/sanity` | grep `unstable_cache\|revalidateTag` | Checked |
| Community and home manifest entries | 80 | 80 | | Analysis |
| Tenant-host candidates and import closure | 46 / 291 files | 46 / 291 | | Analysis |
| Files touching a `via_parent` table; touching `members` | 61; 99 | 61; 99 (heuristic: direct `.from()` only) | | Analysis |
| Migrations | 214 | **214**, newest `20261104400000_field_crypto_shadow.sql` | `ls` | Checked |

**The 12 crons.** The review's correction to 10 is wrong, and this file keeps 12. It ran `rg -L`, which in ripgrep means follow symlinks, not "files without a match" as in grep. So its 10 is the count that have `maxDuration`. The routes that lack it: `alumni-upgrades`, `campaign-drip`, `campaign-events`, `docusign-form-data`, `docusign-reminders`, `entitlements`, `hubspot-event-options`, `hubspot-lifecycle`, `lead-capture-failures`, `motion-bookings`, `session-reminders`, `training-reminders`. B11's sweep covers these 12. `docusign-reminders` and `docusign-form-data` have internal budgets of 90 s and 120 s, so B11 must pick their value against those budgets, not copy the others' 60.

**The authz count.** The figure depends on the idiom list: scoping's list gave 222 and the review's gave 194. C5a commits the script and the idiom list, and the generated baseline is the only number the ratchet may use. Neither 222 nor 295 may be hand-entered.

**Stale in code:** #535 fixed the `API routes (305)` header and the 226 and 130 counts (the IDOR comment now reads 228 and `MIN_TARGETS` is 215). The header has drifted again: on 14 Nov 2026 `lib/security/route-manifest.ts` says `API routes (307)` while `app/api` holds 324 route files. It is not corrected here, because open PR #684 edits that file; correct it once #684 has merged.

## PRs

"Wave" says when a PR may merge to `dev`. **1** means now: it is inert. **Later** means once its dependencies are in and its amendments are done, with the flag-off or no-op proof above. Added or changed by the review: **+**.

**Wave 1 follow-ups.** Tests named `KNOWN DEFECT` and the entries in `HELD_BACK_FIXTURES` fail when their route is fixed, and the fix updates them in its own commit. Lane A owns the registration ones and `C4-F4` and `C4-F6`. Lane B owns `C4-F1`, `C4-F2`, `C4-F3` and `C4-F5`.

### Lane A

| PR | What | Depends on | Wave |
|---|---|---|---|
| A1 | Characterisation tests for the three participant-writing register routes | | 1 |
| A2 + | `assertEligible()` and `EligibilityContext`, unused. Imports `TENANT_MIN_PARTICIPANT_AGE` | | 1 |
| A3 + | Participants eligibility trigger and pgTAP | | later |
| A4 | Handler split: `register/individual` | A1, A2 | later |
| A5 | Handler split: `register/group-join` | A1, A2, A4 | later |
| A6 | Handler split: `register/group` | A1, A2, A4 | later |
| A7 + | Tenant event resolution, API age gate, Stellr-only hooks, audit on all 5 register routes, priced-event refusal | A3, A4, A5, A6, B5, B5b, B8, B10a, B14, C7, C8 | later |
| A7f + | A7 follow-up (owner decision, 10 Nov 2026): on a tenant host the individual and group register gates read no session, so a tenant form uses only the details typed | A7 | later |
| A8 + | Other participant writers: team-leader add and edit, roster sheet import | A2, A3, A7 | later |
| A9 + | Async rate-limiter adoption | B4, C5b | later |
| A10 + | Data conversion: credentials, surveys, team profiles, volunteer interest | C0b, C7, C11, C12 | later |
| A11 + | E-sign participant side | A10, C0b, C12 | later |
| A12 + | Check-in participant side | A10, C0b, C12 | later |
| A13 | Stripe and webhook handlers: audit actors, tenant resolution | A7, C7 | later |
| A14 + | Audit sweep: `consent/request`, `uploads/sign` | C7 | later |
| A16 + | Tenant guardian consent (owner decision, 10 Nov 2026): a 14 to 17-year-old admitted to a tenant's event, on `register/individual` only, once a parent or legal guardian signs a platform-locked document on the native signing engine. Behind `TENANT_GUARDIAN_CONSENT_ENABLED`, with one migration | A7, B14b, C7 | later |

### Lane B

| PR | What | Depends on | Wave |
|---|---|---|---|
| B1 | Tenant host resolver and host map, library only | | 1 |
| B2 + | Tenant-host allow-list as data. Its test asserts the class split, not only 473 | | 1 |
| B3 + | Cron tenant runner, `cron_runs` columns | | later |
| B4 + | Postgres rate limiter core | | later |
| B5 + | Proxy tenant routing behind the flag, minimal tenant tree | B1, B2 | later |
| B5b + | Tenant page tree: wrappers under `app/%5Ft/[tenant]/(flow)/{register,sign,survey,check-in,team-profile}/...`, tenant from params only, record-belongs-to-tenant loaders, tenant-tree lint | B5, B8 | later |
| B5c + | Root layout split: Stellr metadata, JSON-LD, `ConsentMode`, `SiteTracking` and Search Console verification move to a Stellr root layout; `app/%5Ft/[tenant]` gets its own, with nonce-aware scripts only | B5, B10a | later |
| B5d + | Tenant-scoped data caches (S4-SPIKE section 5.5): cache keys and tags carry `t:{tenantId}` for the 5 users | B5 | later |
| B6 | Enforcing CSP per tenant host | B5 | later |
| B7 | No trackers on tenant hosts | B1 | later |
| B8 + | Social import-closure lint, community split, wider `event-hooks` | B2, B5 | later |
| B9 + | Community unreachable on tenant hosts, 4-table CHECK | B5, B8 | later |
| B10a + | Routing harness: Playwright tenant-host project, fixtures, and check (a), the flag-off and flag-on body hash | B5 | later |
| B10 + | Remaining gates: (b) warm cache, (c) Host spoof, (d) 0 trackers | B5b, B5c, B6, B7, B9, B10a | later |
| B11 | Stellr-only crons limited to Stellr data; `maxDuration` on all 23 | B3 | later |
| B12 | Cron audit hook | B3, C7 | later |
| B13 | Per-tenant surveys, team-profile and survey-retention crons | B3, B11 | later |
| B14 | Per-tenant event emails and e-sign reminders, tenant email share | B3, B11 | later |
| B14b + | B14 follow-up (owner decision, 10 Nov 2026): the signing engine's tenant sender. Another tenant's signing mail goes from its sender, or is held or not sent, and `docusign-reminders` may chase its native envelopes | B14 | later |
| B15 + | Async rate-limiter adoption, the `schools/search` and `store/checkout` limits | B4, C5b | later |
| B16 + | Member and community audit sweep, explicit `tenant_id` writes | C2, C7 | later |
| B17 | Staff email audiences from memberships | C9 | later |
| B18 + | Audit sweep: `email/unsubscribe`, `printful/webhook`, `campaigns/[slug]/submit`, `scholarship`, `store/checkout`, `store/reship`, `privacy-requests` (2), `teacher-grant` | C7 | later |
| B19 + | Events-facade codemod on Lane B files: public pages, sitemap, crons, `lib/survey/run.ts` | C8 | later |
| B20 + | `lib/community.ts` off `isAdminClaims`; `proxy.ts` admin prefilter per the owner's choice | C1, C14 | later |

B10 is split because review made B5c depend on B10's body hash, and B10 depend on B5c for its "0 CSP violations". The harness and check (a) land first. A7 needs only the harness.

B5d is added by this file: the review listed the gap but no fix. It has hunks in Lane A (`webhooks/sanity`) and Lane C (the `lib/*pricing` files), so the cross-lane rule applies. **Confirm it before building.** Likewise added here, by walking every mutating route group: `teacher-grant` in B18 and the 5 team routes in A8.

### Lane C

| PR | What | Depends on | Wave |
|---|---|---|---|
| C0b + | S4 `via_parent` follow-up: `participants`, `agreement_recipients`, `esign_access_log`, `esign_audit_events`, `credential_events`, `member_group_members`, `store_order_items`, `store_returns`, `survey_invitations`, `survey_answers` | A3 | later |
| C1 | `lib/authz.ts` core and equivalence harness | | 1 |
| C2 | Data-access inventory and shrink-only ratchets | | 1 |
| C3 | `loadScoped` and scope context | | 1 |
| C4 | Exercise the 16 unexercised and 9 error IDOR cases | | 1 |
| C5a + | Guard list learns authz; legacy-idiom ratchet generated by script | C1 | later |
| C5b + | Guard list learns the async `rate_limit` names | B4 | later |
| C6 + | IDOR ratchet: tenant and participant personas, 4xx oracle, disposition register | B2, C3, C4, C5a | later |
| C7 + | Audit mechanism, catalogue, enforcing gate, webhook actor migration | C2, C6 | later |
| C8 | Events facade complete; codemod on Lane C files | C2 | later |
| C9 | Role sync: dual-write, drift check, audience helpers | C1 | later |
| C10 | Committed authz codemod | C1 | later |
| C11 | `tenantDb` Postgres driver and CI tenant-db job | C2 | later |
| C11t + | C11 follow-up (owner decision, 10 Nov 2026): `sslmode=verify-full` and `TENANT_DATABASE_CA_CERT` required for any non-local tenant database host | C11 | later |
| C12 | Per-area switch, shadow compare, two-tenant kit | C7, C11 | later |
| C13 + | Pilot: Stellr-only community, academy, training, coaching, entitlements admin | C5a, C7, C10 | later |
| C14 + | Admin shell, view-as, staff-target checks | C1, C5a | later |
| C15 + | Platform-destined routes reclassified, guard unchanged | C6, C7, C9, C14 | later |
| C16 | Events admin T2: records by id inside an event | C3, C6, C7, C9, C14 | later |
| C17 | Events admin T1a: paperwork and communications | C8, C16 | later |
| C18 | Events admin configuration, first `tenantDb` area | C12, C17 | later |
| C19 | Events credentials, artwork, admin check-in | C18 | later |
| C20 | Scholarships, refund policies, refunds, group invoices | C18 | later |
| C21 | Members, people and access admin, and `app/api/admin/event-managers`, which C16 moved to `lib/authz` and audit but left on the Stellr admin guard | C9, C13, C14 | later |
| C22 | E-sign, DocuSign and agreements admin | A11, C10, C14 | later |
| C23 + | Store, surveys, email and other admin | C7, C10, C14, C15 | later |
| C24 | Dynamic admin page loaders, AST page rule | B5, C17, C20 | later |
| C25 + | Shadow window, flip, contract | B17, B19, B20, C13 to C23 | Owner-gated; may be the first S6 step |

### Lane D

| PR | What | Depends on | Wave |
|---|---|---|---|
| D1 | This file | | 1 |
| D2 | Routing runbook, CSP and cookie note, threat-model rows | B5 | later |
| D3 | `docs/AUTHZ.md` | C1 | later |
| D4 | Data, `loadScoped` and audit runbook (`docs/TENANCY-S5-data.md`); route-manifest doc | C3, C7, C11 | later |
| D5 | Registration eligibility record | A3 | later |
| D6 | Crons, limiter and SMMA record; WAF runbook; SMMA memo | B3, B4, B8 | later |
| D7 + | 30-day Stellr flow checklist | | later |

**D7** lists each flow, its evidence source and a sign-off row: individual registration; group by invoice and by card; group-join; signing; survey; the check-in desk and QR; credentials; refunds; scholarship; the admin event screens; and each of the 24 crons (`email-outbox`, added in #600, is the 24th). The sign-off itself is the owner's, at M1. The list is `docs/TENANCY-S5-flow-checklist.md`.

## Wave 2 status

**Merged** means squashed into `dev` on 5 Nov 2026, one PR per lane: Lane A #540, Lane B #534, Lane C #535, Lane D #547. **Waves 1 and 2 are on production:** promoted in #548 (`5386f5e7`) with the owner's yes, READY on 6 Nov UTC (`.claude/releases/promote-2026-11-05.md`). The flags stay as they were: no flip was part of that promotion, and production's values were not read, because the connector refuses env listing. Every PR not listed here or under wave 3 is still to build.

| PR | State | Flag, or why it is a no-op for Stellr |
|---|---|---|
| A0 + | Merged. Added for the wave 1 `KNOWN DEFECT` tests | A defect fix: register routes fail closed on a failed read. Stellr sees a change only when a read has already failed |
| A3 | Merged | Platform-owner early return. One added lookup per participant write, and a failed read fails the write |
| A4, A5, A6 | Merged | Pure refactors, pinned by branch tests that passed on the unsplit routes first |
| A5 + | Merged in #549. Owner decision, 5 Nov. Added ahead of A7 | **Not a no-op:** a join link, the individual form and the group form's organiser ask an email on file to sign in, and the register forms give one answer for an address already on the event to anyone not signed in as it |
| A6 + | Merged. Owner decision, 5 Nov | **Not a no-op:** organisers see a Member ID linked row by name and status only, for rows linked from now on (`lib/team-linked-details.ts`) |
| B0 + | Merged. Added for the wave 1 follow-ups | Defect fixes on community reports and reactions, cohort sign-up and library files |
| B3 | Merged | No route imports the runner. `lastCronResult` works with or without the migration |
| B4 | Merged | `RATE_LIMIT_STORE=memory`. `proxy.ts` keeps only the sync module |
| B5 | Merged | `TENANT_ROUTING_ENABLED`. **One exception:** the host-keyed matcher entry, below |
| B7 | Merged | Only stops trackers on hosts that are not Stellr's |
| C5a, C6 | Merged | Tests, static checks and CI only |
| C7 | Merged | `PLATFORM_AUDIT_ENABLED`. No route imports it yet |
| C8 | Merged | The facade returns `lib/sanity`'s result by reference |
| C9 | Merged | Under `AUTHZ_SOURCE=clerk` nothing reads the rows it writes. A failed write changes no response |
| D2, D3, D5, D7 | Merged in #547 | Docs |

**Migrations, stamped.** All five are on the `dev` database and on production. **The route to production differed from [Migrations](#migrations).** They went through the Supabase MCP on 5 Nov, with the owner's yes for each file and for the route, because `prod-migrate` found no `PROD_DATABASE_URL`. Each ledger row was realigned to its file's version and `db:status --prod` re-read. The `prod-migrations` environment that run created had no protection rules, and `prod-migrate` is still unproven. (Update 12 Nov 2026: that environment's protection rules were set on 11 Nov 2026, and A16 went through `prod-migrate` on 12 Nov 2026. §7 has no proof date yet. See [Owner gates](#owner-gates).)

| PR | File |
|---|---|
| B3 | `20261105005751_cron_runs_tenant.sql` |
| A3 | `20261105041211_participants_eligibility.sql` |
| B4 | `20261105042629_rate_limit.sql` |
| C7 | `20261105052154_platform_audit_webhook_actor.sql` |
| A6 + | `20261105131500_participants_details_from_member.sql`. `GET /api/members/teams` names this column, so it was applied first |

**Proven on `dev`.** pgTAP passed on all five in CI's `db` job, and B4's race test passed. B5's host-keyed matcher entry passed its live check on the `dev` alias (`docs/TENANCY-S5-routing.md`).

**Not yet proven.**

- **The real-registration witness for A4 to A6 was waived, not done.** The owner waived it for the promotion on 5 Nov, and #549's own list likewise. No real registration has been seen through the split routes, on `dev` or production, so coverage is unit and characterisation tests.
- The team page's linked-row view has unit tests only. It has not been opened in a browser, and `details_from_member` was true on 0 production rows on 5 Nov. Owned by tracker `s5-programme.35` since 14 Nov 2026.
- A real participant write through A3's trigger on production has not been confirmed.
- Active CPU under real traffic with B5's matcher entry is unmeasured.
- The parity query proves nothing on production yet: `events` had 0 rows there on 5 Nov, and the mirror backfill is owed.

### What wave 2 corrected

Where these touch a number earlier in this file, the generated baseline wins, as the header says.

| This file said | Now | Source |
|---|---|---|
| Authz legacy idioms: not fixed by hand | **222 files, 328 sites** at C5a | `test/baselines/authz-legacy-idioms.json` |
| Mutating handlers 266, unaudited 264 | **269 and 268**, plus 22 crons. **15 GET handlers write**, which C2 could not see: all 15 unaudited | `test/baselines/unaudited-mutations.json` |
| Service-role files 417 | **422**, with 417 still carrying a provisional reason | `test/baselines/service-role-files.json`, `service-role-seed.json` |
| Sanity event-getter importers 73 | **44**, after C8's codemod on Lane C files | `test/baselines/sanity-event-getters.json` |
| Route manifest 473 | **475**: B5 adds 2 `public` pages for the tenant tree | `lib/security/route-manifest.ts` |
| IDOR targets 227, 131 `stellr_only` | **228, 132** | `docs/SECURITY-route-manifest.md` |
| Disposition register 51 / 9 / 55 / 16 | **52 / 9 / 55 / 16**, 132 routes, still proposed for the owner | `lib/security/stellr-only-dispositions.ts` |
| `MAX_UNEXERCISED` 16 | **5**, with `MAX_ERROR` **3**. B0 tried 3 and 2, and its review put them back | `test/idor/idor-routes.test.ts` |
| Shadow reads are sampled and limited to admin (Risks) | **`lib/authz.ts` has no sampling.** Measure Active CPU at the flip, and decide on sampling before a call site that serves ordinary members moves on | `docs/AUTHZ.md` |
| A3: one function, two triggers | Three triggers. The events re-check also covers `time_zone` and `slug`, and refuses a tenant event's handover to Stellr with tenant registrations on it | `docs/TENANCY-S5-registration.md` |

New numbers with no earlier row:

- **C6's tenant-host cap:** 26 routes, 120 cases, 94 failing, 18 unproven. These are caps that only fall, to 0 failing by the S5 gate (`test/baselines/tenant-host-idor.json`). The accepted register is empty.
- **Cron classes:** 22 classified in `lib/cron-scope.ts`. `test/cron-scope.test.ts` keeps it the same set as `app/api/cron` and `vercel.json`.

Decisions a slice made, for the record:

- **B5, `/` on a tenant host** serves the tree's neutral page, not a 404. It stays off the allow-list.
- **B5, the matcher.** The host-keyed entry goes further than the B5 amendment, which asked only for the `/_t` entry. It is the one change here a flag cannot gate.
- **A6, linked rows.** Only rows linked by Member ID from now on are limited. Rows already on a roster stay visible, because nothing recorded how they were filled in. The join-link and sheet paths never set `details_from_member`, because the person or the organiser typed those details.
- **B3, cron fairness.** The code default is `stellr_first` until the owner decides. `rotate` stays available.
- **C6.** The old "`tenant_crew` and `platform_admin` are empty" assertions are gone. A static rule stops a `tenant_crew` file calling `.from()` directly on a table with a tenant column.

### Owner decisions wave 2 raised

On top of [Owner gates](#owner-gates).

| From | Decision |
|---|---|
| A3 | When a tenant tightens an event and an existing participant no longer qualifies: keep refusing the change, or apply it to new writes and report them to staff. Settle before the first tenant event |
| A0, A4, A5 | Several decisions on how the register routes treat an existing member's record and what they answer. Two were settled on 5 Nov (A5 + above). The rest stay in the slice reports, because the repo is public and the behaviour is live |
| B0 | C4-F5, the store catalogue: give it a tenant, or accept the outcome with a written reason. And the access rule for a library file that has lost its last attachment. The slice report holds the detail |
| B3 | `alumni-upgrades`, `campaigns`, `campaign-drip` and `campaign-events` pick people from shared `members` with no tenant limit, and no slice claims this. Once tenant registrants exist as members they could receive Stellr marketing or Alumni grants. Name a slice, or record that it is acceptable |
| B3 | Retention for inactive tenants: `survey-retention` is assumed to keep running for them |
| B4 | Whether the nightly backup holds the hashed limiter counters: exclude `rate_limit_hits` from `ops/backups/backup.sh`, or keep them and say so in `docs/RUNBOOK-backups.md` |
| B5 | **Settled, 5 Nov:** the owner accepted the host-keyed matcher entry for #548. Its live check passed on the `dev` alias |
| B5 | Add to `Real tenant hosts`: `TENANT_ROUTING_ENABLED` stays off for any deployment with a zone attached until B5c and B10(d) pass, and A7, C6 and B10(c) pass |
| B5b | What a tenant's registration form may prefill for a signed-in member. Today nothing: a member's earlier answers, which can be a minor's, stay with the organiser who collected them. Name and email, or this tenant's own rows, are the options |
| C5a | Turn on the required code-owner ruleset. `.github/CODEOWNERS` only requests review until then. And confirm a PR label is enough to raise a ratchet |
| C6 | Whether per-route lists of differing refusals stay in the public repo, or become totals and a hash of the list. A CI artifact is not an option, because artifacts on a public repo are public. And which capability-token outcomes to accept before the S5 gate |
| A5 + | People an organiser enters, on the group form. With no session, naming someone on file as a student or adult still links them to the group. Their profile is not rewritten, and the owner's choice is what else to hold back until they confirm. The slice reports hold the detail |
| C9 | Run `--check` on `dev`, then production, before shadow, and decide what to do with any stale rows. Confirm a Clerk revoke through `set-admin` should go ahead when the Postgres write is refused |

### Docs owed at the end of wave 2

D6 is now delivered: see [Wave 3 status](#wave-3-status).

- **D4:** `docs/SECURITY-route-manifest.md` still says `platform_admin` and `tenant_crew` need "an admin check" and that a test asserts they are empty. C5a and C6 changed both. D4's data and audit runbook is also still to write, and `LOADSCOPED_MODE`, `TENANT_DB_ENABLED` and `PLATFORM_AUDIT_ENABLED` point to it from `docs/ENV-MATRIX.md`. The runbook says that crons write no event on dev (B12, `lib/cron-audit.ts`), so a green dev flip says nothing about them: the cron proof is the first production `cron.run.finish` rows after the flip, checked against that day's `cron_runs`.
- **D6:** the crons, limiter and SMMA record, and the WAF runbook. The record says that a run killed at `maxDuration`, or whose after-response write is lost, leaves no `cron.run.finish` event, so "100% of mutations audited" means every finished run. Once `PLATFORM_AUDIT_ENABLED` is on, compare those rows with `cron_runs`, whose started rows show any run that never finished.

## Wave 3 status

**Merged** means squashed into `dev` on 6 Nov 2026, one PR per lane: Lane A #562, Lane B #563, Lane C #564. Lane D, this docs PR, follows them. **Since promoted:** wave 3 went to production in #561 (`028bea6e`) on 6 Nov with the owner's yes (`.claude/releases/promote-2026-11-06.md`). Every PR not listed here or under wave 2 is still to build.

| PR | State | Flag, or why it is a no-op for Stellr |
|---|---|---|
| A14 | Merged in #562 | `PLATFORM_AUDIT_ENABLED`. With it off, the route helpers return before reading a session or writing. `uploads/sign` caps its own audit rows at 120 an hour per user, per purpose and per instance |
| B5b | Merged in #563 | The tree is reached only with `TENANT_ROUTING_ENABLED`, and 404s by its own URL. Stellr's bodies are called as plain functions, pinned by golden files written on the unsplit pages. `loadOpenCheckIns` gains the Stellr-or-NULL filter |
| B8 | Merged in #563 | Code moves, with the same exports. `recordEventParticipationForRegistration` gains one column read, and refuses only another tenant's row. Nothing imports the hooks yet |
| B10a | Merged in #563 | Tests and CI only. `tenant-host-routing` is report-only |
| B11 | Merged in #563 | The Stellr-or-NULL filter matches every row today. **Three things do change:** the digest, `training-reminders` and the HubSpot option sync each add a read of `events`, and fail closed if it fails. `maxDuration` is now declared on all 23 |
| B12, B18 | Merged in #563 | `PLATFORM_AUDIT_ENABLED`. An audit failure changes no response |
| C0b | Merged in #564, **part of the slice held back** | Expand-only, and the carry trigger's WHEN is never true for Stellr. **Not free:** each child insert gains a tenant lookup, and `select('*')` results gain `tenant_id`, including three route bodies (see [C0b](#pr-amendments)). The composite FK is not built |
| C5b | Merged in #564 | Static check only. No route calls the async limiter |
| C10 | Merged in #564, **not run on the app** | A tool and its tests. No app file changed |
| C14 | Merged in #564, **partial** | `AUTHZ_SOURCE=clerk` keeps every answer and adds no role-table read. **The first runtime use of `lib/authz` for a decision.** `app/(member)/layout.tsx` and `NavUserButton` did not move, because they serve ordinary members and `docs/AUTHZ.md` asks for a sampling decision first |
| D6 | This docs PR | Docs |

**Migrations, stamped.** Only C0b has any, four files to apply in order, each as its own step:

| File | What it does |
|---|---|
| `20261106070722_via_parent_tenant_expand.sql` | Nullable `tenant_id`, index and derive trigger on the 10 child tables |
| `20261106070724_via_parent_tenant_backfill.sql` | Idempotent backfill |
| `20261106070726_via_parent_tenant_policies.sql` | `tenant_app` grants and policies |
| `20261106074112_via_parent_tenant_carry.sql` | Moves children when a parent changes tenant |

All four are on the `dev` database, applied on 6 Nov after #564's `db` job passed, with the ledger realigned to each file's version and re-read. All four went on production on 6 Nov, about 22:05 UTC, with the owner's yes, through the Supabase MCP because `prod-migrate` is unproven (see wave 2). Before them, production held 445 rows across the 10 tables and no query was running. Afterwards, `tenancy_cutover_checks` D2 and I read 0 on all 10 tables, `security_checks.sql` 0 rows, and the ledger was realigned and re-read. No write through the new trigger has been seen yet: see `promote-s5-wave3.3`.

- **`20261106070724_via_parent_tenant_backfill.sql` must run in a single transaction,** by `prod-migrate` or explicit `BEGIN`/`COMMIT`. Afterwards, check `pg_trigger` to confirm `esign_audit_events_guard` and `survey_invitations_updated_at` are enabled.
- **Apply outside event hours and outside active survey submission and signing,** because `20261106070726_via_parent_tenant_policies.sql` takes table locks that can abort a concurrent write.

**Proven.**

- B10a's check (a) ran on a real production build, 14 of 14, with no differences on any host, and `tenant-host-routing` passed step by step on GitHub Actions in #563 and #564.
- pgTAP passed on B12's new test in #563's `db` job, and on C0b's migrations in #564's.
- On the `dev` database after applying: `tenancy_cutover_checks` sections D2 and I at 0 on all 10 tables, `esign_audit_events_guard` and `survey_invitations_updated_at` enabled, and `tenant_app` unable to write `participants.member_id` or insert into `esign_audit_events`.

**Not yet proven.**

- **B5b's "same page" proof is a tree and HTML comparison under mocks,** not a byte comparison of real builds with real records. The harness has no CMS, so register bodies answer 404 there.
- **B11 and B12 prove nothing until production crons run,** because crons decline on `dev`. Check the first production `cron_runs` rows against the previous day's, and the digest in an inbox.
- **No record shows `AUTHZ_SOURCE=shadow` running in a deployment,** so C14's first real comparison is still to come.
- **The WAF rules.** Read the Firewall page and the plan's rule allowance when working through `docs/RUNBOOK-waf-rule.md`.
- **The actor on audit rows written inside `after()` with `{ session: true }`** (scholarship, campaigns submit, store reship) needs one real row checked on `dev` before `PLATFORM_AUDIT_ENABLED` goes on production.

### What wave 3 corrected

| This file said | Now | Source |
|---|---|---|
| 22 crons, 27 schedules, in several places above | **23 and 28**: `group-invoice-sync` came later. Read 23 wherever a row above says 22 | `lib/cron-scope.ts`, `vercel.json` |
| B13 and B14 cover the per-tenant crons | Not `group-invoice-sync`: it is `per_tenant`, and neither lists it. Safe until priced tenant events exist (S9), but it needs a slice | `docs/S5-CRONS-LIMITS-SMMA.md` |
| Unaudited: 268 mutations, 23 crons | **Crons 0** (B12). **Mutations 257** once A14 (2) and B18 (9) are both in; regenerated, never typed in | `test/baselines/unaudited-mutations.json` |
| Authz legacy idioms 222 files, 328 sites | **218, 309** (C14). C10's dry run says what the tool can reach: 328 to 78, but only by moving 33 pages to `pageRequireAdmin`, which still counts | `test/baselines/authz-legacy-idioms.json` |
| C0b adds a composite FK | **Held back.** No slice owns it yet | [C0b](#pr-amendments) |
| B8's baseline: 6 modules, 9 table files | **10 modules, 38 first-step imports, 17 table files, 0 channels,** after review widened the check. They fall from there, and they are not 0 | `test/tenant-surface-baseline.json` |
| `syncMemberOptionSelections` has no decision | Wrapped, as are `resolveAndLinkSchool` and `linkMembersToRegistrationSchool` | `lib/community/event-hooks.ts` |
| Crons audit through `withAudit` | Through `withCronAudit`, which writes nothing outside production. "100% of mutations audited" means every run that finished and whose event was not lost | `lib/cron-audit.ts` |
| Extend the WAF rule to `/credentials/`, then tenant hosts | **Separate rules**, because one rule appears to keep one count per IP across all it matches, and a venue shares an IP. Not measured | `docs/RUNBOOK-waf-rule.md` |
| Limiter problems log to `app_errors` (scoping) | `console.error`, once a minute per instance | `lib/rate-limit-store.ts` |

### Owner decisions wave 3 raised

On top of [Owner gates](#owner-gates) and the wave 2 list. Slice reports hold the detail where the behaviour is live.

| From | Decision |
|---|---|
| A14 | Decide how consent audit rows relate to the purge, before `PLATFORM_AUDIT_ENABLED` and `MINOR_SELF_SIGNUP_ENABLED` are both on. Take legal input. Neither flag is on by default |
| A14 | Review the limits on upload signing before the audit flag goes on. Any change there is live behaviour, so it needs its own flag or review |
| B8 | Should a tenant event write `event_participations` and the activity log? Set to no, because Stellr's account and staff pages read them with no tenant scope. Yes first needs a slice to scope those reads, ahead of A7. Withheld rows can be rebuilt from `participants` and `registrations` |
| B10a | Whether check (a) never comparing signed-in or real-record pages with routing on is accepted, or a slice takes it. The plan points this at D7's sign-off |
| B11 | Confirm the agent-written reason on the service-role ratchet entry for `scripts/hubspot-sync-event-options.ts`, or have the script pass `allTenants: true` instead, which keeps the list shorter but lets a manual `--apply` write another tenant's events to Stellr's portal |
| B18 | **Settled:** `teacher-grant`'s follow-up. The owner chose it, it merged in #566 and was promoted in #561: the school link and base membership now follow `upsertMember`'s `onCreated`, in place of a separate lookup |
| B18 | Decide the route limit for `store/checkout` (B15) before `PLATFORM_AUDIT_ENABLED` goes on production, or record the owner's written decision to go ahead without it |
| C10 | `OPERATIONAL_WRITERS`: its `lib/app-errors` entry now also covers `authz_mismatch` rows, which skip the scrubber because they carry a validated `members.id`. Accept this, or name a separate entry |
| C10 | The sampling decision (`docs/AUTHZ.md`) comes before `lib/store/auth.ts` can leave `HELD_WRAPPERS`, which C23 depends on. Or split the member-reachable PATCH in `app/api/store/returns` from the catalogue check |
| C14 | Should a member purge also protect a login holding only a `staff` membership or `admin_duties` row? It keeps today's rule, which counts `admin` and `event_manager`. Extending it changes who can be deleted |
| C14 | Add to Owner gates: before the first non-owner tenant on production, view-as refuses a target tied to that tenant until S6 support mode exists |
| C0b | **Applied on 6 Nov.** Still open: `participants_membership_id_seq`: keep the shared counter, or fund per-tenant numbering, before the first non-owner tenant |
| C0b | The composite FK: name its slice after A10 to A12, or record that the carry trigger is enough |
| D6 | Decide on the SMMA self-assessment, held privately. Work through `docs/RUNBOOK-waf-rule.md`. Name a slice for `group-invoice-sync` |

### Docs owed after wave 3

- **D4:** as under wave 2.
- **Flow checklist:** now lists 23 crons. D7's other counts are unchanged.

## Wave 4 status

**Built** means committed on a lane branch cut from `dev` at `063d9cb3`, with the slice's own tests and review. Each lane merges to `dev` as one PR (numbers are filled in at merge). **Lane B merges last,** because B5c's codemod, baselines and document captures belong to its merge base. If `dev` has moved past `063d9cb3` by then, merge `origin/dev` and read `main..dev` for changes to page tags; if there are any, recapture base and head and copy head over split, as the header of `e2e/tenancy/stellr-document.spec.ts` describes. Lane D, this docs PR, follows them. **Since promoted:** wave 4 went to production in #587 (`6026dd22`) on 9 Nov with the owner's yes, B9's migration applied to production before the merge with the owner's approval of the rule (`.claude/releases/promote-2026-11-09.md`). No new environment variable: every runtime change sits behind a flag that already exists, or is a no-op for Stellr as stated. Every PR not listed here or under waves 2 and 3 is still to build.

| PR | State | Flag, or why it is a no-op for Stellr |
|---|---|---|
| A9 | On `dev` (#576) | `RATE_LIMIT_STORE=memory`: no database call. Limits, keys and 429 bodies are unchanged. `tenantId` comes from `requestTenant()`, which answers Stellr without reading the request while routing is off, so Stellr's keys stay bare. Adopted by the 5 register routes, check-in (its name count included), the 8 signing routes, the 3 survey API routes, survey stop-reminders, survey link, team profile and credential events, and at merge the group payment-method route #573 added (`app/api/members/teams/[id]/payment-method`). `app/api/uploads/sign/audit-coalescing.ts` stays on the sync limiter, because it caps audit rows, not the route |
| B5c | On `dev` (#578) | **No flag can gate it.** Every Stellr route group moved under `app/(stellr)`, with Stellr's metadata, JSON-LD, `ConsentMode`, `SiteTracking` and verification tags in `app/(stellr)/layout.tsx`. The tenant tree has its own root, which renders no script of its own. The proof is a before-and-after comparison on harness builds of `063d9cb3` and the head: 752 answers (188 paths, 2 hosts, plain and browser request), equal in status, headers and markup, with head tags equal in order except a new 6-character `og:image` suffix on `/lp/*` and `/credentials/*` (10 answers). Rewrites keep the old image URLs answering. **Two changes for everyone:** a client navigation to a URL no page answers is now a full page load (same 404), and on a host outside Stellr's host list a miss gets the tenant tree's neutral 404 (same status). No real Stellr host is outside that list |
| B6 | On `dev` (#578) | Only `proxy.ts`'s tenant handler sends the enforcing policy, reached only with `TENANT_ROUTING_ENABLED` and a host mapped to a non-owner tenant. A byte golden pins Stellr's `noncePolicy` and `hostPolicy`. **One change that does not wait for the flag:** `next.config.mjs` adds a fixed header (`frame-ancestors 'none'; base-uri 'none'; object-src 'none'`, no script rule) to `/_next`, `/api/img` and `/api/csp-report` on hosts outside Stellr's list |
| B9 | On `dev` (#578). Migration applied to the dev database on 9 Nov 2026, all four checks validated; applied to production the same day with the owner's approval of the rule, before #587 | The CHECK allows Stellr or NULL, which is every row today. `syncEventSpace` now writes nothing for an event the mirror gives another tenant, at the cost of one indexed `events` read per sync. **A failed read now fails the sync:** the webhook answers 500, and Sanity's retry and `sync:event-spaces` catch up |
| B10 | On `dev` (#578) | Tests and CI only. `tenant-host-routing` stays report-only (`continue-on-error: true`), now installs Chromium and has a 25-minute timeout |
| B13 | On `dev` (#578) | No flag: `surveys`, `team-profiles` and `survey-retention` run through `runPerTenant`, fairness `stellr_first`. Stellr-only work is the runner's plain call, with the same order, budget, mail and result keys. When a cron has work it now reads `tenants` once; if that read fails, the run records a `tenants` failure and finishes not ok, while Stellr's work still runs. `survey-retention` stays report-only unless `SURVEY_RETENTION_APPLY` is true |
| B16 | On `dev` (#578) | `PLATFORM_AUDIT_ENABLED`: 54 member and community handlers. With it off, nothing reads a session or schedules a write. The 11 inserts into `mentoring_cohorts`, `community_spaces` and `community_resources` now name `tenant_id: STELLR_TENANT_ID`, the value log mode already stamped |
| B17 | On `dev` (#578) | Staff email recipients come from C9's helpers. For Stellr the queries match the old ones whatever `AUTHZ_SOURCE` says, proved on seeded rows against the old query. **Two small changes:** event-email managers read the event's tenant from the mirror first, and a failed assignments read is now logged (managers were already left out) |
| B19 | On `dev` (#578) | Import lines only: 20 Lane B files take the event getters from `lib/events/repo`, which calls `lib/sanity` with the same arguments and cache options |
| C13 | On `dev` (#579) | First run of the C10 codemod on the app: 45 pilot files. `PLATFORM_AUDIT_ENABLED` for 42 handlers. All 45 stay `stellr_only` |
| C15 | On `dev` (#579) | No guard line changed. 9 routes move to a new class, `platform_destined`, which has the same requirement as `stellr_only`. 7 handlers audit behind `PLATFORM_AUDIT_ENABLED` |
| C16 | On `dev` (#579) | `LOADSCOPED_MODE=off` and `AUTHZ_SOURCE=clerk` keep today's queries, pinned by tests. 14 routes move to `tenant_crew`. **Small differences with defaults:** an event manager naming another event's record gets 404, not 403, on several routes; a signed-out call to credentials resend or revoke gets 401 first; `invoice` POST gives an event manager 403 for any id; a few routes add one small read; the health JSON gains `loadScopedMode` |
| C17 | On `dev` (#579) | With defaults no event is read and no query is added; answers and mail counts are unchanged. 17 routes under `events/[slug]` move to `tenant_crew` on `requireEventRoute`. A tenant's staff get 503 on every action that would send, schedule or call an engine. Under `AUTHZ_SOURCE=shadow` each request to these routes makes one extra `events` read for the comparison |

**Cross-lane hunks, for review at merge:** `lib/rate-limit-async.ts` (Lane B file, A9: a per-route store budget, which B15 inherits); `.github/workflows/ci.yml` (Lane C file, B10: browser install and timeout on the existing job, so beyond "append one job block"); B5c's move, which touches Lane A and Lane C files and their regenerated baselines (path-only apart from one reason text) and adds `scripts/codemods/stellr-root-group.mjs` under Lane C's codemods; `test/audit-coverage.test.ts` (Lane C file, B16); `lib/training-admin.ts` and `lib/coaching-requests.ts` (C13); `lib/credentials.ts`, `lib/credentials-notify.ts` and `lib/survey/withdraw.ts` (Lane A files, C16: an optional tenant filter or skip, a no-op in Stellr's scope).

**Migrations, stamped.** One file, B9's:

| File | What it does |
|---|---|
| `20261106234759_community_stellr_only_check.sql` | CHECK (`tenant_id IS NULL OR` Stellr) on `training_modules`, `community_resources`, `community_spaces` and `mentoring_cohorts`, added NOT VALID then validated, under `lock_timeout` 5 s |

It is on no database. Apply to `dev` after the merge's `db` job passes, then read back `convalidated` on all four constraints. Production needs the owner's approval of the rule itself (see [Owner gates](#owner-gates)) and runs outside event hours: the file is one transaction, takes ACCESS EXCLUSIVE on all four tables and holds it through the four validation scans, and rolls back whole if a lock is not had within 5 s or any table already holds another tenant's row.

**Proven, on the lane branches.** None of this has run in CI yet: the merge's run is the first.

- B5c's comparison above, and the assertions that Stellr's layout chain holds `ConsentMode`, `SiteTracking` and the JSON-LD and the tenant root's chain holds neither.
- B10 on a harness production build with Chromium: 191 of 191, 0 skipped. Its localhost control shows GTM, HubSpot, Vercel Analytics, Speed Insights, `dataLayer` and the banner loading, so the no-tracker check can fail.
- B6 in a browser: 73 of 73 locally, including the signing page drawing under the policy.
- B9: all 80 community and home entries answer 404 on a tenant host and on an unknown zone host, through the proxy and on the harness build, with a Stellr-host control.
- The slice reports for B13, B16 and B17 confirm their new tests fail with the change taken out. A9's route test runs the real limiter on 20 route and method cases and asserts a real 429.

**Not yet proven.**

- **On Vercel, after merging to `dev` (B5c).** The fallback rewrite with `missing: host` and `experimental.globalNotFound`, which Next still marks experimental. On the `dev` deployment and its logs, not the badge: `/no-such-page` and `/foo.png` answer 404 with Stellr's document, and an old `/lp/<slug>/opengraph-image-k8l0a9` URL answers `image/png`.
- **B6 on a hosted canary, before any real zone gets the routing flag.** Read the raw headers on `/sign` and `/survey/x`: there must be one enforcing policy, starting `script-src 'nonce-`. Locally the proxy's header replaces `next.config.mjs`'s private-link policy, but that is proved on `next start` only. Read the `/_next`, `/api/img` and `/api/csp-report` header there too. Then run Clerk sign-in, sign-up with Turnstile, and a signed-in registration under the enforcing policy against a real Clerk dev instance, with 0 violations. None of that has run, and a miss stops a family's registration on a tenant host.
- **B10(c) on Stellr's hosts.** 7 record pages answer with the record and 4 are unproven without a CMS. Owners: A7 6, A10 3, A12 2 (`e2e/tenancy/host-cases.ts`). The job stays green while these rows hold, so the gate is met only by those slices or an owner approval by route.
- **A9's store paths** have run only against a mocked store. The first real run is a shadow flip on `dev`. `RATE_LIMIT_STORE`'s value on `dev` was not read.
- **B9's pgTAP** has not run locally; CI's `db` job is its first run. No `object_created` rule state was checked on any database. Owned by tracker `s5-programme.34` (production) and `.35` (`dev`) since 14 Nov 2026.
- **B13** proves nothing until production crons run. After promotion, confirm in `cron_runs` that `surveys` still opens and invites.
- **C16's scope check** relies on a module-private `WeakSet`. On `dev`, make one real admin call to a route that uses `loadRecord` (refund preview or the correct-recipient dialog) and one as an event manager inside their event, and read `loadScopedMode` on the health route.
- **The audit actor.** C13's 42 handlers use `{ session: true }`, read inside `after()`, as wave 3's routes do: check one real row from a pilot route on `dev` before `PLATFORM_AUDIT_ENABLED` goes on. C15's seven pass `{ userId }`. B16's route tests cover 9 member handlers end to end; the other audited member and community handlers are covered by the coverage gate only, not for what each records.
- **B19:** open one public event page on the `dev` preview after merge.

### What wave 4 corrected

Generated baselines are regenerated at merge and win over any number here.

| This file said | Now | Source |
|---|---|---|
| `MAX_TENANT_DESTINED_STELLR_ONLY` 52, to 0 through C16 to C19 | **22** after C17: `app/api/admin/registrations/[id]/payment-method`, added in #573 after C16 converted its siblings, is listed `tenant_destined` for a C16 follow-up. 0 through C21, because `app/api/admin/event-managers` stays `stellr_only` until then | `test/idor/stellr-only-dispositions.test.ts` |
| Manifest: `stellr_only` 203, `tenant_crew` 0, `platform_admin` 0 | **`stellr_only` 164, `tenant_crew` 31, `platform_destined` 9, `platform_admin` 0**, with #573's admin payment-method route still `stellr_only` | `lib/security/route-manifest.ts` |
| The 9 platform-destined routes go to `platform_admin` once the owner decides | They are now **`platform_destined`**. `platform_admin` passes only with `assertPlatformAdmin`, which under `AUTHZ_SOURCE=postgres` answers from `platform_admins` alone, so moving them there would decide owner-only by default at the flip. `events/slug-guard` admits holders of the events staff scope and could not move at all | C15 |
| Unaudited mutations 257, GET writers 15 unaudited | Merged on `dev`: **128** unaudited mutations and **6** unaudited GET writers. Lane A added none: the limiter's store write is an operational writer by the owner's decision of 9 Nov 2026 | `test/baselines/unaudited-mutations.json` |
| Authz legacy idioms 218 files, 309 sites | Merged on `dev`: **138 files, 198 sites** | `test/baselines/authz-legacy-idioms.json` |
| Sanity event-getter importers 44 (wave 2) | **20** after B19, from 40 at `063d9cb3` | `test/baselines/sanity-event-getters.json` |
| `lib/notify.ts` is `stellr_only` in the service-role ratchet | **`convert`**, because it now passes its client to a helper. The stricter class | `test/baselines/service-role-files.json` |
| B5c: `app/layout.tsx` wraps the `/_t` tree | Two roots: `app/(stellr)/layout.tsx` and `app/%5Ft/[tenant]/layout.tsx`. `app/global-not-found.tsx` holds Stellr's document for a URL no page answers | B5c |
| B10(b): if ISR stays an option, also run once in ISR mode | **No ISR mode can run:** tenant pages carry a per-request nonce. `e2e/tenancy/warm-cache.spec.ts` fails on any move to ISR, and asserts `no-store` and no `x-nextjs-cache`. The clause stays open until the owner chooses | B10 |
| B10 amendment for B6: install a browser in `tenant-host-routing` | **Done.** The job installs Chromium and no longer sets `E2E_TENANT_HOST_NO_BROWSER`, and `e2e/tenancy/harness.test.ts` fails if only one of the two holds | B10 |
| The scoped tenant policy | `tenantPagePolicy` keeps `https:` and `'unsafe-inline'` in `script-src` as fallbacks for browsers without nonce or `'strict-dynamic'` support, omits `'wasm-unsafe-eval'`, and omits Turnstile from `connect-src`. A browser too old for `'strict-dynamic'` gets weak enforcement rather than a page that cannot run. One API that draws HTML, `/api/email/unsubscribe`, gets a fixed no-script enforcing policy; other APIs keep the Report-Only policy | `lib/csp.ts` |
| B9: closing the two community `TODO(S5)` snapshot entries | **Still open.** The check now holds those tables to Stellr or NULL, and outcomes do not change. `npm run idor:snapshot` keeps an accepted string, so regenerating will not change the text by itself; Lane C decides how to change it | `test/idor/idor-snapshot.json` |

### Owner decisions wave 4 raised

On top of [Owner gates](#owner-gates) and the earlier lists. Slice reports hold the detail where the behaviour is live.

| From | Decision |
|---|---|
| A9 | **Settled, 9 Nov 2026:** the owner chose to add the limiter's store write (`lib/rate-limit-store#takeFromStore`, counter bookkeeping with HMAC keys only) to `OPERATIONAL_WRITERS`, so the two signing GETs stay off the baseline and no `audit-cap-grow` label was used (#576). A limited GET in B15 is covered by the same entry |
| A9 | Before any non-memory `RATE_LIMIT_STORE`: whether check-in's by-name path gets an unsuffixed per-IP cap ahead of the store call. It would be a new limit, and a venue's shared IP would feel it. Without it, the by-name count always reaches the store, so watch `rate_limit_hits` row growth during shadow. **Settled for `dev`, 13 Nov 2026 (`W7-20`): no cap before P5;** watch the rows during P5. It comes back before any non-memory store on production |
| B5c | Whether `tenant-host-routing` becomes a required check before B5c merges (already proposed under Owner gates). Until then the B5c PR cites the "Flag off and on, compared" step outcome for the merge commit, not the badge |
| B5c | Icons and web manifest on tenant pages before a real zone attaches. They link Stellr's favicon, icons and a manifest named Stellr Education, because those files sit above both roots. Moving them changes Stellr's live icon URLs |
| B6, B10 | Per-request rendering vs ISR, once the first canary zone shows its Active CPU and CMS volume. `force-dynamic` may also default the tree's CMS fetches to no-store (not measured), and tenant traffic draws on the same Hobby meter. Choosing per-request closes the B10(b) clause |
| B10 | Whether the route-by-route Stellr-host outcomes in `e2e/tenancy/host-cases.ts` stay in the public repo as worded, or become totals and a hash, as the C6 item asks for its list. And which capability-token outcomes on Stellr's hosts to accept by route at the gate |
| B16 | Whether a member's registration payment and withdrawal audit rows, which carry the member's Clerk actor, may go on the chain of the tenant that owns the event. That chain is append-only and cannot be purged. Until decided they go on Stellr's chain |
| B16 | Before `PLATFORM_AUDIT_ENABLED`: accept the Active CPU and row cost of one extra `auth()` call and one `after()` write per audited member or community request, and decide whether read-like GET actions (downloads, survey open, withdraw preview) are audited at all. **Gates production only** (owner, 13 Nov 2026, `W7-17`): P1 may go on `dev` first |
| B17 | An alert contact for each tenant. For a non-Stellr tenant with no active tenant admin, or after a failed lookup, admin alerts are dropped and logged. Options: a per-tenant alert contact, or a platform-ops fallback that strips personal data. Decide before any integrity or payment caller passes `tenantId` |
| B17 | Whether a suspended tenant's admins still receive alerts about its records. `tenants.status` is not read today |
| B17 | Low priority: when the events-mirror read fails while an event email is built, keep using Stellr's assignments for the manager audience, as now, or leave managers out of that send |
| C13 | Member uuids in audit metadata for moderation, role and roster operations. These rows can concern minors and cannot be purged, which widens A14's question on audit rows and the purge. Decide before `PLATFORM_AUDIT_ENABLED` on production; until then removing them is a small code change. **Gates production only** (owner, 13 Nov 2026, `W7-17`): P1 may go on `dev` first |
| C13 | The disposition register: whether `training/assignments` and `training/tracking` are release-1 tenant features. If they stay Stellr products, they and the other pilot routes that read by event or cohort need a named gate, or a C6 disposition entry, before the first non-owner tenant |
| C15 | Route by route for the 9 `platform_destined` routes: owner-only, or Stellr staff. Seven of them answer from the Clerk claim under every `AUTHZ_SOURCE`, so a change to Stellr memberships does not reach them until C25 converts them, and shadow gives no comparison for them |
| C15 | Which audit chain their seven events belong on: Stellr's, the platform's, or the owning tenant's where known. Decide before `PLATFORM_AUDIT_ENABLED` with a second tenant, because a row on the wrong chain cannot be corrected |
| C15 | Confirm C25 may convert these claim checks to `isStellrAdmin` while the route-by-route answer is open. That keeps mapped Stellr admins and is not the owner-only choice |
| C15 | Extend A14's decision and its legal input to `deletion.entity.delete`, `member.record.merge` and `deletion.request.review`, which store the uuid of an erased member or participant, possibly a minor, in a table with no retention path |
| C16 | How far a guardian's credential opt-out recorded by one organiser reaches. As built, an admin route's opt-out touches that tenant's rows only, for a non-Stellr scope and for Stellr under `LOADSCOPED_MODE=enforce`; under `off` Stellr's stays global. Stellr's privacy policy promises a guardian can withdraw consent |
| C16 | Whether a media opt-out signed on another organiser's form binds a tenant's do-not-use list. As built it does, the protective direction, but the tenant's CSV can then show the other form's signing date and reason |

### Docs owed after wave 4

- **D4, delivered in wave 5** (`docs/TENANCY-S5-data.md` and `docs/SECURITY-route-manifest.md`), except the `docs/PLATFORM-AUDIT.md` sentence on member uuids, which waits for the owner's C13 answer. What was owed: a `platform_destined` row in `docs/SECURITY-route-manifest.md` and why it is not `platform_admin`; the end of "every `/api/admin` route is `stellr_only`"; the participant-refusal rule for every staff class, not `stellr_only` alone; and, in the audit runbook, that C15's seven events sit on Stellr's chain pending the owner's answer. Still owed: `docs/PLATFORM-AUDIT.md` states whether a member uuid may sit in `target_id` or metadata, once the owner decides (C13).
- **D7:** add the sign-off steps this wave names: the Stellr-host rows by route, B6's canary checks, and a person opening the register form and check-in page in a browser for trackers and hydration once a CMS fixture exists. **Added** to `docs/TENANCY-S5-flow-checklist.md`, "Steps owed from waves 4 to 6", on 14 Nov 2026, with no evidence yet.

## Wave 5 status

**Merged** means squashed into `dev` on 9 Nov 2026, one PR per lane, from branches cut at `faaaeccb`: Lane B #588 (`37a9a315`), Lane A #594 (`8e86d38f`), Lane C #598 (`b620a113`). Lane D, this docs PR, follows them, checked against `dev` at `b620a113`. **Since promoted:** wave 5, its docs PR #601 included, went to production in #600 (`89559a4f`) on 9 Nov 2026 (10 Nov UTC). Wave 5 has no migration. The same promotion carried two non-S5 new-table migrations (#592, #596), applied first with the owner's explicit yes (`.claude/releases/promote-2026-11-09b.md`). Every PR not listed here or under waves 2 to 4 is still to build.

**Owner decisions this wave relies on, settled 9 Nov 2026:** the tenant email share is one shared pool until the move to SES (B14), and `postgres` (postgres.js) is approved as a runtime dependency for C11 only. Both are recorded under [Owner gates](#owner-gates). **Environment:** one new flag, `TENANT_EVENT_MAIL_ENABLED` (B14, off by default), and the two variables the plan already named, `TENANT_DATABASE_URL` (C11) and `TENANT_DB_AREAS` (C12), now read. **Dependency:** `postgres` 3.4.9, exact-pinned and installed with `--before`; the lockfile gains that one package.

| PR | State | Flag, or why it is a no-op for Stellr |
|---|---|---|
| B14 | On `dev` (#588) | `event-emails` and `docusign-reminders` run through `runPerTenant`, Stellr first. A Stellr-only run is the runner's plain call: the same rows, order, budget, mail, failure labels and `cron_runs` result keys, and no read of `tenants` (corrected at merge, below). The three `event_emails` reads and the `agreements` read add `tenant_id`. `tenants` is read only when another tenant has work in the run, which for `event-emails` needs the flag on and for `docusign-reminders` cannot happen yet; if that read fails, the run records a `tenants` failure while Stellr's mail still goes out. **`TENANT_EVENT_MAIL_ENABLED` off:** another tenant's scheduled emails are held and counted as `tenantHeld`, a key that appears only when something was held. **On:** a tenant's mail goes from `"<Tenant> via Stellr" <no-reply@mail.stellreducation.org>` with the tenant's Reply-To, on the tenant's own date and time slice, and its failures are recorded as `t:<id>:…`; a tenant with no usable sender sends nothing (`t:<id>:sender`). **A tenant's envelopes in `docusign-reminders` are held whatever the flag says** (as of wave 5; wave 6's B14b chases a tenant's Stellr-signing envelopes with the flag on: see [Wave 6 status](#wave-6-status)). `sendEventEmail` and `sendCatchUp` answer 503 to a tenant row that comes without its sender. All mail goes through `sendEmail`, so tenants count on the one daily counter with no allowance of their own; `lib/email-budget.ts` gains a comment only. **Two changes for Stellr, in the shared runner, which also reach B13's three crons:** when Stellr is the only tenant with work, `runPerTenant` skips its `tenants` read and uses Stellr's seeded values, so the run makes no new query and can record no `tenants` failure; and it always calls Stellr's function in that case, even if the deadline passed first, and the function counts late work as deferred |
| A7 | On `dev` (#594) | No flag of its own: the request's tenant comes from `requestTenant()`, which answers Stellr while `TENANT_ROUTING_ENABLED` is off, so no request reaches a tenant context. **Two changes for Stellr:** every register, pay and pay-seat request that gets past its first checks reads the event's owner from `public.events` before the first read about the person, any write or any Checkout. The owner must agree with the slug's row, because `tenancy_derive_tenant_id` stamps rows by slug: the row for the CMS document's id is read first, and when it holds another slug (or there is none) the slug's row is read too; if the two name different owners the request is refused, retryably. One read when the document's row holds the slug or the event has no document id, two when the document's row holds another slug or is missing; pay-seat reads by slug alone; an unmirrored slug counts as Stellr's. And **a failed owner read now answers a retryable 503** where registration and payment went ahead before. Every registration and participant row carries `tenant_id` from the resolved event, Stellr's included, the value the trigger already stamps. `assertEligible` replaces `checkRegistrationAge` in individual, group (both roster points) and group-join, making exactly the old call for Stellr. Stellr's hooks run behind `isPlatformOwner` through `lib/community/event-hooks.ts`. Stellr's guarantee and mission note reach the shared individual and group bodies only through a slot Stellr's pages fill, and the pay and pay-seat bodies show the guarantee, and pay-seat the teacher's-cost share, only for Stellr's registrations. **Merged with #584 (group payments):** the split group's pending seat, the share display and the shared checkout sit in `seatPayBody` and the pay-seat route after every tenant and owner check. The 5 register routes audit behind `PLATFORM_AUDIT_ENABLED`, after the response, on Stellr's chain; pay and pay-seat record no payment start for an answer given before a Checkout was tried, such as a tenant's 503 or any 4xx. The events-facade codemod ran on Lane A: Sanity event-getter importers are now 0 |
| C16 follow-up | On `dev` (#598) | `app/api/admin/registrations/[id]/payment-method` onto `lib/authz` and `loadEventRecord`. With `LOADSCOPED_MODE` off, today's query by id, now also selecting `tenant_id`. Admins and event managers keep what they had on their own events; another event, or none, answers 404 with the missing group's body. The events-mirror check the route already made stays (`crewCoversEvent`), and a group stamped with another tenant also answers as missing, in every mode, from the column already read, so no read is added. A tenant's own staff get `refuseOutsideStellr`'s 503. **Merged with #584's rewrite of the route:** `paymentChangeBody`, with `invoiceParticipantIds`, `lateJoinerPayer` and `shareEstimate`, passes through unchanged, and the guard is equivalent for the same callers. POST was already audited; it now records the method and, for `invoice_some`, how many participants are on the invoice, never who. GET audits too, behind `PLATFORM_AUDIT_ENABLED`, with one new action, `registration.payment_method.read`. Moves to `tenant_crew` |
| C11 | On `dev` (#598) | `TENANT_DB_ENABLED` off: nothing imports postgres.js and nothing connects. No route imports `lib/tenancy/db.ts`, which the allow-list test proves repo-wide. A new report-only CI job, `tenant-db`, builds a throwaway local database, creates a `tenant_app_login` for the run, and runs `test/integration` through the real driver. The main Vitest run now excludes `test/integration/**`. `lib/tenancy/driver-wiring.test.ts` parses only the files whose text names the module it is checking (`postgres`, or the driver), with the same assertions: parsing every file ran past CI's time limit |
| C12 | On `dev` (#598) | Nothing calls `readArea` or `writeArea`, and only `events-config` is declared, for C18. Every area answers `service` unless `TENANT_DB_ENABLED` is `true` and `TENANT_DB_AREAS` lists it. The IDOR harness gains a fake `tenantDb` driver over the honey database, reached only by a fixture that turns the flag on; none does yet |
| D4 | This docs PR | `docs/TENANCY-S5-data.md`, and `docs/SECURITY-route-manifest.md` brought up to date |

**What a tenant's event gets from A7**, all fail-closed and unreachable while routing is off: another tenant's event or link is answered as unknown on every host, and `/api/members/exists` answers a non-Stellr join link exactly as an unknown link; anyone under 18, today or on the day, is refused online until tenants can collect a guardian's consent (`TENANT_MIN_AGE_WITHOUT_GUARDIAN_CONSENT`); a live event with no start date refuses everyone; an event with a Stripe price, even an explicit $0 one, and a card, invoice, "Invoice for some", shared teacher's cost, add-on or scholarship offer are refused before the duplicate check and before any write, and no Checkout is opened or pay link resent; a free event's group, which the form always sends as paid seat by seat, is not refused for that alone; every Member ID slot is unusable, with the unknown ID's answer; only the registration and participant rows are written, with no member row, login, Space, Sheet, merch or agreement; the tenant tree's join page is in tenant mode, so it always collects the joiner's details, offers no "use my Stellr profile" confirm and makes no exists lookup, and nothing is read from or linked to a joiner's Stellr record; confirmations go only through B14's tenant sender, from a fixed template, and are held while `TENANT_EVENT_MAIL_ENABLED` is off. The tenant tree's pay-seat page still shows a Pay button, which the API refuses until S9.

**Migrations.** None this wave.

**Proven.**

- **CI on each merge.** #598's run was the first of the `tenant-db` job against a real database, and every step passed, including "Two tenants through the real driver": `test/integration/tenant-db.int.test.ts` (its multi-statement case included) and the two-tenant kit's test, with C12's read-only shadow path.
- B14's 19 behaviour tests fail with its four source files put back, and the shared-pool test runs the real `sendEmail` and budget code.
- C16's follow-up: its new tests fail 8 times against the old route, and removing the tenant-row check, the event check or `refuseOutsideStellr` each fails a test.
- A7: the Stellr traces (an adult, a 13-year-old, a 12-year-old with no login, a group organiser) answer as before; the cross-tenant Member ID case and a tenant event with an unpaid card registration on file are covered. On the Stellr host, `join`, `pay` and `pay-seat` give the unknown link's answer for another tenant's link (`e2e/tenancy/host-cases.ts`), and the tenant-host IDOR cap fell from 94 failing cases to 82.

**Not yet proven.**

- **`tenant-db` is still report-only.** One green run; it is not a required check, so a later failure blocks nothing (owner decision below).
- **A7 on a deployment.** No real registration has gone through the owner read. One real registration per kind on `dev` (individual, group by invoice, group by card, group-join), and a check that no tenant-owned mirror row shares a slug with a Sanity event an e2e registers on Stellr's host. Owned by tracker `s5-programme.35` since 14 Nov 2026.
- **A7's three CMS rows on the Stellr host** (`register/[slug]`, `individual`, `group`) are still `noCms` in the harness, so the amendment's Stellr-host check for them stays open.
- **B14 proves nothing until production crons run,** because crons decline on `dev`. After promotion, confirm in `cron_runs` that `event-emails` and `docusign-reminders` keep their result keys, with no `tenantHeld` and no `tenants` failure.
- **B14's flag-on path** has run only against mocks. A tenant event's date still comes from the CMS read until the events facade has a Postgres path (C8 amendment, C25), so the flag cannot send for a tenant event the CMS does not hold.
- **C16's follow-up on a deployment:** one admin and one event-manager call to the payment-method route on `dev`, with #584's "Invoice for some" among them.

### What wave 5 corrected

Generated baselines are regenerated at merge and win over any number here.

| This file said | Now | Source |
|---|---|---|
| `MAX_TENANT_DESTINED_STELLR_ONLY` 22, "21 after C17" in Gates | **21** after C16's payment-method follow-up. 0 through C21 | `test/idor/stellr-only-dispositions.test.ts` |
| Manifest `stellr_only` 164, `tenant_crew` 31 | On `dev` at `b620a113`, 508 entries: **`stellr_only` 165, `tenant_crew` 35**, `participant` 131, `public` 132, `cron` 24, `webhook` 12, `platform_destined` 9, `platform_admin` 0. The payment-method move is one of the `tenant_crew` gains; routes from other PRs that day (#581, #585, #592, #596, #597) make up the rest | `test/tenant-surface-routes.test.ts`, `lib/security/route-manifest.ts` |
| Unaudited mutations 128, GET writers 6 | **123** mutations after A7; **6** GET writers: the payment-method GET is audited now, and #597 added the discount GET | `test/baselines/unaudited-mutations.json` |
| "The 22 crons" in Gates | **24** cron handlers, all audited (`cron/email-outbox` arrived with #592) | `test/baselines/unaudited-mutations.json` |
| Sanity event-getter importers 20 | **0** after A7's codemod | `test/baselines/sanity-event-getters.json` |
| Tenant surface baseline 10 modules, 38 edges, 17 table files | **7, 25, 16**: the register hooks now go through `lib/community/event-hooks.ts` | `test/tenant-surface.test.ts`, `test/tenant-surface-baseline.json` |
| Tenant-host IDOR: 94 failing | **82** of 124 cases, 18 unproven | `test/baselines/tenant-host-idor.json` |
| IDOR targets: 228 routes (4 Nov 2026) | **240**: 94 `stellr_only`, 68 `participant`, 35 `tenant_crew`, 32 `public`, 9 `platform_destined`, 2 `webhook` | `test/idor/idor-snapshot.json` |
| B13 and B14: a cron with work reads `tenants` once, and a failed read records a `tenants` failure | **Only when another tenant has work.** A Stellr-only run skips the read and uses Stellr's seeded values, so it makes no new query and records no new failure. Fixed in the runner during wave 5, so it covers B13's three crons too | `lib/cron-tenants.ts` |
| B14 builds a per-tenant send budget | **No per-tenant budget,** by the owner's decision: one shared pool | `lib/email-budget.ts` |
| B14 covers per-tenant e-sign reminders | **Held for every tenant but Stellr.** The signing engine's outbox has no tenant sender, so chasing a tenant's envelope would send it as Stellr. **B14b (#610, wave 6) gave it one**, now on production: with `TENANT_EVENT_MAIL_ENABLED` on, a tenant's Stellr-signing envelopes are chased from its own sender, and its DocuSign envelopes stay held | `app/api/cron/docusign-reminders/route.ts`, `lib/esign/outbox.ts` |
| A7: tenant events take the platform age floor (14) | **The register API refuses under-18s on tenant events** until a consent flow exists. The A3 trigger keeps the floor of 14 | `lib/registration/eligibility.ts` |
| D4 owes the data record | **Delivered:** `docs/TENANCY-S5-data.md` | |

### Owner decisions wave 5 raised

On top of [Owner gates](#owner-gates) and the earlier lists. Each is built fail-closed until decided. Proposed user-facing wording is the slice's, for the owner to approve or reword.

| From | Decision |
|---|---|
| — | **Settled, 9 Nov 2026:** the tenant email share is one shared pool until SES; `postgres` (postgres.js) approved for C11 only. B14 and C11 build on these |
| A7 | **Settled, 10 Nov 2026: guardian consent on tenant events.** Under-18s stay refused for non-Stellr events (`TENANT_MIN_AGE_WITHOUT_GUARDIAN_CONSENT`) until a tenant guardian-consent flow exists. That flow, on the native e-sign engine with a platform-locked consent document, is an early wave 6 slice; 14 to 17-year-olds are admitted once a guardian signs. The A3 trigger keeps the 14 floor |
| A7 | **Settled, 10 Nov 2026:** refusal copy approved as written: "You must be 18 or older to register for this event online. Please contact the event organiser." and "{name} must be 18 or older to register for this event online. Please contact the event organiser." (reason `under_minimum_age`, 400) |
| A7 | **Settled, 10 Nov 2026:** a Stellr member's profile is not used at a tenant event until S7's per-tenant consent grant exists; sharing then happens only through that logged, revocable grant (plan decisions 5 and 6). The tenant join page already complies. It settles B5b's prefill decision the same way |
| A7 | **Settled, 10 Nov 2026, with the row above:** on a tenant event the individual form must not take the signed-in account's email or check the account's stored date of birth; the registrant types their details, as on the tenant join page. As built it still does both, so this is a wave 6 change |
| A7 | A tenant event with an explicit $0 Stripe price is treated as priced and refused, like any event with a price. Whether a $0 price should count as free |
| A7 | The tenant tree's pay-seat page shows a Pay button that the API refuses for a tenant's seat. Unreachable while routing is off; S9 either opens tenant payments or the page hides the button |
| A7, A8 | Which slice, A8 or S9, gives the organiser-side payment writers (`changeGroupPaymentMethod` in `lib/group-payment-change.ts`, and the team payment-link route) their tenant checks. They need them before any priced tenant event (see PR amendments) |
| B14 | **Settled, 10 Nov 2026:** admin-facing copy for `TENANT_SENDER_REQUIRED` approved as written: "This event belongs to another organiser. Its emails go out from their own sender, which isn't set up yet, so nothing was sent." |
| B14 | **Settled, 10 Nov 2026:** the signing engine's tenant sender is built with the wave 6 guardian-consent slice, since consent cannot work without reminders. Until it lands, a tenant's signing reminders stay held, and `TENANT_EVENT_MAIL_ENABLED` stays off. **Landed** as B14b, its own Lane B slice, ahead of the consent slice: #610, on production via #612 |
| C16 follow-up | **Settled, 10 Nov 2026:** once tenant billing exists (S9), a group's payment method on a tenant event may be changed by the tenant's admins and the event managers assigned to that event, the same rule as Stellr's since #573. The slice that lifts `refuseOutsideStellr` adds the persona tests |
| C11 | **Settled, 10 Nov 2026:** the tenant connection requires full certificate verification. For any non-local host the driver accepts only `sslmode=verify-full`, with Supabase's root CA supplied, and refuses the URL otherwise. This is a wave 6 change to `lib/tenancy/driver.ts` and must land before any route calls `tenantDb` or `TENANT_DB_ENABLED` is set |
| C11 | **Settled, 10 Nov 2026:** the `tenant-db` CI job becomes required in the PR that first wires a live area to `tenantDb` (C18): drop `continue-on-error` there, and the owner adds it to branch protection. Until then it stays report-only and its steps are read by hand |

### Docs owed after wave 5

- **D7:** one real registration per kind on `dev` now that A7 has merged; A7's three CMS rows on the Stellr host; after promotion, B14's two crons read in `cron_runs`; and, once `TENANT_EVENT_MAIL_ENABLED` is considered, the first tenant send read in `cron_runs` and an inbox. **Added** to the checklist on 14 Nov 2026, with no evidence yet (tracker `s5-programme.34` and `.35`).
- **`docs/PLATFORM-AUDIT.md`:** the member-uuid sentence, once the owner answers C13.

## Wave 6 status

**Merged** means squashed into `dev`, one PR per lane: Lane B #610 (`b4329149`) on 10 Nov 2026, then Lane C #624 (`12877f5e`) and Lane A #625 (`b8c1fba3`) on 11 Nov 2026. Lane A's branch merged #605 (the "All attendees" email group and staff check-in) and current `dev` before it landed. Lane D's docs, #637 (`8cc2a4d8`), followed them on 11 Nov 2026, checked against `dev` at `b8c1fba3`. **Since promoted:** B14b in #612 (`3d90a6dd`) on 10 Nov 2026 (`.claude/releases/promote-2026-11-10b.md`); Lanes A and C, with Lane D's docs, in #643 (`5d18d321`) on 12 Nov 2026 (`.claude/releases/promote-2026-11-12b.md`), with A16's migration applied to production first. No tenancy switch has been on in a hosted environment. Every PR not listed here or under waves 2 to 5 is still to build. Open items, each with the gate it blocks: `docs/handovers/tracker/2026-11-11-s5-programme.md`.

**Owner decisions this wave builds on, settled 10 Nov 2026** (recorded under [Owner decisions wave 5 raised](#owner-decisions-wave-5-raised)): under-18s stay refused at tenant events until a tenant guardian-consent flow exists, and that flow uses the native signing engine with a platform-locked consent document, admitting 14 to 17-year-olds once a guardian signs; the signing engine gets a tenant sender; a Stellr member's profile is never used at a tenant event until S7's consent grant, so tenant forms take typed details only; the refusal copy and the `TENANT_SENDER_REQUIRED` copy as written; `sslmode=verify-full` with a supplied root CA for any non-local tenant database host; the `tenant-db` CI job required from C18.

**Environment:** two new names, both unset by default: `TENANT_GUARDIAN_CONSENT_ENABLED` (A16, a flag, on only when exactly `true`) and `TENANT_DATABASE_CA_CERT` (C11t, a server-only secret read only for a non-local host with `TENANT_DB_ENABLED` on). Both are in `docs/ENV-MATRIX.md`, section 6. **Dependency:** none added.

| PR | State | Flag, or why it is a no-op for Stellr |
|---|---|---|
| B14b | **On production.** Squashed to `dev` as #610 (`b4329149`), promoted in #612 (`3d90a6dd`) on 10 Nov 2026. No migration | **`TENANT_EVENT_MAIL_ENABLED` off:** every other tenant's signing mail is held as before. **On:** the native signing engine sends another tenant's invitations, reminders, completion emails and bounce and correction notices from that tenant's sender ("`<Tenant>` via Stellr", its Reply-To). Without a usable sender, a tenant envelope's invitations and reminders are held in the outbox or refused by a reminder (`TENANT_SENDER_REQUIRED`), and its completion emails and bounce and correction notices are not sent. Nothing is sent as Stellr. `docusign-reminders` chases a tenant's Stellr-signing envelopes inside its own slice; its DocuSign envelopes stay held. `drainOutbox` reads Stellr's waiting signers first, in a read of their own. Stellr's signing mail, sender and budget are unchanged |
| A7f | On production. #625, promoted in #643 (`5d18d321`) on 12 Nov 2026 | No flag of its own: the gates take the tenant branch only when `requestTenant()` names a tenant other than Stellr, which needs `TENANT_ROUTING_ENABLED`. On a tenant host `lib/registration/individual/gate.ts` reads neither the session's member nor its child-awaiting-consent state, so the typed address and date of birth stand, with no stored date-of-birth comparison; `lib/registration/group/gate.ts` keeps the organiser's typed address. Stellr's hosts run the same code as before |
| A16 | On production. #625, promoted in #643 (`5d18d321`) on 12 Nov 2026; its migration on the `dev` database since 11 Nov 2026 and on production since 12 Nov 2026, before the code | `TENANT_GUARDIAN_CONSENT_ENABLED`. **Flag off:** every minor at a tenant event gets the approved refusal, and the register route and the `membership-expiry` sweep read and write nothing new. **On**, for `register/individual` on a tenant event: a 14 to 17-year-old is saved consent-pending, a parent or legal guardian signs a platform-locked document sent from the tenant's sender through B14b's `sendTenantSigningInvitation`, and a decline or a closed window removes the registration. Group and group-join still refuse every minor. **Not free once the migration is applied, flag or not:** each participant insert, and each update of `date_of_birth` or `registration_id`, makes one indexed join and writes nothing for Stellr; each write that sets `checked_in_at` makes one indexed lookup and is never refused for Stellr. A tenant's event mail reads the consent table whatever the flag says; Stellr's sends read nothing more. Detail: `docs/TENANCY-S5-registration.md` |
| A8 | On production. #625, promoted in #643 on 12 Nov 2026 | No flag of its own. `lib/registration/roster-context.ts` starts from the registration's `tenant_id` and makes no read for a Stellr registration, so the shared roster add (organiser and staff), team-leader edit and remove, and the sheet import make exactly the old age call for Stellr. The team routes under `app/api/members/teams` act only on groups whose tenant matches `requestTenant()`, which is Stellr while routing is off, and their responses drop `tenant_id`. On another tenant's group: that tenant's age rules, with every minor refused (these paths collect no guardian), no Member ID lookup, participant rows only, and the tenant payments answer for a group that takes money. The organiser payment writers refuse a tenant registration before any Stripe call. In the sheet import an eligibility refusal from the A3 trigger (`isEligibilityRefusal`) is skipped and listed in `skippedForDateOfBirth`, where it was ignored; any other write error is still only logged. A8 audits 5 more mutating team route files (6 handlers) under `app/api/members/teams` behind `PLATFORM_AUDIT_ENABLED`, with `lib/registration/team-audit.ts`: `participants`, `participants/[pid]`, `sheet-sync`, `docusign-resend` and `payment-link`. Every mutating team route is now audited |
| C11t | On production. #624, promoted in #643 on 12 Nov 2026 | `TENANT_DB_ENABLED` off: nothing connects. For any host other than `localhost` or `127.0.0.1` the driver accepts only `sslmode=verify-full`, given once, with `TENANT_DATABASE_CA_CERT` holding one or more PEM CA certificates and nothing else. postgres.js then checks the chain against that CA and the name against the host (an IPv4 host against its address), TLS 1.2 or later. Anything else throws before a pool exists, with no fallback to an unchecked mode. `parsePostgresUrl` now refuses `sslmode` given twice for every caller |
| C18 | On production. #624, promoted in #643 on 12 Nov 2026 | `TENANT_DB_ENABLED` and `TENANT_DB_AREAS`: with defaults no `tenantDb` is built and no connection opens. The events admin companies list, count and rename are the first area, `events-config` (`lib/events/admin-config.ts`), with today's query kept as the service path. `companies`, `offerings` and `merch/commit` move from `stellr_only` to `tenant_crew`. What C18 converted and what it left, each with its owner slice: `docs/TENANCY-S5-data.md`, "The first area". **`tenant-db` is required in the workflow:** no `continue-on-error`, and its scope step also runs for the area module and the three routes |
| Tenant-event refusals (Lane C) | On production. #624, promoted in #643 on 12 Nov 2026 | `refuseUnlessStellrEvent` (`lib/tenancy/load-scoped.ts`) on `remind`, `docusign-reissue`, the guardian route, `offerings` and `merch/commit` under `app/api/admin/events/[slug]`: another tenant's event answers 404 for everyone, a Stellr admin included, in every `LOADSCOPED_MODE`, before any read about a person, email or envelope. **For Stellr:** one extra read of the event's owner per request, and a retryable 503 if that read fails, the trade-off already accepted for the register routes |
| D | On production. #637 (`8cc2a4d8`), promoted in #643 on 12 Nov 2026 | Docs |

**Merged with #605.** For another tenant's email, every roster-based audience, "All attendees" included, reads the roster with consent-pending participants left out (`resolveAudience`, `lib/event-emails/audiences.ts`), with their signers' links. Volunteer mentors and event managers are staff, not participants, and keep #605's behaviour. The check-in desk keeps #605's staff check-in beside the consent refusal.

**Migrations, stamped.** One file, A16's:

| File | What it does |
|---|---|
| `20261110164339_tenant_guardian_consent.sql` | New table `public.tenant_guardian_consents` (no contact data, Stellr refused by CHECK, RLS on, `service_role` only, no `tenant_app` grant); `agreements.envelope_type` also accepts `tenant_guardian_consent`, by dropping the CHECK and adding it again, wider, in the one transaction; trigger `zzz_participants_refuse_unconsented_check_in` (BEFORE UPDATE OF `checked_in_at`, 23514 `guardian_consent_pending`); trigger `zzz_participants_open_tenant_guardian_consent` (AFTER INSERT OR UPDATE OF `date_of_birth`, `registration_id`). Both functions SECURITY DEFINER, `search_path` pinned, EXECUTE revoked from PUBLIC, anon and authenticated. `lock_timeout` 5 s |

**Its locks,** corrected 12 Nov 2026: the file's header understates them. Each lock below is held until the transaction ends, and `lock_timeout` (5 s) bounds only each wait to take one, not how long it is held. While the migration waits for a lock, for up to 5 s, later requests that conflict with it queue behind it, so the header's "instead of queueing live writers behind it" is not right either.

1. **Creating the table.** Its four foreign keys take SHARE ROW EXCLUSIVE on `tenants`, `registrations`, `participants` and `agreements`. From the `CREATE TABLE`, writes to all four wait; reads go on.
2. **The CHECK on `agreements`.** Dropping and adding it takes ACCESS EXCLUSIVE and scans every row, so reads of `agreements` wait too.
3. **The two triggers,** both on `participants`. `DROP TRIGGER IF EXISTS` takes ACCESS EXCLUSIVE on its table even when the trigger does not exist, so reads of `participants` wait too. A probe on the `dev` database (PostgreSQL 17.6, the version production runs, 12 Nov 2026) showed this on `registrations`, for a trigger that does not exist there.

So `agreements` is unavailable from step 2 and `participants` from step 3, both until the transaction ends, and `tenants` and `registrations` take no writes from the `CREATE TABLE` on. The production migration Action also writes the ledger row and runs `security_checks.sql` inside the same transaction. On production both runs took these locks: the dry run (43152631990) until it rolled back, then the real run (43157319187) until it committed. The Action's step that runs the transaction took about 3 s each time (12 Nov 2026, 04:29:04 to 04:29:07 and 04:53:24 to 04:53:27 UTC), so no lock was held longer than that. The `DROP TRIGGER IF EXISTS` lock is not peculiar to this file: in any migration it blocks reads of its table until the transaction ends.

**Where it is applied.** The `dev` database, on 11 Nov 2026, after #625's `db` job passed; the `dev` ledger lists `20261110164339`. Production, on 12 Nov 2026, before Lane A's code, as the promote skill orders it (a tenant's event mail reads the new table whatever the flag says, and fails closed if it is missing). It went through the production migration Action with the owner's approval of each run: a dry run (43152631990) that rolled back, then the real run (43157319187). The real run applied the file, wrote the ledger row and ran `security_checks.sql` in one transaction, then read the ledger row back by name and ran the checks again after the commit. Every step passed.

**Proven.**

- **CI on #624.** `tenant-db`, with no `continue-on-error`, passed every step, including "Two tenants through the real driver", which ran `test/integration/two-tenant/events-config.int.test.ts` for the first time. It passed again on #625.
- **CI on #625.** The `db` job's pgTAP step passed, the first run of `supabase/tests/database/tenant_guardian_consent.test.sql` (plan 37). `db` is report-only, so this is read by step outcome.
- C11t: `lib/tenancy/driver-tls.test.ts` runs real postgres.js and Node TLS handshakes against a local server and a generated CA: the right chain and name connect, another CA or another name is refused, an IPv4 host is checked against its address, and a control shows the old unchecked mode would have connected to the wrong server.
- C18: `test/events-admin-config-c18.test.ts` drives the three routes under real `lib/authz` with every flag at its default and for a tenant's staff; `lib/events/admin-config.test.ts` drives the real switch on all three paths.

**Not yet proven.**

- **The consent flow end to end.** No guardian has signed a tenant consent on any deployment. With the flag on, the flow refuses every minor (`document`) until a document is published under `tenant_guardian_consent`.
- **`verify-full` against the hosted pooler.** CI's `tenant-db` job connects to `127.0.0.1`, where the driver uses no TLS. Before `TENANT_DB_ENABLED` is set anywhere, one connection on `dev` with the real pooler URL and the supplied CA must complete its handshake (`docs/TENANCY-S5-data.md`, Owner steps).
- **C18 on a deployment.** No `events-config` read has gone through `tenantDb` anywhere but CI.
- **B14b on production.** The first production runs of `docusign-reminders` and of the outbox drain since 10 Nov: result keys present, no `tenantHeld`, no `outbox` or `tenants` failure in `cron_runs`. Agents cannot read production, so the owner reads them (tracker `s5-programme.34`). B14b's flag-on path has run only against test stand-ins.
- **A8 on a deployment.** One organiser's add, edit and remove and one sheet import on a Stellr group on `dev`.

### What wave 6 corrected

Generated baselines are regenerated at merge and win over any number here.

| This file said | Now | Source |
|---|---|---|
| `MAX_TENANT_DESTINED_STELLR_ONLY` 21 | **18** after C18. 0 through C21 | `test/idor/stellr-only-dispositions.test.ts` |
| Manifest `stellr_only` 165, `tenant_crew` 35 | **162 and 38** after C18, 508 entries | `test/tenant-surface-routes.test.ts` |
| IDOR targets: 94 `stellr_only`, 35 `tenant_crew` | **91 and 38**, 240 in all. The reported 4xx-oracle count is **13**, from 17 | `test/idor/idor-snapshot.json` |
| Unaudited mutations 123 | **118** after Lane C, **112** after Lane A | `test/baselines/unaudited-mutations.json` |
| Authz legacy idioms 138 files, 198 sites | **135 and 190** after Lane C | `test/baselines/authz-legacy-idioms.json` |
| `tenant-db` is report-only | **Required in the workflow** (no `continue-on-error`). Adding it to branch protection is the owner's step | `.github/workflows/ci.yml`, `test/ci-tenant-db-required.test.ts` |
| Tenant database TLS: encrypted, certificate unchecked unless `sslmode=verify-full` | **`verify-full` and `TENANT_DATABASE_CA_CERT` required** for any non-local host | `lib/tenancy/driver.ts` |
| Amendment: the signing engine's tenant sender, nearest slice A11 | **Built in B14b** | `lib/esign/outbox.ts` |
| A7: the register API refuses under-18s on tenant events | Still the default. With `TENANT_GUARDIAN_CONSENT_ENABLED` on and the flow ready, `register/individual` admits 14 to 17-year-olds pending a guardian's signature | `lib/registration/eligibility.ts` |
| A7: the individual form takes the signed-in account's email and checks its stored date of birth on a tenant event | **Not on a tenant host** (A7f) | `lib/registration/individual/gate.ts` |
| Amendment: A8 scopes the team routes and refuses tenant registrations in the payment writers before routing on any zone | **Built in A8** | `lib/registration/roster-context.ts`, `app/api/members/teams/**` |

### Owner decisions wave 6 raised

On top of [Owner gates](#owner-gates) and the earlier lists. Each is built fail-closed until decided. Proposed user-facing wording is the slice's, for the owner to approve or reword.

| From | Decision |
|---|---|
| A16 | **The consent document.** The flow refuses every minor until one is published under `tenant_guardian_consent`. Its wording needs the owner, with legal input. Only platform staff can publish it (Admin, Agreement documents; `lib/esign/native/template-admin.ts`) |
| A16 | Guardian identity assurance: whether an emailed link to an address that is none of the registrant's own, plus the birth-year question and the guardian's attestation at signing, is enough for tenant events. It matches Stellr's own minor consent |
| A16 | Proposed caps on consent invitations: 5 a day per guardian address, across every organiser, and 30 an hour per organiser (`GUARDIAN_INVITES_PER_ADDRESS_PER_DAY`, `GUARDIAN_INVITES_PER_TENANT_PER_HOUR`). They use `lib/rate-limit-async.ts`, so they count per instance until `RATE_LIMIT_STORE` is `postgres` |
| A16 | Proposed window: 14 days, or until the event starts if sooner (`TENANT_GUARDIAN_CONSENT_WINDOW_DAYS`) |
| A16 | Proposed wording, all new: `GUARDIAN_REQUIRED_MESSAGE` (400 `guardian_required`), `GUARDIAN_CONSENT_BUSY_MESSAGE` (429 `guardian_consent_busy`), the door and desk refusals while consent is pending (`lib/check-in-consent.ts`), the confirmation page's "Waiting for your parent or guardian", the registrant's five notices (`consent_pending`, `consent_pending_unsent`, `consent_signed`, `consent_declined`, `consent_expired` in `lib/registration/tenant-confirmation.ts`), and the document title "Parent or Guardian Consent" |
| A16 | Confirm that moving a participant to another registration needs a fresh guardian signature. As built the consent resets to pending, because a signature covers one registration |
| A16 | The desk: a group check-in with one consent-pending member gets a 409 and nobody in the group is checked in. Checking in the rest is not built (tracker `s5-programme.24`) |
| A16 | Before the flag is on anywhere: credentials and surveys do not yet leave out consent-pending participants (A10, tracker `s5-programme.22`), staff see no pending marker on the roster or desk (`.23`), and the sweep's removal retries have no cap (`.26`). **Credentials, team profiles and surveys now leave them out:** wave 7's A10a (#655) and A10b (#660), on `dev` |
| A16 | Before the flag is on in an environment: Lane C's tenant-event refusals (`refuseUnlessStellrEvent`, #624) live in that same environment, as `docs/ENV-MATRIX.md` states (**settled 11 Nov 2026**: `dev` may go first, since Lane C is on `dev`; production waits for Lane C's promotion. **Met on production since 12 Nov 2026,** when #643 promoted Lane C; the flag's other preconditions still stand). **Settled 13 Nov 2026 (`W7-14`): `LOADSCOPED_MODE=enforce` is also required.** On `dev` it holds by procedure (P12 after P4's 72-hour soak); the readiness guard in code is wave 8 work, before any production consent flip (tracker `s5-programme.20`) |
| TB3 E | **Settled 11 Nov 2026: moved from M to L** (`docs/THREAT-MODEL.md` TB3 E). Its stated condition, A3 and A7 on production, was met (A3 since 5 Nov 2026, A7 since #600) (tracker `s5-programme.19`) |
| A16 | CODEOWNERS now also owns `lib/esign/completion.ts` and `lib/esign/native/flow.ts`, where the consent hooks are called, which puts owner review on future e-sign changes there. Keep these two lines, or rely on the owned consent tests (#625). **Kept** (owner, 13 Nov 2026, `PR625-1`) |
| A8 | Before S9 opens tenant billing, the roster writers also check the event's current price, not only the registration's money columns (`TENANT_MONEY_COLUMNS`), or a free-registered group on an event that later gains a price admits places that never show as owed |
| C11t | Which PEM goes in `TENANT_DATABASE_CA_CERT`: the provider's published root CA, or a bundle. This rests on the `dev` handshake showing the pooler's chain ends at that root with a name matching the pooler host (tracker `s5-programme.30`). **Pending:** wave 7's O3 built the canary that decides it (#658); its run, P6, has not happened |
| C18 | Add `tenant-db` to branch protection on `dev` and `main`. It has passed on #624 and #625 (tracker `s5-programme.5`). **Done on `dev`** (its required checks are `verify`, `e2e`, `db` and `tenant-db`, read 12 Nov 2026); `main` still requires `verify` and `e2e` only |
| C18 | How the companies area is confined for Stellr's admins before the first tenant event: `LOADSCOPED_MODE=enforce`, `AUTHZ_SOURCE=postgres`, or an owner check (#624) |

### Owner decisions for wave 7, settled 11 Nov 2026

- `dev` switches are flipped one at a time, each with the owner's yes, and a redeploy after each. Since 13 Nov 2026 Claude sets them with the Vercel CLI after that yes (`W7-18`), and each flip ends by confirming the deployment serves the new code (`W7-19`).
- A fictitious tenant, "dev-canary", for `dev`.
- A separate Sanity development dataset.
- A consent document marked DEV PLACEHOLDER may be published on `dev`.
- `TENANT_GUARDIAN_CONSENT_ENABLED` may go on in any environment where Lane C's tenant-event refusals (#624) are already live: on `dev` since #624 (11 Nov 2026), and on production since #643 (12 Nov 2026). The flag's other preconditions in `docs/ENV-MATRIX.md` still apply.
- The owner creates `tenant_app_login` on `dev`.
- The proposed 72-hour no-flip windows around events: declined by the owner.

### Docs owed after wave 6

- **D7:** a tenant consent signed end to end on `dev`, once a document is published, both flags are on there and the consent flag's precondition above is met; the B14b outbox read in `cron_runs` on production; one A8 roster round on a Stellr group on `dev`. **Added** to the checklist on 14 Nov 2026, with no evidence yet.
- **The wave 7 plan,** with an owner slice for each unassigned need (tracker `s5-programme.43`).
- **`docs/PLATFORM-AUDIT.md`:** the member-uuid sentence, once the owner answers C13.
- **The template PDF-hash test** (tracker `s5-programme.18`), defined 14 Nov 2026: the golden PDF-hash test from the 4 Nov scope, fixed-input renders of the badge and certificate PDFs whose normalised bytes are hashed and pinned. Built as `test/pdf-golden-hash.test.ts` in PR #710 (open, not merged). It lands before C19 and before P8 or P9.

## Wave 7 status

Wave 7 proves the switches on `dev` one at a time, runs a fictitious canary tenant there end to end, and closes the consent and isolation gaps a second tenant would hit first. **Merged** means squashed into `dev`, one PR per slice, on 12 and 13 Nov 2026. **Since promoted:** all of wave 7, with #675 and #677, reached production in #680 (`fba19669`, 14 Nov 2026 UTC) with the owner's yes (`.claude/releases/promote-2026-11-13.md`). Owner decisions are in `docs/S5-DECISION-REGISTER.md` (`W7-1` to `W7-32`, and the answers given in PR review). Every flip goes in the tracker's "Wave 7 flip log" (`s5-programme.31`). **No tenancy switch has yet been on in a hosted environment:** on 13 Nov 2026 the flip log holds only the P0 baseline, with every S5 switch unset on `stellr-web-dev`. Checked against the code on `dev` at `bac59d66`; the promotion lines re-checked on 14 Nov 2026 at `1d9b6977`.

**Merged so far:** batches 1 to 4 (W7-pre to A10b, below), the survey hold #661 and docs train D2 #662. **Follow-ups, all merged on 13 Nov 2026 (#665 to #671):** #665 enters `W7-15`'s two Stellr-host unsubscribe cases in `TENANT_HOST_ACCEPTED`; #666 hides another tenant's survey links in event emails and on check-in (`PR661-1`); #667 is the A10a follow-up (`PR655-3`: "skipped" in bulk issue, 409 from `pd-credentials`); #668 removes event staff check-ins with the account (`attendee-email-cohort.4`); #669 takes a signed-in organiser's name from their account (`promote-s5-wave3.17`); #670 fixes the PD credential e2e flake; #671 is docs train D3. The production zone guard (`W7-27`) was approved on 13 Nov 2026 as a small wave 7 slice and is built in #675 (`docs/TENANCY-S5-routing.md`, "The production zone guard") and is on production since #680.

| Slice | PR | Flag, or why it is a no-op for Stellr |
|---|---|---|
| W7-pre | #646 (`a33ef9c9`) | No runtime change: 10 audit action names (`credential.*`, `team_profile.record.save`, `survey.*`, `event_volunteer.interest.set`) and 3 CODEOWNERS paths registered up front. Unsubscribe keeps `email.unsubscribe.apply` |
| D1 | #647 (`fee4420f`) | Docs: the decision register and the flip log |
| C20c | #648 (`891822f3`) | No flag. The money routes on Stellr's Stripe refuse another tenant's event in every mode: `invoice-paid`, `payment-link`, `registrations/[id]/invoice`, `registrations/[id]/finish-setup` and `refunds/preview` (`docs/TENANCY-S5-data.md`, "Stellr-only routes refuse another tenant's event (waves 6 and 7)"). **For Stellr:** one extra read of the event's owner per request, two for `refunds/preview`, and a retryable 503 if it fails. The delete dialog now blocks a delete when the refund preview fails for any reason but 404 |
| K4 | #649 (`1a1bd5d7`) | The event mirror sync keeps a non-owner row's minimum age, and its time zone unless the venue moved (`docs/TENANCY-S5-registration.md`, Known limits). Stellr's written payload is byte-identical, with no extra read |
| O2 | #650 (`7dca70e1`) | `RATE_LIMIT_STORE`: in `memory`, today's default, nothing new is written or imported. In `shadow` a disagreement or store problem leaves a `RATELIMIT` row (`docs/S5-CRONS-LIMITS-SMMA.md`) |
| B26a | #651 (`06e06f24`) | `CRON_NON_PROD_JOBS`, unset: read only on the hosted `dev` deployment, two values only, never the minor-account purge (`docs/S5-CRONS-LIMITS-SMMA.md`, "The dev opt-in") |
| K3 | #652 (`080d9c64`) | Tooling only: `scripts/seed-two-tenants.ts --profile flow` (below). One logic change: `lib/tenancy/role-mapping.ts` counts a Clerk event-manager claim as backed by an assignment in any tenant, because the claim names none. With Stellr-only data the results are identical (tested) |
| K5 | #653 (`6475dc54`) | Tooling, the e2e stack and placeholder guards (below). Stellr's titles and PDFs carry no mark, so they pass through unchanged; off `dev`, admin create and approve read a PDF's text once more |
| O1 | #654 (`82534411`) | The switch registry (`lib/tenancy/flags.ts`) and the health route's `tenancy` object (below). The health route is the registry's only importer, so no Stellr request path gains a read; the route makes one service-role read (`W7-8(b)`). `TENANT_DB_ENABLED`'s gate and `TENANT_DB_AREAS`' parser moved unchanged to `lib/tenancy/tenant-db-config.ts` |
| A10a | #655 (`71a15c5f`) | No flag. `recordOnHost()` (`lib/tenancy/host-record.ts`, NULL counts as Stellr) on the credential events, visibility, pdf and certificate routes and the team-profile token POST; the public credential page, badge, card and wallet show Stellr's credentials only; a credential is never issued or reinstated for another tenant's event, and its email never sent; every non-Stellr team-profile invitation is held. Decisions `W7-9` to `W7-11`. **For Stellr:** responses byte-identical, zero consent reads, and issuing a credential for an event now reads the event's owner once (per batch for bulk issues); if that read fails, issuance fails |
| B10r | #656 (`79a58c96`) | CI only: `tenant-host-routing` is required through the `e2e` gate (below) |
| O3 | #658 (`907ce4fd`) | `TENANT_DB_ENABLED`, unset: nothing new runs or is imported. The pooler TLS canary, `TenantDbConfigError` with a fixed reason, one `TENANTDB config` row per instance, `tenancy.tenantDb.config` on the health route, and `application_name` `stellr-tenantdb` (`docs/TENANCY-S5-data.md`) |
| K8 | #659 (`82472e0d`) | No app code: the canary runner and the tenant-host header checker (below). The only `lib/` file, `lib/testing/canary-flow-scenarios.ts`, is a pure module the app does not import |
| A10b | #660 (`9912395b`) | No flag. `recordOnHost` in the survey session before the wrong-member check, for GET, PATCH, submit and stop-reminders; `survey/event/[slug]/link` sends only when the event's tenant matches the host; Stellr's token, stop-reminders and QR pages show Stellr's surveys only; consent-pending tenant minors and their guardians are left out of every survey send; `volunteer/interest` refuses another tenant's event; `email/unsubscribe` POST checks the host. Decisions `W7-12`, `W7-13` and `W7-15`. **For Stellr:** byte-identical plans, sends and pages, no consent read, and one `events.tenant_id` read on the admin late-open preview only |
| Survey hold | #661 (`117e25b4`) | No flag. Every non-Stellr survey send is held until tenant-host survey links exist (`W7-16`): `lib/survey/hold.ts`'s `surveySendsHeld` is asked by every send path, queued invitations stay queued with the held label, and the admin Survey tab shows the label instead of "Send failed". **For Stellr:** surveys (NULL included) send, claim budget and read as before (`docs/S5-CRONS-LIMITS-SMMA.md`) |
| D2 | #662 (`9a6ac19f`) | Docs train 1: wave 7 status, the PR-review answers and the questions then open |

**`tenant-host-routing` is required (B10r).** It lost `continue-on-error`, and the `e2e` gate fails unless it succeeded, so a cancelled, failed or skipped run fails too. Branch protection still names `verify` and `e2e`; the requirement lives inside the gate (owner decision `W7-8(c)`). A throwaway PR with one deliberately failing tenant-host test (#657, closed unmerged) turned `e2e` red. The ledger of which jobs block a merge is `docs/RUNBOOK-ci-database.md`, "Enforcement ledger".

**The health route (O1, O3).** `GET /api/admin/health/integrations` (admin only) now carries `tenancy`, every S5 switch as it resolved, never a raw value, secret, URL or zone:

- `authzSource` {`value`, `unrecognised`}, `loadScopedMode`, `rateLimitStore` {`mode`, `secretUsable`};
- `platformAudit`, `tenantEventMail` and `guardianConsent` as booleans, and `fieldCryptoMode`;
- `derivationMode`, from one service-role read of `tenancy_settings` with a 2 s timeout, `unavailable` on failure;
- `tenantDb` {`enabled`, `areas`, `ignoredEntries`}, and, only while `TENANT_DB_ENABLED` is on, `config` {`url`, `ca`}, each `ok`, `not-needed` (the CA, for a local host) or a fixed reason (O3);
- `routing` {`enabled`, `suffixError`};
- `unrecognised`, the variables whose value fell back to the default, by name;
- `invalidCombinations`, of 5 rules: `rate_limit_store_without_secret`, `tenant_db_areas_without_flag`, `routing_without_usable_suffix`, `guardian_consent_without_tenant_mail`, `field_crypto_mode_without_key`.

It is informational and does not feed `ok`. **Every flip's checklist starts here (`W7-19`):** after the redeploy, confirm the `dev` deployment is serving the new code, that is, the deployment is READY for the expected commit and the health endpoint reports the new value. Only then read `supabase/tests/s5_watch_only.sql` with the flip's time (`docs/TENANCY-S5-data.md`, "Before any flip"). Claude makes the change and the redeploy with the Vercel CLI, after the owner's yes for that change (`W7-18`).

**The consent placeholder (K5).** The consent document's field map is `lib/esign/native/templates/tenant-guardian-consent-v1.fields.json`, whose prefill keys match `planTenantGuardianConsent`; the organiser, event, child's name and date of birth, and relationship are locked, and the guardian can correct only their own name and email. The e2e stack publishes `tenant_guardian_consent`. On `dev` only, `scripts/esign-template.ts` builds and publishes a document titled "DEV PLACEHOLDER – NOT A CONSENT FORM", marked on every page, refuses any target but the dev project or a loopback database, and approves nothing without `--dev-placeholder` and `--apply`; `scripts/esign-dev-issue.ts tenant_guardian_consent --version <n>` signs one before approval, for K0. `lib/esign/native/template-admin.ts` and `templates-store.ts` refuse a placeholder on the real production app. Nothing has been published or approved on `dev` yet, and each step needs the owner's yes (`W7-6`). The production wording stays a legal item.

**The canary tenant (K3, K8 built; K9 not run).**

- **K3, the seed.** `scripts/seed-two-tenants.ts --profile flow --zone <zone>` plans the `dev-canary` tenant (US, USD, America/Denver, minimum age 14, replies to the role inbox), `canary.<zone>` mapped and `nobody.<zone>` left unmapped as the probe host, one mirror row about 4 weeks out, and Clerk test personas `canary-manager`, `canary-admin` and `stellr-probe-admin`. A dry run by default; `--apply --clerk` writes it; `--check` prints READY or NOT READY reasons only; `--profile flow --remove [--apply --clerk]` tears down only rows stamped with `dev-canary`'s id, and refuses while registrations exist or the event is published. It refuses the production project, `sk_live_` keys, `APP_ENV` or `NEXT_PUBLIC_APP_ENV` prod or preview, and `VERCEL_ENV=preview`.
- **K8, the runner.** `scripts/canary-tenant-flow.ts` drives S1 to S8 over HTTP against `--base` and reads the evidence back from the `dev` database: S1 an adult registers, S2 a minor is held pending consent, S3 check-in is refused while pending, S4 the pending minor gets no tenant mail, S5 the guardian signs, S6 the guardian declines, S7 isolation probes with an expectation table per `AUTHZ_SOURCE` and `LOADSCOPED_MODE` and known gaps named by slice, S8 Stellr unchanged. `--plan` prints the scenarios and the table and sends nothing. `scripts/canary/tenant-host-headers.mjs` checks one enforcing CSP on `/sign` and `/survey/x` and the fixed header on `/_next`, `/api/img` and `/api/csp-report`. Both print ids, counts and status codes only, and refuse Stellr's production hosts.

**How to run K9.** Each numbered step needs the owner's yes at the time. Nothing here has run.

*Phase A, the local rehearsal* (needs K7a, K0 and K7b; the CMS side needs K2, which is pending):

1. **K7a.** From a checkout whose `.env.local` points at `dev` only: `npx tsx scripts/seed-two-tenants.ts --profile flow --zone <zone>` (dry run), then `--apply --clerk`, then `--check`. Then `scripts/map-tenancy-roles.ts --check` shows no drift, and the parity query returns 0. The next CI e2e and `tenant-host-routing` runs must pass by step outcome, because CI shares this database. Rollback: `--profile flow --remove --apply --clerk`.
2. **`canary.localhost`.** A second K3 apply with `--zone localhost` maps it to `dev-canary` on the shared `dev` database (owner answer `PR659-1`).
3. **The server.** A local `next start` with `TENANT_ROUTING_ENABLED=true` and `TENANT_HOST_SUFFIX=.localhost`, against the `dev` database.
4. **Persona sessions.** Sign each persona in on the dev host in a browser with a Clerk testing token, and export its session id as `CANARY_SESSION_ID_<HANDLE>` in the shell (`docs/ENV-MATRIX.md`, section 6). The runner mints each token just before use.
5. **Start.** `npx tsx scripts/canary-tenant-flow.ts --phase start --zone localhost --base http://canary.localhost:3000 --stellr-base http://localhost:3000 --stellr-event <a Stellr event slug>`, with `--authz-source` and `--loadscoped-mode` naming the server's modes. It runs S1 to S4, S7 and S8 and writes its ids to a state file outside the repo. The register route's cap allows one start an hour.
6. **The guardian, by hand.** In the role inbox, with the owner as witness, sign the "guardian-sign" consent and decline the "guardian-decline" one.
7. **Settle.** `--phase settle --state <file>` with the same flags, until S5 and S6 stop waiting.
8. **Headers.** `node scripts/canary/tenant-host-headers.mjs --zone localhost --base http://canary.localhost:3000 --stellr-base http://localhost:3000`.
9. **`app_errors`.** Read every unexpected row since the run started, a CI-origin one included (owner answer `PR659-3`).

*Phase B, hosted `dev`* (after K6 attaches the canary zone, and P10 to P12): the same runner and header checker with `--zone devzone.stellreducation.org --base https://canary.devzone.stellreducation.org` and `--stellr-base` the `stellr-web-dev` deployment. The zone is a subdomain of `stellreducation.org` on `stellr-web-dev` only (`W7-24`); its steps, the cookie review's conditions and the rollback are in `docs/TENANCY-S5-routing.md`, "The dev canary zone (K6)". Use a browser profile that never signs in to production. **P12, the consent flip,** sets `CRON_NON_PROD_JOBS` and then `TENANT_GUARDIAN_CONSENT_ENABLED`, each followed by a redeploy and the deployment check (`W7-19`: READY for the expected commit, health reporting the new value), and only after P4 has soaked 72 hours (`W7-14`). By hand: the check-in desk as `canary-manager` before and after consent; tenant-host pages in a browser with 0 trackers, no hydration error and 0 CSP violations; Clerk sign-in and sign-up with Turnstile on the canary host. The expiry path: an agent moves one canary consent row's `expires_at` into the past on the `dev` database, then the owner calls the consent-only sweep by hand (B26a), between two 06:00 UTC scheduled runs. Afterwards clear `CRON_NON_PROD_JOBS` and sign the persona sessions out. Optionally, with the owner's yes at the time, a short supervised `AUTHZ_SOURCE=postgres` window re-runs S7, then goes back to `shadow` (`W7-22`).

*Pass:* S1 to S6 and S8 green; S7 matching its table for the modes in force, with known gaps named; 0 unread `app_errors` rows; at most 25 canary sends a day (`W7-21`), counted by the operator, since nothing in code enforces it. The scenario table is in `docs/TENANCY-S5-flow-checklist.md`, "The dev canary tenant (K8, K9)".

**Not yet proven.**

- **Any switch on a hosted deployment.** P1 onwards wait on the owner's yes for each flip; Claude then sets it with the Vercel CLI (`W7-18`). P1 may go on `dev` with C13 and B16 still open, since they gate production only (`W7-17`).
- **The `AUTHZ_SOURCE=shadow` rehearsal (P3).** Not started. On `dev`, after `scripts/map-tenancy-roles.ts --check` exits 0, it runs for 7 days, counted from the first expected canary mismatch row, which proves the switch took effect; a fix to the role tables restarts the clock (tracker `s5-programme.31`, `W7-2`).
- **The pooler TLS canary (P6).** Built, not run, so which PEM goes in `TENANT_DATABASE_CA_CERT` is pending (tracker `s5-programme.30`).
- **The `dev` Sanity dataset (K2).** Approved (`W7-5`), not done. Without it the hosted canary stops at the local rehearsal.
- **Signing on `dev` (K0).** On 12 Nov 2026 `stellr-web-dev` had no e-sign or seal variables, which K0 checks first.
- **The `RATELIMIT`, `TENANTDB config` and health signals** have run only in tests; the first flip that reaches each is its first real run.
- **A10a and A10b on a deployment.** Every event and record is Stellr's, so their tenant branches have run only in tests and the tenant-host harness.

### What wave 7 corrected

Generated baselines are regenerated at merge and win over any number here.

| The S5 docs said | Now | Source |
|---|---|---|
| Tenant-host cases failing: 82 (leak 14, honey_write 22, 4xx-oracle 42, oracle 4), 18 unproven | **74** after A10a, **50** after A10b, **48** since #665 entered the 2 accepted Stellr-host unsubscribe leaks (`W7-15`) in `TENANT_HOST_ACCEPTED`. By outcome: leak 10 (the 2 accepted among them), honey_write 12, 4xx-oracle 28, oracle 0; unproven 18 | `test/baselines/tenant-host-idor.json` |
| Unaudited: 112 mutating handlers and 6 GET writers | **104 and 4** (108 in all) after A10a and A10b | `test/baselines/unaudited-mutations.json` |
| `tenant-host-routing` is report-only | **Required through the `e2e` gate** (B10r) | `.github/workflows/ci.yml`, `test/ci-tenant-host-routing-required.test.ts` |
| No route decides through `lib/authz` | Converted routes decide through it, so `AUTHZ_SOURCE=shadow` compares real decisions (`docs/AUTHZ.md`) | `lib/authz.ts` |
| The mirror sync writes a NULL minimum on every sync | **A non-owner row keeps its minimum and time zone** (K4) | `lib/events/sync.ts` |
| Credentials and surveys do not leave out consent-pending participants (A10, tracker `s5-programme.22`) | **Built in A10a and A10b,** on production since #680 | `test/participant-mail-consent-guard.test.ts` |

### Owner decisions wave 7 raised

All in `docs/S5-DECISION-REGISTER.md`. Answered on 12 Nov 2026: `W7-9` to `W7-13`, `W7-15` and `W7-16`, and the review answers `PR658-1`, `PR658-2` and `PR659-1` to `PR659-3`. Answered on 13 Nov 2026: `W7-14`, `W7-17` to `W7-31`, `W7-32`, and every question the wave 7 PR bodies raised:

| From | Question | Answer (13 Nov 2026) |
|---|---|---|
| C20c (#648) | For another tenant's participant, should `refunds/preview` answer 404 (as built) or the empty preview a missing participant gets? | 404, as built (`PR648-1`) |
| B26a (#651) | Keep `membership-expiry` as the `cron_runs` job name for the consent-only run (result `{ only: 'tenant-consent', ... }`)? | Kept (`PR651-1`) |
| K5 (#653) | K0 signs the placeholder before approval and K7b approves it: keep that order? Lock the organiser, event, child's details and relationship on the guardian form, when Stellr's own minor form locks nothing? | Both kept (`PR653-1`, `PR653-2`) |
| O1 (#654) | The stale "auto:" reason the generator re-derived for `admin/competitions/[slug]/page.tsx` in the service-role baseline | Accepted; fixed at the next regeneration (`PR654-2`) |
| A10a (#655) | One event-owner read per Stellr credential issue; refusals in the admin bulk issue shown as "skipped" rather than "failures"; `pd-credentials` answering 409 rather than 500 for a refused tenant event | The read accepted (`PR655-2`); the follow-up approved, in #667 (`PR655-3`) |
| B10r (#656) | Pin the required jobs' Actions to SHAs, as `tenant-db` does, in a later slice? | Yes, after the GitHub organisation move (`PR656-1`) |
| Survey hold (#661) | Hide `feedback_link` and the check-in survey link for another tenant's events; the held label's wording | Both approved (`PR661-1`, in #666; `PR661-2`) |
| A16 (#625) | Keep the CODEOWNERS lines for `lib/esign/completion.ts` and `lib/esign/native/flow.ts`? | Kept (`PR625-1`) |

**The 13 Nov cookie review's questions, answered the same day** ("Accept all seven"): `W7-25`, the canary hosts may be public for the K9 window; `W7-26`, the no-ads gap is accepted for now and no setter is built; `W7-27`, the production zone guard is built now as a small slice, and stays a hard gate before production's routing flip; `W7-28`, keeping the zone after K9 is decided after K9; `W7-29`, the Clerk dev instance settings are found out at K9's sign-in; `W7-30`, the owner adds the two CNAME records; `W7-31`, both `canary.localhost` and the devzone rows are kept. No entry in the register was open on 13 Nov 2026; on 14 Nov 2026 the reviews of batch 1's S5 PRs added five open ones (`PR624-1`, `PR701-1`, `PR705-1`, `PR708-1`, `PR708-2`).

### Docs owed after wave 7

- **D3, in part (13 Nov 2026):** the owner's 13 Nov answers, K6's zone steps and the cookie review in `docs/TENANCY-S5-routing.md`, and the K8 scenario table in `docs/TENANCY-S5-flow-checklist.md` are written. **Still owed after K9:** the dev canary record (what was proven, scenario results by mode, gaps by slice, re-run and rollback order), the K6 results (including the `Domain` attribute of both `__client_uat` cookies), and the canary's keep-or-tear-down record (the zone itself: `W7-28`, decided after K9).
- **The P6 result:** the PEM choice in tracker `s5-programme.30` and `docs/TENANCY-S5-data.md`.
- **K2's dataset** in `docs/ENV-MATRIX.md`, once done.
- **The e-sign runbook's placeholder script usage** (K5); for now it lives in `scripts/esign-template.ts`'s header. PR #707 (open, not merged) adds it as `docs/esign/RUNBOOK-esign-templates.md`.

### Backlog batch 1 (14 Nov 2026): S5 PRs open

Batch 1 of the 14 Nov review's backlog opened these S5 PRs into `dev`. None is merged and none has been applied to a database; each keeps Stellr's behaviour with the switches at their defaults, as its PR body shows. The full batch is `docs/handovers/tracker/2026-11-14-backlog-batch1.md`.

| Slice | PR | What it does, and what is left |
|---|---|---|
| B22 | #701 | `group-invoice-sync` splits rows by tenant and runs through `runPerTenant`; only Stellr runs until S9; Stellr's reads are filtered to Stellr's or unstamped rows; unstarted registrations are deferred after 270 s. The route holds its own copies of the two sweeps (tracker `s5-programme.49`; `PR701-1`) |
| C8-PG | #702 | A tenant-explicit Postgres reader for the events facade, not wired to any caller. Caller conversion and the cron tenant loops are wave 8 (`s5-programme.50`) |
| Lane C follow-ups | #705 | The agreements list and page read only Stellr's or unstamped rows in every mode, with a shrink-only ratchet over `stellr_only` lists; the C17 route comments; stronger C17 Stellr-event tests (`s5-programme.29`, `.51`; `PR705-1`) |
| Consent guard and edges | #708 | `tenantGuardianConsentReady()` (the flag, `LOADSCOPED_MODE=enforce` and `TENANT_EVENT_MAIL_ENABLED`) gates every admission path, and the switch registry's `guardian_consent_without_tenant_mail` becomes `guardian_consent_not_ready`; the retry cap; move-to-Stellr and date-of-birth-lift edges, the pending row kept as `settled`; a guard over later participant writers; more A16 pgTAP cases. One migration (`20261114072142`), applied nowhere (`s5-programme.12`, `.20`, `.25`, `.26`; `PR708-1`, `PR708-2`) |
| Plans | #706 | Docs only: `docs/PLAN-multi-tenant.md`, the DRAFT wave 8 and S6 plans, the decision backfill draft and the S1 to S4 owner checklist (`s5-programme.37`, `.39`, `.41`, `.43`, `.44`) |

The S0 database PRs (#687, #689, #690, #691) and the mutation runner (#692, `s5-programme.40`) are outside S5 but gate it: see the batch tracker.

## PR amendments

These change what a PR must do, on top of its scoped summary.

**A2.** Import `TENANT_MIN_PARTICIPANT_AGE` from `lib/tenancy/constants.ts`: no second constant, no edit to that file. A3's pgTAP asserts the SQL literal equals it, by a test that reads the constant.

**A3.** Defines the lookup that scoping left open:

- With an `events` row: use `events.tenant_id` joined to `tenants.is_platform_owner`.
- With no `events` row: return NEW only when `registrations.tenant_id` is NULL or Stellr. Otherwise raise 23514. Sanity is the source of truth and `events` is a background mirror, so refusing outright would break Stellr registrations for an unmirrored event.
- **That rule alone does not stop an unmirrored tenant event.** In log mode, the default, `tenancy_derive_tenant_id` stamps an unstamped registration with no `events` row as Stellr (reason `no_event`). A3 then sees Stellr and accepts a 13-year-old or NULL DOB, and the row lands in Stellr's scope. Two things close this: `derivation_mode='enforce'` before the first non-owner event (see [Owner gates](#owner-gates)), which raises 23503 for that row, and every write path supplying `tenant_id` (A7, A8).
- pgTAP covers both branches, plus a tenant slug with no `events` row and no supplied `tenant_id`: stamped Stellr in log mode, which pins the gap, and 23503 in enforce.
- An AFTER UPDATE OF `starts_at`, `tenant_id`, `min_participant_age` trigger on `events` (non-owner only) re-checks existing participants, or the PR documents why tenant events cannot change once registrations open.

**A7.**

- **Priced tenant events fail closed.** Until S9 ships the ledger, a tenant event with a price is refused: an under-construction 503, or a refusal at the gate. No Checkout session or invoice is ever created on Stellr's Stripe account for a tenant. No Stripe Connect code exists yet. In `register/group` the refusal comes before `answerDuplicates`, which can open a Checkout on an earlier unpaid registration, and `collectPayment` uses `group.event` or applies the refusal again to its second read. A test covers a tenant event with an unpaid card registration on file.
- **`assertEligible` runs over everyone before the first write in `register/group`.** A6 stayed a pure refactor and only pinned that every person with a row passes one point (`route.branches.test.ts`; see the note in `lib/registration/group/persist.ts`). A7 replaces `checkRegistrationAge` with it in both `resolveLinkedSlots` and `checkDatesOfBirth` in `lib/registration/group/roster.ts`, with the same context. In `checkDatesOfBirth` alone the answer would depend on the record an ID names. A test covers a Member ID record under the tenant minimum, which gets the same "couldn't use the Member ID" answer as an unknown ID.
- **`lib/registration/group/stellr-hooks.ts` sits behind `isPlatformOwner`.**
- **Member ID linking on a tenant event.** On a tenant event, either treat the slot as unusable, with the same answer, or scope both the ID lookup and the profile read to the event's tenant. The test is a cross-tenant IDOR case.
- Every register write supplies `tenant_id` from the resolved event context, on the Stellr path too. For Stellr that is the value the trigger stamps today, so it changes nothing now, and it is what keeps an unmirrored Stellr event registering after the enforce flip.
- Tenant confirmations are email-only, through B14's tenant share.
- Shared bodies render Stellr's guarantee and nonprofit notes, so those slots must be Stellr-only before any tenant host goes live.
- Audit covers the Stellr path too: all 5 register routes, through `auditMutation` and `runAfterResponse`, with `PLATFORM_AUDIT_ENABLED` off by default. A4 to A6 stay pure refactors.
- The events-facade codemod runs on every Lane A importer, not only the 5 register routes. That includes the 9 `app/(flow)` importers and Lane A's `lib/` files.

**A8.** Also audits all 5 mutating `app/api/members/teams/**` files: B16 excludes them and no other PR claims them. These writers supply `tenant_id` explicitly, as A7's do. Handle the existing-row update as well as the insert: `update(payload)` in `lib/sheet-participant-sync.ts` (lines 187 and 210, the existing-row and raced branches) ignores its error, so a 23514 from A3's `UPDATE OF date_of_birth` trigger would vanish. The 6 other files that update `participants` (`lib/agreement-correction.ts`, `team-profile/assign.ts` and `override.ts`, check-in, and the admin guardian, companies and check-in routes) must not touch `date_of_birth` or `registration_id`, or they need the same handling.

**A10, A12.** Use `lib/team-profile/`, not `lib/team-profiles/`. The scoped `lib/credentials/data.ts` and `lib/check-in/data.ts` collide with the existing files, so use the non-colliding paths above.

**A12.** `checkInCodeUrl` builds from `SITE_URL`, so the QR on a tenant's code page and the emailed code links open the Stellr host, where the code page has no tenant check. A12 builds them from the tenant's host, passed in by the tenant wrapper (B5b reviewed this and left it here, with the rest of the check-in data).

**B1.** Decided in the B1 slice, replacing the scoped text: **`stellr.localhost` has no hard-coded exemption.** With the zone at `.localhost` it is looked up like any zone host, and the two-tenant seed maps it to Stellr through the platform-owner rule. That costs one map load per TTL and makes the platform-owner path a tested one. In any other zone it is outside and takes the Stellr path with zero fetches.

**B3.** `lastCronResult` works whether or not the migration is applied: select `parent_id` and filter in JS, or filter conditionally.

**B4.** New async API in a separate module, or the store dynamically imported. `proxy.ts` keeps importing only the sync module, with a test that its import closure excludes `lib/rate-limit-store.ts`. The `entitlements` gc runs only when `RATE_LIMIT_STORE` is not `memory`.

**B5.** The tenant branch goes **at the top of the outer `proxy()`**, before `isMarketingRoute` and crawler recording. The marketing fast path returns before `clerkHandler` runs, so a tenant check inside the Clerk handler would serve Stellr pages on a tenant host. A test asserts that every route calling `requestTenant()` is matched by `config.matcher` (`api/img` and `api/csp-report` are excluded today).

That test works per route, so it cannot see a further gap: **dotted paths skip the proxy.** The extension lookahead in the first matcher entry has no end anchor, so a static extension anywhere in the path excludes it. Run against the live regex, `/%5Ft/acme/sign/abc` is matched, but `/%5Ft/acme/sign/abc.png`, `/%5Ft/acme/sign/x.html` and `/%5ft/acme/sign/x.css/y` are not. Those requests get no block, no header stripping and no per-tenant CSP, and they still reach `app/%5Ft/[tenant]`. B5 adds a dedicated matcher entry for `/_t`, `/%5Ft` and `/%5ft` that the exclusion cannot override, compares a decoded first segment so other encodings such as `/_%74` are caught too, and confirms it with a raw `node:http` test on the production build.

B5 also reports `tenantRoutingConfig().suffixError` through `app/api/admin/health/integrations` (a Lane C hunk). The attach order under [Owner gates](#owner-gates) needs it.

**B5b.** Without it, all 16 `app/(flow)` pages 404 on a tenant host and B10's tenant checks have nothing real to hit.

A bare re-export is not enough, and the lint must fail one. The reused page ignores `params.tenant`: `survey/[token]/page.tsx` reads only `token` and calls `invitationByToken(db, token)` with no tenant, so tenant B's record would render on tenant A's host. Each tenant-tree page is a wrapper that resolves the tenant from params and passes it to a data loader that answers 404 for another tenant's record. Where a Lane A loader is not tenant-aware yet, B5b adds that check as a hunk under the cross-lane rule, and A7 and A10 to A12 build on it.

The lint runs over the tree's import closure, reusing B8's closure tooling, not only over files under `app/%5Ft`. The code it must see sits in `app/(flow)` and `lib/`. A page may not use `headers()`, `Host` or a cookie to decide the tenant. The review asked for a plain ban over the closure, but that cannot pass: `check-in/[slug]/page.tsx` needs its `cookies()` call. So each `headers()` or `cookies()` call in the closure is listed by name with its reason, as that one and `requestNonce` would be.

B7's `test/tenant-tree-no-analytics.test.ts` also walks that closure, and `register/[slug]/{individual,group,confirmation}/page.tsx` import `TrackEvent` and `lib/analytics` today. B5b moves those into the Stellr pages, through a slot or prop the Stellr page supplies, so the shared bodies are free of them. It does not exempt them from the test: `FORBIDDEN_FILES` has no allow-list, and an edit there would loosen it for everything.

The B5b review added two rules. A tenant's form gets no registration prefill: `getRegistrationPrefill` reads the member's latest `participants` row from any organiser, so the shared register and join bodies take it through `loadPrefill`, which only Stellr's pages supply, and `test/tenant-tree-pages.test.ts` holds `lib/registration-prefill.ts` out of the tree's closure. Anything richer waits on the owner (see [Owner decisions wave 2 raised](#owner-decisions-wave-2-raised)), and must read `participants` for this `tenant_id` only. And `loadOpenCheckIns` keeps to Stellr-or-NULL rows, so Stellr's banner and desk list can't reach a tenant's open check-in. The filter is the no-op form above, not a flag, because `e2e/tenancy/harness.test.ts` holds readers of the routing flag to the tenancy edge. Tenant pages use `loadOpenCheckInsForTenant`.

**B5c.** `app/layout.tsx` wraps the `/_t` tree too. A nested layout cannot remove head JSON-LD, and the un-nonced `ConsentMode` inline script would break under B6's enforcing CSP.

The gate has three parts, because B10a's flag-off and flag-on hash cannot see this move. Both its servers run one build, and the split is not tied to the flag, so dropping a tag from Stellr's pages passes every comparison (shown by mutation on 5 Nov). B5c therefore adds, before it merges: a before-and-after comparison of the fingerprints from a harness build of its merge base and of its head, on the same paths, in CI or as committed fingerprints regenerated by script; and an assertion that Stellr's layout chain still holds `ConsentMode`, `SiteTracking` and the JSON-LD. B10a's flag-off and flag-on check still has to pass as well.

B7 does not stop that head script. Until B5c lands it still runs on a tenant host: it creates `window.dataLayer`, replays a stored choice and shows the banner at first paint, with no network request. B7's test walks only `app/%5Ft`, so it does not see this. B5c adds an assertion that the tenant layout's parent chain holds neither `ConsentMode` nor `SiteTracking`. No real zone gets the routing flag before B5c.

**B8.** `lib/community/event-hooks.ts` also wraps `syncObjectSpaceRoster` and `reconcileEventSpaceRoster` (`lib/space-inheritance`), `autoGrantBaseMembership` (`lib/auto-membership-grant`, now Lane B) and `linkMembersToSchoolByName`. `syncMemberOptionSelections` is imported by the same route and has no decision yet: B8 either wraps it or says why not.

**B9.** Four tables, not two. Closing the two community `TODO(S5)` snapshot entries points at the coaching request and training item-flag routes.

**B10.** (b) seeds a second non-owner tenant (for example `canary-b.localhost`) and alternates between the two non-owner tenants. Alternating with `stellr.localhost` passes vacuously: Stellr is never rewritten into `/_t`, and with B6 every tenant page renders per request. If ISR stays an owner option, also run once in ISR mode. (c) also tries a denied path with a dotted suffix on a tenant host, and names host B's slug and token on host A's pages, in both directions. That includes a tenant's slug on the Stellr host at `/check-in/<slug>` and `/check-in/<slug>/code`, which have no tenant check of their own until A12. (d) counts third-party requests, and also asserts no hydration error, no `window.dataLayer` and no cookie banner, so it covers the head script as well as the five trackers.

**C0b.** Scoped as `tenant_id` plus a composite FK. The composite FK is **held back**:

- **Why.** Beside the existing single-column key it gives PostgREST two relationships between the same tables, and PostgREST then refuses every embed with no hint (PGRST201). Rosters, check-in and join links use such embeds. `lib/tenancy/load-scoped.test.ts` fails on a second FK.
- **What replaces its cascade.** `zzz_tenancy_carry_children` moves children when a parent goes from one tenant to another, including when the derivation trigger does it from a new `event_slug`. A parent with `esign_audit_events` or `survey_answers` cannot change tenant, because those rows are immutable. For Stellr the trigger's WHEN clause is never true.
- **Who adds the FK.** No slice owns it yet. It needs every unhinted embed of these relations hinted first, so it is a follow-up PR after A10 to A12. The two esign logs never get one, because each must outlive its agreement.
- **What A10 to A12 depend on.** `tenant_id` and the carry trigger, not the FK. Each also needs `tenancy_cutover_checks` sections D2 and I at 0 first.

What `tenant_app` may write is narrower than the other tenant tables, and later slices must say what they need:

- `agreement_recipients` is read-only, alongside the three append-only evidence tables, because it holds signature evidence and signing-link state. **A11** names the columns it needs, in a migration, with a matrix test. No grant of the signature, consent or token columns.
- `participants.member_id` and `membership_id` are not writable, and `participants` has per-column grants, so a later column is not writable until a migration says so. **A7 and A8** write through `service_role` for those two columns, or scope the global lookups in `lib/member-onfile.ts` and `app/api/members/lookup` by tenant first and then justify the grant. These lookups are the same ones A7's Member ID rule covers.

Other things this slice leaves in place:

- **Refusals.** In a tenant session, a parent the session cannot see gets RLS's one refusal (42501) from the inherit and eligibility triggers, in both derivation modes. `tenancy_derive_tenant_id`, from S3, still raises 23514 or 23503 on an event key in enforce mode, which tells a tenant whether another tenant's slug exists. Slugs are public on the event pages, but it needs the same step aside before the enforce flip.
- **Known limit: the shared counter.** `tenant_app` holds USAGE on `participants_membership_id_seq`, which also feeds `members.membership_id`, because the column default needs it. So the numbers a tenant is given suggest how many participants and members exist across all tenants, and a session running `nextval` would use up ids. A tenant does not issue SQL, so that takes a slice that returns the value or calls it. A per-tenant numbering scheme would close it. Settle it before the first non-owner tenant.
- **Response bodies.** Three routes return whole participant rows, so they now carry `tenant_id`: `GET /api/members/teams/[id]` for an organiser, `PATCH /api/members/teams/[id]/participants/[pid]`, and the add-participant POST through `lib/group-participant-add.ts`. For Stellr that is a constant already public in `lib/tenancy/constants.ts`. A8 names the columns on these routes.
- **Production apply.** Apply the four files outside event hours: the first takes ACCESS EXCLUSIVE on 10 tables, the third on 15, and each lock taken stays held while the next waits.

**C5.** Split so the audit chain does not wait on the rate limiter for no functional reason. C6 depends on C5a only.

**C6.** Scoped with staff personas only, and with the oracle "enforced for those classes and reported for the others". But admin is denied on tenant hosts. The routes tenant hosts do serve are participant or public class, and they are global today. So C6 also runs an anonymous and a participant persona over every id-bearing route in B2's `allowedTenantFiles()`, on host A naming host B's slug, token, envelope and credential number, in both directions, Stellr included, and it enforces the oracle there. These routes start above 0, so they get a generated cap that only falls, through A7 and A10 to A12. Those PRs' own tests do not replace this: A7's covers one direction for register only, and the two-tenant tests in A10 to A12 prove refusal, not that a 404/403 difference hides the record.

**C7.** Scoped as no migration, but `platform_audit_events` and `ActorKind` in `lib/audit/platform.ts` accept only `user`, `system` and `cron`, so `webhook:<provider>` actors would be refused. Re-run `check-migration-security` and the `platform_audit` pgTAP.

**Added by wave 4.** Each comes from a wave 4 slice report and lands on the PR named.

- **A7: Stellr-host checks.** `e2e/tenancy/host-cases.ts` assigns A7 the Stellr-host rows for `pay`, `pay-seat`, `join` and `confirmation`, which answer today, and for `register/[slug]`, `individual` and `group`, which the harness cannot reach without a CMS. A7 takes each to 0 or an owner approval by route, and names the two-tenant page tests that prove the CMS rows.
- **A8: the staff branch of `lib/group-participant-add.ts`.** Its Member ID link and global lookups join A7 and A8's Member ID gate. C16 makes the `participants` POST answer 503 to a tenant's staff on their own group until this is done; A8 lifts that refusal. S9 lifts it for `invoice` and `finish-setup`, and for the refund preview's empty answer.
- **A10: Stellr-host checks** for the credential page, the survey pages and the team profile (3 rows answer today, 4 give the unknown-record answer). Badge and OG were exercised only with a withdrawn row, so a public live row stays with A10.
- **A12: Stellr-host checks** for `check-in/[slug]` and its code page, one answering and one without a CMS in the harness.
- **Agreement reuse across tenants: no slice yet.** `findValidAgreement` and `recordCoverage` in `lib/docusign-agreements.ts` reuse an agreement by `member_id` with no tenant, and `loadMediaAgreements` follows `reused_from` without one. C16's download route refuses to serve such an original. Name a slice before a tenant's paperwork is live; A11 is the nearest.
- **B5c: the split capture is a one-time proof.** `e2e/tenancy/stellr-document-split.json` is a frozen copy of the head capture at the split, and `e2e/tenancy/document-shape.test.ts` holds base and split equal. A later PR that changes a page's tags regenerates head only.
- **B14, A10, A11: lifting C17's refusals.** The helpers in `lib/events/admin-records.ts` that query without a tenant filter take a `StellrOnlyDb`. A slice that lifts `refuseOutsideStellr` from `payment-link`, `guardian`, the `pd-credentials` POST or `volunteers` gives those helpers real tenant filtering first, or the route answers 500.
- **B16 and tenant surface.** Moving an `app/api/members` route from pending to allow in `lib/tenancy/tenant-surface.ts` also settles its audit chain, which `lib/community/self-service-audit.surface.test.ts` enforces.
- **C8, C25: a Postgres path in the events facade.** When `lib/events/repo.ts` reads from Postgres, `getEventBySlug`, `getEventsBySlugs` and `getEventsByIds` take an explicit tenant id. It comes from the registration or member row, never from request headers or the Host; a missing tenant throws rather than falling back; crons loop over tenants explicitly. A facade test shows a slug shared by two tenants resolving only within the tenant passed in. B19's callers this reaches include the payment-link route (its Stripe price comes from the event), `store/reship`, the `event-emails` cron, `lib/training-reminders.ts`, `lib/admin-digest.ts`, `lib/compliance-notify.ts`, `lib/event-emails/send.ts` and `lib/space-admin.ts`.
- **C16 to C23: `notifyCommunityAdmins`' `tenantId`** comes from the owning row's `tenant_id`, never from request input. Integrity and payment callers (`lib/esign/integrity.ts`, the e-sign heartbeat and bounce paths, the Stripe dispute and refund paths) leave it unwired until the owner decides on a tenant alert contact.
- **S8: per-tenant cron reads keyed on slug.** B13's per-tenant `surveys` and `team-profiles` functions read with the service-role client by `event_slug`, so their isolation rests on slugs being unique across tenants. Before S8 makes slugs unique per tenant, route those reads through `job.scope` (`scopedQuery`), or check each row's `tenant_id` against the job's.
- **Team profiles on tenant events: no slice yet.** `dispatchTeamProfiles`' `participantIds` path (from `lib/esign/completion.ts` and `lib/docusign-agreements.ts`) does not read the registration's tenant, so it does not skip students of inactive tenants and prefills from Stellr's profiles. Correct while only CMS events take profiles. The slice that lets tenant events take them selects `registrations.tenant_id` there and drops inactive tenants' candidates; offered to the tenant-offboarding work.
- **Surveys on tenant events.** The Sanity webhook's survey step still runs for an event B9 skips. Whichever slice covers surveys on tenant events confirms that step.

**Added by wave 5.** Each comes from a wave 5 slice report and lands on the PR named.

- **A8 before routing on any zone (from A7).** Before `TENANT_ROUTING_ENABLED` is set on any deployment with a zone attached, A8 scopes the `app/api/members/teams/**` reads by tenant, so an organiser's team list holds only Stellr's groups on Stellr's hosts, and `changeGroupPaymentMethod` (`lib/group-payment-change.ts`, which since #584 also covers "Invoice for some" and the shared teacher's cost) and the payment-link route refuse a registration that is not Stellr's. A7 depends on this for tenant groups, and these writers need it before any priced tenant event (owner decision, wave 5).
- **Tenant join page: built in A7.** The tenant tree's join page passes `tenantMode`: it always collects the joiner's details, offers no member-profile confirm and makes no exists lookup. The API still answers a details-free join on a tenant event 400 "Please complete your details to join."
- **S8: slugs unique per tenant (from A7).** A7's owner read finds the event's row by the CMS document's id, checks it against the slug's row, and refuses retryably when they disagree; pay-seat reads the owner by slug alone. When `events.slug` becomes unique per `(tenant_id, slug)`, both pick the row by the request's tenant, or a shared slug errors and Stellr's flows answer 503.
- **The signing engine's tenant sender (from B14), nearest slice A11.** `lib/esign` (the reminder path through the outbox) gets a tenant `EventSender` and refuses a tenant envelope that has none, as `lib/event-emails/send.ts` does. Only then may `docusign-reminders` chase a tenant's native envelopes.
- **Lifting C17's refusals on the email routes (from B14).** B14 did not lift `refuseOutsideStellr` on `events/[slug]/emails/[id]/send`, `catch-up`, `preview` or `events/[slug]/remind`. The slice that does passes `loadTenantSender`'s result to `sendEventEmail` and `sendCatchUp`, or the route answers 503. The comments in those routes that say B14 opens them to a tenant are Lane C's to correct.
- **Any new caller of `sendTenantConfirmation` (from B14).** Send only to the address on the saved row, never one from the request body; use a fixed template, never markup from the tenant or the request; and sit behind `lib/rate-limit.ts` per IP and per address or tenant. A7's three callers do. The shared counter never refuses transactional mail, so these rules are what keep one caller from spending the day's sends for everyone.
- **`invoice` alongside `payment-method` (from C16's follow-up).** `app/api/admin/registrations/[id]/invoice` takes the payment-method route's pattern: the stamped-tenant check on the loaded row, and the audit target named before the staff check. Lane C, as a follow-up.
- **C18, the first `tenantDb` area (from C12).** Production code calls `readArea` and `writeArea`, never the `*WithSeams` variants (a `lib/tenancy/db.test.ts` ratchet enforces it). Mismatch records show uuids only unless the area opts in through `showIds`, and a member number or a slug made from a person's name is never the key. Start `events-config:shadow` at a low sample rate and read Active CPU before raising it. `parsePostgresUrl` in `lib/tenancy/driver.ts` checks any other connection string the same way.

**Added by wave 6.** Each comes from a wave 6 slice report or review and lands on the PR named.

- **S7: the stored date of birth on a tenant host (from A7f).** On a tenant host neither the stored date-of-birth comparison nor Stellr's child-awaiting-consent check runs, so a signed-in Stellr minor is held only by the tenant's rules on the date typed, as a signed-out visitor is. S7 brings the comparison back once the profile may be used. Nothing may treat the typed email on these registrations as the session's: they link no member.
- **Any later tenant participant writer (from A16).** The migration's trigger opens a pending consent for any participant under 18 on a tenant event, whoever writes it, but only `register/individual` issues the guardian's envelope. A row opened another way has no envelope: it is held from check-in and tenant event mail. With `TENANT_GUARDIAN_CONSENT_ENABLED` on, the sweep removes it once its window closes, through `executeDeletion`'s guard, which takes a registration only when every participant on it is declined or expired. The sweep runs only with the flag on (`app/api/cron/membership-expiry/route.ts`), and the migration's trigger opens the row whatever the flag says, so with the flag off the row stays pending, the participant stays held, and nothing removes it. Any later slice that lets a tenant write participants issues an envelope for such rows or refuses minors.
- **What the consent trigger does not re-check (from A16).** It fires only on a participant's insert or a change of `date_of_birth` or `registration_id`. Re-owning an event, renaming its slug or changing its start date does not re-check consent. A move onto a Stellr event's registration leaves the old pending row, because the trigger returns before it for a Stellr event, so the participant stays held from check-in until the row goes (tracker `s5-programme.26`).
- **A new Stellr-only route under `events/[slug]` (from Lane C).** A route that acts only on Stellr's accounts, sender or store asks `refuseUnlessStellrEvent` before any read about a person, any email and any envelope, as `remind`, `docusign-reissue`, the guardian route, `offerings` and `merch/commit` do. Moving the check into `requireEventAccess` would cover them all (tracker `s5-programme.28`).
- **C19, after C18.** The service-role baseline no longer names the tables behind `companies`, `offerings` and `merch/commit`, because their queries moved into `lib/events/admin-config.ts` (`test/baselines/service-role-files.json`): C19 checks that the inventory attributes those tables.
- **An admin count of held signing invitations (from B14b).** With the flag on, `drainOutbox` reads only the signers of tenants with a usable sender, so a sender-less tenant's waiting signers are neither read nor counted. `loadTenantSenders` reads every non-Stellr tenant in one unpaged query, which needs paging before the tenant list nears PostgREST's row cap.

**Two different TODO pairs.** Do not conflate them. The snapshot entries in `test/idor/idor-snapshot.json` are on community coaching request and training `[itemId]/flag`. The allow-list entries in `route-guards.ts` are `schools/search` and `store/checkout`. B9 and C6 close the first pair; B15 closes the second.

## Gates

S5 finishes when all of these hold. Each names its proof.

| Gate | Proof |
|---|---|
| Cross-tenant ratchet at 0 | C6: 0 leak, honey_write or 4xx-oracle outcomes for the tenant personas on every `tenant_crew` and `platform_admin` route. `MAX_TENANT_DESTINED_STELLR_ONLY` falls from 52 to 0 through C16 to C21: 21 after C16's payment-method follow-up (wave 5), 18 after C18 (wave 6), and `app/api/admin/event-managers` stays `stellr_only` until C21. `MAX_UNEXERCISED` falls from 5 towards 0. `idor:canary` proves the personas can fail. |
| Tenant-host routes isolate records | C6 for the APIs, B10(c) for the pages: 0 leak, honey_write or 4xx-oracle outcomes on every id-bearing route in `allowedTenantFiles()`, in both directions, Stellr included. An accepted outcome is listed by route with its reason (for example a capability token) and the owner's approval. A green `tenant-host-routing` job does not meet this: the Stellr-host rows in `e2e/tenancy/host-cases.ts` are recorded outcomes, not failures (see [Wave 4 status](#wave-4-status)), so D7's sign-off checks them by route. |
| 100% of mutations audited | C7's enforcing gate over every mutating handler, GET writers included, and the 24 crons (counts in `test/baselines/unaudited-mutations.json`). Every mutating route group now has a claimant: A7, A8, A10 to A14, B12, B16, B18 and C13 to C23. The rest are owner-approved, reasoned exemptions, proposed for `contact`, `subscribe`, `lp-lead`, `white-paper`, `join-network`, `host-event`, `asset-request` and `csp-report`. |
| Host-header spoof | B10(c): forged `X-Forwarded-Host` and `x-stellr-tenant-id` change nothing; `/_t/<slug>` and `/%5Ft/<slug>` 404 on every host, for `stellr` and for another tenant's slug on a foreign tenant host and on the Stellr host, with dotted variants (`x.html`, `x.png`, `x.pngfoo`); an unknown zone host 404s. The harness has no platform in front of it, so it cannot show how forwarding headers are handled on a deployment; a request to the deployed hosts on 8 Nov 2026 confirmed the platform sets them itself. |
| Warm-cache body hash | B10a: flag off and on, the same status, headers and normalised hash for every page under `app/` plus a sample of other routes (167 paths on 5 Nov), and no write added. Signed out and with no records: about 60 paths compare a rendered body (45 on the app host) and the rest compare a redirect or an error. So this says what switching routing on does, not what a code change does, and it says nothing about signed-in bodies or real records. Those are D7's sign-off unless a later slice takes them. B10(b): two non-owner tenants keep their own hashes. |
| 0 trackers, 0 community routes on tenant hosts | B10(d) and B9, with the localhost control proving the test can fail. All 80 community and home entries 404. |
| Under-14 and unknown DOB rejected | A7 by API, A3 by database (23514): a 13-year-old, NULL, future or over-120 DOB, and a registration moved onto a tenant event. In enforce, a tenant slug with no `events` row and no supplied `tenant_id` raises 23503. Stellr 12-year-olds still insert, on a mirrored and an unmirrored event. Since wave 6 (A16), a tenant event's 14 to 17-year-old is admitted only through the guardian-consent flow, behind `TENANT_GUARDIAN_CONSENT_ENABLED`, and a database trigger refuses their check-in until the guardian signs. |
| Authorisation converged | C5a's ratchet reaches 0 by C25. At least 7 clean days of `AUTHZ_SOURCE=shadow` on production before the flip. |
| Data access classified and shrinking | The service-role and events-facade baselines only fall; the facade reaches 0 through C8, A7 and B19. |
| 30-day production checklist | D7's list, signed by the owner, on the converted code. |

## Owner gates

- **Production migrations.** Each of the six above, through `prod-migrate`. B9's CHECK, which also needed the owner's approval of the rule itself, was applied on 9 Nov 2026 with that approval, before #587.
  - **Control item, settled 11 to 12 Nov 2026.** The `prod-migrations` environment's protection rules (`docs/RUNBOOK-agent-controls.md` §3) were set on 11 Nov 2026, before A16 merged to `dev` in #625. A16's dry run on 12 Nov 2026 passed §7's rows 5 and 6. §7's other rows are still to run.
  - **Until §7 records a proof date,** production SQL keeps the interim route in `CLAUDE.md`: the promote skill's Step 3, with the owner's explicit yes on the exact SQL. A16 took that route on 12 Nov 2026 through the Action, the owner approving each run. Proposed for each migration that adds triggers on participants: a fresh production backup first, and a window with no events.
- **S4 state.** Confirm `20261104200000`, `210000`, `300000` and `400000` are on production, and that `tenancy_cutover_checks` Section D shows 0 NULL `tenant_id`, before any area reads through `tenantDb` or `loadScoped` enforce.
- **`tenant_app_login`.** Create on dev, then production; store `TENANT_DATABASE_URL` as a server-only secret. Needed only for a deployed flip, not to build, merge or CI-test. The steps, the URL rules C11's driver enforces, and rotation are in `docs/TENANCY-S5-data.md`. The TLS rule was settled on 10 Nov 2026 and built in C11t: also store the root CA as the server-only secret `TENANT_DATABASE_CA_CERT`, give the URL `sslmode=verify-full`, and see the pooler TLS canary (`scripts/tenant-db-canary.ts`, wave 7's O3) PASS on `dev` before `TENANT_DB_ENABLED` is set. That run is P6, pending, and it decides the PEM. The owner creates the `dev` login (owner decision, 11 Nov 2026).
- **Roles.** Run `scripts/map-tenancy-roles.ts --apply`, decide `--platform-admins`, and decide route by route which of the 9 platform-destined routes become owner-only (class `platform_destined` since C15). After C9, stop assigning `admin` or `event_manager` in the Clerk dashboard, or run `--check` after any change.
- **Environment flips**, each with the rules above: `AUTHZ_SOURCE`, `LOADSCOPED_MODE`, `TENANT_DB_ENABLED` and `TENANT_DB_AREAS`, `PLATFORM_AUDIT_ENABLED` (proposed order and rollback for these four: `docs/TENANCY-S5-data.md`), `TENANT_EVENT_MAIL_ENABLED` (the signing engine's tenant sender it waited on is B14b, on production), `TENANT_GUARDIAN_CONSENT_ENABLED` (after A16's migration, a published consent document and `TENANT_EVENT_MAIL_ENABLED`, and only where Lane C's tenant-event refusals are live in the same environment: `docs/ENV-MATRIX.md`), `RATE_LIMIT_STORE`, `TENANT_ROUTING_ENABLED` and `TENANT_HOST_SUFFIX` (before the zone is attached: see Real tenant hosts). Create `RATE_LIMIT_KEY_SECRET` before any non-memory limiter mode, and flip `RATE_LIMIT_STORE` only after A9 and B15 (`docs/S5-CRONS-LIMITS-SMMA.md`). Add the WAF rules for `/credentials/`, then tenant hosts (`docs/RUNBOOK-waf-rule.md`).
- **Dependencies.** `ts-morph` (dev, C10), or the TypeScript-API fallback. **`postgres` (runtime, C11): approved 9 Nov 2026**, postgres.js, on the terms in the file-ownership table. The login (`tenant_app_login`) and `TENANT_DB_ENABLED` stay separate gates.
- **CODEOWNERS reviews**, `DB_CI_ENFORCE=true`, and the tenant-db job as required, which the owner settled on 10 Nov 2026 for the PR that first wires a live area to `tenantDb` (C18). C18 removed `continue-on-error` from the job (#624), and `dev`'s branch protection now requires `tenant-db` and `db`. Still open: `DB_CI_ENFORCE` is unset, so the `db` job keeps `continue-on-error`, and `main` requires only `verify` and `e2e` (read 12 Nov 2026; `docs/RUNBOOK-ci-database.md`, "Enforcement ledger").
- **`tenant-host-routing` as required: settled 11 Nov 2026 (`W7-8(c)`), built 12 Nov 2026.** B10a landed it report-only. Since B10r (#656) it has no `continue-on-error` and the `e2e` gate fails unless it succeeded, so it blocks a merge through `e2e` while branch protection still names `verify` and `e2e`. Proven by the throwaway PR #657, closed unmerged. Re-check after the GitHub organisation move.
- **Decisions:**
  - the tenant-tree segment (`%5Ft` for `/_t`, or `/t`), because a folder named `_t` is private and never routes;
  - the final allow-list;
  - per-request rendering vs ISR;
  - where tenant staff work;
  - whether `group/route` gets `childAwaitingConsentBlock` (A7 left it without);
  - live tenant events with no start date (A7 refuses everyone for such an event until decided);
  - guardian consent on tenant events: **settled 10 Nov 2026** (see [Owner decisions wave 5 raised](#owner-decisions-wave-5-raised)) and built in A16 behind `TENANT_GUARDIAN_CONSENT_ENABLED`; what remains is under [Owner decisions wave 6 raised](#owner-decisions-wave-6-raised);
  - **the tenant email share: settled 9 Nov 2026.** The owner chose one shared pool, until the move to SES: tenants' event mail counts against the same daily counter in `lib/email-budget.ts` as Stellr's, under the same rules, with no per-tenant allowance. Transactional mail is never refused by the counter, and the transactional reserve keeps bulk mail out, not any one sender. B14 builds on that. The risk the owner accepted: one busy tenant can reach Resend's own daily limit, after which Resend rejects mail for every sender, Stellr included;
  - cron fairness;
  - audit exemptions for anonymous writes;
  - the audit gate's `OPERATIONAL_WRITERS` list (`lib/security/audit-coverage.ts`), a second exemption route, and in it the sign-in consent gate: `childAwaitingConsent` and `childAwaitingConsentBlock` record through the activity log, and whether they also need a platform audit event;
  - the disposition register (51 / 9 / 55 / 16);
  - the refusal copy for under-minimum registrants: **settled 10 Nov 2026** (see [Owner decisions wave 5 raised](#owner-decisions-wave-5-raised));
  - the `proxy.ts` admin prefilter (B20).
- **Real tenant hosts.** The G5 subzone, Vercel Pro (G1), Clerk session sharing and FAPI origins, and the cookie-domain review on `.stellreducation.org`. That review also decides the no-ads marker: since B7 a student who signs in only on a tenant host is not marked for Stellr's www in that browser, so Privacy Policy section 9.4 is not closed for them. **For the dev canary zone** (`.devzone.stellreducation.org`, `W7-24`), the review was done on 13 Nov 2026: safe with conditions (`docs/TENANCY-S5-routing.md`, "The dev canary zone (K6)"), and the no-ads gap is recorded as known and accepted for now, with no setter built (`W7-26`). The production `.events` zone still needs: the production zone guard (`W7-27`) on production (built, not promoted), the privacy-notice point for the GTM, GA and HubSpot cookies those hosts receive, and the no-ads question again.
  - **Order on each Vercel project.** Set the flag and suffix, redeploy, confirm through the health check that `suffixError` is null, then attach the wildcard domain. Then check straight away that an unknown host in the zone answers 404, and detach if it does not. The review put that 404 check before the attach, but Vercel does not route the host to the deployment until the domain is attached.
  - **Why the order matters.** With the flag off, the resolver says Stellr, and `proxy.ts` compares the host only to `APP_HOST`. A tenant hostname would get the full Stellr surface: `/admin`, community and trackers. The same happens if the suffix does not cover the zone.
  - **Rollback.** Detach the zone first, then flip the flag.
  - **Before any real zone gets the routing flag (wave 4):** B6's canary checks pass (one enforcing policy on `/sign` and `/survey/x`, and Clerk sign-in, sign-up with Turnstile and a signed-in registration with 0 violations), and the icon and manifest decision is made.
  - **Before any non-owner tenant has records on production:** A7, A10 and A12 land, since B10(c) assigns them the Stellr-host rows. Production data was not checked for this.
- **Witnessed.** The parity query (`events` where the local start date differs from `raw->>'date'`; expect 0), and one real Stellr registration on `dev` for each of individual, group by invoice, group by card, and group-join before promoting A4 to A6. The registrations were waived by the owner on 5 Nov for #548 and none was witnessed; the parity query still needs the events mirror backfilled on production.
- **Sign-offs.** The S3 `derivation_mode` enforce flip after A7, A8, B16 and C20 and 7 clean days, and before the first non-owner event on production, because A3 relies on it; the SMMA memo; D7, including the steps wave 4 adds (see [Docs owed after wave 4](#docs-owed-after-wave-4)). `tenant-host-routing` is now required through `e2e`, but the Stellr-host rows in `e2e/tenancy/host-cases.ts` are recorded outcomes, not failures, so nothing mechanical fails while they remain open: a person checks them at sign-off.

The `via_parent` follow-up is no longer an owner gate: it is code plus a migration, in C0b. The owner only approves its production apply.

## Risks to keep in view

- **`_t`.** `app/_t` silently 404s. The tree is `app/%5Ft`, and the direct-request 404 matches `/_t`, `%5Ft` and `%5ft`, dotted paths included (B5).
- **Active CPU.** Nothing may add a database call to `proxy.ts` for Stellr hosts. The zone check is string work. Shadow reads are sampled and limited to admin (corrected in wave 2: `lib/authz.ts` has no sampling). With `PLATFORM_AUDIT_ENABLED` on, each audited member or community request adds an `auth()` call and an `after()` write (B16), and the 29 C13 pilot routes load the mailer at import through the audit failure path. A `TENANT_DB_AREAS` shadow sample adds a transaction after the response for each sampled call (C12).
- **Clerk roles span subdomains.** `/admin` is a 404 on tenant hosts until `lib/authz` membership checks and S6 MFA exist.
- **Partial state in `register/group`.** A7 refuses in the gate, before the first write; A6 pins that every person with a row passes that point.
- **Stellr stamps and NULL `tenant_id`** while S3 derivation is in log mode. Log mode does not leave a new derived row NULL: when it cannot derive a tenant it stamps Stellr, and only the `no_event` log entry tells that row from a real Stellr row. NULL remains on rows the backfill has not reached, and a strict filter would hide them. `loadScoped` and `stellrScope` match NULL in Stellr scope until Section D shows 0 NULL for 7 days.
- **Stellr-only crons.** `weekly-digest`, `background-sync`, `training-reminders` and `docusign-form-data` would leak tenant data into Stellr email once a second tenant exists, and `hubspot-event-options` would write a tenant's events to Stellr's portal. B11 limits them; it lands before any tenant event. `membership-expiry` stays wide on purpose: its reads only hold an account back from deletion (`lib/cron-scope.ts`, `identityRead`).
- **A tenant event's mirror row comes first.** Until S8 gives an event an owner, B11 and the derivation trigger learn the owner from `public.events`, and an event with no row counts as Stellr's. So before a tenant's Sanity document is first published, its mirror row must exist. Otherwise that first publish reaches Stellr's HubSpot portal, and its Space is stamped Stellr. Containers made by `lib/container-sync.ts` have no `sanity_event_id`, so they are stamped Stellr whatever event they serve: B11 matches them by `campaign_ref`, and any new reader must too. B9's CHECK does not cover the unmirrored case either: that first publish also takes an unadopted Stellr Space with the same slug, strips its tier and role grants, links it, copies the roster into it and fires the `object_created` rules, and nothing refuses the write, because the row is stamped Stellr and passes the check. The mirror row coming first is the only protection there. One narrow window remains: if the mirror row appears between `syncEventSpace`'s read and its Space write, the slug repair and the Stellr-stamped container have already run when the 23514 stops the sync. No tenant event exists today.
- **`public.events` now has live readers.** The migration's table comment says none depends on it. The HubSpot option sync, the weekly digest and `training-reminders` read it (B11), and each fails closed if the read fails: the sync refuses and writes nothing, the digest reports the section, and the reminder run records a failure. The next run catches up. Wave 4 adds three more: `syncEventSpace` (B9) fails the sync, so the Sanity webhook answers 500 and Sanity's retry and `sync:event-spaces` catch up; event-email managers (B17) are treated as a Stellr event's on a failed read, so only Stellr-stamped or unstamped assignments are kept; and under `AUTHZ_SOURCE=shadow` C17's routes read the event for their comparison. Wave 5 adds the busiest: A7's register, pay and pay-seat routes read the event's owner on every request, and a failed read answers a retryable 503, so a mirror outage now stops registration and payment until it recovers.
- **Async limiter.** An un-awaited `rateLimit()` is a truthy Promise that blocks every request. A distributed limiter is stricter than per-instance counting, so venue Wi-Fi could hit 429 at check-in: shadow first, flip outside events. Keys hold IPs and minors' names, so they are HMAC-hashed under a dedicated secret. Since A9, every new key is a new store row, so a key suffix the client chooses (a slug, a token) draws on a per-route budget of 2,000 store calls per IP per hour per instance, past which that IP counts in memory only. The budget slows row writes; a client rotating addresses, IPv6 within a prefix included, is not held by it. `limit()` has no budget, so check-in's by-name count always reaches the store in shadow and `postgres` modes.
- **Audit is not atomic.** It writes through a separate service-role RPC. Live paths use `runAfterResponse`, which can be lost if the instance is reclaimed.
- **Bypasses on tenant hosts.** Static `public/` assets, the webmanifest and `/api/img` skip the proxy and stay Stellr-branded; any other path with a static extension anywhere skips it too, allow-list included (B5, B10(c)); the 21 unscoped `next.config` redirects fire before the allow-list; every `domain=.stellreducation.org` cookie reaches a tenant host. That last one is a privacy-notice point. Since B5c and B6:
  - A URL no file or page answers, on a host outside Stellr's list, reaches the tenant tree's catch-all through a fallback rewrite in `next.config.mjs`, whose destination names no real tenant and carries no part of the path. On a tenant host a static-extension path gets the page policy from the proxy. A miss under `/_next`, `/api/img` or `/api/csp-report` gets that 404 with the fixed no-script header and no nonce, so the tree's layout and 404 must hold no tenant or request data. A later slice that brands them moves those paths behind the proxy or adds a scoped rule.
  - Tenant pages link Stellr's favicon, icons and a manifest named Stellr Education, because those files sit above both roots: an owner decision from wave 4.
  - Any new Stellr domain must join the host list in `proxy.ts`'s matcher, which `stellrHostsPattern()` in `next.config.mjs` follows; otherwise its misses get the tenant tree's 404.
