# Handover: legal pages for student self-registration, 2–3 Oct 2026

Tracker: `tracker/2026-10-02-legal-self-registration.md` (rows `legal-self-registration.N`).
Written at close-out on 5 Oct; the work ran 2–3 Oct.

## Context

David's handover (claude.ai, 02-Oct-2026) asked for the Privacy Policy and Terms of Use to be brought into line with the V2.3 Participation Agreements: students may self-register, there is a new definition of Minor (state age of majority), FERPA applies to all student data, there are retention and deletion rules, students choose their own media and quote uses, and there is an under-13 lockdown. Its truthfulness gate says no published promise the product doesn't keep. **Tier A** items (I6, I7, I11–I14) had to be true at release, or their sentence held back. **Tier B** (the self-registration flow, I1–I5 and I8–I10) could ship as text only if the route stayed disabled for Minors.

A second, cumulative handover the same day added D17 (survey quotes) and D16 (mentor co-signature, DocuSign only).

## What shipped (all in production)

| PR | Promoted in | What |
|---|---|---|
| #274 | #276 (`f9722fa`, 2 Oct 23:52Z) | Privacy + Terms P1–P12 / T1–T10, reconciled with #273's e-sign rewrite. Where they disagreed, David chose the D-decisions (medical 90 days, membership + 7 years after deactivation, FERPA for all student data). School Data Terms v2. Code below |
| #275 | #276 | Fix for an SWC bug that dropped the space after `</strong>` in wrapped text containing an entity (13 spots), plus the guard `test/jsx-entity-whitespace.test.ts` |
| #278 | #279 (`29be23e`, 3 Oct 02:33Z) | D17 survey quotes: Privacy §2, new §3.12, §5, §10; Terms §11.3; runbook Part C |
| (#280, e-sign session) | #279 | V2.3 alignment. Its prod migration `20261002235609` was applied from this session before the merge; it also fixed `retain_until` to membership + 7 years after deactivation |

**Code (Tier A):**
- **I6:** `lib/credentials.ts` `shareConsentFor` + `lib/credentials-core.ts` `ageBlock`. Under 13 or unknown DOB can never be made public; the live DOB decides "minor", not the stale `is_minor` flag.
- **I7:** `lib/no-ads.ts` + `ConsentMode`, `lib/consent.ts`, `CookieConsent`, `NoAdsStudentMarker` (member layout) and `HubSpotTrackingNoAdsGate`. On student surfaces and in student-marked browsers, ads consent stays denied, "Accept all" is ignored, Google signals are off, and `stellr_no_ads: true` is pushed before GTM, including on client-side navigation. The GTM half (a blocking exception on every ad tag) was done by David on 2 Oct.
- **Tier B guard:** `app/api/members/onboarding/route.ts` refuses a fresh self-sign-up by a Minor (403 `minor_self_signup_closed`) unless the Minor was admin-invited, event-registered, or has a minor agreement. This also overrides #273's Membership Agreement route for Minors.
- **I11:** `scripts/medical-retention-sql.ts` (`npm run -s retention:medical-sql`) emits a transaction for the prod SQL editor.

**Docs:**
- `docs/RUNBOOK-no-ads-students.md` (the GTM steps + evidence procedure).
- `docs/RUNBOOK-privacy-retention-and-deletion.md` (medical retention, deletion requests with the 30-day clock, media/quote opt-outs, school DPA requests).
- The 30-day clock lives in the Google Sheet "Stellr — Privacy requests log" (`1OEedQV3f6xUVK-3uj5mfWOKxfR3VvhiF8xXiEJaPfro`) and in #273's Admin → Privacy requests.

**Production database:**
- #273's five migrations and #280's one were applied from this session, each with David's approval, in a transaction with its ledger row under the filename version.
- `db:status --prod`: only the two long-standing 10 Sept entries are pending.

**First medical retention run** (2 Oct, prod): 0 participants and 0 members to clear. The audit_log and deletion_archive scrub committed.

## What is not verified

- **Minor sign-up block:** never exercised end to end (typecheck and unit suite only).
- **Signed-in student marker:** never exercised (the `stellr_no_ads` cookie, HubSpot `doNotTrack`, and the HubSpot script not rendering).
  - The pre-GTM guard *was* exercised locally against the live container.
  - With "Accept all" stored, `/educators` fired Google Ads remarketing.
  - `/sign-up` (hard load) and a client-side navigation into `/community` fired none.
  - In prod, only the presence of the guard in the HTML was checked.
- **Tag Assistant evidence** with a signed-in under-13 account (handover I7d) has not been captured.
- **`verify:prod` proves nothing here:** it reads local `.env.local` (DocuSign sandbox, Stripe test).

## Decisions made in session (David)

- D1–D16 win over #273's 9-Oct text; everything on `dev` was promoted on 2 Oct, e-sign engine included (inert: `docusign_only`, no `ESIGN_*` in prod).
- Applying all six production migrations.
- Ship #280 on 3 Oct, accepting that under-age mentor/volunteer agreements go to "Needs paperwork" until the `ESIGN_*` variables are set.

## Held back from the handover text

- "in their account" in Privacy §2. There is no toggle; opt-out is by email (I13 fallback).
- The under-13 "before a parent consents we collect no more than…" sentence is scoped to self-created accounts, because individual event registration has no under-13 floor and collects health details before the guardian signs.

## Open items

See the tracker. The most important:
- `legal-self-registration.1`: Tag Assistant evidence.
- `legal-self-registration.8`: event-registered Minors get portal access before the guardian signs.
- `legal-self-registration.11`: the Tier B flow.
- `legal-self-registration.4`: the monthly medical run (next early November).
