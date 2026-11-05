# Tenancy S5: plan of record

Stage 5 of the multi-tenancy plan converts the app to tenancy and moves authorisation onto one API, while Stellr runs as tenant #1 with no visible change (M1). This file says who owns what, what may merge when, how migrations are numbered, and which counts to trust.

It merges the six S5 area analyses with the review that followed them, at `dev` `c1e41eb8` (4 Nov 2026). Where this file disagrees with the plan or the scoping output, this file wins. Where it disagrees with a committed baseline (`test/baselines/**`), the baseline wins. Where it departs from the review, it says so and why.

Sibling records: `docs/TENANCY-S3.md`, `docs/TENANCY-S4.md`, `docs/S4-SPIKE.md`, `docs/TENANCY-S5-routing.md` (D2), `docs/AUTHZ.md` (D3), `docs/TENANCY-S5-registration.md` (D5), `docs/TENANCY-S5-flow-checklist.md` (D7). Later Lane D PRs add the data and cron records (D4, D6). What wave 2 built, and what it corrected here, is under [Wave 2 status](#wave-2-status).

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

Every runtime change sits behind a default-off flag: `TENANT_ROUTING_ENABLED`, `AUTHZ_SOURCE=clerk`, `LOADSCOPED_MODE=off`, `TENANT_DB_ENABLED` off, `RATE_LIMIT_STORE=memory`, `PLATFORM_AUDIT_ENABLED` off. Where it cannot be, it must be provably a no-op for Stellr: a platform-owner early return, the Stellr-or-NULL tenant filter, or the zone-suffix string check.

## Lanes and file ownership

Lanes split by file ownership, not by mechanism. A file has one owner. Any `lib/**` file or root config file nobody claims belongs to Lane C.

### Lane A: participant flows and registration

- `app/api/register/**` (sole owner), `app/(flow)/**`, `app/(public)/credentials/**`
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
- `app/%5Ft/**` (the tenant tree), `app/layout.tsx` (B5c), `app/(public)/**` except `credentials/**`, `app/(auth)/**`, `app/(member)/**` except `app/(member)/layout.tsx`, `app/sitemap.ts` and the metadata routes
- `components/analytics/**`, `lib/analytics.ts`
- `lib/community.ts`, `lib/community/**`, `lib/member-session.ts`, `lib/event-participation-sync.ts`, `lib/auto-membership-grant.ts`, `lib/notify.ts`, `lib/email.ts`, `lib/event-emails/**`, `lib/email-budget.ts`
- `lib/event-space-sync.ts`, `lib/spaces*.ts`, `lib/space-*.ts`, `lib/resource-upload.ts`, `lib/resource-finalise.ts`, `lib/mentoring.ts`, `lib/coaching.ts`, `lib/container-sync.ts`
- `lib/cron.ts`, `lib/cron-runs.ts`, `lib/cron-tenants.ts`, `lib/cron-scope.ts`, `app/api/cron/**`
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
- `app/api/admin/**`, `app/(admin)/**`, `app/(member)/layout.tsx`, `components/layout/NavUserButton.tsx`, `app/api/store/returns/route.ts`
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
| `package.json`, `package-lock.json` | C | No new dependency without the owner's approval. The only two proposed are `ts-morph` (C10) and `postgres` (C11), each exact-pinned, at least 2 weeks old, installed with `--before`. |
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
| C0b | the S4 `via_parent` follow-up | `tenant_id` plus composite FK on the 10 `child()` tables. Created after A3. |
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
| Manifest `tenant_staff`, `platform_admin` | 0 | **0** | same | Checked |
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

**Stale in code, for Lane C to fix:** the `API routes (305)` header in `route-manifest.ts` (there are 306), and the IDOR doc and `MIN_TARGETS` comment that still say 226 and 130.

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
| A8 + | Other participant writers: team-leader add and edit, roster sheet import | A2, A3, A7 | later |
| A9 + | Async rate-limiter adoption | B4, C5b | later |
| A10 + | Data conversion: credentials, surveys, team profiles, volunteer interest | C0b, C7, C11, C12 | later |
| A11 + | E-sign participant side | A10, C0b, C12 | later |
| A12 + | Check-in participant side | A10, C0b, C12 | later |
| A13 | Stripe and webhook handlers: audit actors, tenant resolution | A7, C7 | later |
| A14 + | Audit sweep: `consent/request`, `uploads/sign` | C7 | later |

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
| B11 | Stellr-only crons limited to Stellr data; `maxDuration` on all 22 | B3 | later |
| B12 | Cron audit hook | B3, C7 | later |
| B13 | Per-tenant surveys, team-profile and survey-retention crons | B3, B11 | later |
| B14 | Per-tenant event emails and e-sign reminders, tenant email share | B3, B11 | later |
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
| C12 | Per-area switch, shadow compare, two-tenant kit | C7, C11 | later |
| C13 + | Pilot: Stellr-only community, academy, training, coaching, entitlements admin | C5a, C7, C10 | later |
| C14 + | Admin shell, view-as, staff-target checks | C1, C5a | later |
| C15 + | Platform-destined routes reclassified, guard unchanged | C6, C7, C9, C14 | later |
| C16 | Events admin T2: records by id inside an event | C3, C6, C7, C9, C14 | later |
| C17 | Events admin T1a: paperwork and communications | C8, C16 | later |
| C18 | Events admin configuration, first `tenantDb` area | C12, C17 | later |
| C19 | Events credentials, artwork, admin check-in | C18 | later |
| C20 | Scholarships, refund policies, refunds, group invoices | C18 | later |
| C21 | Members, people and access admin | C9, C13, C14 | later |
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
| D4 | Data, `loadScoped` and audit runbook; route-manifest doc | C3, C7, C11 | later |
| D5 | Registration eligibility record | A3 | later |
| D6 | Crons, limiter and SMMA record; WAF runbook; SMMA memo | B3, B4, B8 | later |
| D7 + | 30-day Stellr flow checklist | | later |

**D7** lists each flow, its evidence source and a sign-off row: individual registration; group by invoice and by card; group-join; signing; survey; the check-in desk and QR; credentials; refunds; scholarship; the admin event screens; and each of the 22 crons. The sign-off itself is the owner's, at M1. The list is `docs/TENANCY-S5-flow-checklist.md`.

## Wave 2 status

On 5 Nov 2026. **Merged** means squashed into `dev`, one PR per lane: Lane A #540, Lane B #534, Lane C #535. Nothing here is on production. Every PR not listed is still to build.

| PR | State | Flag, or why it is a no-op for Stellr |
|---|---|---|
| A0 + | Merged. Added for the wave 1 `KNOWN DEFECT` tests | A defect fix: register routes fail closed on a failed read. Stellr sees a change only when a read has already failed |
| A3 | Merged | Platform-owner early return. One added lookup per participant write, and a failed read fails the write |
| A4, A5, A6 | Merged | Pure refactors, pinned by branch tests that passed on the unsplit routes first |
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
| D2, D3, D5, D7 | This docs PR | Docs |

**Migrations, stamped.** All five are on the `dev` database, with the ledger re-read after applying. None is on production: each needs the owner's approval, and must land before the code that needs it (see [Migrations](#migrations)).

| PR | File |
|---|---|
| B3 | `20261105005751_cron_runs_tenant.sql` |
| A3 | `20261105041211_participants_eligibility.sql` |
| B4 | `20261105042629_rate_limit.sql` |
| C7 | `20261105052154_platform_audit_webhook_actor.sql` |
| A6 + | `20261105131500_participants_details_from_member.sql`. `GET /api/members/teams` names this column, so it must reach production before Lane A's code |

**Proven on `dev`.** pgTAP passed on all five in CI's `db` job, and B4's race test passed. B5's host-keyed matcher entry passed its live check on the `dev` alias (`docs/TENANCY-S5-routing.md`).

**Not yet proven.**

- The real-registration witness for A4 to A6 (see [Owner gates](#owner-gates)) is still owed.
- The team page's linked-row view has unit tests only. It has not been opened in a browser.

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
- **C6.** The old "`tenant_staff` and `platform_admin` are empty" assertions are gone. A static rule stops a `tenant_staff` file calling `.from()` directly on a table with a tenant column.

### Owner decisions wave 2 raised

On top of [Owner gates](#owner-gates).

| From | Decision |
|---|---|
| A3 | When a tenant tightens an event and an existing participant no longer qualifies: keep refusing the change, or apply it to new writes and report them to staff. Settle before the first tenant event |
| A0, A4, A5 | Several decisions on how the register routes treat an existing member's record and what they answer. The slice reports hold the detail. It stays out of this file because the repo is public and the behaviour is live |
| B0 | C4-F5, the store catalogue: give it a tenant, or accept the outcome with a written reason. And the access rule for a library file that has lost its last attachment. The slice report holds the detail |
| B3 | `alumni-upgrades`, `campaigns`, `campaign-drip` and `campaign-events` pick people from shared `members` with no tenant limit, and no slice claims this. Once tenant registrants exist as members they could receive Stellr marketing or Alumni grants. Name a slice, or record that it is acceptable |
| B3 | Retention for inactive tenants: `survey-retention` is assumed to keep running for them |
| B4 | Whether the nightly backup holds the hashed limiter counters: exclude `rate_limit_hits` from `ops/backups/backup.sh`, or keep them and say so in `docs/RUNBOOK-backups.md` |
| B5 | Before any promotion carrying B5: accept the host-keyed matcher entry. Its live check passed on the `dev` alias on 5 Nov |
| B5 | Add to `Real tenant hosts`: `TENANT_ROUTING_ENABLED` stays off for any deployment with a zone attached until B5c and B10(d) pass, and A7, C6 and B10(c) pass |
| C5a | Turn on the required code-owner ruleset. `.github/CODEOWNERS` only requests review until then. And confirm a PR label is enough to raise a ratchet |
| C6 | Whether per-route lists of differing refusals stay in the public repo, or become totals and a hash of the list. A CI artifact is not an option, because artifacts on a public repo are public. And which capability-token outcomes to accept before the S5 gate |
| C9 | Run `--check` on `dev`, then production, before shadow, and decide what to do with any stale rows. Confirm a Clerk revoke through `set-admin` should go ahead when the Postgres write is refused |

### Docs still owed

- **D4:** `docs/SECURITY-route-manifest.md` still says `platform_admin` and `tenant_staff` need "an admin check" and that a test asserts they are empty. C5a and C6 changed both. D4's data and audit runbook is also still to write, and `LOADSCOPED_MODE`, `TENANT_DB_ENABLED` and `PLATFORM_AUDIT_ENABLED` point to it from `docs/ENV-MATRIX.md`.
- **D6:** the crons, limiter and SMMA record, and the WAF runbook.

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
- Audit covers the Stellr path too: all 5 register routes, through `auditMutation` and `runAfterResponse`, with `PLATFORM_AUDIT_ENABLED` off by default. A4 to A6 stay pure refactors.
- The events-facade codemod runs on every Lane A importer, not only the 5 register routes. That includes the 9 `app/(flow)` importers and Lane A's `lib/` files.

**A8.** Also audits all 5 mutating `app/api/members/teams/**` files: B16 excludes them and no other PR claims them. These writers supply `tenant_id` explicitly, as A7's do. Handle the existing-row update as well as the insert: `update(payload)` in `lib/sheet-participant-sync.ts` (lines 187 and 210, the existing-row and raced branches) ignores its error, so a 23514 from A3's `UPDATE OF date_of_birth` trigger would vanish. The 6 other files that update `participants` (`lib/agreement-correction.ts`, `team-profile/assign.ts` and `override.ts`, check-in, and the admin guardian, companies and check-in routes) must not touch `date_of_birth` or `registration_id`, or they need the same handling.

**A10, A12.** Use `lib/team-profile/`, not `lib/team-profiles/`. The scoped `lib/credentials/data.ts` and `lib/check-in/data.ts` collide with the existing files, so use the non-colliding paths above.

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

**B5c.** `app/layout.tsx` wraps the `/_t` tree too. A nested layout cannot remove head JSON-LD, and the un-nonced `ConsentMode` inline script would break under B6's enforcing CSP. The gate is B10a's body hash, flag off and on, over all 158 pages.

B7 does not stop that head script. Until B5c lands it still runs on a tenant host: it creates `window.dataLayer`, replays a stored choice and shows the banner at first paint, with no network request. B7's test walks only `app/%5Ft`, so it does not see this. B5c adds an assertion that the tenant layout's parent chain holds neither `ConsentMode` nor `SiteTracking`. No real zone gets the routing flag before B5c.

**B8.** `lib/community/event-hooks.ts` also wraps `syncObjectSpaceRoster` and `reconcileEventSpaceRoster` (`lib/space-inheritance`), `autoGrantBaseMembership` (`lib/auto-membership-grant`, now Lane B) and `linkMembersToSchoolByName`. `syncMemberOptionSelections` is imported by the same route and has no decision yet: B8 either wraps it or says why not.

**B9.** Four tables, not two. Closing the two community `TODO(S5)` snapshot entries points at the coaching request and training item-flag routes.

**B10.** (b) seeds a second non-owner tenant (for example `canary-b.localhost`) and alternates between the two non-owner tenants. Alternating with `stellr.localhost` passes vacuously: Stellr is never rewritten into `/_t`, and with B6 every tenant page renders per request. If ISR stays an owner option, also run once in ISR mode. (c) also tries a denied path with a dotted suffix on a tenant host, and names host B's slug and token on host A's pages, in both directions. (d) counts third-party requests, and also asserts no hydration error, no `window.dataLayer` and no cookie banner, so it covers the head script as well as the five trackers.

**C5.** Split so the audit chain does not wait on the rate limiter for no functional reason. C6 depends on C5a only.

**C6.** Scoped with staff personas only, and with the oracle "enforced for those classes and reported for the others". But admin is denied on tenant hosts. The routes tenant hosts do serve are participant or public class, and they are global today. So C6 also runs an anonymous and a participant persona over every id-bearing route in B2's `allowedTenantFiles()`, on host A naming host B's slug, token, envelope and credential number, in both directions, Stellr included, and it enforces the oracle there. These routes start above 0, so they get a generated cap that only falls, through A7 and A10 to A12. Those PRs' own tests do not replace this: A7's covers one direction for register only, and the two-tenant tests in A10 to A12 prove refusal, not that a 404/403 difference hides the record.

**C7.** Scoped as no migration, but `platform_audit_events` and `ActorKind` in `lib/audit/platform.ts` accept only `user`, `system` and `cron`, so `webhook:<provider>` actors would be refused. Re-run `check-migration-security` and the `platform_audit` pgTAP.

**Two different TODO pairs.** Do not conflate them. The snapshot entries in `test/idor/idor-snapshot.json` are on community coaching request and training `[itemId]/flag`. The allow-list entries in `route-guards.ts` are `schools/search` and `store/checkout`. B9 and C6 close the first pair; B15 closes the second.

## Gates

S5 finishes when all of these hold. Each names its proof.

| Gate | Proof |
|---|---|
| Cross-tenant ratchet at 0 | C6: 0 leak, honey_write or 4xx-oracle outcomes for the tenant personas on every `tenant_staff` and `platform_admin` route. `MAX_TENANT_DESTINED_STELLR_ONLY` falls from 52 to 0 through C16 to C19. `MAX_UNEXERCISED` falls from 5 towards 0. `idor:canary` proves the personas can fail. |
| Tenant-host routes isolate records | C6 for the APIs, B10(c) for the pages: 0 leak, honey_write or 4xx-oracle outcomes on every id-bearing route in `allowedTenantFiles()`, in both directions, Stellr included. An accepted outcome is listed by route with its reason (for example a capability token) and the owner's approval. |
| 100% of mutations audited | C7's enforcing gate over every mutating handler, GET writers included, and the 22 crons (counts in `test/baselines/unaudited-mutations.json`). Every mutating route group now has a claimant: A7, A8, A10 to A14, B12, B16, B18 and C13 to C23. The rest are owner-approved, reasoned exemptions, proposed for `contact`, `subscribe`, `lp-lead`, `white-paper`, `join-network`, `host-event`, `asset-request` and `csp-report`. |
| Host-header spoof | B10(c): forged `X-Forwarded-Host` and `x-stellr-tenant-id` change nothing; `/_t/<slug>` and `/%5Ft/<slug>` 404 on every host, for `stellr` and for another tenant's slug on a foreign tenant host and on the Stellr host, with dotted variants (`x.html`, `x.png`, `x.pngfoo`); an unknown zone host 404s. |
| Warm-cache body hash | B10a: flag off and on, identical normalised hash across all 158 pages. B10(b): two non-owner tenants keep their own hashes. |
| 0 trackers, 0 community routes on tenant hosts | B10(d) and B9, with the localhost control proving the test can fail. All 80 community and home entries 404. |
| Under-14 and unknown DOB rejected | A7 by API, A3 by database (23514): a 13-year-old, NULL, future or over-120 DOB, and a registration moved onto a tenant event. In enforce, a tenant slug with no `events` row and no supplied `tenant_id` raises 23503. Stellr 12-year-olds still insert, on a mirrored and an unmirrored event. |
| Authorisation converged | C5a's ratchet reaches 0 by C25. At least 7 clean days of `AUTHZ_SOURCE=shadow` on production before the flip. |
| Data access classified and shrinking | The service-role and events-facade baselines only fall; the facade reaches 0 through C8, A7 and B19. |
| 30-day production checklist | D7's list, signed by the owner, on the converted code. |

## Owner gates

- **Production migrations.** Each of the six above, through `prod-migrate`. B9's CHECK also needs the owner's approval of the rule itself.
- **S4 state.** Confirm `20261104200000`, `210000`, `300000` and `400000` are on production, and that `tenancy_cutover_checks` Section D shows 0 NULL `tenant_id`, before any area reads through `tenantDb` or `loadScoped` enforce.
- **`tenant_app_login`.** Create on dev, then production; store `TENANT_DATABASE_URL` as a server-only secret. Needed only for a deployed flip, not to build, merge or CI-test.
- **Roles.** Run `scripts/map-tenancy-roles.ts --apply`, decide `--platform-admins`, and decide route by route which of the 9 platform-destined routes become owner-only. After C9, stop assigning `admin` or `event_manager` in the Clerk dashboard, or run `--check` after any change.
- **Environment flips**, each with the rules above: `AUTHZ_SOURCE`, `LOADSCOPED_MODE`, `TENANT_DB_ENABLED` and `TENANT_DB_AREAS`, `PLATFORM_AUDIT_ENABLED`, `RATE_LIMIT_STORE`, `TENANT_ROUTING_ENABLED` and `TENANT_HOST_SUFFIX` (before the zone is attached: see Real tenant hosts). Create `RATE_LIMIT_KEY_SECRET` before any non-memory limiter mode. Extend the WAF rule to `/credentials/`, then tenant hosts.
- **Dependencies.** `postgres` (runtime, C11) and `ts-morph` (dev, C10), or the TypeScript-API fallback.
- **CODEOWNERS reviews**, `DB_CI_ENFORCE=true` and the tenant-db job as required.
- **Decisions:**
  - the tenant-tree segment (`%5Ft` for `/_t`, or `/t`), because a folder named `_t` is private and never routes;
  - the final allow-list;
  - per-request rendering vs ISR;
  - where tenant staff work;
  - whether `group/route` gets `childAwaitingConsentBlock`;
  - live tenant events with no start date;
  - the tenant email share (blocks B14);
  - cron fairness;
  - audit exemptions for anonymous writes;
  - the audit gate's `OPERATIONAL_WRITERS` list (`lib/security/audit-coverage.ts`), a second exemption route, and in it the sign-in consent gate: `childAwaitingConsent` and `childAwaitingConsentBlock` record through the activity log, and whether they also need a platform audit event;
  - the disposition register (51 / 9 / 55 / 16);
  - the refusal copy for under-minimum registrants;
  - the `proxy.ts` admin prefilter (B20).
- **Real tenant hosts.** The G5 subzone, Vercel Pro (G1), Clerk session sharing and FAPI origins, and the cookie-domain review on `.stellreducation.org`. That review also decides the no-ads marker: since B7 a student who signs in only on a tenant host is not marked for Stellr's www in that browser, so Privacy Policy section 9.4 is not closed for them.
  - **Order on each Vercel project.** Set the flag and suffix, redeploy, confirm through the health check that `suffixError` is null, then attach the wildcard domain. Then check straight away that an unknown host in the zone answers 404, and detach if it does not. The review put that 404 check before the attach, but Vercel does not route the host to the deployment until the domain is attached.
  - **Why the order matters.** With the flag off, the resolver says Stellr, and `proxy.ts` compares the host only to `APP_HOST`. A tenant hostname would get the full Stellr surface: `/admin`, community and trackers. The same happens if the suffix does not cover the zone.
  - **Rollback.** Detach the zone first, then flip the flag.
- **Witnessed.** The parity query (`events` where the local start date differs from `raw->>'date'`; expect 0), and one real Stellr registration on `dev` for each of individual, group by invoice, group by card, and group-join before promoting A4 to A6.
- **Sign-offs.** The S3 `derivation_mode` enforce flip after A7, A8, B16 and C20 and 7 clean days, and before the first non-owner event on production, because A3 relies on it; the SMMA memo; D7.

The `via_parent` follow-up is no longer an owner gate: it is code plus a migration, in C0b. The owner only approves its production apply.

## Risks to keep in view

- **`_t`.** `app/_t` silently 404s. The tree is `app/%5Ft`, and the direct-request 404 matches `/_t`, `%5Ft` and `%5ft`, dotted paths included (B5).
- **Active CPU.** Nothing may add a database call to `proxy.ts` for Stellr hosts. The zone check is string work. Shadow reads are sampled and limited to admin.
- **Clerk roles span subdomains.** `/admin` is a 404 on tenant hosts until `lib/authz` membership checks and S6 MFA exist.
- **Partial state in `register/group`.** A7 refuses in the gate, before the first write; A6 pins that every person with a row passes that point.
- **Stellr stamps and NULL `tenant_id`** while S3 derivation is in log mode. Log mode does not leave a new derived row NULL: when it cannot derive a tenant it stamps Stellr, and only the `no_event` log entry tells that row from a real Stellr row. NULL remains on rows the backfill has not reached, and a strict filter would hide them. `loadScoped` and `stellrScope` match NULL in Stellr scope until Section D shows 0 NULL for 7 days.
- **Stellr-only crons.** `weekly-digest`, `background-sync`, `membership-expiry`, `training-reminders` and `docusign-form-data` would leak tenant data into Stellr email once a second tenant exists. B11 lands before any tenant event.
- **Async limiter.** An un-awaited `rateLimit()` is a truthy Promise that blocks every request. A distributed limiter is stricter than per-instance counting, so venue Wi-Fi could hit 429 at check-in: shadow first, flip outside events. Keys hold IPs and minors' names, so they are HMAC-hashed under a dedicated secret.
- **Audit is not atomic.** It writes through a separate service-role RPC. Live paths use `runAfterResponse`, which can be lost if the instance is reclaimed.
- **Bypasses on tenant hosts.** Static `public/` assets, the webmanifest and `/api/img` skip the proxy and stay Stellr-branded; any other path with a static extension anywhere skips it too, allow-list included (B5, B10(c)); the 21 unscoped `next.config` redirects fire before the allow-list; every `domain=.stellreducation.org` cookie reaches a tenant host. That last one is a privacy-notice point.
