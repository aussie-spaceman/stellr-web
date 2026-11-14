# S5 multi-tenant programme — 2026-11-11

Slug: `s5-programme`. Handover: `HANDOVER-s5-session-transfer-2026-11-10.md` (public copy; the full one is private). Doc snapshot: none.
PR #… → `dev` as `<sha>`; promotion not needed (docs only). Migration: none.

One list of the open Stage 5 items after the move to the new Claude account, seeded from the 11 Nov review of the whole programme and deduplicated. Each row names the gate it blocks and who owns the next step. On 11 Nov, production (`main`) is `3d90a6dd` (#612) and carries S5 waves 1 to 5 and wave 6 Lane B (B14b); wave 6 Lanes A, C and D are not on `dev`. Later on 11 Nov, Lanes C (#624), A (#625) and D (#637) landed on `dev`, not on production. On 12 Nov, A16 was applied to production and #643 (`5d18d321`) promoted Lanes A and C with Lane D's docs. Every tenancy switch is off, and every event and record belongs to Stellr, so no item below that is gated on a switch or on a second tenant is reachable today. The plan of record is `docs/TENANCY-S5.md`.

**13 Nov 2026 (docs train D3).** The owner answered the open wave 7 questions in chat; each is in `docs/S5-DECISION-REGISTER.md` (`W7-14`, `W7-17` to `W7-24`, `W7-32`, and the PR-review rows dated 13 Nov; `W7-25` to `W7-31` came from the cookie review and were answered the same day, "Accept all seven"; `W7-27`, the production zone guard, is built as a small wave 7 slice). On the programme items, the owner said to proceed with the recommendations (`W7-32`): the rows below carry them as next steps, not as done, and **every production action still needs the owner's own yes at the time.** `dev` is at `bac59d66`; wave 7's batches 1 to 4, the survey hold #661 and D2 #662 are merged, and #665 to #671 were merged later on 13 Nov 2026.

**14 Nov 2026 (backlog batch 1 record).** Wave 7, with #675 and #677, reached production in #680 (`fba19669`, 14 Nov 2026 UTC); `dev` is at `1d9b6977`. Batch 1 of the 14 Nov review's backlog opened 24 PRs into `dev` (#687 to #710), none merged and nothing applied to any database: the four S5 slices are rows `.49` to `.51` and the State of `.12`, `.20`, `.25`, `.26` and `.29`; the other 20 are in `2026-11-14-backlog-batch1.md`. The Closes section below also records the review's "done but not ticked" rows, each with its evidence, and restates the 13 Nov closes in the form `scripts/tracker.mjs` reads (one id per bullet, then a colon).

Gates used below: **Lane A/C → `dev`** (the wave 6 PRs); **A16 → production** (the promotion that carries Lane A's migration); **consent flag on** (`TENANT_GUARDIAN_CONSENT_ENABLED`); **`TENANT_DB_ENABLED` on**; **routing on a zone** (`TENANT_ROUTING_ENABLED` with a zone attached); **first non-owner tenant** (an active tenant other than Stellr with records on production); **S5 sign-off** (the gates and checklist in `docs/TENANCY-S5.md`, Gates).

| # | Item | Gate it blocks | Owner | State | Next | Done |
|---|---|---|---|---|---|---|
| s5-programme.1 | Approval step on the production migration Action | Any PR that adds a migration merges to `dev` (A16 first) | owner | Set on 11 Nov 2026 as `docs/RUNBOOK-agent-controls.md` §3 describes. On 12 Nov 2026 A16's dry run waited on it for about 21 minutes until the owner approved (§7 row 5, passed) | None. §7's other rows are still to run before a proof date is written | ☑ |
| s5-programme.2 | Agent permission rules for running or approving the production migration Action | Same as `.1` | owner | Open owner action. Agent permission settings are the owner's to change | The owner reviews the rules | ☐ |
| s5-programme.3 | Production route for A16 | A16 → production | owner | Interim route, through the Action: the owner approved the exact file and each run (dry run 43152631990, then 43157319187), 12 Nov 2026 | None | ☑ |
| s5-programme.4 | Database tests able to block a merge | Lane A → `dev` | owner | Branch protection read 12 Nov 2026: `dev` requires `verify`, `e2e`, `db` and `tenant-db`; `main` requires `verify` and `e2e`. `DB_CI_ENFORCE` is unset, so `db` keeps `continue-on-error` and its step outcomes must be read (`docs/RUNBOOK-ci-database.md`, Enforcement ledger) | Proceed (`W7-32`): set `DB_CI_ENFORCE=true` and require `db`, each with the owner's yes. Until then, a PR is read by the `db` job's step outcomes | ☐ |
| s5-programme.5 | `tenant-db` as a required check | C18 (settled 10 Nov) | owner | Required on `dev` (branch protection read 12 Nov 2026), not on `main`. No `continue-on-error` since #624 | Proceed (`W7-32`): add `tenant-db` to `main`'s branch protection, with the owner's yes | ☐ |
| s5-programme.6 | Whether `tenant-host-routing` becomes required | Routing on a zone | owner | Done: required through the `e2e` gate since B10r #656 (`79a58c96`, 12 Nov 2026, owner decision `W7-8(c)`). Proven by throwaway PR #657, closed unmerged: one failing tenant-host test turned `e2e` red. Re-read 13 Nov 2026 at `bac59d66`: the job has no `continue-on-error`, `test/ci-tenant-host-routing-required.test.ts` holds that, and `dev`'s required checks are `verify`, `e2e`, `db` and `tenant-db` | None here. After the GitHub organisation move (`.47`), re-check it, and pin the required jobs' Actions to SHAs (`PR656-1`) | ☑ |
| s5-programme.7 | Wave 6 merge order | Every wave 6 merge to `dev` | Claude | Done in the proposed order on 11 Nov 2026: the browser-install fix #630 (`e5421e23`), the status PR #626 (`dee57fa3`), Lane C #624 (`12877f5e`), Lane A #625 (`b8c1fba3`), then Lane D #637 (`8cc2a4d8`). Lanes A and C, with Lane D's docs, were promoted together in #643 (`5d18d321`) on 12 Nov 2026. `docs/ENV-MATRIX.md` keeps both the corrected `TENANT_EVENT_MAIL_ENABLED` row and Lane A's `TENANT_GUARDIAN_CONSENT_ENABLED` row | None | ☑ |
| s5-programme.8 | Lane C PR (C11t, C18) | Lane A → production; consent flag on | Claude | Merged to `dev` as #624 (`12877f5e`) on 11 Nov 2026; promoted in #643 (`5d18d321`) on 12 Nov 2026 | None | ☑ |
| s5-programme.9 | Lane A: bring up to current `dev` | Lane A → `dev` | Claude | Brought up to current `dev` and merged to `dev` as #625 (`b8c1fba3`) on 11 Nov 2026; promoted in #643 (`5d18d321`) on 12 Nov 2026 | None | ☑ |
| s5-programme.10 | Lane A fix pass from the 11 Nov reviews: an invitation where nothing was sent counts as not sent; neutral confirmation copy ("will be sent"); the eligibility-refusal check matches the trigger's message only; CODEOWNERS entries for the roster context, the consent envelope issuer and the consent tests; the migration's lock note corrected (or the agreements rule change moved to the end); `TENANT_GUARDIAN_CONSENT_ENABLED` documented in `docs/ENV-MATRIX.md` and `.env.local.example` | Lane A → `dev` | Claude | Done in #625 (lane commit `3db1bf62`), merged to `dev` (`b8c1fba3`) on 11 Nov 2026 and promoted in #643 (`5d18d321`) on 12 Nov 2026. The reviews found no change to Stellr's behaviour with default flags. The lock note changed as a comment only and still understates the locks; the applied file is not edited, and the docs correct it (`docs/TENANCY-S5.md`, Wave 6 status, "Its locks"; the Locks note in `docs/TENANCY-S5-registration.md`), 12 Nov 2026 | None | ☑ |
| s5-programme.11 | Lanes A and C with #605, tested together | Lane A → `dev` | Claude | Run together on `dev`: Lane A's branch merged #605 and current `dev`, with Lane C already on it, before #625 merged (`b8c1fba3`, 11 Nov 2026); promoted in #643 (`5d18d321`) on 12 Nov 2026 | None | ☑ |
| s5-programme.12 | More A16 database test cases | Lane A → `dev` | Claude | Written in #708 (open, not merged, 14 Nov 2026): pgTAP cases for a tenant-to-Stellr move, a group registration minor, an insert on a Stellr event with `checked_in_at` set, and the date-of-birth lift; CI's `db` and `tenant-db` jobs pass | Owner merge (`2026-11-14-backlog-batch1.md` lists every batch 1 PR) | ☐ |
| s5-programme.13 | A16 on the dev database | Lane A merged | Claude | Applied on 11 Nov 2026, after #625's `db` job passed; the `dev` ledger lists `20261110164339` | None | ☑ |
| s5-programme.14 | A16 on production | A16 → production | owner | Applied 12 Nov 2026 by run 43157319187, before #643 merged: every step passed, including the ledger row read back by name and the security checks after the commit. The Action's step that runs the transaction took about 3 s, so its locks were held no longer than that; the dry run took the same locks for about 3 s first. Whether the backup in `.16` was taken first is not recorded here | None | ☑ |
| s5-programme.15 | Event calendar for the next six weeks | Each production migration that adds triggers on participants, and every promotion in that time | owner | Declined by the owner on 11 Nov 2026 (`W7-3`): the event calendar does not constrain wave 7, and no 72-hour no-flip or no-merge window is added. A production migration that adds triggers on participants still gets a window with no events, chosen at its own promotion with the owner's yes (`docs/TENANCY-S5.md`, Owner gates) | None | ☑ |
| s5-programme.16 | Production backup routine | Next production migration | owner | The backup runbook is not yet installed | Proceed (`W7-32`): install it, or take a manual dump before the next production migration; each production step with the owner's yes | ☐ |
| s5-programme.17 | Agent access to the Vercel projects | Post-merge deployment checks; `.31` | owner | On the new account the connector still sees the team but no projects. Owner decision, 13 Nov 2026 (`W7-18`): the connector is not used; Claude reads and sets the hosted `dev` variables with the Vercel CLI (`--scope stellreducation`) after the owner's yes for each change. The CLI reached the team's projects read-only on 13 Nov 2026 (`vercel project inspect stellr-web-dev`, `vercel domains ls`, during the zone review). Production variables stay the owner's track | None | ☑ |
| s5-programme.18 | Lane D rebuild | Ships after A and C | Claude | Rebuilt on current `dev` and merged as #637 (`8cc2a4d8`), 11 Nov 2026; promoted with #643 (`5d18d321`), 12 Nov 2026. The owner declined the 72-hour no-flip windows. **The PDF-hash test, defined 14 Nov 2026:** the golden PDF-hash test from the 4 Nov scope, that is, fixed-input renders of the badge and certificate PDFs whose normalised bytes are hashed and pinned, so a change to the print output fails a test. C18 shipped in #624 without it. Built in batch 1 as `test/pdf-golden-hash.test.ts` (five cases: Avery 5392 plain and single preview, Avery 8395 on artwork, the certificate on US Letter and A4), PR #710, open, not merged | Owner merge #710; it must land before C19 and before P8 or P9 | ☐ |
| s5-programme.19 | Threat-model rating TB3 E (age gate) | Lane D | owner | Its own rule said M until A3 and A7 are on production; both are. Owner decision, 11 Nov 2026: moved to L in `docs/THREAT-MODEL.md` | None | ☑ |
| s5-programme.20 | Consent flag precondition | Consent flag on | Claude | Owner decisions 11 and 13 Nov 2026 as before (`W7-14`). Built in #708 (open, not merged): a new `tenantGuardianConsentReady()` that is true only with the flag, `LOADSCOPED_MODE=enforce` and `TENANT_EVENT_MAIL_ENABLED` all set; every admission path reads it, and the switch registry reports `guardian_consent_not_ready`. `tenantGuardianConsentEnabled()` still reads the flag alone and still gates the sweep, so the guard does not gate the sweep (`PR708-1`) | Owner merge #708, and an answer to `PR708-1`; until then the precondition holds by procedure on `dev` | ☐ |
| s5-programme.21 | A consent settles only from the current registration's envelope | Consent flag on | Claude | Done in #625 (lane commit `3db1bf62`), on production via #643 with the consent flag off: settle and decline need the current registration's envelope, and the sweep voids an open envelope from an earlier registration | Confirm in the Lane A PR's CI run | ☐ |
| s5-programme.22 | Credentials and surveys skip participants whose guardian has not consented | Consent flag on | Claude | Built in A10a #655 (`71a15c5f`) and A10b #660 (`9912395b`), with the guard test `test/participant-mail-consent-guard.test.ts`; on production since #680 (`fba19669`, 14 Nov 2026 UTC). The consent flag is off everywhere, so the tenant branches have run only in tests | None in code. The first real run is P12 on `dev` (`.31`) | ☑ |
| s5-programme.23 | Staff see and act on pending consent | Consent flag on | Claude | Not built | A "waiting for guardian consent" marker on the tenant roster and check-in desk, a resend action, and the desk treating `guardian_consent_pending` as a failed scan | ☐ |
| s5-programme.24 | Group check-in with one pending minor | Consent flag on | Claude | The group is refused as a whole | Check in the rest and return the held names | ☐ |
| s5-programme.25 | A date-of-birth edit that lifts the consent hold leaves a trace | Consent flag on | Claude | Partly done in #625 (on production via #643, consent flag off): the lift is audited when its envelope is voided. #708 (open, not merged) keeps the pending row with a `settled` status instead of deleting it, and re-opens it if the date of birth is corrected back | Owner merge #708. The edit becomes an audited action when tenant staff edit routes arrive | ☐ |
| s5-programme.26 | Consent sweep and removal | Consent flag on | Claude | #708 (open, not merged): retries are capped and escalate, and a move to a Stellr event settles the pending row. Its last commit escalates only once a staff alert is wired (`.52`). Not built: running the sweep whenever non-signed rows exist, whatever the flag says (batch 2: it needs the owner's production count of non-signed rows first). The re-owning and slug-rename note in `docs/TENANCY-S5.md` is still owed | Owner merge #708; the owner's production count; then the sweep change in wave 8 | ☐ |
| s5-programme.27 | Platform audit on the check-in POSTs | `PLATFORM_AUDIT_ENABLED` on production | Claude | The desk and self check-in POSTs are not yet wrapped; platform audit is off | Add them in a later Lane C slice (C19 to C25) | ☐ |
| s5-programme.28 | Stellr-only event routes refuse another tenant's event in every mode | First non-owner tenant | Claude | 10 routes refuse another tenant's event on `dev`: `remind`, `docusign-reissue`, `guardian`, `offerings` and `merch/commit` (wave 6, #624 and later), and `invoice-paid`, `payment-link`, `registrations/[id]/invoice`, `registrations/[id]/finish-setup` and `refunds/preview` (C20c #648). Every event is Stellr's today | Move the event-owner check into `requireEventAccess`, so it covers them | ☐ |
| s5-programme.29 | Stellr-only admin lists read only Stellr's rows in every mode | First non-owner tenant | Claude | Built in #705 (open, not merged): `/api/admin/docusigns` and the agreements page read only Stellr's or unstamped rows in every `LOADSCOPED_MODE`, and a shrink-only ratchet (`test/stellr-only-lists-ratchet.test.ts`) flags any new unfiltered read in a `stellr_only` list. The ratchet file is not in CODEOWNERS (`PR705-1`) | Owner merge #705; a person still confirms the `stellr_only` and identity classes | ☐ |
| s5-programme.30 | Tenant database connection on dev | `TENANT_DB_ENABLED` on | owner | O3 (#658, `907ce4fd`, 12 Nov 2026, on `dev`) built the pooler TLS canary (`scripts/tenant-db-canary.ts`), the `TENANTDB config` row in `app_errors`, `tenancy.tenantDb.config` on the health route and the refusal reason in the companies list's log. The canary has not run (P6), so which PEM goes in `TENANT_DATABASE_CA_CERT` is still open. `TENANT_DB_ENABLED` is unset on `stellr-web-dev` (P0, 12 Nov 2026) | P6: the owner creates `tenant_app_login` on the `dev` database, runs the canary with PEM A, and PEM B only if A fails (`docs/TENANCY-S5-data.md`, owner step 5); record the chosen PEM here; store the PEM and the URL on `stellr-web-dev` as sensitive values, with `TENANT_DB_ENABLED` still off. Other `dev` variables are set by Claude with the Vercel CLI (`W7-18`), but the URL holds the password `W7-7` keeps with the owner, so how it is stored is asked at P6. If no CA verifies, P7 to P9 stop and it is a new owner decision (`W7-7`) | ☐ |
| s5-programme.31 | Watch-only wave on dev, and its flip log | S5 sign-off (the 7-day and 30-day clocks) | Claude | The flip log lives in a new section at the end of this file, "Wave 7 flip log": a table with the columns flip, flip_at, exercise, positive signal, meters and verdict. Its first row is the P0 baseline of 12 Nov 2026. No tenancy switch has yet been on in a hosted environment, even in watch-only mode. Results so far (13 Nov 2026): the P0 baseline only; no flip yet. The signals each flip reads are now on `dev`: O1's `tenancy` object on the health route and the watch SQL `supabase/tests/s5_watch_only.sql` (#654), O2's `RATELIMIT` rows (#650) for P5, O3's `TENANTDB config` row and `tenancy.tenantDb.config` (#658) for P7 to P9, and B26a's `CRON_NON_PROD_JOBS` (#651) for P12. The canary tooling (K3 #652, K5 #653, K8 #659) is merged, and nothing is seeded yet: K7a has not run, and a read-only check of the `dev` database after the last merge showed 1 tenant, 0 non-Stellr events, 0 `platform_audit_events` and 0 `rate_limit_hits` | With the owner's yes for each flip (`docs/S5-DECISION-REGISTER.md`, `W7-2`), Claude sets it with the Vercel CLI (`W7-18`, which closed `.17`): one switch at a time on dev, each with a redeploy, the deployment check (`W7-19`: READY for the expected commit, health reporting the new value) and its own log row. P1 may go first with C13 and B16 still open (`W7-17`); P5 adds no per-IP cap on check-in's by-name lookup, so watch `rate_limit_hits` (`W7-20`); P12 waits for P4's 72-hour soak (`W7-14`); a short supervised `AUTHZ_SOURCE=postgres` window may close K9 (`W7-22`). Flips run in the wave 7 order (P1 platform audit; P2 `LOADSCOPED_MODE` shadow; P3 `AUTHZ_SOURCE=shadow`; P5 `RATE_LIMIT_STORE=shadow`; P4 enforce; then P7 `TENANT_DB_ENABLED`, P8 events-config shadow at 0.25, P10 routing, P9 events-config shadow at 1, P11 `TENANT_EVENT_MAIL_ENABLED` and P12 `TENANT_GUARDIAN_CONSENT_ENABLED`). The owner reads the meters before and 24 h after; every check is filtered by route and by flip_at | ☐ |
| s5-programme.32 | A database-enforced "not ready for tenants" lock, and one registry of switches | First non-owner tenant | Claude | The registry (`lib/tenancy/flags.ts`) and the health route's `tenancy` report are built in O1 #654 (`82534411`), on `dev`. The lock is still not built | A tenancy setting and trigger that refuse an active non-owner tenant until the isolating switches are on; a typed registry (`lib/tenancy/flags.ts`) for the health page and a startup check; IDOR staff personas across switch combinations | ☐ |
| s5-programme.33 | One host-tenant check for pages reached by emailed links | Routing on a zone; first non-owner tenant | Claude | Not reachable while routing is off. Tenant-host isolation on `dev` at `1d9b6977`: 48 of 124 cases failing (the 2 `W7-15` Stellr-host unsubscribe leaks were entered as accepted in #665), 18 unproven; A10a and A10b are on production since #680. A11 and A12 remain | Schedule A11 and A12 in wave 8 (draft plan in #706): one helper each link handler calls, or reads through `tenantDb` pinned to the host's tenant | ☐ |
| s5-programme.34 | Owner-run production checklist (read-only), below | S5 sign-off; closes the B13, B14 and B14b proofs | owner | Agents cannot read production. Owed since waves 4 to 6. Added 14 Nov 2026: the `tier_grant_rules` `object_created` state on production (B9), in the checklist below | Proceed (`W7-32`): the owner runs the queries below (agents do not read production); record the result in `docs/S5-CRONS-LIMITS-SMMA.md` | ☐ |
| s5-programme.35 | Dev-side proofs | S5 sign-off | Claude | Not run. Added 14 Nov 2026 from the review, items no list carried after the account move: the team page's linked-row view opened in a browser (`promote-s5-wave2.9`); a Stellr registration through the register routes on `dev` after A3 (`docs/TENANCY-S5-registration.md`, Rollout order 1); one real registration per kind through A7's owner read, and a check that no tenant mirror row shares a slug with an e2e Sanity event; `tier_grant_rules` `object_created` state read on `dev` (B9); the A16 check-in path exercised once batch 1 is on `dev` | On dev: one admin and one event-manager call to the payment-method route (C16), B19's public event page, one A8 roster round, and the items added above. Record each in `docs/TENANCY-S5-flow-checklist.md`, "Steps owed from waves 4 to 6" | ☐ |
| s5-programme.36 | Records held only on the development Mac | Continuity | owner | The overall plan, the scope file, the wave 2 and 3 slice reports and the final wave 6 bundle | Copy them to the restricted Drive folder; consider a longer transcript retention setting | ☐ |
| s5-programme.37 | A public-safe plan ledger | S5 sign-off | Claude | Written in #706 (open, not merged): `docs/PLAN-multi-tenant.md`, stages S0 to S15, the plan's binding decisions, and a ledger with separate "on production" and "gate passed" columns | Owner reviews and merges #706 | ☐ |
| s5-programme.38 | Where the SMMA self-assessment is held | SMMA sign-off | owner | Not known to the sessions | The owner says where | ☐ |
| s5-programme.39 | S1 to S4 owner actions | S1 to S4 gates | owner | Drafted in #706 (open, not merged) as `docs/OWNER-CHECKLIST-S1-S4.md`. Its C-12 row duplicates `esign-prod-switch-on.4` (the Resend webhook secret) | Owner merges #706, then works through the list | ☐ |
| s5-programme.40 | Mutation-testing runner for the S4 gate | S4 gate | Claude | Fixed in #692 (open, not merged): Stryker now runs and scores. The first full run killed 3,925 of 5,352 mutants, 73.3%, under the break threshold of 80, so the nightly mutation job fails until tests are added | Owner merge #692; then tests that raise the score, file by file (per-file scores in #692's body) | ☐ |
| s5-programme.41 | Owner decisions grouped by gate | Each switch and milestone | Claude | The register is `docs/S5-DECISION-REGISTER.md`, grouped by gate. Answered: W7-1 to W7-32 and the PR-review rows. Batch 1's S5 PR questions (`PR624-1`, `PR701-1`, `PR705-1`, `PR708-1`, `PR708-2`) were added open on 14 Nov 2026. #706 (open) adds `docs/S5-DECISION-BACKFILL-DRAFT.md`, 72 draft entries for the earlier waves, not yet in the register. Also not yet entered: B17's alert contact per tenant, and the tightening the register review asked for | After #706 merges, move the backfill entries into the register under their gates and bring them about 5 at a time, citing register ids only | ☐ |
| s5-programme.42 | Held for the owner: B15, B5d, B20, the C0b composite foreign key, the C14 remainder | B15: platform audit on production. The rest: first non-owner tenant | owner | Undecided | Decide through `.41` | ☐ |
| s5-programme.43 | Wave 7 plan | Next build wave | Claude | Wave 7: written and built; on production since #680 (`fba19669`, 14 Nov 2026 UTC). The wave 8 plan and an S6 plan are drafted in #706 (`docs/PLAN-S5-wave8-DRAFT.md`, `docs/PLAN-S6-DRAFT.md`), open, not merged. Owner decision, 13 Nov 2026 (`W7-23`): S6 starts alongside wave 7 | Owner reviews the drafts; the wave 8 slices are `.53` | ☑ |
| s5-programme.44 | C13's wave 4 follow-up notes | C6 disposition register | Claude | #706 (open, not merged) publishes the C13 follow-ups in `docs/S5-DECISION-BACKFILL-DRAFT.md` (T-44a, T-44b). They were held privately before; both admin routes check `isStellrAdmin`, so publishing is low risk, but the owner should know | Owner reads them in #706; each then goes to the C6 disposition register or a named gate | ☐ |
| s5-programme.45 | Smaller PRs, and the lane scripts in the repo | Wave 7 | Claude | The helper scripts sit outside the repo with fixed paths, and one skips a generator | Commit `npm run baselines` and `npm run check:pr` (matching CI's `verify-build`); one PR per slice, about 30 files at most | ☐ |
| s5-programme.46 | Housekeeping | Risk register | Claude | Open | A stored production schema dump for drift reports; the dev migration apply scripted with its ledger update; a tenant column on the email outbox; a narrow read function for the proxy in place of the service key; landed worktrees cleared (owner's yes); the risk register re-scored | ☐ |
| s5-programme.47 | The GitHub organisation move, against S5 | Wave 7 timing | owner | Same move as `account-migration.14` | Settle the timing; afterwards re-check branch protection, variables and environments | ☐ |
| s5-programme.48 | The first partner's event | M1 planning | owner | Not known | Event date, region, paid or free, any 14 to 17-year-olds, and who runs it | ☐ |
| s5-programme.49 | B22: `group-invoice-sync` runs per tenant and fails closed for non-Stellr tenants | First non-owner tenant | Claude | Built in #701 (open, not merged): both passes split rows by tenant and run through `runPerTenant`; only Stellr runs until S9; Stellr's reads are filtered to Stellr's or unstamped rows; after 270 s, unstarted registrations are deferred to the next run. The route holds its own copies of the two sweeps, so the `lib` versions are now unused by the cron. A failed held-count read marks the run not ok (`PR701-1`) | Owner merge #701; a later slice folds the loops back into the `lib` functions and counts held rows with a head count | ☐ |
| s5-programme.50 | C8-PG: a tenant-explicit Postgres reader for the events facade | First non-owner tenant | Claude | Built in #702 (open, not merged), not wired to any caller: `getEventBySlugForTenant` and two list readers, which refuse a missing tenant, filter `tenant_id` on every query and drop any row of another tenant. An uppercase tenant uuid passes the check but its rows are then dropped | Owner merge #702; lower-case the tenant id; caller conversion and the cron tenant loops are wave 8 | ☐ |
| s5-programme.51 | C17's Stellr-event tests assert their side effects (`fixrev-low-c-test`), and the C17 route comments (`AMD-C17-HELPERS`) | Lane C sign-off | Claude | Built in #705 (open, not merged): stronger assertions for `remind`, `docusign-reissue` and `guardian` on Stellr's own events under each `LOADSCOPED_MODE`, and the route comments corrected | Owner merge #705 | ☐ |
| s5-programme.52 | Staff are alerted when a guardian invitation fails (`fixA-notdone-alert`) | Consent flag on | Claude | Not built: `lib/registration/tenant-guardian-consent.ts` only logs a failed invitation, and only the request audit sees it, which is off. `.23` covers the roster marker and resend, not an alert. #708's retry cap escalates only once this alert is wired | Wave 8, with `.23` | ☐ |
| s5-programme.53 | Wave 8 slices | First non-owner tenant | Claude | Ordered in the DRAFT wave 8 plan in #706: B22 (`.49`), M7, A13a, C20a, A8b, the derivation enforce flip on `dev`, C20b, C19a; the consent pack (`.23`, `.26`'s sweep change, `.52`); `refuseUnlessStellrEvent` into `requireEventAccess` (`.28`); A11 with agreement reuse kept inside one tenant; A12; B24 and B25; the bounce-notices tenant link (`bounce-notices.9`); C8-PG's callers (`.50`); A10c only if P9 is clean; the rest of B26; K11 | Owner reviews the draft plan; then one PR per slice | ☐ |
| s5-programme.54 | Owner question: 503 or 404 when the event-owner read fails for Stellr's own event (`fixrev-low-503`) | Lane C sign-off | owner | The three C17 routes (and C20c's money routes) answer a retryable 503; `requireEventRoute` answers 404. The docs called it accepted without citing the owner. Now `PR624-1` in the register | Owner answers `PR624-1` | ☐ |

Related rows still open in other files, not repeated here: the production events-mirror backfill and parity query (`promote-s5-wave2.3`, `.5`, `.7`), and the first real write through the C0b trigger and the first production crons after wave 3 (`promote-s5-wave3.3`, `.7`).

## Closes

Rows in other sessions' tracker files, closed or decided here. Their files are not edited. `scripts/tracker.mjs` counts a row closed only when a bullet starts with its id and a colon, one id per bullet.

**13 Nov 2026.** Restated on 14 Nov 2026 in that form; the first wording named two ids in one bullet, so the script still listed them as open.

- `promote-s5-wave3.4`: **closed, stale** (the Minnesota group's corrected invoice). A read of Stripe on 13 Nov 2026 shows invoices `-0004` and `-0005` void and `-0006` open for 14 places at $1,154.30 (14 × $97 less 15%). The roster has changed since the row was written, so its "15 places at $1,236.75" check no longer applies.
- `group-invoice-any-changes.2`: **closed, stale.** The same Stripe read as `promote-s5-wave3.4`.
- `promote-s5-wave3.5`: **closed as not needed** (typed sign-in and a new login), by the owner, 13 Nov 2026.
- `attendee-email-cohort.5`: **closed** (organising teachers not on the roster cannot be checked in). Owner, 13 Nov 2026: leave it as it is.
- `admin-collapse-links.1`: **closed** (admin pages signed in on production). Checked read-only on production, 13 Nov 2026, signed in as the owner, on one competition's Roster tab and one member page. The roster has 7 folds (4 sections, 3 groups); the page's Expand all / Collapse all acts on the sections and the Registrations control on the groups only, as built; a single fold toggles; all 204 member and school record links open in a new tab. The member page's 15 folds close and reopen with its buttons. One School link on the member page opened in the same tab; #677 made it a `SchoolLink`.
- `admin-collapse-links.2`: **closed** (a real group's folded header). In the same check, each group header read "N participants · N unpaid · N DocuSign open", with "· N background open" where one is open. `.3` (an event manager sees plain names) still needs an event manager's sign-in.
- **Decided on 13 Nov, since built:** `promote-s5-wave3.17` and `attendee-email-cohort.4`, closed below.

**14 Nov 2026: done, with evidence.** Commit ancestry was checked against `origin/main` at `fba19669` on 14 Nov 2026. The other evidence is from the 14 Nov review, which read the API, the run logs and the worktree list on 13 Nov.

- `worktree-cleanup.4`: superseded. The three rescued 7 Oct files were redacted in #619 (`83bda5b4`, on `main`); the wider redaction is `account-migration.15`.
- `claude-design-sync.1`: #615 (`7bfeb941`) is on `main`.
- `node-forge-bump.2`: #616 (`65418f18`) is on `main`, so node-forge 1.4.3 is in production. The seal code that imports it runs only with `ESIGN_SEAL_P12` set, which production does not set (`esign-prod-switch-on.3`).
- `staff-role.1`: the 13 Nov promotion read production Clerk: 0 of 128 users held `role='staff'` (125 no role, 2 admin, 1 event_manager) (`.claude/releases/promote-2026-11-13.md`).
- `staff-role.2`: all four migrations were applied to production through the Production migration Action before #680: runs 43520222386, 43520670741, 43522523075 and 43522871753 (same record).
- `claude-account-switch.13`: #623 (`f3467654`), #627 (`3c924fe3`) and #628 (`ffd438f5`) are on `main`.
- `23.5`: #357 (`de37fc85`, on `main`) added `escapeHtml`; `lib/notify.ts` uses it on both alert bodies.
- `playwright-report-exposure.1`: `account-migration.16` was ticked 11 Nov; on 13 Nov the artifacts API listed only 2 `playwright-report` artifacts, both new failure uploads from 12 and 13 Nov.
- `playwright-report-exposure.4`: on `dev` run 43311710031 (12 Nov) the test step failed, then the session revocation and `upload-artifact` steps succeeded.
- `playwright-report-exposure.8`: #670 (`faeff165`, on `main`) fixed the `pd-credentials` stale-token flake.
- `event-manager-role.1`: migration `20261109120000` was applied to production with the owner's yes and promoted in #587 (`6026dd22`), as the bounce-notices Closes record.
- `group-payment-options.1`: promoted in #587 (`6026dd22`).
- `lint-pii.3`: #416 (`cb7aa7d6`, on `main`); `main`'s `ci.yml` runs "PII lint (added lines in docs)".
- `promote-s5-wave3.17`: built in #669 (`74aefc21`), on `main` via #680. Its first real use is not yet seen.
- `promote-s5-wave3.18`: #670 (`faeff165`, on `main`) fixed the PD and course-builder flakes: the saved Clerk token lives 60 s and a page load does not refresh it.
- `attendee-email-cohort.4`: built in #668 (`bc984990`), on `main` via #680. Its first real use is not yet seen.
- `resend-quota-outbox.8`: the worktree is gone (13 Nov sweep).
- `awards-no-show.8`: the worktree is gone (13 Nov sweep).
- `bounce-notices.10`: the worktree is gone (13 Nov sweep).
- `norm-chaffee-award.7`: the worktree is gone (13 Nov sweep).
- `presize-blob-images.6`: the worktree is gone (13 Nov sweep).
- `skills-ci-waits.3`: the worktree is gone (13 Nov sweep).
- `active-cpu-phase-2.9`: both worktrees are gone.
- `e2e-apt-cache.7`: no worktree and no remote branch for `fix/e2e-apt-deb-cache`.
- `e2e-local-stack.8`: the session worktrees are gone.
- `13.4`: the worktree is gone and neither branch is on the remote.
- `playwright-apt-offline.5`: the caches API listed the `-W46-lists` cache on `refs/heads/dev`, created 11 Nov 22:50 UTC.
- `playwright-apt-offline.7`: `e5421e23` is on `main` (promoted in #643).
- `playwright-apt-offline.10`: the branch and worktree are gone.
- `mentor-credentials.5`: #429 (`0ab624d7`, on `main`) stopped the survey fixture granting the seeded minor's credential consent, which flipped the fixture public.
- `scholarship-offers.8`: the cancel action is #490 (`13119444`, on `main`). The scholarship-cancel Closes bullet did not match the script's form.
- `scholarship-offers.10`: #466 (`c12aa021`, on `main`) finds the fixture row by event and participant and fails on duplicates.
- `lighthouse-url-list.5`: #550 (`63a1187c`, on `main`) cleared the OSV advisories; `osv-scanner` is green.
- `training-audience.12`: the same, #550.
- `training-resources-space-tab.8`: the same, #550.
- `e2e-lock-queue.11`: the same, #550.
- `event-manager-e2e.6`: the same, #550.
- `roster-grade-display.1`: #498 (`1487d95b`) is on `main`.
- `skills-ci-waits.1`: an observation row; the CI wait has run in every ship and promote since 16 Oct, including the 13 Nov promotion. Nothing further to record.
- `skills-ci-waits.2`: #440 (`77f04c45`) reached `main` with #441 (`e83e1f59`), 18 Oct.
- `worktree-sweep.2`: all three worktrees were removed in the 13 Nov sweep.
- `worktree-sweep.3`: the 13 Nov sweep removed 191 app worktrees, so the removal paths have run; the list is in the private handover.
- `worktree-sweep.5`: the same sweep exercised the paths that had only unit tests.
- `deep-review-v2.7`: #427 (`7e53fcee`, on `main`) removed `await headers()` from the root layout; `app/(stellr)/layout.tsx` has none.
- `deep-review-v2.10`: `main`'s `package.json` has `pdfjs-dist` ^6.4.299 (#463, `5681fce1`).
- `deep-review-v2.14`: `vitest.config.mts` on `main` splits a `node` project (`*.test.ts`) from `jsdom` (#525, `0106e78f`).
- `credential-family-link.6`: #358 (`b970384d`, on `main`) added the share-block reasons; `lib/email-credential-templates.test.ts` asserts the old copy is gone.
- `educator-pd.12`: promotion #343 merged 8 Oct (`1339f276`).
- `presize-blob-images.1`: `fd7bccaf` (#439) is on `main` via #441.
- `sanity-images.2`: #437 reached `main` with #441 (`e83e1f59`), 18 Oct.
- `image-transformations.1`: `0aaf19a4` (#436) is on `main` via #441.
- `training-audience.2`: #513 (`bcc1aa28`) is on `main`.
- `training-audience.9`: moot: `bcc1aa28` is promoted.
- `e2e-local-stack.1`: #670 found the cause (an expired saved Clerk token) and added `freshClerkSession` to the training-builder spec.
- `e2e-speedups.3`: `.github/workflows/e2e-nightly.yml` is on `main`; its scheduled runs succeeded 10 to 13 Nov.
- `e2e-speedups.6`: #539 (`6a655b3c`, on `main`).
- `e2e-speedups.7`: #541 (`bed84259`, `queue: max`, on `main`).
- `event-manager-e2e.3`: #670 measured the cause from 60 CI runs' logs (the 60-second saved token).
- `check-in-desk.9`: #487 (`d3825d63`) merged 30 Oct.
- `concurrency-deploy-volume.1`: the docs-only skip was proven on PR #290 and its `dev` push.
- `concurrency-deploy-volume.2`: promote Step 8 ran: `fba19669` is an ancestor of `dev` through record PR #682.
- `concurrency-deploy-volume.7`: concurrent close-out PRs have merged back to back since without a collision (#682 and #686, 13 and 14 Nov).
- `4.10`: superseded: crons decline on `dev` by design, and every cron writes `cron_runs`.
- `4.11`: superseded: the session tracker Doc was replaced by these tracker files.
- `5.4`: route tests exist for the group, individual and payment-link routes, and `lib/registration-checkout.test.ts` asserts `allow_promotion_codes`.
- `5.7`: #90 merged 16 Sept.
- `9.13`: the row's own text says closed 22 Sept (#146); only the box was never ticked.
- `12.8`: `components/admin/DeleteEntityButton.test.tsx` is on `main` (#427).
- `15.6`: `components/admin/AdminAddMember.tsx` uses the exact-date `ageOn` (#273, `f13a7c9f`).
- `20.4`: #393 (`0eead1fd`, on `main`) turns '' into null for the enum columns in `app/api/members/me/route.ts`.
- `21.8`: all 24 cron routes on `main` write `cron_runs` (checked 14 Nov 2026).
- `21.12`: superseded: `app/api/admin/docusigns/[id]/resend/route.ts` calls `remindEnvelopeRow` from `lib/esign/operations`.
- `mentor-credentials.2`: done in substance: `artwork-defaults.5` records Colorado's mentor certificate template row.
- `mentor-credentials.3`: done in substance: the same row records 4 mentor credentials issued.
- `event-check-in-v2.1`: Nevada (6 Nov) used check-in on production: `awards-no-show.2`'s read-only production query (9 Nov) found 11 students checked in and placed.
- `account-migration.22`: S5 resumed on the Team account: wave 6 promoted in #643, wave 7 in #680.
- `account-migration.23`: a pointer row; the Ad Grants work continues as `ad-grants-rebuild.1` to `.11`, which stay open (the 13 Nov first-serve check found the campaigns not serving).
- `account-migration.5`: the 14 Nov review verified the git bundles.

**14 Nov 2026: closed as won't do, because the event has passed.**

- `17.9`: Colorado SDC was 3 Oct.
- `17.10`: Colorado SDC was 3 Oct.
- `18.2`: the 8395 sheet check was for an event that has passed; the spares work since then (`badge-spares`) prints on the same sheet.
- `22.1`: Colorado SDC was 3 Oct.
- `22.9`: Colorado SDC was 3 Oct.
- `mentor-agreement-emails.1`: the 3 Oct event has passed; the signatures were never re-read.
- `docusign-shared-inbox.1`: a September envelope for an event that has passed.
- `docusign-shared-inbox.2`: the same.
- `21.3`: the retrospective re-issue is now stale.
- `14.2`: the screenshot re-send is now stale.
- `artwork-defaults.3`: Nevada (6 Nov) has passed; it issued credentials (`awards-no-show.3`), but which artwork printed was not recorded.
- `team-profile-override.1`: Nevada has passed.
- `training-resources-space-tab.4`: the Nevada assignment was due 6 Nov (the Alumni-tier course decision).
- `training-audience.4`: Nevada has passed; mentor training for the next event is the owner's.
- `member-merge-school-email.2`: Nevada has passed.
- `post-event-survey.1`: the Nevada run was not recorded against this row, and the event has passed.

**14 Nov 2026: left open, though the review listed them as done.** `worktree-sweep.6`: the folder beside the repo still has no version control, and the owner has not decided. `vercel-retention.7` and `10.5`: they were to be closed by the move to a Pro team, but a Vercel API read on 13 Nov reported the team's plan as Hobby, so `account-migration.17` needs correcting first. `23.1`: the review also lists the pre-28 Sept alert audit as an owner production read still owed. `account-migration.10` and `public-repo-personal-data.3` were already closed, and `resend-quota-outbox.1` too.

## Owner-run production checklist (`.34`)

Read-only, as the owner, in the Supabase SQL editor for production. Agents do not run these.

```sql
-- B13, B14, B14b: cron results since the 10 Nov promotion
SELECT job, started_at, ok, result, errors
FROM cron_runs
WHERE job IN ('surveys', 'event-emails', 'docusign-reminders', 'email-outbox', 'esign-maintenance')
  AND started_at >= '2026-11-10'
ORDER BY job, started_at DESC;

-- New error digests since the same date
SELECT route, message, count, last_seen
FROM app_errors
WHERE last_seen >= '2026-11-10'
ORDER BY last_seen DESC;

-- B9: object_created rules (added 14 Nov 2026); counts only
SELECT object_type, grant_kind, is_active, count(*)
FROM tier_grant_rules
WHERE trigger_type = 'object_created'
GROUP BY object_type, grant_kind, is_active
ORDER BY object_type;
```

Expected: each job has finished runs with `ok` true and its usual result keys; no `tenantHeld` key (every event is Stellr's); no `tenants`, `outbox` or `t:<id>:…` entry in `errors`; `surveys` still opens and invites. For B9, any active `attach_object` rule is expected to name a target; the event-sync webhook skips these rules for an event the mirror gives another tenant. B19's public event page is a dev-side check (`.35`). B5c's fallback rewrite on Vercel stays a D7 sign-off step (`docs/TENANCY-S5.md`, wave 4, Not yet proven).

## Wave 7 flip log

One row per step on `stellr-web-dev`, newest last. Each flip sets one variable, has the owner's yes for that flip (`docs/S5-DECISION-REGISTER.md`, `W7-2`), is set by Claude with the Vercel CLI (`W7-18`), and is followed by a redeploy of the newest READY deployment, listed fresh each time. **Before any signal is read, confirm the `dev` deployment is serving the new code: READY for the expected commit, and the health endpoint reports the new value (`W7-19`).** CI e2e writes to the same dev database, so every check is filtered by route and by `flip_at`. The owner reads the Hobby meters (Active CPU, deployments per day, Function Storage, Deployment Storage) before the flip and 24 h after; the latest flip is rolled back if Active CPU passes about 85%. Counts and ids only: no `members.id`, email or route failure line goes in this table.

| flip | flip_at | exercise | positive signal | meters | verdict |
|---|---|---|---|---|---|
| P0 baseline | 12 Nov 2026 | None; read-only baseline. No switch set on `stellr-web-dev` (every S5 switch at its default) | Dev DB: 1 tenant, 11 events, all Stellr's. Cutover sections D, D2 and I all 0; section C ok (log mode since 4 Nov). Derivation log, last 7 days: `no_event` 3,124 and `no_key` 2,673, from CI e2e fixtures writing slugs the mirror does not know, so every flip check must filter by route and time. `platform_audit_events` 0; `rate_limit_hits` 0; `tenant_guardian_consents` 0. Storage buckets: `agreement-templates`, `community-resources`, `signed-agreements` | To be read by the owner | baseline |
