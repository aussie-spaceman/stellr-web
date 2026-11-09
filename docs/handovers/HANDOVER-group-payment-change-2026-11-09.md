# Handover: change how a group pays — 2026-11-09

Tracker: `docs/handovers/tracker/2026-11-09-group-payment-change.md` (rows `group-payment-change.1`–`.7`).

## Context
A teacher emailed asking to move their invoiced group to individual payment. Until now the way a group paid was fixed at registration. The owner asked for staff (roster) and teachers (portal) to be able to change it, using only the existing payment types, closing the old way to pay and starting the new one.

Owner decisions:
- **Who:** admins and event managers assigned to the event, from the roster; the teacher and Teacher POC from Account → Teams. Student managers see it read-only.
- **What moves:** the unpaid balance only. Places paid individually stay paid; a group whose own payment is taken can't change.
- **Individual** means the existing emailed per-person pay links.
- **Scope increase:** pay links work whatever the event's registration status, for individual registrations as well as groups.

## What changed (#573, promoted in #574)
- `lib/group-payment-change.ts`: `changeGroupPaymentMethod` runs under the invoice lock. It refuses if a Checkout payment is in flight, expires open sessions, voids open invoices (refusing if a void fails), compare-and-sets the registration, then starts the new method: a new invoice for owed places, a card pay link, or per-person links. It emails the organizer (cc the POC) and alerts staff on failure or when an organizer made the change. `notePaymentAfterMethodChange` is called from the Stripe webhook when a payment lands on an old path.
- `lib/group-billing.ts`: `billableSeats` (declared minus paid individually) used across invoice create, revise, settle, summary, discount and correction.
- `lib/payment-status.ts`: a place paid individually counts as paid on an invoiced group.
- Group discount carries to card checkout, and to per-person checkout when it's a percentage.
- Routes: `app/api/admin/registrations/[id]/payment-method` and `app/api/members/teams/[id]/payment-method` (GET view, POST change, both `withAudit`; non-managers get 404).
- UI: `components/registration/GroupPaymentMethod.tsx`, used in `EventRoster` and `TeamsTab`.
- `registrationIsOpen` gates removed from the pay and pay-seat routes and pages.
- Ratchets updated: audit actions, route manifest, IDOR snapshot, stellr-only dispositions (cap 53), tenant-surface counts, service-role reasons, unaudited GETs (`audit-cap-grow`).

## Verified
- Unit suite (10,033), CI on #573 and #574 read step by step.
- Test-mode drill on the dev database with real Stripe test calls: invoice → individual → invoice → card → invoice, then paid and refused. Data removed.
- Signed-in local checks of the teacher section, dialog and roster link; an event manager refused on an event they don't manage.
- Production after the merge: deployment completed, www 200, app 307, cron guard 401, both new routes 401 anonymously.

## Not verified
- Confirm clicked in a browser (`.4`), the late-payment alert (`.6`), anything against live Stripe, a real audit row (`.5`). The first real change (`.3`) covers most of this.

## Open items
See the tracker. Most important: reply to the teacher (`.2`), then watch their change (`.3`). The production check for groups already recorded as owing $0 (`group-price-refusal.3`) is still owed and needs the owner's say-so to query production.
