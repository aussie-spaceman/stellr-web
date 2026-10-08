# Event check-in v2 — 2026-10-08

Slug: `event-check-in-v2`. Handover: `HANDOVER-event-check-in-v2-2026-10-08.md`. Doc snapshot: `1OeQuvvTDu-dWs7lFfHZJhD-SH8CmqoWO2jq8aPl9SiU`.
PR #328 → `dev` as `3a4666b`; promoted in #335 (`8892455`). Migration: `20261007210357_event_check_in_resources` (dev + prod, column read back in prod 8 Oct).

Door check-in now finds people by name + date of birth. Participants get a remembered page with their company number, shirt size, Docs folder and survey. The desk console keeps a fixed first-name order with arrival tabs, and there's a printable door poster. Live in production since 8 Oct 17:23Z; no real event has used it yet.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| event-check-in-v2.1 | **HIGH** First real use in prod: door lookup, participant page, signed-in desk console | Verified locally and on dev data only; prod has served `/check-in/<slug>` 200, but no prod check-in has been exercised (prod rows not read). First real use is the Nevada SDC, 6 Nov | Before 6 Nov: open Nevada check-in on prod, check in one staff member by name + DOB on a phone, confirm the desk row updates, then Undo | ☐ |
| event-check-in-v2.2 | Phone remembered on prod | Proven locally with a throwaway secret only. David confirmed `SURVEY_TOKEN_SECRET` is in prod Vercel (8 Oct) | During .1, reopen `/check-in/<slug>` without `?t=` and confirm the page comes back | ☐ |
| event-check-in-v2.3 | Nevada Docs folder link | Column added to prod 8 Oct; this session set no prod value (prod rows not read) | Paste the Nevada Drive folder link into the console's Event documents field | ☐ |
| event-check-in-v2.4 | Door poster scanned by a real camera, printed on paper | Print view rendered in headless Chromium only | Print one; scan with an iPhone and an Android camera | ☐ |
| event-check-in-v2.5 | Mentor company numbers | Dropdown is in the roster for mentors but never clicked; no mentor holds a company anywhere | When Nevada companies exist, hand-assign mentors and check one mentor's check-in screen shows the number | ☐ |
| event-check-in-v2.6 | No e2e coverage for check-in | CI e2e passed but no spec touches `/check-in` or the console. The seed event `seed-regional-challenge` is Postgres-only and 404s (no Sanity doc) | Add a spec on a Sanity-backed dev event: name + DOB happy path, wrong DOB, desk order stable after Check in. Restore fixture rows in afterEach | ☐ |
| event-check-in-v2.7 | Survey states other than "scheduled" | Only "scheduled" seen rendered; `lib/check-in-view.ts` has no unit test | Unit-test `surveyStateFor` with a mocked db for open / guardian / submitted / closed / paused | ☐ |
| event-check-in-v2.8 | Per-name DOB-guess limit is per instance | `checkRateLimit` is in-memory, so 10/h holds per warm instance, not globally | David's call: accept (token-gated, at the venue) or move the limiter to Upstash | ☐ |
| event-check-in-v2.9 | Event manager (non-admin) access to console + poster | Tested as admin only; both routes use `requireEventAccess` | Sign in on dev as an assigned event manager and open the console and poster | ☐ |
| event-check-in-v2.10 | Email fallback reachability | `participants.date_of_birth` is NOT NULL (dev information_schema, 7 Oct), so `need_email` cannot fire today; unit-tested | None unless DOB becomes nullable on participants | ☑ |
