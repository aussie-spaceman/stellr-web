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
