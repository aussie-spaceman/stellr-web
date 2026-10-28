# Handover — public-site iteration: five changes (27–28 Oct 2026)

**Shipped to `dev`:**

| PR | Change | Merge |
|---|---|---|
| #458 | Awards and Summer Camp as Step 4 on /competitions | `bafa1ec1` |
| #459 | "Book a 15-min call" on five pages | `d7da39e2` |
| #460 | Teacher PD certificate on /educators | `b981d4b4` |
| #461 | Future History page and teaser | `a829e0c7` |
| #462 | 100% money-back guarantee, 45 days, every purchase | `8868c14e` |

**Not promoted by this session.** A separate session is promoting `dev`; check `main` before assuming any of this is live.
**Migration:** none. The `refund_policies` table is now unread but still there (`.9`).
**Tracker:** `tracker/2026-10-28-website-iteration.md`.

## What was asked
David asked for five separate website tasks, each planned with questions and a recommendation, then built and shipped one at a time. The answers to those questions are the spec, and the later corrections outrank the first brief:

1. **Money-back guarantee:**
   - 100% for 45 days from payment, even if the buyer attended;
   - on every purchase, merch included, and donations excluded;
   - requested by email;
   - the Terms updated;
   - the admin refund-policy tool removed, as "way too complex and unnecessary".
2. **"Book a 15-min call":**
   - the secondary action on events, membership, contact, educators and network;
   - a new 15-minute Motion page, opening in a new tab.
3. **Event narrative:**
   - generic and about the activity, for Challenges and Campaigns alike;
   - "future history" language;
   - the four-year space rotation, with this year marked: cislunar +20, Mars +25, inner solar system +30, outer +35;
   - Environmental runs concurrently;
   - it is the 2027 school year;
   - subcontractors named by category only.
4. **Awards on /competitions:**
   - tiles that open a dialog;
   - judges choose the Overall Champions, mentors choose the other three;
   - Creative Vision, Quiet Leadership and Engineering Excellence winners are invited to the International Summer Camp (Frontier Challenges, with a fee);
   - each award has a full name for delivered awards and a short name for the website.
5. **Teacher PD certificates on /educators:**
   - 5–15 PD hours per Challenge or Campaign;
   - the Teacher Grant figure unchanged;
   - a sample from the real artwork.

## What changed
- **#458 awards:**
  - `PUBLIC_AWARDS` in `lib/event-awards.ts` holds the web names: Creative Vision Award, Quiet Leadership Award, Engineering Excellence Award, Champions Award.
  - The full labels are Anita Gale Award for Creative Vision, Dick Edwards Award for Quiet Leadership, Norm Chaffee Award for Engineering Excellence, and Overall Event Champions. They show on certificates, credentials and LinkedIn.
  - All four types are in `RELABELLED_AWARD_TYPES`, so credentials already issued show the new label without touching stored rows.
  - `ARTWORK_SUPERSEDED_AWARD_TYPES` is empty.
  - `AwardTile` was added to `@stellr/web-ui`.
- **#459 booking:**
  - `components/sections/BookCallButton.tsx` and `lib/booking.ts`.
  - The link is `NEXT_PUBLIC_INTRO_CALL_URL`, falling back to `NEXT_PUBLIC_BOOKING_URL`.
  - A click pushes a `booking_click` dataLayer event with its location.
- **#460 PD:**
  - a "PD Certificates" section on /educators;
  - the sample is rendered by `scripts/pd-certificate-sample.ts`;
  - the standards list comes from `lib/pd-standards.ts`, and `EVENT_PD_HOURS` is `'5–15'`;
  - V2 heroes on /educators and /contact.
- **#461 future history:**
  - /competitions/mission, plus a teaser on /competitions and a line on each event page;
  - `lib/future-history.ts` derives the year's region and the year it is set in from `CURRENT_SCHOOL_YEAR`;
  - `EraCycle` was added to `@stellr/web-ui`.
- **#462 guarantee:**
  - `lib/refunds/policy.ts` holds the rule: full refund if the Stripe charge date is no more than 45 days ago, otherwise nothing.
  - The admin cancellation offers only a full refund or none, with nothing pre-selected.
  - Removed: the refund-policy editor, its API route, credit refunds, and the per-event panel.
  - The guarantee shows as `GuaranteeBadge` in `@stellr/web-ui` on every pay surface, as Stripe Checkout `custom_text` on 11 callers, as the invoice footer on 2 callers, and in two confirmation emails.
  - Terms §9.1 (`/terms#guarantee`) and §9.2.

## What was verified
- **CI:** every step was read on each PR. `changes`, `verify` (PII lint, typecheck, design-system lint, unit tests, lint, build) and `e2e` (Playwright, Storybook render + axe, Lighthouse) succeeded on all five. #462's first `e2e` was cancelled in the shared `e2e-dev-supabase` queue, and the re-run succeeded.
- **Locally, before shipping:**
  - each branch passed typecheck, eslint, `lint:tokens` and the full unit suite (2,425 tests on the last);
  - in the browser: the award tiles, dialog and phone layout; the booking button on all five pages and its dataLayer event; the PD section and its dialogs; the mission page, the teaser and the event-page line.
- **On `dev`:** deployment `dpl_DmoJh9MQJSTjUeQAKrx3oJYAUSKe` (`8868c14e`) is READY. Fetched through the Vercel connector:
  - /membership has the badge, its `/terms#guarantee` link and the booking button;
  - the Nevada event page has the guarantee FAQ answer and the "Mars" line.
- **Not verified:** rows `.2`–`.5` and `.10`.

## The `e2e` failure on `dev` (fixed by #466, not here)
`dev`'s push run on `8868c14e` failed `e2e`: all five tests in `e2e/core/registration-docusign.spec.ts`. The same five had failed on `chore/dependency-upgrades` half an hour earlier.

- **Cause:** `e2e/fixtures/survey-cli.ts` creates a *completed* agreement for the seed student while the survey spec runs. The DocuSign spec took the first table row naming that student, read "Complete", and failed.
- **The seed row was intact:** read on dev, it was still `delivered`, 1 of 2.
- **Fix:** #466 (`c12aa021`, another session) pins the row to the fixture's event and fails if there are two. `dev` CI on `c12aa021` succeeded.

Nothing in the five changes was involved.

## Open items (tracker `2026-10-28-website-iteration.md`)
- `.2` Guarantee badge beside an event's price, seen on production.
- `.3` Guarantee text on Stripe Checkout and invoices, seen once.
- `.4` First real cancellation refund within 45 days.
- `.5` Guarantee line in a real confirmation email.
- `.6` Booking link: confirm the Motion page, its event title, and production's value. David.
- `.7` PD sample artwork errors and the real signatures on a public image. David.
- `.8` Champion artwork wording against "Overall Event Champions". David.
- `.9` Drop `refund_policies` later.
- `.10` Phone width of /competitions/mission and the /educators PD section.
- `.11` Terms §9.1 and §9.2, read by David or counsel.
- `.12` Bump `CURRENT_SCHOOL_YEAR` for the 2028 school year.

## Gotchas learned
- **`dev` can't show anything that needs a live price.** Event pages there never count as priced, so price-gated UI (`.2`) is first visible on production. Static pages such as /membership do render it.
- **The `e2e-dev-supabase` queue holds one waiting run.** If a third run arrives, the waiting one is cancelled with no steps run. Re-run that job with `gh run rerun <id> --failed`; nothing is wrong with the code.
- **Merging `dev` into a later branch:** each conflict here came from both sides adding lines at the same place, mostly in `packages/web-ui/src/competition.tsx` and its stories. The first resolution dropped a component's closing `)` and `}` and broke 24 test files. Diff each resolved component against its source branch before committing.
- **Stale `.next/dev/types`** from a preview server made `tsc` report the deleted refund routes. Removing `.next/dev` cleared it.
- **Protected `dev` deployments** can be read with the Vercel connector's `web_fetch_vercel_url`. There is no local `VERCEL_AUTOMATION_BYPASS_SECRET`.

## Session gaps (honest review)
- **The PD sample's text errors** were noticed at build time and noted only as "typos" in memory. That they are visible on the public /educators page, along with real signatures, was not said until close-out (`.7`).
- **No `/code-review` was run** on any of the five PRs. Phase 4 was each PR body's contract checklist.
- **One PR body was wrong before it was posted.** #462's draft first said the admin cancellation defaults to a full refund; nothing is pre-selected. It was caught and corrected before the PR was opened.
- **Phone width:** recorded only for the awards section, which is why `.10` is open.
- **The `e2e` collision was found here but fixed elsewhere.** The fix was offered and not taken up before #466 landed it.
