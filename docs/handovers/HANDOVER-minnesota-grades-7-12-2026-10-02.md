# HANDOVER — Minnesota EDC opened to grades 7–12

**Session:** 2 Oct 2026 · **Status: content live on production; landing-page
copy on this branch; three items open, listed in §4**

The ask: take the Minnesota Environmental Design Challenge from high school only
to middle and high school, the same as the Colorado SDC at STEM School
(`HANDOVER-grades-7-12-2026-09-14.md`). The code for this already existed.
`lib/grade-band.ts` has been generic since #68, and the `grade_6..8` enum is on
both databases, so Minnesota's change was content. Three clean-ups were added to
the scope: the stale eligibility note, a grade-7 registration run end to end, and
the "Grades 9–12" landing-page copy.

---

## 1. Content (Sanity production, no deploy)

Document `hMTFl9bBp7oMl7DIEc5060` (`minnesota-environmental-design-challenge`) was
patched with `ifRevisionID` and a dry run first. Transaction
`fRYqy7Dy1LWxaVLh0fQfr9`.

| Field | Before (rollback) | After |
|---|---|---|
| `gradeLevel` | `High School` | `Both` (HubSpot `event_demographic` → `Middle School;High School`) |
| `gradeMin` / `gradeMax` | unset | `7` / `12` |
| `eligibility` | "Open to high school students (grades 9–12). Teams of 4–6 students." | "Open to middle and high school students (grades 7–12). Teams of 4–6 students." |
| `venue` | `MSU Mankato` | `Innovation Gateway, MSU Mankato` (matches the flyer) |
| flyer "Event Flyer" | `file-1b7ea806fde8246173ab36d5127495b75dc33ed0-pdf` | `file-1ba03cf7c2cf6a1908767080bfc887b1037f7050-pdf` |

- **Flyer:** uploaded with `scripts/upload-event-flyers.ts
  --only=minnesota-environmental-design-challenge --apply`. The source is the Drive
  file `2027 - EDC - MN - Flyer 3pp.pdf`, re-saved 2 Oct, which reads "GRADES 7-12".
- **HubSpot location:** matched on city/state (`LOCATION_BY_CITY.mankato`), not
  venue, so the venue rename doesn't affect it.
- **Live page check, 2 Oct, within minutes of the patch:**
  - `www…/events/minnesota-environmental-design-challenge` returns `200`;
  - "grades 7–12" ×4 and "Grades 7–12" ×2;
  - "9–12" ×0;
  - "Innovation Gateway" is shown;
  - the new flyer asset is linked and the old one is not;
  - the event is listed under `/events?grade=Middle+School`;
  - the registration page carries `gradeMin 7 / gradeMax 12`.

## 2. Grade-7 registration, end to end (open since 14 Sept)

The test ran on a local server against the **dev** database, with Clerk/Stripe
test keys and DocuSign demo.

- **UI, on the Minnesota individual form:**
  - the radio reads "School Student (Grades 7–12)";
  - the Grade options run 7–12;
  - a DOB of 2014-03-15 infers grade 7;
  - the payload sends `grade: "7"`, `event_role: "School Student"`.
- **Server:** the real Minnesota slug **cannot be registered locally**. Its
  `stripePriceId` is a live-mode price, and local/dev use `sk_test`, so the route
  refuses with "registration fee is misconfigured" (503) before any write. This is
  correct behaviour, but it means no real event with a fee can be exercised on dev.
  The same payload was replayed to `/api/register/individual` under an unpriced
  throwaway slug `mntest-grade7-check-2026-10-02`. The route doesn't check grade
  against the band server-side, so this exercises the same path. Result `201`:
  - `participants.grade = '7'`;
  - `members.grade = 'grade_7'`;
  - `age_bracket = high_school` (by design: there is no middle-school bracket);
  - a `docusign_envelopes` row with `envelope_type = minor`, `status = sent`, two
    signers, guardian as signer (demo envelope `733f2396-b603-8034-81bb-abc0d7ae0281`).
- **Not proven:** a guardian signing that envelope, and Stripe checkout for a grade-7
  registrant on a priced event.

**Test rows left on dev, for deletion:**
- registration `138a059e-39f5-4066-a9d5-1e189f549b96`;
- participant `72e712f7-07b3-4872-888f-cc2a91ad47cc`;
- member `7585b189-24e8-4bdb-904d-28577ee74023`
  (`gradeseven.mntest@example.com`), plus its Clerk **test** login;
- the envelope row above (void the demo envelope or leave it to expire).

## 3. Landing-page copy (this branch)

Only Colorado and Minnesota take 7–12, and Nebraska, Nevada and South Dakota stay
9–12, so the copy says 7–12 and points to the event page:

- `content/lp/shared.ts`: the At-a-glance stat is "Grades 7–12", with the label
  "Some events start at grade 9 — see each event page."
- `content/lp/homeschool-students.ts`: the SEO description and the "Who is
  eligible?" FAQ now say grades 7–12. The FAQ adds the same caveat.
- `app/(public)/lp/[slug]/opengraph-image.tsx`: the fallback kicker and the footer
  now say "Grades 7–12".
- **Left alone on purpose:** campaign copy, which is correct at 9–12. That covers
  `curriculum/page.tsx`, `guides/run-an-engineering-design-challenge`,
  `tutorial-data.ts`, and the campaign line in `llms.txt`.
- **Verified:** locally `/lp/homeschool-students` shows "9–12" ×0, and the OG image
  renders "Grades 7–12". The unit suite passes 1005/1005; `lint:tokens` and `tsc`
  are clean.

## 4. Open

1. **Delete the dev test rows** in §2. They were left rather than hard-deleted
   from the session.
2. **AEO copy overstates the band.** `app/llms.txt/route.ts`,
   `lib/structured-data.ts:65`, `competitions/page.tsx:153` and
   `content/guides/competitions-compared.ts` say live Challenges are "grades 7–12".
   NE/NV/SD are 9–12. Either soften to "7–12 at some events" or open the others.
3. **Uruguay EDC has a half-set band:** `gradeMin=8` and no `gradeMax`. It is
   ignored, so the event shows 9–12. Set `gradeMax` or clear `gradeMin`.

Carried from the Colorado work and still open: migration ledger realign (TRACKER
4.8).

---

## 5. Close-out (2 Oct 2026)

**Deployed.** #264 squash-merged to `dev` as `d4db11b`. A parallel session
promoted it in #265 (`40ea376`). On 2 Oct www `/lp/homeschool-students` showed
"Grades 7–12" ×3 and "9–12" ×0. The Sanity content was already live before
that (§1).

**Gaps, honestly:**
- **The plan said to clean up the test registration; it wasn't.** Hard-deleting
  rows was left to David (tracker `minnesota-grades-7-12.4`).
- **The grade-7 run is partial.** It went through the API under a throwaway slug,
  not through Minnesota itself, because of the live-price block (§2). A guardian
  signing and payment are unproven (`.5`).
- **The OG image** was seen locally only, not on www.
- **Not in the tracker.** The Colorado handover's open item 3 (a grade-7
  registration end to end) and item 4 (venue) never had tracker rows:
  - Item 3 is now closed for the DB and DocuSign-send half by §2.
  - Item 4 is already resolved: Colorado's venue reads "STEM School" in Sanity.

Open rows: `minnesota-grades-7-12.4`–`.9` in
`docs/handovers/tracker/2026-10-02-minnesota-grades-7-12.md`.
