# Handover — Checkr hardening, 21 Sept 2026

**For:** whoever runs the Checkr certification and production cut-over, or
touches background-check / compliance code.
**Prompted by:** "Checkr integration into the web app is still not complete."
It turned out the *code* was complete — built 18–26 June, security-fixed
8 July, then frozen. What was incomplete was everything around it: no tests,
no reconciliation for a missed webhook, no production sandbox guard, a role
rule that put newsletter subscribers on the audit page, and a certification
process that stopped after the June webhook-domain incident. Because the
close-out tracker started in September, none of this had a row anywhere.

## 1. What was found

Verified 21 Sept against prod (`hwtzpfrnksksxlwwabqz`) and dev
(`xvxlhbxtiwxpopoqjygm`) Supabase, both deployed webhook endpoints, and the
repo:

- `member_background_checks` holds **0 rows** on both projects; 0 `compliance`
  activity-log rows. The feature has never been used for a real member.
- Migrations 059/060/092 are applied everywhere (`supabase/baseline.sql`).
  `docs/BACKGROUND-CHECKS-HANDOFF.md` still said 092 was pending — fixed.
- `GET /api/webhooks/background` → 200 on `app.stellreducation.org` and
  `stellr-web-dev.vercel.app`; unsigned `POST` → 401 on both (fail-closed, so
  this says nothing about whether keys are configured).
- Vercel env for either project could not be listed with this session's token
  (403). The June runbook tested against the **prod** URL, so staging Checkr
  credentials may be on `stellr-web` Production scope. See TRACKER 9.4.
- Checkr side: staging only (package `stellr_crimid`, Assess on, webhook
  `8b0393fb769341844c1f62be` → prod domain). Adjudicator named in a doc, but
  the Smartsheet review form and video were never submitted.

## 2. What changed

All on branch `checkr-hardening`; no migration.

**Role scope** — `lib/compliance.ts` gains `BC_REQUIRED_ROLES`
(`teacher / mentor / volunteer / adult`); `requiresBackgroundCheck` is now
opt-in by role. `subscriber`, `parent`, and unrecognised roles are exempt.
`lib/compliance-admin.ts` prefilters on the same constant; the audit page
subtitle says so. Prod roles in use are participant/teacher/mentor/adult, so
no real member's state changes.

**Sandbox guard** — `lib/env-guards.ts` knows `checkr` (`unconfigured` /
`sandbox` / `production`, keyed on `CHECKR_BASE_URL`, defaulting to sandbox as
the adapter does). The order route calls `assertLiveCredentials('checkr')`
and returns 503 with the guard's message on a production deployment holding
staging keys. `/api/admin/health/integrations` reports it with no change.

**Reconciliation** — `lib/background-sync.ts` is now the one writer of vendor
outcomes: `applyCheckOutcome` (moved out of the webhook route; the webhook
calls it) and `syncStaleChecks`, which re-polls every `invited` /
`in_progress` row through a new `provider.fetchStatus(refs)`
(`GET /invitations/{id}` → `GET /reports/{id}`, mapped by the same
`mapReport`). Two entry points: `GET /api/cron/background-sync` (daily 06:30
UTC, skips rows touched in the last hour; declines on dev via `guardCron`) and
`POST /api/admin/compliance/sync` behind a **Sync with Checkr** button on
`/admin/compliance` (no threshold). Audit entries are written only when the
status actually changes, so a re-delivered webhook no longer double-logs.

**Tests** — `lib/background-provider/checkr.test.ts` (36: the runbook's mock
matrix as fixtures, every lifecycle event, signature fail-closed, polling),
`lib/compliance.test.ts` (17), `lib/background-sync.test.ts` (8), plus four
Checkr cases in `lib/env-guards.test.ts`.

**Docs** — handoff §4/§5/§6/§7/§9/§10 corrected; `ENV-MATRIX.md` §3 Checkr
row rewritten (prod must hold **no** key until authorised); `GO-LIVE-CHECKLIST`
§7 gains a Checkr gate; runbook §5 gains the missed-webhook → sync case;
`TRACKER.md` session 9.

## 3. Verification

- `npx vitest run` on the four suites: 65 passed. Full suite: every repo test
  passes; the ~130 "failing files" are third-party tests under
  `.claude/worktrees/credentials-linkedin/node_modules` swept up by the glob
  (TRACKER 9.9).
- `npx tsc --noEmit`: clean apart from `lib/google-sheets.ts`, whose
  `@googleapis/*` packages are in `package.json` but missing from this
  checkout's `node_modules` (stale install; CI runs `npm ci`).
- `npm run lint:tokens`: green.
- **Not exercised against Checkr staging.** No `CHECKR_*` in `.env.local`, and
  the certification run is deliberately sequenced after this lands
  (TRACKER 9.3–9.6).

## 4. Left open

Everything from TRACKER 9.3 onward is operator work outside the repo: env
wiring on the dev Vercel project, re-pointing the staging webhook, the
mock-candidate run and video, the Smartsheet submission, then production keys.
`docs/BACKGROUND-CHECKS-HANDOFF.md` §9 is the ordered list.
