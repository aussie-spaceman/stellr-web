# Handover — Event Manager role + uploaded background checks (9 Nov 2026)

Tracker: `tracker/2026-11-09-event-manager-role.md`. PR #581 → `dev` (`06edb07b`). **Not promoted** — a separate session promotes, and it must apply migration `20261109120000` to prod first (row `.1`).

## Context

The owner needed to make a Stellr staff member an Event Manager for the Minnesota event (name in the Doc). The only way was a hand edit of Clerk `publicMetadata` plus the event's Overview panel. The owner asked for it to be an event-specific role assigned from the member page, under Classification, as a checkbox only an admin can use, with attention to safeguarding (minors' data) and security. Mid-session they added a second item: let members upload a background check they already hold.

Owner decisions (asked as clarifying questions, all answered):

- Gate: cleared adult only, no override. A verified teaching licence counts.
- Clerk role: set and cleared automatically.
- Expiry: event end + 30 days by default, shown as "Expiry date", editable by an admin.
- Notify: activity log plus an email to the person.
- Uploaded check: member and admin can submit; valid 3 years from completion; issuer required; once verified it clears for everything a background check clears for.
- Uploaded check vs licence: same flow, minus number and state, document mandatory.

## What changed

**Event Manager** (`lib/event-manager.ts`, one service behind both screens)
- `decideEligibility`: active member, Clerk login, known DOB, 18+, and `valid_bc` / `valid_license` derived as a BC-required role. `awaiting_verification` refuses.
- Expiry: default `eventLastDay + 30` (undated: today + 30). Stored as end of that day UTC. Refused if in the past, more than a year past the event, or past the clearance.
- Readers ignore expired rows via `lib/event-manager-active.ts`: `lib/event-access.ts`, `lib/authz/principal.ts` `loadAssignments`, and `lib/authz/audiences.ts` (event emails use it).
- Clerk role set on the first grant, cleared with the last active one. `admin` and unknown roles are never touched.
- `recheckEventManagerClearance` revokes all of a person's assignments the moment clearance is withdrawn. Wired into: uploaded-check save/unverify/delete, admin licence save/unverify, member licence re-entry and re-upload, and adjudication `not_cleared`.
- `sweepEventManagers` is chained into the `membership-expiry` cron (no new cron, Hobby limit). It deletes expired rows and removes gated holders who lapsed.
- Routes: `app/api/admin/members/[id]/event-manager` (GET / POST / PATCH / DELETE, `isStellrAdmin`, `withAudit` `role.event_manager.*`). `/api/admin/event-managers` (event Overview panel) now calls the same service.
- UI: `components/admin/MemberEventManagerRole.tsx` in Classification (admin only); the Overview panel shows each expiry.

**Uploaded background check** (`lib/external-background-check.ts`)
- Table `member_external_background_checks`: one per member; issuer, `completed_on`, optional `document_expires_on`, `document_path` NOT NULL, `verified_*`, `submitted_by`.
- Upload purposes `external-bc-document` and `external-bc-document-admin`. Same private bucket as licences, under `<memberId>/bc/`, claim pinned to that prefix.
- `lib/compliance.ts`: `deriveCompliance(..., external)`. Verified and unexpired gives `valid_bc` with `clearedBy: 'external_background_check'`; unverified gives `awaiting_verification`. A `not_cleared` adjudication still dominates. Every caller passes it.
- Verify is bound to `updated_at` (BG-9). Staff are alerted on a member upload; the member is emailed on verify.
- Routes: `app/api/members/compliance/external-check` (member), `app/api/admin/members/[id]/external-check` (admin; GET is a 10-minute signed URL).
- UI: `components/compliance/ExternalCheckForm.tsx`, used on the account page and in the admin panel. The admin Background Check panel now shows for any adult who isn't a known minor.

**Migration** `20261109120000_event_manager_expiry_external_bc.sql`
- `event_manager_assignments` gains `expires_at`, `member_id`, `clearance_basis`, `granted_by_label`, `updated_at`, with a backfill from `members` and the events mirror.
- Revokes the inert anon/authenticated grants on `event_manager_assignments`.
- Creates the new table with an explicit service_role grant.
- Applied to dev through the MCP; ledger realigned to the filename.

**Guardrails updated:** audit action catalogue, route manifest, stellr-only dispositions, tenancy registry and pgTAP, service-role inventory (reasons written by hand), IDOR snapshot (both admin routes refuse every method for non-admins), tenant-surface counts, authz idiom list (`lib/event-manager.ts` added as a role-table manager).

## Verified

- CI on #581: every job green, read by step. The `db` job applied migrations and ran pgTAP (its first failure was the runner failing to start its container; the re-run passed). `e2e-tests` ran Playwright; `unit` and `verify-build` passed.
- Locally after merging dev: 11,382 unit tests.
- Signed in on a local server against dev, read-only, as the e2e fixtures:
  - the admin member page shows the checkbox with the right refusal reasons;
  - assigning an uncleared adult or a minor returns 409 and writes nothing;
  - the event-manager and member fixtures get 403 on both admin routes;
  - the account page and admin panel show the upload option.
- `stellr-web-dev` deployment for `06edb07b` completed.

## Not verified

A real grant (Clerk role change, portal access, email); a real document upload and verify; the cron sweep outside unit tests; email rendering in an inbox. These are rows `.3`–`.5`.

## Open items

See the tracker file: `.1` prod migration (HIGH), `.2` the MN grant itself, `.3`–`.5` first real use, `.6` assignments made before the gate, `.7` document retention and storage cleanup on deletion, `.8` no signed acknowledgement from Event Managers.
