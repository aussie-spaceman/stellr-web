# Handover — Event check-in v2 — 8 Oct 2026

Slug `event-check-in-v2`. Tracker: `tracker/2026-10-08-event-check-in-v2.md`.

## Context

Feedback from the Colorado event (Oct 2026):
- Many participants didn't know which email they were registered under (a parent or teacher registered them), so the email-only door QR lookup stalled the line. Paper worked for 24 students but won't scale.
- There was no QR code at the start of the line.
- The desk list re-sorted on every check-in (newest first), so rows jumped under the admin's finger.
- Students and mentors didn't know their company; the admin handled it by hand.

David's decisions (asked and answered in session, 7 Oct):

| Question | Decision |
|---|---|
| Door lookup | First name + last name + **date of birth** |
| Record with no DOB | Fall back to **email** |
| Mentors' company number | **Manual only**; auto-assign stays students-only |
| Docs folder | **One link per event**, set in admin |
| Revisit the participant page | **Yes**, remembered on the phone |
| Survey before it opens | Show "Opens <date>" |
| Desk list | **First name A–Z**, with All / Not arrived / Arrived tabs |
| Who scans | Everyone on their own phone (no kiosk) |

## What shipped

- **#328 → `dev` as `3a4666b`; promoted in #335 (`8892455`, 8 Oct 17:18Z).** Production deployment `dpl_EEyiUr77k3BmZwFdqecopfFqgX1U`. Rollback target `dpl_7E8NyASkZKNTJHco2yVizrXy35s8`.
- **Migration** `20261007210357_event_check_in_resources`: `event_settings.resources_url text` with an `^https://` CHECK.
  - Applied to dev (MCP, ledger realigned) and to prod by the #335 promotion (SQL approved by David).
  - Column confirmed in prod `information_schema` on 8 Oct.

| Area | Files | What |
|---|---|---|
| Matching + cookie | `lib/check-in.ts` (+ test) | Name normalisation; first name matches equal, a 3+ letter prefix either way, or the nickname. DOB must match exactly. `need_email` / `ambiguous` / `none` results. HMAC cookie `stellr_check_in`, path `/check-in/<slug>`, 45 days |
| Participant view | `lib/check-in-view.ts` | Company **number** only, shirt size, `resources_url`, survey state: `open` (their own derived token link, or `/survey/event/<slug>` when no invitation), `guardian`, `scheduled` (date in the event's time zone), `submitted`, `closed`, or hidden when paused |
| Public API | `app/api/check-in/route.ts` | POST name+DOB or email; per-name limit 10/h; per slug+IP 600/h (was 60). DELETE = "Not you?" |
| Public page | `app/(public)/check-in/[slug]/page.tsx`, `components/forms/CheckInForm.tsx` | A remembered phone renders its page without the token, even after check-in closes |
| Desk console | `components/admin/CheckInLive.tsx`, admin check-in API | Fixed order, tabs, ≥44px targets, optimistic rows, company badge, Docs field (`action: 'resources_url'`). On portrait the list comes first |
| Door poster | `…/check-in/poster/page.tsx`, `components/admin/CheckInPoster.tsx` | Letter-size QR + three steps; print CSS hides the admin chrome |
| Roster | `components/admin/EventRoster.tsx` | Company dropdown for students, student managers **and mentors**. A hand move sets `company_locked` (#329), so auto-assign leaves it |
| Badges | `lib/badge-layout.ts` (+ test) | The mentors' template now wins over the company's, so a mentor stays visibly a mentor |

Signing secret chain: `CREDENTIAL_LINK_SECRET` → `SURVEY_TOKEN_SECRET` → `ESIGN_TOKEN_SECRET`, at least 32 characters. David confirmed `SURVEY_TOKEN_SECRET` is in prod Vercel. Local `.env.local` has none, so a local server never remembers a phone; that is by design.

## Running check-in on the day (staff steps)

1. Competition → Check-in → **Open check-in**. This creates the QR token.
2. Paste the event's Google Drive folder link into **Event documents** and save.
3. **Door poster** → print a couple: one at the start of the line, one at the desk.
4. In the roster, hand-assign each mentor a company. Run auto-assign for students first.
5. At the desk, use the **Not arrived** tab. People show their phone screen: company number plus shirt size.
6. **Regenerate code** invalidates printed posters. Only use it if a link leaks.

## Verified (and how)

- Unit tests: matching, cookie signing and badge precedence. Full suite 1,516 passed on the merged tree.
- `tsc`, `lint:tokens` and `lint:migrations` are clean. CI on #328 (after merging dev) and on #335 is green. **No e2e test covers check-in** (row .6).
- Browser, local against dev data (Nevada event, test participants; temporary rows removed afterwards):
  - a wrong DOB was refused
  - "Test" + "scholar" + the right DOB checked in, showing Company 3, shirt M and "Survey opens Saturday, November 7"
  - with a throwaway secret, reloading without the token showed the remembered page with the Docs button
- API by curl:
  - an unknown email gets the desk message
  - a stale token returns 403
  - the 11th DOB guess on one name returns 429
- Desk console (Playwright, signed-in admin):
  - the order was unchanged after a desk check-in
  - the Not arrived tab filtered correctly
  - layout checked at 1024×768 and 768×1024
  - the poster print view rendered
- Production (#335 record and this session): www 200, `/check-in/nevada-space-design-challenge` 200, the cron guard answers `Unauthorized`, and the Vercel status for `8892455` is completed.

## Not verified / known limits

- **Nothing has run on production with real data.** The first real use is the Nevada SDC on 6 Nov (row .1).
- The per-name and per-IP limits use the in-memory limiter (`lib/rate-limit.ts`): **per warm instance**, so across several instances the real ceiling is higher than 10/h (row .8).
- The email fallback is effectively unreachable. `participants.date_of_birth` is `NOT NULL` (dev schema read 7 Oct), so `need_email` only fires if that ever changes. It is unit-tested.
- Only the "scheduled" survey state was seen rendered. `open`, `guardian`, `submitted` and `closed` are untested in both browser and unit tests (row .7).
- On a remembered page opened **without** the token, "Not you?" is hidden, so another person on that phone must re-scan the QR to get it. This was deliberate; reconsider if it bites.
- `/admin/competitions/[slug]/check-in` still uses legacy `brand-*` heading classes (pre-existing; the console itself is V2).

## Open items

See `tracker/2026-10-08-event-check-in-v2.md`: rows `event-check-in-v2.1` to `.10`.
