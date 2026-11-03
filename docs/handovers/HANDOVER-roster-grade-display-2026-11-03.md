# Handover — roster grade display (3 Nov 2026)

Slug: `roster-grade-display`. Tracker: `tracker/2026-11-03-roster-grade-display.md`.
PR #498 → `dev` as `1487d95b`. **Not promoted.** Migration: none.

## Context

The admin event roster (`/admin/competitions/<slug>?tab=roster`) showed the
Grade column in two shapes side by side: `11` and `grade_10`.

`participants.grade` is free text, and the write paths disagree:

- `app/api/register/individual` stores the form value, a bare number (`"10"`).
- `app/api/register/group` (when a participant has a member profile on file)
  and `app/api/register/group-join` copy `members.grade`, the `grade_type`
  enum (`"grade_10"`).

The roster rendered `p.grade` as stored.

## What changed

- `displayGrade(v)` in `lib/member-enums.ts`, beside `displayEventRole`:
  school grades as a bare number for either shape (`normalizeGrade` →
  `denormalizeGrade`), college grades as their form label, unrecognised
  values passed through, empty → `undefined`.
- Used in `components/admin/EventRoster.tsx` (desktop table and mobile cards)
  and the roster CSV export `app/api/admin/events/[slug]/export/route.ts`.
- Tests in `lib/member-enums.test.ts` (`displayGrade` block).

Display only. Stored values are still mixed.

## Not verified

- No one has looked at the roster in a browser since the change: not on
  local, the `dev` alias, or production.
- The `dev` deployment of `1487d95b` was not checked with `list_deployments`.
- CI on #498: verify (typecheck, unit, lint, build) and e2e all passed step by
  step; e2e does not cover the roster grade cell.

## Open items

See the tracker file. In short: promote, look at a real roster, decide on a
write-side fix, and route the other grade readers through `displayGrade`.

Other readers of `participants.grade` that still show the raw value:

- `app/api/registrations/[id]/spreadsheet/route.ts` (member-facing team
  spreadsheet).
- `components/admin/EventTeamProfiles.tsx:223` has its own inline regex that
  already handles both shapes; it could use `displayGrade` (it prefixes
  "Grade ").
