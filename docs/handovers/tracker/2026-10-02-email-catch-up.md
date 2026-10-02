# Late-registrant email catch-ups — 2026-10-02

Slug: `email-catch-up`. Handover: `HANDOVER-email-catch-up-2026-10-02.md`. Doc snapshot: `10c-XhRvu-FBRtgsUQ1cB7JXz7EhfEATxxHPdzAM0wRo`.
PR #263 → `dev` as `02586bc`; promoted in #265 (`40ea376`, production `dpl_BKHKZerVyZGooducgDgocovkTjXy`); record + sync #266. Migration: `20261002164507_event_email_catch_up` (dev + prod, both ledgers).

People who register after an email went to All participants now get it. Their guardian does too, if the email went to guardians. The cron sends it in 3 daily slots, or an admin presses **Send to N late registrants** in the Email Reminders tab. Each run is its own History row ("Late registrants").

| # | Item | State | Next | Done |
|---|---|---|---|---|
| email-catch-up.1 | CO SDC "2 Days Out" catch-up | **Sent 2 Oct 18:18Z** by David with the tab's button: a `catch_up` row in `event_email_sends`, 3 recipients, 3 sent, 0 failed, groups participants + guardians. A prod read shows both late registrants (2 Oct 00:55Z, 13:19Z) and their guardians now in the sent set. It was 3 addresses, not the 4 forecast: the second student's emergency-contact email is their own, so one copy covered both roles (one-per-address rule). | — | ☑ |
| email-catch-up.2 | Automatic (cron) path not yet seen sending | The manual path is proven in prod (.1). The cron pass has unit tests only. Its first prod run (19:00Z, 2 Oct) should find nobody owed and write no History row. | Read the next `cron_runs` `event-emails` rows: `catchUpEmailed` present, no `catch-up:` errors. The first real automatic send needs a registration after an All-participants email for a future event. | ☐ |
| email-catch-up.3 | Failed addresses are not retried | Decision taken in-session and not raised with the maintainer. Any address a previous send *tried* counts as having had it, so a bounce on the original is never retried by catch-ups. It stays visible in History. | Maintainer: accept, or change `alreadyTriedAddresses` to count only `status: 'sent'` (risk: a hard-bouncing address retried 3×/day until the event). | ☐ |
| email-catch-up.4 | Only emails sent to All participants | Per the ask. Late registrants still miss guardian-only emails and the "outstanding" chasers. The chasers resolve fresh at send time anyway. | None unless the maintainer wants guardian-only emails caught up too (one-line change in `catchUpAudiences`). | ☐ |
| email-catch-up.5 | Misleading copy when the event is missing from Sanity | `catchUpStatus` returns `open: false` for both "event passed" and "event not found", and the panel says "The event has passed". This only affects Postgres-only fixture events (e.g. `seed-regional-challenge`, whose admin page 404s anyway). | Low. Split the two cases if a real event ever lacks a Sanity date. | ☐ |
| email-catch-up.6 | Pending registrations count as registered | The roster (and so the catch-up) includes every non-`withdrawn` registration, unpaid ones too. That matches how All participants is resolved for normal sends. | None, unless the maintainer wants unpaid registrants excluded. | ☐ |
| email-catch-up.7 | Signed-in prod view of the panel | David used the panel on prod to send .1, so it renders and sends there. Its "Everyone registered has this" state after the send has not been looked at. | Optional: reopen "2 Days Out" on prod and confirm the empty state. | ☐ |

## Closes

- None. Related: `event-email-reminders` 21.x rows are untouched. This adds behaviour; it does not close them.
