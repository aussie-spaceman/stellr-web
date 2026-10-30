# Handover — Check-in desk: groups, scanning, offline — 30 Oct 2026

Slug `check-in-desk`. Tracker: `tracker/2026-10-30-check-in-desk.md`. Staff steps: `docs/RUNBOOK-event-check-in.md`.
Builds on check-in v2 (`HANDOVER-event-check-in-v2-2026-10-08.md`) and the banner (`HANDOVER-check-in-banner-2026-10-15.md`).

## Context

David asked whether to build an iOS registration and check-in app like RegFox's, for checking in large groups of students fast. The investigation compared:

- our code and production data;
- RegFox;
- Eventbrite Organizer, Cvent OnArrival, zkipster, Ticket Tailor and Planning Center Check-Ins.

Report (private artifact): https://claude.ai/artifact/LkvVkPCdkUeEpVvduhEcXS. It recommends **no native app**: extend the web desk in phases, then decide on native at a gate, after two events with real numbers.

The case in brief:

- The web check-in already did the basics.
- For school buses it lacked **group check-in** and **desk scanning**. Group check-in saves more time than a faster scanner: about 12 groups instead of 300 people.
- Every vendor that documents offline sync has caveats. RegFox has shipped four sync fixes since May 2026, and zkipster warns that devices can overwrite each other's data.

David's decisions (asked and answered in session, 30 Oct):

| Question | Decision |
|---|---|
| Event size | Under 150 |
| Students with phones | About 50%, so the desk stays the main path |
| Volunteers running a desk without a Stellr account | **No.** The planned volunteer link was dropped |
| Walk-up registration and payment | Not at this time |
| Unsigned agreement at check-in | **Flag only, never block** |
| Build | Phases 0–3 as written in the report |

## What shipped

**#484 → `dev` as `2b6970f3`. Promoted in #485 (merge `185e3356`, 19:44Z 30 Oct). Production deployment `dpl_BwZabiv7uEgRqQ7n1aWNhTFc5aHU`; rollback target `dpl_BtsCz4ZrfEGasoAWg4uHwoWWPvGu`. Record: `.claude/releases/promote-2026-10-30b.md`.** No migration.

| Area | Files | What |
|---|---|---|
| Desk rules | `lib/check-in-desk.ts` (+ test) | Shared shapes. Group rows: A–Z by school, members by first name. Search covers name, school and teacher. Code parsing, `meaningfulNote`, `checkInTime` (a tap's own time, trusted up to 12 h back), the on-device store and `pendingFromQueue` |
| Codes | `lib/check-in-codes.ts` (+ test), `lib/check-in.ts` | `p.<participant uuid>.<sig>` / `g.<registration uuid>.<sig>`. The signature is the first 22 characters of an HMAC over slug, kind and id. The secret chain is the same as the remembered-phone cookie (`checkInSecret()`) |
| Code page | `app/(flow)/check-in/[slug]/code/page.tsx` | Verifies the code and shows the person's or group's name with a big QR. Private-link headers already cover `/check-in/*` |
| Desk API | `app/api/admin/events/[slug]/check-in/route.ts` (+ `route.desk.test.ts`) | GET adds `registrationId`, `schoolName` and `groups`. `GET ?details=1` returns flags from `getEventRoster` plus the teacher's contact. POST `group_check_in` / `group_undo` (every id must belong to the event; anyone already in keeps their time); `scan` (verifies the code; a participant checks in, a group returns its id); `at` on desk taps |
| Desk UI | `components/admin/CheckInLive.tsx`, `CheckInGroupSheet.tsx`, `CheckInScanner.tsx`, `CheckInFlags.tsx` | People and Groups tabs. Group sheet on the shared `Dialog` (untick, confirm, Undo notice). Scanner. Flag chips with Details. Queue and last list in localStorage. Service worker in desk mode (production builds only) |
| Scanner reader | `scripts/copy-scanner-wasm.mjs`, `package.json` (predev, prebuild), `.gitignore` | `barcode-detector@3.2.3` (zxing-wasm 3.1.6). The WASM file is copied to `public/vendor/zxing_reader.wasm` and served from our own site. Used on every device: about 240 ms a read, against 0.3–6 s for Chrome's own reader |
| Offline page | `public/check-in-desk-sw.js` | Scope `/admin/competitions/`. Caches only the desk page (network first), `/_next/static` and the reader. Never the API |
| Install | `app/api/check-in-desk/manifest/route.ts`, check-in page metadata | Per-event manifest so Add to Home Screen opens that desk. The page names a Postgres-only event from its registrations (used by e2e) |
| Headers | `next.config.mjs` (+ test), `proxy.ts` (+ test) | `camera=(self)` on `/admin/competitions/:slug/check-in` only. The proxy skips `.wasm` |
| Emails | `lib/email.ts` (+ test), `lib/registration-confirm.ts`, `app/api/stripe/webhook/route.ts`, `app/api/register/group/route.ts`, `lib/group-registration-setup.ts` | The individual confirmation has a "Show my check-in code" button; the group confirmation has the group's code. Without a secret, the old wording stays |
| Your group | `lib/group-status.ts`, `components/community/GroupStatusSection.tsx` (+ test) | "Show our check-in code" for group (not campaign) registrations |
| Badges | `lib/event-badges.ts` (+ test), `lib/event-pdf.ts`, badges route, `components/admin/EventBadges.tsx` | `order=school` (each group together, mentors last); `codes=1` (bottom-right QR on a white square, registered people only) |
| E2E | `e2e/core/check-in-desk.spec.ts`, `e2e/fixtures/check-in.ts` | Throwaway `e2e-checkin-*` event on dev: a group checked in with one student left out, persisted, Undo; people order stable; search by school and teacher |

Desk check-ins stay `check_in_method = 'manual'`. A new value would have needed a migration ahead of the code. Group check-ins share one `checked_in_at`, so they can still be counted.

## Verified (and how)

- **Unit tests.** 2602 passed. The new tests cover codes, desk rules, the API actions, badge order, emails, Your group, headers and the proxy matcher.
- **Static checks.** `tsc`, `lint:ci` (40 warnings, all already there, under the 42 ratchet), `ds-lint`, `lint:pii`.
- **CI on #484 and #485, every step read.**
  - `verify`: all steps succeeded.
  - `e2e`: 171 passed and 45 skipped, on both. The job has the dev service key, so the desk spec ran.
- **Local, against dev data, with throwaway rows removed afterwards** (read back: no `e2e-checkin-*` registrations left):
  - The full core and smoke suites against a production build passed. The credentials specs needed a fresh sign-in: request-only specs 401 on a stale saved session.
  - WebKit at iPad size with a fake camera: a participant code read in 351 ms, and a group code opened its sheet. Chromium WASM: about 240 ms.
  - Offline: a group check-in queued and reached a second desk 4.9 s after reconnecting. A tap queued offline was sent after the page was closed and reopened.
  - Production build in Chromium: the desk reloaded in airplane mode from the service worker, showed the saved list and flags (medical as "See the roster"), checked a group in, and sent all four on reconnect (read back in the database).
  - Badge PDF in school order with QR codes on named badges only. Code page at 390 px. Manifest `start_url`. The `camera=(self)` header on the console.
- **Production, 30 Oct:** see "Production after the promotion" below.

## Not verified / known limits

- **No real device.** No real iPad or iPhone camera has scanned a code. iOS Add to Home Screen with the per-event manifest and the service worker in Safari are untested (rows `.1`, `.2`).
- **No real email.** No confirmation email with a code has reached an inbox (`.3`).
- **Earlier registrants have no code.** People registered before this promotion got no code by email. Nevada's and Minnesota's registrants are among them (`.4`).
- **No real timing yet.** "A group of 25 in under 2 minutes" was shown with a group of 4, not timed at a real event (`.5`).
- **No "late" label.** Groups that haven't arrived show "Not here yet", because the desk has no event start time or time zone (`.6`).
- **Badge QR is a fixed corner.** The QR always goes bottom-right; artwork with content there will be covered (`.7`).
- **Service worker scope.** It controls every `/admin/competitions/*` page, though it only serves the desk page and caches hashed static files there. If an admin page ever misbehaves after a deploy, unregister it in the browser first (`.8`).
- **Signed-in production desk.** Not exercised; there are no production test accounts.

## Production after the promotion

Checked by curl, 30 Oct, after `dpl_BwZabiv7uEgRqQ7n1aWNhTFc5aHU` went live. The details are in `.claude/releases/promote-2026-10-30b.md` (PR #487).

- www returns 200, app returns 307 to sign-in, and the cron guard answers `Unauthorized`.
- On the app host:
  - the service worker returns 200 `application/javascript`;
  - `/vendor/zxing_reader.wasm` returns 200 `application/wasm` (946,860 bytes, so `prebuild` copied it);
  - the desk manifest JSON is correct.
- The console route sends `camera=(self)`.
- `/check-in` returns 200: no event's check-in is open.
- Not exercised on production: the signed-in desk, the scanner, a group check-in, and an email with a code.

## Open items

`tracker/2026-10-30-check-in-desk.md`, rows `check-in-desk.1` to `.9`.
