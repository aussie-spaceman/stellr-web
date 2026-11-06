# S5: crons, rate limiter and SMMA guardrail

What is built, what it does for Stellr today, and what has to happen before it does more. Plan of record: `docs/TENANCY-S5.md`. Checked against the code on 6 Nov 2026, with wave 3's Lanes A, B and C merged to `dev` (#562, #563, #564). None of wave 3 is on production.

**In one line each:**

- **Crons:** Stellr-only crons are limited to Stellr's rows, every cron declares `maxDuration` and audits each finished run. **No cron runs per tenant yet.** B13 and B14 are not built.
- **Limiter:** the Postgres store is built and its migration is on production, but **no route calls it**, so changing `RATE_LIMIT_STORE` today protects nothing.
- **SMMA:** the allow-list and the lint are built. The gate, the database CHECK and the browser test are not. The self-assessment is held privately pending the owner's decision.

## Crons

**There are 23, not the plan's 22.** `group-invoice-sync` arrived after the plan was written. Routes, the distinct `vercel.json` paths (28 schedule entries) and `lib/cron-scope.ts` all agree, and `test/cron-scope.test.ts` keeps them the same set. `guardCron` declines outside production, so **no cron does any work on `dev`, and proof comes only from production's `cron_runs`.**

### Scope classes

From `lib/cron-scope.ts`. Nothing reads this at runtime.

| Class | Crons | `maxDuration` |
|---|---|---|
| `per_tenant` (6) | `docusign-reminders`, `event-emails`, `group-invoice-sync`, `survey-retention`, `surveys`, `team-profiles` | 300 for `docusign-reminders` and `group-invoice-sync`, 60 for the rest |
| `platform` (2) | `deletion-archive-retention` (60), `entitlements` (300) | |
| `stellr_only` (15) | `alumni-upgrades`, `apollo-reconcile`, `background-sync`, `campaign-drip`, `campaign-events`, `campaigns`, `docusign-form-data`, `hubspot-event-options`, `hubspot-lifecycle`, `lead-capture-failures`, `membership-expiry`, `motion-bookings`, `session-reminders`, `training-reminders`, `weekly-digest` | 60 for `apollo-reconcile`, `background-sync`, `campaigns`, `membership-expiry`, `weekly-digest`; 300 for the rest |

**`maxDuration` (B11).** The 12 crons with none now declare 300, the highest value already used on this Hobby project. Existing values did not change: 13 crons at 300 and 10 at 60. It cannot shorten a run. Where the platform default was lower, a run that hangs may now run longer, so watch Active CPU.

### The per-tenant runner: built, unused

`lib/cron-tenants.ts` (B3). Only `lib/cron-tenants.ts` and `lib/cron-runs.ts` touch it, so **per-tenant crons still run one global work list under one deadline.** A second tenant's backlog could starve or fail Stellr's run until B13 and B14 land, so those must land before a tenant has work in these crons.

How it will behave once used:

- It partitions the work list a cron has already fetched. It does not loop over `tenants`, and `vercel.json` keeps its schedules.
- A NULL `tenant_id` goes in Stellr's slot. A row read without the column throws.
- A run that touches only Stellr adds one small read of `tenants` and is otherwise a plain call: same budget, no child row, no change to failure labels or result JSON.
- With more than one tenant, each gets a slice: an equal share of what is left, at least 5 s, with 5 s of overrun. A tenant still running past that is aborted, marked failed, and the next one starts. `fn` must honour the abort signal, or its work carries on in the background.
- Each tenant has its own try/catch and a child `cron_runs` row (`parent_id`, `tenant_id`). `lastCronResult` ignores child rows, so the `apollo-reconcile` cursor is safe.
- Inactive tenants are skipped, except where the cron passes `includeInactive`. `survey-retention` is marked for it, because offboarding does not stop a retention clock.
- **Fairness defaults to `stellr_first`** until the owner decides. `rotate` is available, with a stored cursor. A tenant that was mid-run when the platform killed the last run goes last next time.

**`group-invoice-sync` has no slice.** It is classed `per_tenant`, but B13 and B14 do not list it. A7's refusal of priced tenant events means no tenant has a group invoice until S9, so it can wait, but name a slice before then.

### Stellr-only limits (B11)

`stellrRows()` in `lib/tenancy/stellr-scope.ts` filters on `tenant_id IS NULL OR tenant_id = Stellr`. With one tenant it matches every row, so each query returns what it returned before.

| Cron | What is limited |
|---|---|
| `weekly-digest` (`lib/admin-digest.ts`; the admin dashboard and digest send share it) | Registrations, agreements, volunteer interest, group invoices, scholarships through `stellrRows`. Cohorts and Space activity by the event's owner |
| `background-sync` (`lib/compliance-notify.ts`) | The registrations read behind clearance reminders. Participants follow from those ids |
| `training-reminders` (`lib/training-reminders.ts`) | Assignments and registrations through `stellrRows`. Another tenant's events and cohorts are skipped |
| `docusign-form-data` | The agreements work list |
| `hubspot-event-options` (`lib/hubspot-event-options.ts`) | Events the mirror gives to another tenant, matched by Sanity document id. A caller must name its scope. The Sanity webhook and the manual script do too |

**Not limited, on purpose:**

- **`membership-expiry`.** Its participants and agreements reads only hold an account back from deletion. Limiting them would delete a person another tenant still holds records for.
- **`alumni-upgrades`, `campaigns`, `campaign-drip`, `campaign-events`.** They pick their audience from shared `members`, with no tenant column to filter on. Who counts as a Stellr member is the open B3 decision, and `test/cron-scope.test.ts` pins the list. **Settle it before the first non-owner event**, or tenant registrants could get Stellr marketing or Alumni grants.
- **`weekly-digest`, member sections.** New and departed members, new mentors, the verification queue and reactions read shared data. Same decision.

**The events mirror carries these limits.** `otherTenantEvents()` learns who owns an event from `public.events`, and an event with no row counts as Stellr's. So a tenant's mirror row must exist before its Sanity document is first published. On 5 Nov production's `events` had 0 rows (read-only check, `.claude/releases/promote-2026-11-05.md`). That is harmless with one tenant. The backfill is still owed. Each reader fails closed if that read fails: the sync writes nothing, the digest reports the section, the reminder run records a failure.

**Proof still owed:** the first production `cron_runs` rows after promotion, against the previous day's counts. Tests run on fake clients.

### Cron audit (B12)

All 23 routes export `withCronAudit('<job>', handler)` from `lib/cron-audit.ts`, behind `PLATFORM_AUDIT_ENABLED`, off by default. An authorised run writes one `cron.run.finish` on the platform chain after the response: actor `cron:<job>`, tenant null, metadata `{ status }`. A 5xx is recorded with its status. The body is never read, because `motion-bookings` answers with email addresses. A failed audit write never changes the cron's answer.

**What "100% audited" means for a cron: every run that finished and whose event was not lost.**

- **A run killed at `maxDuration`** never reaches the write, although it may have done part of its work.
- **The write comes after the response**, so it can be lost with its instance.
- **A cron writes no event on `dev`, even with the flag on**, so a green `dev` flip says nothing about crons.

Once the flag is on in production, compare the two ledgers. `cron_runs` holds the runs that started. It also has job names with no route of their own (`esign-maintenance`, `rate-limit-gc`), so read the differences job by job.

```sql
SELECT r.job,
       count(*) AS started,
       count(*) FILTER (WHERE r.finished_at IS NULL) AS never_finished,
       (SELECT count(*) FROM public.platform_audit_events e
         WHERE e.action = 'cron.run.finish' AND e.actor = 'cron:' || r.job
           AND e.occurred_at >= now() - interval '7 days') AS audit_events
FROM public.cron_runs r
WHERE r.started_at >= now() - interval '7 days' AND r.parent_id IS NULL
GROUP BY r.job
ORDER BY r.job;
```

### Email budget

**No per-tenant share exists.** `lib/email-budget.ts` still has one daily cap, with a transactional reserve, shared by every sender. B14 builds the share and is blocked on the owner's decision. Until then a tenant's sends could use up Stellr's day, so no tenant event sends mail before B14.

## Rate limiter

### What exists

| Piece | File | State |
|---|---|---|
| In-memory limiter, per warm instance | `lib/rate-limit.ts` | Live. It is what every route uses, and `proxy.ts` for `/credentials/` |
| Async API: `limit()`, `rateLimit()` | `lib/rate-limit-async.ts` | **No route imports it** (A9, B15 not built) |
| Store client | `lib/rate-limit-store.ts` | Reached only by that API and the `entitlements` gc call |
| `rate_limit_hits`, `rate_limit_take()`, `rate_limit_gc()` | `supabase/migrations/20261105042629_rate_limit.sql` | On `dev` and production. Empty until a route adopts |
| Guard list | `lib/security/route-guards.ts` | Knows both async names (C5b). A call counts only when awaited with its answer used |

### Modes

`RATE_LIMIT_STORE`, where anything unrecognised means `memory`:

| Mode | The decision comes from | Postgres |
|---|---|---|
| `memory` (default) | The in-memory limiter | Never called. The gc does nothing |
| `shadow` | The in-memory limiter | Also counted. A disagreement logs `[rate-limit] shadow disagreement` |
| `postgres` | Postgres, or memory if the store cannot answer | Counted and decides |

Every mode counts in memory first. **A request memory has already denied stops there, with no database call.** So shadow can only ever log "memory allowed, store denied", which is exactly the question it is there to answer: would the shared count refuse someone today's limiter lets through?

**Failure is never allow-all.** The store gets 300 ms, enforced by the app and by `lock_timeout` in the function. A timeout, an error, an odd answer or a missing secret means the caller keeps its in-memory decision. Problems go to `console.error` at most once a minute per instance, not to `app_errors` as scoping proposed, so they vanish with Hobby's short log retention.

### Key hashing

Limiter keys hold IP addresses, and `check-in-name` keys hold minors' names. Only an HMAC-SHA256 under `RATE_LIMIT_KEY_SECRET` leaves the process, and the table's CHECK takes 32 bytes only. Without a secret of at least 32 characters nothing is sent at all.

- **Secret:** different per Vercel project. Changing it restarts every open window, which is harmless.
- **Tenant:** `tenantId` is required by the types, and only another tenant's id changes the key. So Stellr's keys stay as they are, and a tenant's traffic counts separately from Stellr's.
- **Logs:** shadow lines carry the route label and the two answers, no key. The 429 line keeps the IP, as the sync limiter's does.
- **Backups: open.** The table is UNLOGGED, but a logical `pg_dump` still includes its rows, and `ops/backups/backup.sh` does not exclude it. Owner decision from wave 2.

### Costs

One row per active key, one RPC per limited request, no WAL. One take in 100 also clears up to 200 expired windows, and `entitlements` runs `rate_limit_gc()` daily when the store is in use, recorded in `cron_runs` as `rate-limit-gc`. `test/rate-limit-proxy-closure.test.ts` keeps `proxy.ts` from reaching the store, so no database call joins the request path on every page. A database crash empties the table, which resets the current windows and nothing else.

### Flip procedure

**Not yet: A9 and B15 come first.** Without them, shadow on production only runs a gc over an empty table and proves nothing.

1. **Adopt.** A9 and B15 move routes to the async API with the same limits, keys and 429 body. Every call is awaited (`test/rate-limit-await.test.ts`), because a Promise is truthy and an un-awaited guard blocks every request.
2. **Secret.** The owner creates `RATE_LIMIT_KEY_SECRET` per project. It is never pasted in chat or the repo.
3. **`dev` first**, then a redeploy of the newest READY deployment. Read a fresh list: a stored deployment id goes stale.
4. **Production `shadow`**, outside event hours, for at least 7 days, with a real event in the window if one is coming. Hobby's logs are short, so read them during the event.
5. **Read the shadow lines by route.** Expect few or none outside abuse. Any at `check-in` during an event means a venue's shared IP hit the wider count: raise that route's limit in a PR first, and do not flip.
6. **Production `postgres`, outside event hours.** A distributed count is stricter than per-instance counting, so venue Wi-Fi is the risk.
7. **Back out** by setting `memory` and redeploying. Nothing in the table needs clearing.

### What stays in memory

**`proxy.ts`'s `/credentials/` limit stays sync, on purpose:** 60 a minute per IP, per instance. A database call there would raise latency and the middleware share of Active CPU. Its cross-instance cover is the WAF rule (`docs/RUNBOOK-waf-rule.md`).

**Plan items:** B15 sets the route limits for `schools/search` and `store/checkout`. Decide the `store/checkout` limit before `PLATFORM_AUDIT_ENABLED` goes on (owner decision, wave 3).

## SMMA guardrail

Social Media Minimum Age: plan decision 12 gives tenant participants an event-only experience. The self-assessment is held privately pending the owner's decision. This section is the mechanism.

### The tenant surface

`lib/tenancy/tenant-surface.ts` classifies every route-manifest entry, and a route with no decision fails `test/tenant-surface-routes.test.ts`, so a new route is denied until someone classifies it.

| Decision | Meaning |
|---|---|
| `allow` (49 files, named one by one) | Reachable on a tenant host: flow pages and APIs, sign-in, credentials, privacy, terms, onboarding, volunteer interest |
| `pending` | Wanted, not safe yet. Treated as denied |
| `deny` | Never. All 80 community and home entries, plus admin, crons, webhooks, store, academy, campaigns and lead capture |
| `bypass` | Skips the proxy, so it answers on every host |

The final allow-list is an owner decision. Being allowed gives reachability only: each handler must still check the record's tenant (C6, B5b).

### The lint (B8)

`test/tenant-surface.test.ts` walks the static and dynamic import closure of the tenant tree, the allowed files, and the root layout and boundaries. It fails on:

- a new import of a social module, counted per first step in, so a new direct import of an already-listed module fails too;
- a new file naming a social table (community, chat, cohort, mentoring, coaching, membership, training), in `.from()`, an embed or a variable;
- any Realtime `.channel(` call.

The baseline is `test/tenant-surface-baseline.json`, generated by `scripts/tenant-surface-baseline.mjs`, and it only falls. Size caps in the test make raising it a visible edit.

| Baseline, wave 3 | Count |
|---|---|
| Social modules reached | 10 |
| First-step imports | 38 |
| Files naming a social table | 17 |
| Files opening a Realtime channel | 0 |

**These are not 0, and the lint does not make them 0.** It stops growth. The B8 slice's first count (8 modules, 9 files) was before review widened what the lint looks for.

**What the walk cannot see:** code acting on a registration by id from Stellr's own host. So a test lists every caller of the participation writers, and `recordEventParticipationForRegistration` refuses another tenant's row itself.

### The hooks (B8)

`lib/community/event-hooks.ts` is the only allowed way in. Each hook passes through unchanged when `isPlatformOwner` is true, and otherwise does nothing. A context that could not be resolved counts as not Stellr's.

- It covers participation, both Space roster syncs, the base membership grant, the three school links, and `syncMemberOptionSelections`. The last was first left out, and review added it, because it writes the shared person record.
- **A tenant event writes no `event_participations` row or activity entry**, until the owner decides otherwise (wave 3 decisions).
- **Nothing imports the hooks yet, so they hold nothing back on their own.** The register routes still call these modules directly, until A7. Team and sheet paths move in A8.

### What is not built

| Control | Slice |
|---|---|
| The 4-table CHECK: `community_spaces`, `community_resources`, `mentoring_cohorts`, `training_modules` | B9 |
| The two community `TODO(S5)` IDOR snapshot entries | B9 |
| The browser gate: 0 community routes, 0 trackers | B9, B10(d) |
| Register routes through the hooks, tenant confirmations email-only | A7 |

Until then, keep `TENANT_ROUTING_ENABLED` off on any deployment with a zone attached (see `docs/TENANCY-S5.md`, Real tenant hosts).
