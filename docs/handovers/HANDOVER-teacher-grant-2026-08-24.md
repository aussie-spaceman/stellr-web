# Handover — Teacher Grant Program

> **RENAMED 1 Sept 2026 — the Teacher Stipend is now the Teacher Grant Program.**
> A label change only: amounts, thresholds, payment date and tax framing are
> unchanged. `/stipend` permanently redirects to `/grant`. The ten `stipend_*`
> HubSpot properties were archived and recreated as `grant_*` (internal names are
> immutable there) — cheap only because they held no data. "Earn" language went
> with it: you earn a stipend, a grant pays out.

**Date:** 24 August 2026
**Status:** SHIPPED AND LIVE — commit `2b6f2b5` on `main`
**Tracker:** [Teacher Grant — Close-Out Actions](https://docs.google.com/document/d/1aJbPjvs3CTKl_UQzTXPgDeKoUFhcg0HxYd_-bRem8_o/edit)
**Supersedes:** `~/Documents/Claude/Projects/Website Rebuild/HANDOVER-Teacher-Grant.md` (the pre-build design handover, now carrying a SHIPPED banner)

---

## 1. The one thing to know

**Nothing has ever run through this code.** Verified at close-out: zero contacts in
HubSpot portal 24379847 carry `grant_status`. The page is live, the form is live, the
HubSpot properties exist — but no application has been submitted, by a teacher or by me.

That matters more than usual here, because the Educator-registration block in
`app/api/teacher-grant/route.ts` is **deliberately non-fatal**. If `upsertMember`, the
school link or the tier grant fails, the applicant still sees success, the email still
arrives, and the only trace is a `console.error` in the Vercel logs. That was the right
call — losing a membership grant is recoverable, losing an application is not — but it
means a broken member path is invisible until someone looks.

**First action for whoever picks this up: submit one real application and follow it
through all three systems.** The tracker doc has the checklist.

---

## 2. What is live

| Surface | Detail |
|---|---|
| `/grant` | Page, application form, FAQPage JSON-LD (7 questions), one-pager download |
| `/api/teacher-grant` | zod validation, 3/hour rate limit, honeypot, Resend, `captureLead`, member creation |
| `/api/members/me/prefill` | Narrow (name/email/phone/school) prefill for scattered lead forms |
| Nav + footer | "Teacher Grant" in the Educate dropdown after Curriculum, and the footer's Educate column |
| `/educators#grant` | Trimmed to a ~67-word teaser linking to `/grant` |
| HubSpot 24379847 | 10 `grant_*` properties, `Teacher Grant` on the `stellr_lead_source` enum, form "Website — Teacher Grant Application" |
| Vercel Production | `HUBSPOT_FORM_TEACHER_GRANT` set |

**Program figures live in `lib/grant.ts`.** The page, the FAQ, the API route and the
copy all read from it. Change a number there, not in a template.

---

## 3. Vocabulary — three words, one hierarchy

Codified in the header of `lib/grant.ts`, and they are not interchangeable:

- **Competition** — the umbrella. A team joins a Competition.
- **Challenge** — a Competition run **live**, at a venue the teacher travels to.
- **Campaign** — the same Competition run **remotely**, at the teacher's own school.

"One Challenge and one Campaign per year" is right. "One Competition and one Campaign"
is wrong — it names a category and one of its own members as siblings.

**`Educator` is unrelated.** It is the free adult membership tier (`lib/tiers.ts`) and a
sign-up audience (`?audience=educator`). It must never be swept up in a rename of the
program. The safe search terms are `Educator Stipend`, `educator_stipend`,
`educator-stipend`, `EducatorStipend`.

Eligibility is **US high school teachers only**. That is why the form has no
grade-levels question — `event_demographic` is `High School` by definition.

---

## 4. Traps that cost time, so they don't cost it twice

**A new `LEAD_SOURCES` value never reaches the live enum.** `scripts/hubspot-setup.ts`
skips any property that already exists, so a new option is never added to
`stellr_lead_source` — and HubSpot **silently drops** a property whose value is not a
declared option. Every grant capture would have landed with no lead source. Fixed by
generalising `ensureNotifyStatusOptions` into `ensureEnumOptions(property, wanted, label)`,
now called for the lead source too. **Any future lead source depends on that call.**

**A HubSpot `number` form field needs digit bounds.** Omitting
`minAllowedDigits`/`maxAllowedDigits` 400s the *entire* form definition with a message
that names no field: `Some required fields were not set: [minAllowedDigits,
maxAllowedDigits]`. It reads like a malformed request. `grant_expected_students` was
the first number field in any Stellr form; `NUMBER_VALIDATION` now covers it.

**Order the deploy: HubSpot first, code second.** The properties and the enum option were
applied before the push, so no capture ever ran against a portal that could not hold it.

**A literal grep is not enough for a rename.** One occurrence was split across a JSX line
break (`The Educator\n  Stipend recognizes…`) and survived the first pass. Sweep with
`Educator\s+Stipend` and diff the *rendered* HTML, not just the source.

**Prefill lands after first paint.** Every merge must keep what the visitor has already
typed — RHF `reset(..., { keepDirtyValues: true })` or an explicit only-if-empty fill.
There is a test that types while the fetch is in flight.

**A module-scoped promise cache does not dedupe across chunks.** The footer form and a
page form load separate instances of `useMemberPrefill.ts`, so `/contact` fired two
identical requests until the cache moved to `globalThis`.

**`members.date_of_birth` and `gender` are NOT NULL with no default.** That is why the
grant form collects them — a member simply cannot be created without them.

---

## 5. Prefill architecture

Two mechanisms, deliberately:

- **Server prop, full record** — `getRegistrationPrefill()` for rich forms on their own
  pages: individual + group registration, group join, and the grant form.
- **Client hook, narrow record** — `useMemberPrefill.ts` + `/api/members/me/prefill` for
  the scattered lead forms: contact, scholarship, host-event, join-network, subscribe,
  both asset gates, event notify.

The endpoint returns **name, email, phone, school only**. Date of birth, gender, health
conditions and emergency contacts stay out of it — that belongs in the JS of a
registration page someone deliberately opened, not every page with a footer.

**`CheckInForm` is deliberately excluded.** A volunteer checking a queue in on one device
would get their own email pre-filled for every student.

---

## 6. Collateral

Authoritative documents now live in
`Shared drives/Stellr/2 Community/Grant Plan/`:

- `Stellr Education Grant - Overview.pdf` / `.docx` — the one-pager (also served at
  `/files/Stellr-Teacher-Grant-Overview.pdf`)
- `Participation Agreement - Teacher Grant V3.docx` — **V2 left intact**; a versioned
  legal draft gets a new version, not an in-place edit

`~/Documents/Claude/Projects/Website Rebuild/README-Grant-Collateral.md` lists what is
authoritative and what is safe to delete.

**Editing `.docx` here:** LibreOffice **is** installed at
`/Applications/LibreOffice.app/Contents/MacOS/soffice` — it is not on `PATH`, so
`command -v soffice` finds nothing. Always render a hand-edited document and look at it;
a text-only check passed while the render showed a table row labelled "Challenge
Participation" that was actually the Campaign row. And **grep every XML part** — a page
footer still carried the old program name because `word/footer1.xml` is not
`word/document.xml`. `pandoc` is genuinely absent, and the docx skill's scripts need
Python 3.10+ while the system Python is 3.9, so edits are unzip → patch → rezip
(`[Content_Types].xml` first, `zip -X -D`).

**Google Docs cannot be edited by the connector** — `update_file` accepts title and
parent only. Seven stale `.gdoc` exports in My Drive still say "Educator Stipend" and can
only be deleted or replaced, not corrected.

---

## 7. Open items

All tracked in the [close-out doc](https://docs.google.com/document/d/1aJbPjvs3CTKl_UQzTXPgDeKoUFhcg0HxYd_-bRem8_o/edit)
with a tickable Complete column. Summary of the sharp ones:

- **P1** — end-to-end submission, Educator auto-registration, `grant_application_date`
  acceptance, signed-in prefill, notification email, conversion tracking: all shipped,
  none exercised.
- **P1** — `members.marketing_consent` is NOT NULL DEFAULT true and no signup path sets
  it, so a grant applicant is enrolled into marketing drips while their consent
  checkbox only covers contact *about their application*. Pre-existing across every
  registration route; the grant wording sharpens it. Worth a privacy-counsel view.
- **P1** — participation agreement V3 still unreviewed by counsel while the page
  publicly accepts applications.
- **P2** — keyboard/screen-reader pass never run (was an explicit go-live item).
- **P2** — the official one-pager's close-out row omits the two-thirds student threshold
  that the live page states four times.
- **P2** — `/contact` still says "Enquiry Type" (British) against an American-English
  content standard.
