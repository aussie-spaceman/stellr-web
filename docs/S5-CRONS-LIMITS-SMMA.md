# S5: crons, rate limiter and SMMA guardrail

What is built, what it does for Stellr today, and what has to happen before it does more. Plan of record: `docs/TENANCY-S5.md`. Checked against the code on 6 Nov 2026, with wave 3's Lanes A, B and C merged to `dev` (#562, #563, #564), updated on 8 Nov 2026 for wave 4's A9, B9, B10 and B13, read on their lane branches before merge, and on 9 Nov 2026 for wave 5's B14 (#588) and A7 (#594), read on `dev` at `b620a113` after merge. Wave 3 is on production (#561, `.claude/releases/promote-2026-11-06.md`), and so is wave 4 (#587, `.claude/releases/promote-2026-11-09.md`); wave 5 is on `dev` and not promoted.

**In one line each:**

- **Crons:** Stellr-only crons are limited to Stellr's rows, every cron declares `maxDuration` and audits each finished run. **Five crons run per tenant:** `surveys`, `team-profiles` and `survey-retention` (B13), and `event-emails` and `docusign-reminders` (B14). `group-invoice-sync` has no slice.
- **Email:** one shared daily pool for every sender, tenants included, by the owner's decision of 9 Nov 2026. A tenant's event mail is held unless `TENANT_EVENT_MAIL_ENABLED` is on (B14).
- **Limiter:** the Postgres store is built and its migration is on production. **Lane A's participant routes call it (A9)**, so a shadow flip now has real traffic to compare. B15 is not built, so flip only after it.
- **SMMA:** the allow-list and the lint are built. The 4-table CHECK (B9) is applied on `dev` and production (9 Nov 2026). The browser test (B10(d)) is built and runs report-only. The self-assessment is held privately pending the owner's decision.

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

### The per-tenant runner

`lib/cron-tenants.ts` (B3). **B13 moved `surveys`, `team-profiles` and `survey-retention` onto it, and B14 `event-emails` and `docusign-reminders`.** `group-invoice-sync` still runs one global work list under one deadline, so a second tenant's backlog could starve or fail Stellr's run there until a slice for it lands, before a tenant has a group invoice.

How it behaves:

- It partitions the work list a cron has already fetched. It does not loop over `tenants`, and `vercel.json` keeps its schedules.
- A NULL `tenant_id` goes in Stellr's slot. A row read without the column throws.
- A run that touches only Stellr is a plain call: no read of `tenants` (it uses Stellr's seeded values), the whole budget, no child row, no change to failure labels or result JSON. A run with no work reads nothing. **Since wave 5, Stellr alone is always called, even when the deadline has passed before the runner starts;** the cron's own function sees the deadline and counts late work as deferred, as it did before the runner existed. Before, such a run would have recorded Stellr as not reached, and a Stellr-only run read `tenants` once and could record a `tenants` failure. Both apply to all five crons on the runner.
- `tenants` is read only when another tenant has work. If that read fails, the run records a `tenants` failure and finishes not ok, and Stellr's work still runs.
- With more than one tenant, each gets a slice: an equal share of what is left, at least 5 s, with 5 s of overrun. A tenant still running past that is aborted, marked failed, and the next one starts. `fn` must honour the abort signal, or its work carries on in the background.
- Each tenant has its own try/catch and a child `cron_runs` row (`parent_id`, `tenant_id`). `lastCronResult` ignores child rows, so the `apollo-reconcile` cursor is safe.
- Inactive tenants are skipped, except where the cron passes `includeInactive`. `survey-retention` is marked for it, because offboarding does not stop a retention clock.
- **Fairness defaults to `stellr_first`** until the owner decides. `rotate` is available, with a stored cursor. A tenant that was mid-run when the platform killed the last run goes last next time.

### The three per-tenant crons (B13)

No flag: with only Stellr's work, each is the runner's plain call, so the order, budget, mail and failure labels are as before, and `cron_runs` results gain no keys. Each function checks the abort signal before every distribution, student or subject.

| Cron | How it splits | What else changed |
|---|---|---|
| `surveys` (`lib/survey/run.ts`) | Open distributions by `survey_distributions.tenant_id` (from S4, so already on production) | The sweep and the clock still run once over every event, before the runner. They schedule, open and close surveys and send no mail. Failures are recorded on the run in the order they happen; sweep errors only after the open-surveys read succeeds |
| `team-profiles` (`lib/team-profile/store.ts`) | The daily sweep reads each student's tenant from their registration (`registrations!inner(… tenant_id)`), because `participants.tenant_id` comes with C0b, which is not on production | Calls for some participants or one event (agreement completion, registration) keep the plain path. The 550 ms gap and the 45 s budget are unchanged, and the gap is shared across tenants, since Resend's rate is one account's. If only Stellr has work and a write fails, the error is thrown again after the runner, so the route still answers 500 as today |
| `survey-retention` (`lib/survey/retention.ts`) | Planning stays one read and now also selects `tenant_id` on `survey_distributions` and `survey_responses`. Deletions run per tenant with `includeInactive` | Still report-only unless `SURVEY_RETENTION_APPLY` is true. A person whose rows span tenants is one purge, in Stellr's slot. With apply on, deletions stop starting 45 s after the route starts (the plan read counts); anyone left is recorded as a `not_applied` failure and `notApplied` in the result. Before, such a run was cut off at `maxDuration` and recorded nothing |

**What changes for Stellr:** nothing in what runs. As built in wave 4, a cron with only Stellr's work read `tenants` once and could record a `tenants` failure; since wave 5 that run skips the read, so a `tenants` error in `cron_runs` can only come from a run where another tenant had work. Read it as a ledger signal, not a send failure.

**Preconditions it leaves:**

- The per-tenant `surveys` and `team-profiles` functions read with the service-role client by `event_slug`, so their isolation rests on slugs being unique across tenants. Before S8 makes slugs unique per tenant, those reads go through the job's scope, or check each row's `tenant_id`.
- `dispatchTeamProfiles`' path for named participants does not read the registration's tenant. That is correct while only CMS events take team profiles. The slice that lets tenant events take them adds the tenant there and drops inactive tenants' candidates.

**Proof still owed:** now that wave 4 is promoted, confirm in `cron_runs` that `surveys` still opens and invites.

### The two mail crons (B14)

On `dev` since #588 (wave 5), not promoted. A run with only Stellr's work is the runner's plain call: the same rows, order, budget, mail, failure labels and `cron_runs` result keys as before, and no read of `tenants`. The three `event_emails` reads and the `agreements` read now also select `tenant_id`. Only `event-emails` with the flag on can give another tenant a turn, and only then is `tenants` read, along with each such tenant's sender row; `docusign-reminders` hands the runner Stellr's envelopes alone, so it never reads `tenants`.

| Cron | How it splits | Another tenant's work |
|---|---|---|
| `event-emails` | Scheduled sends, the re-drive of sends left in `sending`, and catch-ups, per tenant, Stellr first. Stellr keeps Mountain time for "today" | **Held** unless `TENANT_EVENT_MAIL_ENABLED` is exactly `true`: its scheduled rows stay for a later run and are counted as `tenantHeld`, a result key that appears only when something was held. With the flag on, it sends from `"<Tenant> via Stellr" <no-reply@mail.stellreducation.org>` with the tenant's Reply-To (`tenants.branding.reply_to`), takes "today" from the tenant's time zone, sends only inside its own slice and stops between recipients when the slice is aborted. A tenant with no usable sender sends nothing (`t:<id>:sender`); a tenant that throws is recorded as `t:<id>:…` and the next one still runs. With the flag on, one more read finds tenants with only a re-drive or catch-up to do |
| `docusign-reminders` | Envelopes per tenant, Stellr first | **Held whatever the flag says,** and counted as `tenantHeld`. DocuSign stays Stellr's, and the signing engine's reminders go through its outbox, which has no tenant sender yet, so chasing a tenant's envelope would send it as Stellr. The slice that gives the signing engine a tenant sender lifts this (A11 is the nearest) |

**Guards in the library, not only the crons.** `sendEventEmail` and `sendCatchUp` (`lib/event-emails/send.ts`, `lib/event-emails/catch-up.ts`) answer 503 to a tenant row that arrives without its sender, before they claim or send anything, so no caller can send a tenant's mail as Stellr. Stellr's rows, with `tenant_id` NULL or Stellr's, never meet the check. The admin email routes under `events/[slug]` still give a tenant's staff C17's 503: B14 did not lift those refusals.

**A7's confirmation helper.** `sendTenantConfirmation` in `lib/event-emails/tenant-mail.ts` sends one transactional email from the tenant's sender. It refuses while the flag is off, for Stellr, and for a tenant with no sender, and it never throws. A7's register routes call it with the address on the row just saved and a fixed, escaped template, behind their rate limiter. Any new caller keeps those three rules (`docs/TENANCY-S5.md`, PR amendments).

**Before the flag is set anywhere:** the tenant's Reply-To is set, the tenant's events resolve through the events facade (until C8 and C25 give it a Postgres path, that means the CMS, which holds no tenant event), and the owner has named the slice that gives the signing engine a tenant sender. Until that slice lands, a tenant family's consent reminders are not chased by the cron.

**Proof still owed:** after promotion, confirm in `cron_runs` that both crons keep their result keys, with no `tenantHeld` and no `tenants` failure.

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

**One shared pool, by the owner's decision of 9 Nov 2026, until the move to SES.** `lib/email-budget.ts` keeps one daily counter with a transactional reserve, and B14 sends every tenant's mail through `sendEmail()`, so tenants count on the same row under the same rules, with no per-tenant allowance and no tenant argument. Event blasts keep the bulk class (`kind: 'marketing'`) Stellr's carry, so they stop at the same cap and skip unsubscribed addresses. Transactional mail is never refused by the counter; the reserve keeps bulk mail out, not any one sender. **The accepted risk:** one busy tenant can reach Resend's own daily limit, after which Resend refuses mail for every sender, Stellr included. Since #592 (9 Nov 2026, on `dev`), a send Resend refuses for its quota waits in `email_outbox` for the `email-outbox` cron rather than failing, so that refusal delays mail rather than dropping it; the signing engine's outbox opts out. B14 changes no counter code; the file gains a comment.

## Rate limiter

### What exists

| Piece | File | State |
|---|---|---|
| In-memory limiter, per warm instance | `lib/rate-limit.ts` | Live. It is what every route uses, and `proxy.ts` for `/credentials/` |
| Async API: `limit()`, `rateLimit()` | `lib/rate-limit-async.ts` | **Lane A's participant routes (A9):** the 5 register routes, check-in and its name count, the 8 signing routes, the 3 survey API routes, survey stop-reminders, survey link, team profile and credential events. B15 (Lane B's routes) is not built |
| Store client | `lib/rate-limit-store.ts` | Reached only by that API and the `entitlements` gc call |
| `rate_limit_hits`, `rate_limit_take()`, `rate_limit_gc()` | `supabase/migrations/20261105042629_rate_limit.sql` | On `dev` and production. Empty while `RATE_LIMIT_STORE` is `memory` |
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

**Store budget (A9).** Every new key is a new row, and a `rateLimit()` key suffix holds what the client sent (a slug, a token). So in `shadow` and `postgres` each route gives an IP 2,000 store calls an hour for suffixed keys, per instance, kept in a bounded map of its own so a spray of keys cannot evict it. Past that the IP keeps its in-memory decision on that route, as in `memory` mode. It slows the rows one client can write and adds no limit, and it is not a firm bound: a client rotating addresses, IPv6 within a prefix included, is not held by it. `limit()` has no budget, because its keys need not hold the IP: check-in's by-name count therefore always reaches the store, and an IP spraying names and slugs before the token check writes about one row per request. Watch `rate_limit_hits` during shadow. Whether that path gets an unsuffixed per-IP cap first is an owner decision (wave 4), since a venue's shared IP would feel it.

### Key hashing

Limiter keys hold IP addresses, and `check-in-name` keys hold minors' names. Only an HMAC-SHA256 under `RATE_LIMIT_KEY_SECRET` leaves the process, and the table's CHECK takes 32 bytes only. Without a secret of at least 32 characters nothing is sent at all.

- **Secret:** different per Vercel project. Changing it restarts every open window, which is harmless.
- **Tenant:** `tenantId` is required by the types, and only another tenant's id changes the key. So Stellr's keys stay as they are, and a tenant's traffic counts separately from Stellr's. A9's routes take it from `requestTenant()`, which answers Stellr without reading the request while routing is off. Because the count is per tenant, check-in and the register routes must refuse another tenant's event before tenant hosts go live, or the by-name tries and the hourly allowances would multiply with each host. A7 does this for the register, pay and pay-seat routes (wave 5); check-in waits on A12.
- **Logs:** shadow lines carry the route label and the two answers, no key. The 429 line keeps the IP, as the sync limiter's does.
- **Backups: open.** The table is UNLOGGED, but a logical `pg_dump` still includes its rows, and `ops/backups/backup.sh` does not exclude it. Owner decision from wave 2.

### Costs

One row per active key, one RPC per limited request, no WAL. One take in 100 also clears up to 200 expired windows, and `entitlements` runs `rate_limit_gc()` daily when the store is in use, recorded in `cron_runs` as `rate-limit-gc`. `test/rate-limit-proxy-closure.test.ts` keeps `proxy.ts` from reaching the store, so no database call joins the request path on every page. A database crash empties the table, which resets the current windows and nothing else.

### Flip procedure

**Not yet: B15 comes first.** A9 is built; without B15, shadow covers Lane A's routes only.

1. **Adopt.** A9 (built) and B15 move routes to the async API with the same limits, keys and 429 body. Every call is awaited (`test/rate-limit-await.test.ts`), because a Promise is truthy and an un-awaited guard blocks every request. A9's store and budget paths have run only against a mocked store, so the first shadow flip on `dev` is their first real run. `RATE_LIMIT_STORE`'s value on `dev` was not read for this record.
2. **Secret.** The owner creates `RATE_LIMIT_KEY_SECRET` per project. It is never pasted in chat or the repo.
3. **`dev` first**, then a redeploy of the newest READY deployment. Read a fresh list: a stored deployment id goes stale.
4. **Production `shadow`**, outside event hours, for at least 7 days, with a real event in the window if one is coming. Hobby's logs are short, so read them during the event.
5. **Read the shadow lines by route.** Expect few or none outside abuse. Any at `check-in` during an event means a venue's shared IP hit the wider count: raise that route's limit in a PR first, and do not flip.
6. **Production `postgres`, outside event hours.** A distributed count is stricter than per-instance counting, so venue Wi-Fi is the risk.
7. **Back out** by setting `memory` and redeploying. Nothing in the table needs clearing.

### What stays in memory

**`proxy.ts`'s `/credentials/` limit stays sync, on purpose:** 60 a minute per IP, per instance. A database call there would raise latency and the middleware share of Active CPU. Its cross-instance cover is the WAF rule (`docs/RUNBOOK-waf-rule.md`).

**`app/api/uploads/sign/audit-coalescing.ts` stays sync too.** It caps that route's audit rows per instance and does not limit the route, and a test pins it as Lane A's only remaining sync limiter use.

**Audit list.** A9 adds two GET handlers, `sign/context` and `sign/document`, to the unaudited GET writers, because their only write is the store counter. Lane A's PR needs the `audit-cap-grow` label unless the owner gives the store write an `OPERATIONAL_WRITERS` entry (wave 4). B15 meets the same question on any limited GET.

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
- **The register routes go through them since A7** (wave 5): each route's `stellr-hooks.ts` runs behind `isPlatformOwner`, so a tenant registration writes only its registration and participant rows. The tenant-surface baseline fell to 7 modules, 25 first-step imports and 16 table files. Team and sheet paths move in A8.

### The database CHECK (B9)

Migration `20261106234759_community_stellr_only_check.sql`, built in wave 4, applied to the `dev` database and then, with the owner's approval of the rule, to production on 9 Nov 2026, before #587 promoted wave 4. It adds CHECK (`tenant_id IS NULL OR` Stellr) to `community_spaces`, `community_resources`, `mentoring_cohorts` and `training_modules`, so a write that would stamp another tenant's event on them is refused with 23514. `STELLR_ONLY_CHECKS` in `lib/tenancy/registry.ts` lists the four. Every row today is Stellr's or NULL. Any re-apply runs outside event hours, because the file holds ACCESS EXCLUSIVE on all four tables through the validation scans (`lock_timeout` 5 s, then it rolls back).

- `syncEventSpace` writes nothing for an event the mirror gives another tenant, and fails the sync if the mirror read fails: the Sanity webhook answers 500, and Sanity's retry and `sync:event-spaces` catch up.
- Lane B's 11 inserts into three of the tables name `tenant_id: STELLR_TENANT_ID` (B16), the value log mode already stamped.
- **What it does not cover:** a tenant event published before its mirror row exists is stamped Stellr, so the check passes it. That first publish also takes an unadopted Stellr Space with the same slug, strips its grants, links it and copies the roster in. The mirror row coming first is the only protection there (`docs/TENANCY-S5.md`, Risks).

### The browser gate (B10(d), B9)

Built in wave 4, on a harness production build with Chromium, and run by `tenant-host-routing`, which stays report-only:

- `e2e/tenancy/no-trackers.spec.ts`: for both canary tenants, no third-party or `/_vercel` request, no CSP violation, no `window.dataLayer` or `gtag`, no banner, no tracker cookie and no hydration error. Every third-party request is aborted in the browser. The localhost control on the same build shows GTM, HubSpot, Vercel Analytics, Speed Insights, `dataLayer` and the banner loading.
- `e2e/tenancy/community-unreachable.spec.ts`: all 80 community and home entries answer 404 on a tenant host and on an unknown zone host, with a Stellr-host control.

The harness has no CMS, so the register form and check-in page have not been opened this way. D7's sign-off names who does so once a CMS fixture exists.

### What is not built

| Control | Slice |
|---|---|
| The two community `TODO(S5)` IDOR snapshot entries: the check now holds those tables to Stellr or NULL, and Lane C changes the text | Lane C, after B9 |
| Team-leader add and edit and the roster sheet import through the hooks | A8 |
| A tenant sender for the signing engine, so `docusign-reminders` can chase a tenant's envelopes | No slice named; A11 is the nearest |
| `tenant-host-routing` as a required check | Owner decision |

Until then, keep `TENANT_ROUTING_ENABLED` off on any deployment with a zone attached (see `docs/TENANCY-S5.md`, Real tenant hosts).
