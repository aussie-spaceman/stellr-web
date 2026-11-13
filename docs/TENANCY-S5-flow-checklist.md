# The 30-day Stellr flow checklist (D7)

The gate for M1: Stellr runs as tenant #1 with no visible change. For 30 days on production, on the converted code, every Stellr flow works and leaves evidence. Plan of record: `docs/TENANCY-S5.md`, section Gates.

**The sign-off is the owner's.** An agent may gather evidence and fill in the evidence column. It does not fill in a sign-off.

## How to use it

**When the clock starts.** On the first day production runs the code the gate is about: the conversion slices promoted, and each flag set to the value it will keep. A change to a flag or a promotion that touches a flow restarts that flow's row, and the owner decides whether it restarts the rest. Not started: S5 is still merging to `dev`.

**What counts.** A real use on production in the window. Where the window holds no real use, the owner says how to exercise it, or records why not. A green test does not replace a row, and a row does not replace a test.

**Where to look.** Vercel Hobby keeps runtime logs for an hour, so the database is the evidence. Read it, do not assume it. A flow that fails silently shows as a missing row, not as an error.

**The repo is public.** Record dates, counts, event slugs and `members.id` here, never a name, an email, a date of birth, a credential number or a Stripe or Clerk id. Keep query output that holds them off the repo.

**Applies to every flow below:** in the window, no row in `app_errors` for that flow's routes that nobody has read.

```sql
SELECT route, message, count, occurred_at, last_seen
FROM public.app_errors
WHERE last_seen >= now() - interval '30 days'
ORDER BY last_seen DESC;
```

## The flows

Each row needs a window, a note of what was seen, and the owner's sign-off.

| Flow | Routes | Evidence source | Pass | Automated cover |
|---|---|---|---|---|
| **Individual registration** | `app/api/register/individual/route.ts`, `app/api/register/pay/route.ts` | `registrations`, `participants` by `event_slug`. A priced event: Stripe Dashboard, `stripe_webhook_events` | Rows written; paid state follows payment; confirmation email received | `e2e/core/registration-resume.spec.ts`, `app/api/register/individual/route.characterisation.test.ts` |
| **Group, by invoice** | `app/api/register/group/route.ts`, `lib/group-billing.ts` | `registrations`, `member_groups`, `group_invoices`, Stripe Dashboard | Invoice created for the right seats and amount; marked paid; roster change follows | `app/api/register/group/route.characterisation.test.ts` |
| **Group, by card** | `app/api/register/group/route.ts`, `app/api/register/pay/route.ts`, `app/api/register/pay-seat/route.ts` | `registrations`, Stripe Dashboard, `stripe_webhook_events` | Checkout completes; paid state follows | same |
| **Group-join** | `app/api/register/group-join/route.ts` | `participants` on the group's registration | Student joins by the link; correct row; consent flow starts for a minor | `app/api/register/group-join/route.characterisation.test.ts` |
| **Signing** | `app/api/sign/**`, `lib/esign/**` | `agreements`, `agreement_recipients`, `esign_audit_events` | Issued, signed, sealed; audit chain intact; signer's copy opens | `e2e/core/esign-signing.spec.ts` |
| **Survey** | `app/api/survey/**`, `lib/survey/**` | `survey_invitations`, `survey_responses`, `cron_runs` job `surveys` | Invitations sent after an event; a real response recorded; reminder stops on request | `e2e/core/survey.spec.ts` |
| **Check-in desk** | `app/api/check-in-desk/manifest/route.ts`, `lib/check-in-desk.ts` | `participants.checked_in_at`, `check_in_method`. `docs/RUNBOOK-event-check-in.md` | The desk loads its manifest and checks people in at a real event, including with no signal | `e2e/core/check-in-desk.spec.ts` |
| **Check-in QR** | `app/api/check-in/route.ts` | same | A participant's QR checks them in once; a repeat says already checked in | same |
| **Credentials** | `app/(public)/credentials/**`, `app/api/credentials/**` | `credentials`, `credential_events` | Issued and emailed; public page, PDF and badge open; family link opens | `e2e/core/credentials.spec.ts`, `e2e/core/mentor-credentials.spec.ts`, `e2e/core/pd-credentials.spec.ts` |
| **Refunds** | `lib/refunds/**` | `event_refunds`, Stripe Dashboard | Refund issued, recorded once, registration state follows | `lib/refunds/redeem.test.ts` |
| **Scholarship** | `app/api/scholarship/route.ts`, `lib/scholarship-*.ts` | `scholarship_applications`, Stripe Dashboard for a coupon | Application recorded; offer issued; coupon applies at checkout; cancellation works | |
| **Admin event screens** | `app/(admin)/admin/competitions/**`, `app/api/admin/events/**` | Owner and an event manager, by hand. `member_activity_log` for writes | Roster, exports, emails, check-in and paperwork all load. An event manager sees only their own events | `e2e/core/admin-nav.spec.ts`, `e2e/core/access-control.spec.ts` |

| Flow | Window | What was seen (no personal data) | Owner sign-off |
|---|---|---|---|
| Individual registration | | | |
| Group, by invoice | | | |
| Group, by card | | | |
| Group-join | | | |
| Signing | | | |
| Survey | | | |
| Check-in desk | | | |
| Check-in QR | | | |
| Credentials | | | |
| Refunds | | | |
| Scholarship | | | |
| Admin event screens | | | |

## The crons

All 23, from `vercel.json` and `lib/cron-scope.ts`. Schedules are UTC. Evidence is the `cron_runs` ledger, which every cron writes through `lib/cron-runs.ts`. `ok` is false when any failure was recorded, and a run killed mid-way never finishes.

```sql
SELECT job,
       count(*) AS runs,
       count(*) FILTER (WHERE ok) AS ok_runs,
       count(*) FILTER (WHERE finished_at IS NULL) AS unfinished,
       max(started_at) AS last_run
FROM public.cron_runs
WHERE started_at >= now() - interval '30 days'
GROUP BY job
ORDER BY job;
```

Once a cron moves to `runPerTenant`, add `AND parent_id IS NULL` to count top-level runs only (it needs the `cron_runs_tenant` migration). Pass means: it ran on its schedule, the runs finished with `ok`, and what `result` says it did makes sense. A run with no work to do is a pass. A missing day is not.

On `dev` these rows prove little: the crons decline there, because `guardCron()` sees `APP_ENV=dev`.

| Cron | Schedule | Class | Runs seen / ok | Owner sign-off |
|---|---|---|---|---|
| `alumni-upgrades` | 08:00 daily | Stellr-only | | |
| `apollo-reconcile` | 11:00 daily | Stellr-only | | |
| `background-sync` | 06:30 daily | Stellr-only | | |
| `campaign-drip` | 07:30 daily | Stellr-only | | |
| `campaign-events` | 07:00 daily | Stellr-only | | |
| `campaigns` | 09:00 daily | Stellr-only | | |
| `deletion-archive-retention` | 04:00 on the 2nd | Platform | | |
| `docusign-form-data` | 09:15 daily. Also writes job `esign-maintenance` | Stellr-only | | |
| `docusign-reminders` | 09:00 daily | Per tenant | | |
| `entitlements` | 05:00 daily. Also sends the error digest | Platform | | |
| `event-emails` | 15:00, 17:00, 19:00 daily | Per tenant | | |
| `group-invoice-sync` | 09:45 daily | Per tenant | | |
| `hubspot-event-options` | 04:45 daily | Stellr-only | | |
| `hubspot-lifecycle` | 04:00 daily | Stellr-only | | |
| `lead-capture-failures` | 13:00 Mondays | Stellr-only | | |
| `membership-expiry` | 06:00 daily | Stellr-only | | |
| `motion-bookings` | 12:00 daily | Stellr-only | | |
| `session-reminders` | 10:00 daily | Stellr-only | | |
| `survey-retention` | 03:00 on the 2nd | Per tenant | | |
| `surveys` | 07:00, 16:00, 22:00 daily | Per tenant | | |
| `team-profiles` | 09:45 daily | Per tenant | | |
| `training-reminders` | 09:00 daily | Stellr-only | | |
| `weekly-digest` | 18:00 and 19:00 Fridays | Stellr-only | | |

A monthly cron shows one run in 30 days, so read that one run closely.

**The inbox matters as well as the ledger.** For `weekly-digest`, `entitlements`' error digest, `event-emails`, `surveys` and `docusign-reminders`, also confirm that a real message arrived. The ledger says a send ran, not that it reached an inbox.

## Closing it

| | |
|---|---|
| Clock started (date, deployment SHA) | |
| Flags in force (`AUTHZ_SOURCE`, `LOADSCOPED_MODE`, `TENANT_DB_ENABLED`, `PLATFORM_AUDIT_ENABLED`, `RATE_LIMIT_STORE`, `TENANT_ROUTING_ENABLED`) | |
| Restarts, with the reason | |
| Rows the owner accepted without a real use, with the reason | |
| Clock ended (date) | |
| **Owner's sign-off for M1** | |

## The dev canary tenant (K8, K9)

Not part of the 30-day gate above: this is wave 7's end-to-end run of a fictitious second tenant, `dev-canary`, on `dev` (`docs/TENANCY-S5.md`, Wave 7 status, "How to run K9"). The scenarios and the S7 table come from `lib/testing/canary-flow-scenarios.ts` (K8, #659), which wins over this copy; `npx tsx scripts/canary-tenant-flow.ts --plan` prints them and sends nothing. The runner prints ids, counts and status codes only. **Not run yet:** Phase A waits on K7a, K0 and K7b; Phase B on K6 (`docs/TENANCY-S5-routing.md`, "The dev canary zone (K6)") and P10 to P12.

### Scenarios

| Id | Scenario | Phase | Personas | Evidence read back |
|---|---|---|---|---|
| S1 | An adult registers | start | none | 201; `registrations` and `participants` rows stamped `dev-canary`; no guardian-consent row. A 201 the database does not hold as `dev-canary`'s stops the phase |
| S2 | A minor is held pending consent | start | none | 201 with `consentPending` and `guardianInvited`, for two minors; each has a pending `tenant_guardian_consents` row stamped `dev-canary`, its window closing before the event, and a `tenant_guardian_consent` agreement |
| S3 | Check-in is refused while pending | start | `canary-manager` | The desk's manual check-in answers 409 `guardian_consent_pending`; `participants.checked_in_at` stays empty |
| S4 | The pending minor is left out of tenant mail | start | none | `unconsentedParticipantIds(dev-canary)` holds both minors and not the adult; no `event_email_sends` row since the start names a minor or a guardian |
| S5 | After the guardian signs | settle | `canary-manager` | The consent row is signed and settled, its agreement completed, the minor is out of the unconsented set, and the desk checks them in (then undoes it) |
| S6 | After the guardian declines | settle | none | The registration and participant are removed, the consent row with them; a declined row still waiting for removal is reported with its attempt count |
| S7 | Isolation probes | start | `canary-manager`, `canary-admin`, `stellr-probe-admin` | Every probe answers as the table below says for the run's modes; known gaps are named by slice |
| S8 | Stellr unchanged | start and settle | none | Stellr's pages answer 200; the Stellr event's registration count is unchanged; every registration the run made is `dev-canary`'s; every `app_errors` row since the start is one the table expects |

Between the phases, the guardian signs one consent and declines the other in the role inbox, with the owner as witness. A persona with no session is skipped, and a skip is never a pass.

### S7: the isolation probes, by mode

Mode is `AUTHZ_SOURCE` / `LOADSCOPED_MODE`. "Any" means the answer is the same in all nine combinations. "+ LOADSCOPED row" means `shadow` also writes a `LOADSCOPED <route>` row to `app_errors`; under `AUTHZ_SOURCE=shadow`, P11 and P12 also write an `AUTHZ <route>` row. Those rows are expected; any other `app_errors` row fails S8.

| Probe | What it checks | As | Host | Expected |
|---|---|---|---|---|
| P1 | The unmapped probe host | anonymous | `nobody.<zone>` | Any: 404 |
| P2 | `/admin` on the canary host | anonymous | `canary.<zone>` | Any: 404 |
| P3 | An admin API on the canary host, even for a Stellr admin | `stellr-probe-admin` | `canary.<zone>` | Any: 404 |
| P4 | `dev-canary`'s register page on Stellr's host (A7) | anonymous | Stellr | Any: 404 |
| P5 | Registering for `dev-canary`'s event through Stellr's host; nothing written (A7) | anonymous | Stellr | Any: 404 |
| P6 | `dev-canary`'s check-in page on Stellr's host | anonymous | Stellr | Any: 200, **known gap A12** |
| P7 | `canary-manager`'s desk for their own event, and the pending minor's consent marker | `canary-manager` | Stellr | Any: 200 with no marker, **known gap `.23`** |
| P8 | `canary-manager` on a Stellr event's desk | `canary-manager` | Stellr | Any: 403 |
| P9 | A group check-in of the adult and a pending minor | `canary-manager` | Stellr | Any: 409 for the whole group, **known gap `.24`** |
| P10 | `canary-admin` (tenant admin, no Clerk role) on Stellr's admin health route | `canary-admin` | Stellr | Any: 403 |
| P11 | `canary-manager` on their own event's email tab, on Stellr's host | `canary-manager` | Stellr | `clerk` or `shadow` with `off`: 200; with `shadow`: 200 + LOADSCOPED row; with `enforce`: 404. `postgres`, any: 403 |
| P12 | `stellr-probe-admin` on `dev-canary`'s event's email tab | `stellr-probe-admin` | Stellr | `clerk` or `shadow` with `off`: 200; with `shadow`: 200 + LOADSCOPED row; with `enforce`: 404. `postgres`, any: 404 |
| P13 | `stellr-probe-admin` loads `dev-canary`'s pending consent agreement by id | `stellr-probe-admin` | Stellr | `off`: 400 (found, unsigned); `shadow`: 400 + LOADSCOPED row; `enforce`: 404 |
| P14 | Stellr's agreements list holds `dev-canary`'s consent agreement | `stellr-probe-admin` | Stellr | Any: 200 and it is listed, **known gap `.29`** |
| P15 | `dev-canary`'s signing link on Stellr's host | anonymous | Stellr | Not run, **known gap A11**: opening a link records a view on the guardian's envelope |
| P16 | A Stellr event's register page on the canary host | anonymous | `canary.<zone>` | Any: 404 |
| P17 | Registering for a Stellr event through the canary host; nothing written | anonymous | `canary.<zone>` | Any: 404 |

**Known gaps and who closes them:** A11 (slice A11: the e-sign participant side has no tenant check on Stellr's host), A12 (slice A12: `/check-in/<slug>` answers for another tenant's event on Stellr's host), `.23` (tracker `s5-programme.23`: no "waiting for guardian consent" marker on the desk), `.24` (`.24`: a group check-in with one pending minor refuses the whole group), `.29` (`.29`: a Stellr-only admin list includes another tenant's rows). A probe that answers the closed state instead is reported as differing, and the table changes in the same PR that closes the gap.

### Pass, and the run record

Pass: S1 to S6 and S8 green; S7 as the table says for the modes in force, with the known gaps named; 0 unread `app_errors` rows, a CI-origin one included (`PR659-3`); at most 25 canary sends a day (`W7-21`), counted by the operator. The optional supervised `AUTHZ_SOURCE=postgres` window (`W7-22`) re-runs S7 against the `postgres` rows.

| Run | Phase and modes | Date | S1 to S8 | S7: pass / known gap / differs / skipped | Sends that day | Notes (ids and counts only) |
|---|---|---|---|---|---|---|
| | | | | | | |
