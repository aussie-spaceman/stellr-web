# Handover: Resend quota — mail is delayed, never dropped (2026-11-09)

Slug `resend-quota-outbox`. Tracker: `tracker/2026-11-09-resend-quota-outbox.md`.

**Not promoted.** The code is on `dev` only (#592, squash `6e8b1066`). Production still sends the old way, so a quota refusal there can still lose an email until `resend-quota-outbox.1` is done. Promotion is a separate session, by the owner's choice.

## Context

On 9 Nov Resend warned that the team had used 80% of its daily quota. The Free plan allows 100 emails a day and 3,000 a month, shared by everything Stellr sends. The owner asked for a codebase-wide review, and for explicit confirmation that every web-app email is still sent (only delayed) when the limit is reached.

Every email reaches Resend through `sendEmail` (`lib/email.ts`) and the one transport (`lib/email/transport.ts`); nothing else calls Resend. On a refusal, `sendEmail` threw `EmailSendError(429)`. Only four callers handled it: campaigns, event emails, survey invites and the e-sign outbox. Everywhere else, about 50 call sites, the email was lost or the request failed. That included registration confirmations, pay links, credentials, invites, staff alerts and contact forms. Survey reminders were lost as well: the reminder is claimed before it is sent, so a throw used up the reminder.

## What changed

- **`sendEmail`** no longer throws on a refusal that will pass. That covers a 429 for the daily or monthly quota, 5xx, 401/403 and network failures. The finished message, already routed and past the suppression check, is written to `email_outbox`, and the caller gets `{ id: null, queued: true }`. A `rate_limit_exceeded` 429 is retried inline using Retry-After, up to 3 tries. Only 400/422 (an invalid message) still throws. If the outbox itself can't be written, the original error is thrown, as before.
- **Marketing held back by the transactional reserve** (`lib/email-budget.ts`) is queued for a later day instead of throwing.
- **`lib/email/outbox.ts`** holds `enqueueEmail` and `drainEmailOutbox`. **`/api/cron/email-outbox`** runs at 00:05, 06:05, 12:05 and 18:05 UTC. Each run:
  - sends transactional mail first, oldest first, and stops at the next refusal;
  - claims each row before sending it, with Idempotency-Key `email-outbox/<row id>`;
  - takes back stale claims after 10 minutes;
  - re-checks the suppression list at send time;
  - backs off outages (30 minutes, doubling, at most 12 hours);
  - stores each attachment file once (`email_outbox_blobs`);
  - deletes sent and suppressed rows after 14 days.

  The cron run is marked failed when mail has waited more than 48 hours, or when Resend rejected a message as invalid.
- **The e-sign outbox** passes `deferOnFailure: false`. It is already durable: a signer whose email did not go keeps `invite_sent_at` null, and `drainOutbox` retries it from the `docusign-reminders` and `event-emails` crons with no attempt cap. It also needs Resend's real id in `invite_email_id`, because the bounce webhook matches on it.
- **Migration `20261109224229_email_outbox.sql`** adds two service-role-only tables and `prune_email_outbox_blobs()`. It is applied to the dev database (`xvxlhbxtiwxpopoqjygm`), and the migration ledger row matches the filename.
- **Guard tests and baselines** are updated for the new cron: cron scope `platform`, the route manifest, the maxDuration floor, the audit and service-role baselines (class `system`), tenant-surface counts, and the tenancy registry and regenerated pgTAP.

## Confirmation by path (once promoted)

| Mail | When Resend refuses |
|---|---|
| Every `sendEmail` caller except e-sign (registration, payment, group, credentials, invites, refunds, staff alerts, contact forms, community, scholarships, training, digest, campaigns, event emails, surveys) | Queued, sent by the email-outbox cron |
| Marketing over the transactional reserve | Queued, sent on a later day |
| E-sign invitations and reminders | Their own outbox, retried four times a day |

Still not sent:
- **Mail Resend calls invalid** (400/422). It is marked `failed` with the error kept.
- **Mail to an address suppressed while it waited.** It is marked `suppressed`.

Still a gap:
- **The database is down at the moment Resend refuses.** The email can't be queued, so the caller gets the old error.
- **The monthly quota holds mail until the month resets.** It is delayed, not lost, but that can be weeks.

## Verified

- **CI on #592:** every step was read, not just the badges. Typecheck, build, lint, migration lints and the unit suite passed. The `db` job applied the migration and ran pgTAP. `e2e-tests / Run npx playwright test` and `e2e-local` passed.
- **Locally:** 562 test files and 11,559 tests passed. The new tests are `lib/email-send.test.ts` and `lib/email/outbox.test.ts`. The claim-race test was mutation-checked: it fails when the claim guard is removed.
- **Live against the dev database, with Resend stubbed (no real mail sent):**
  - three refused sends were queued, one of them with an attachment;
  - a drain that met the quota again stopped and kept all three;
  - the next drain sent all three, the retried row with the same idempotency key;
  - the test rows were removed.

  The check added 3 to dev's `email_send_quota` count for 9 Nov. That is harmless.

## Not verified

- **The cron on a real deployment.** Crons skip outside production, so it has never run for real.
- **Resend's real 429 body and the Idempotency-Key header.** Neither has been seen from Resend: the error names (`daily_quota_exceeded`, `monthly_quota_exceeded`, `rate_limit_exceeded`) and the header come from Resend's documentation. An unrecognised 429 name is treated as the daily quota, so the mail is still queued, not lost. A rate-limit 429 with a different name would be queued rather than retried inline.

## Open items

See the tracker file. In short:
- `.1` promote, with the migration applied to production first;
- `.2` read the first production drain;
- `.3` confirm Resend's real 429 body;
- `.4` the owner's plan decision;
- `.5` make a stale outbox visible to staff;
- `.6` "queued" shows as "sent";
- `.7` the database-down gap;
- `.8` worktree cleanup.
