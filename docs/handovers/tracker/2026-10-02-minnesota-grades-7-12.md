# Minnesota EDC opened to grades 7–12 — 2026-10-02

Slug: `minnesota-grades-7-12`. Handover: `HANDOVER-minnesota-grades-7-12-2026-10-02.md`. Doc snapshot: `1GgrzAtKnFudqETbjBDxExcxzBXJb9ARDLKtgMTJw_ok`.
PR #264 → `dev` as `d4db11b`; promoted in #265 (`40ea376`, by a parallel session). Migration: none.

The Minnesota Environmental Design Challenge admits grades 7–12, the same as the
Colorado SDC. This was a Sanity content patch: `gradeLevel=Both`, `gradeMin=7`,
`gradeMax=12`, the eligibility note, the venue "Innovation Gateway, MSU Mankato",
and a new flyer. The landing pages now say "Grades 7–12", varying by event.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| minnesota-grades-7-12.1 | Minnesota content: band, eligibility, venue | Live on prod Sanity (tx `fRYqy7Dy1LWxaVLh0fQfr9`). On 2 Oct www showed "grades 7–12" ×4, "9–12" ×0 and the new venue, listed the event under `/events?grade=Middle+School`, and the registration form offered grades 7–12 | — | ☑ |
| minnesota-grades-7-12.2 | Minnesota flyer reads 7–12 | Asset `file-1ba03cf7…-pdf` is linked on the live page; the downloaded PDF text reads "GRADES 7-12"; the old asset `1b7ea806…` is no longer linked | — | ☑ |
| minnesota-grades-7-12.3 | Landing-page copy says Grades 7–12, varying by event | #264 was promoted in #265. On 2 Oct www `/lp/homeschool-students` showed "Grades 7–12" ×3 and "9–12" ×0. The OG image was checked locally only | — | ☑ |
| minnesota-grades-7-12.4 | Test registration left on dev | Still on dev: registration `138a059e-…`, participant `72e712f7-…`, member `7585b189-…` (`gradeseven.mntest@example.com`), its Clerk test login, and demo envelope `733f2396-…` | David hard-deletes the member in admin (#192 also removes the Clerk login), then the registration | ☐ |
| minnesota-grades-7-12.5 | Grade-7 path: guardian signature and paid checkout | Proven on dev: the form's options, DOB inference and label; `members.grade = grade_7`; the minor envelope is sent. Not proven: a guardian signing, or payment. Minnesota can't be registered on dev because its fee is a live-mode Stripe price | Read the first real grade 7–8 Minnesota registration on prod: `members.grade`, the envelope's `status`/`completed_at`, and `registrations.status` | ☐ |
| minnesota-grades-7-12.6 | AEO copy says all live Challenges are grades 7–12 | `app/llms.txt/route.ts`, `lib/structured-data.ts:65`, `competitions/page.tsx:153` and `content/guides/competitions-compared.ts` still say so; Nebraska, Nevada and South Dakota are 9–12 | Decide: soften the copy to "7–12 at some events", or open the other events | ☐ |
| minnesota-grades-7-12.7 | Uruguay EDC half-set band | `gradeMin=8` with no `gradeMax` is ignored, so the event shows 9–12 | Ask David for the intended band, then set `gradeMax` or clear `gradeMin` | ☐ |
| minnesota-grades-7-12.8 | No event with a fee can be registered on dev | Every live event's `stripePriceId` is live-mode, and dev uses `sk_test`, so the route returns 503 before any write | Decide whether dev needs a test-mode price override (e.g. per-env price map) or a priced seed event | ☐ |
| minnesota-grades-7-12.9 | HubSpot event demographic for Minnesota | `mapEventDemographic('Both')` gives `Middle School;High School`, per the code. No contact has been written since the change | Check the first Minnesota subscribe/registration contact in HubSpot | ☐ |
