# Plan — AEO off-site presence (Phase 3), 24 Sept 2026

Answer engines recommend what other sites say about you, not only what you say
about yourself. On 24 Sept 2026 a search for "best STEM competitions for high
school 2026" returned nine list articles; **Stellr appeared in none.** This is
the work that fixes that. None of it is code; everything that sends a message
or publishes is David's (or staff's) to do — the drafts below are ready to use.

Rule carried from the content work: one family of space-settlement design
competitions is never named in Stellr's public content or pitches.

## 1. Get onto the lists assistants cite

Pitch each author to add Stellr. Lead with what is genuinely different for
their readers — free classroom Campaigns with professional judging, no lab or
kit — not with adjectives.

| Article | URL | Angle |
|---|---|---|
| create-learn — Best high school STEM competitions 2026 | https://www.create-learn.us/blog/stem-competitions-and-contests/ | Free, no-equipment option |
| iD Tech — Ultimate guide to STEM competitions | https://www.idtech.com/blog/ultimate-guide-to-stem-competitions-events | Space/aerospace gap in their list |
| AdmissionSight — Top engineering competitions for HS | https://admissionsight.com/engineering-competitions-for-high-school-students/ | Industry judges; proposal writing |
| TheMakerMom — 16 best STEM competitions | https://www.themakermom.com/stem-competitions-for-students/ | Parent-friendly; scholarships |
| RishabAcademy — 50 STEM competitions | https://rishabacademy.com/the-complete-guide-for-the-top-50-stem-competitions/ | Long list — easiest add |
| BetterMind Labs — 15+ STEM competitions | https://www.bettermindlabs.org/post/15-stem-competitions-for-high-school-student | Career readiness |
| Future Forward Labs — Top 30 for 2026 | https://www.futureforward.app/blog/top-30-stem-competitions-for-students-in-2026/ | Grades 7–12 range |
| RISE — 20 best for US high school (2026) | https://riseglobaleducation.com/blogs/best-stem-competitions-us-high-school-students-2026 | Environmental theme |
| WSSEF — Notable STEM competitions | https://wssef.org/stem-competitions/ | Science-fair audience; nonprofit to nonprofit |

**Pitch draft** (edit, then send from a named person's address):

> Subject: A free engineering competition for your [article title] list
>
> Hi [name],
>
> Your [article] is one of the lists teachers send me when they're choosing a competition. I run Stellr Education, a 501(c)(3) that runs industry-simulation design competitions for grades 7–12: students become an engineering company answering a client's Request for Proposal — for a space settlement or a net-zero town — and are judged by working aerospace and engineering professionals.
>
> Two things your readers might not find elsewhere: classroom Campaigns are free and need no lab or kit, and every submitted proposal gets written feedback from our judges. Live one-day Challenges run in [states] this season.
>
> If it's useful, here's a one-line summary you could use: "Stellr Education — free classroom engineering design Campaigns (grades 9–12) and one-day live Challenges (grades 7–12), judged by industry professionals. stellreducation.org/competitions"
>
> Happy to answer anything.
> [Name, title]

Track: sent date, reply, added (Y/N), URL checked.

## 2. Entity signals

**Wikidata** — create an item (anyone can; notability bar is low for a registered nonprofit with a website and press coverage). Properties:

| Property | Value |
|---|---|
| instance of (P31) | nonprofit organization (Q163740); educational organization (Q5341295) |
| official name (P1448) | Stellr Education |
| official website (P856) | https://www.stellreducation.org |
| inception (P571) | May 2021 |
| country (P17) | United States |
| headquarters location (P159) | West Jordan, Utah |
| legal form (P1454) | 501(c)(3) organization |
| US EIN (P1297) | 86-2292698 |
| LinkedIn company ID (P4264) | stellreducation |
| X username (P2002) | stellreducation |
| Instagram username (P2003) | stellreducation |
| YouTube handle (P11245) | @StellrEducation |

Add the Wikidata URL to `sameAs` in `lib/structured-data.ts` once the item exists.

**Candid (GuideStar)** — claim or complete the profile for EIN 86-2292698: mission, programs (Space Design Challenge, Environmental Design Challenge, Campaigns, Teacher Grant), 2026 participation figures from /impact, and a Seal of Transparency. Assistants use Candid to answer "is X a real nonprofit".

**The five `sameAs` profiles are verified** (close-out item B4, closed 24 Sept 2026): LinkedIn, X, Instagram, Facebook ("Stellr Education | West Jordan UT") and YouTube each opened in a browser to Stellr Education's own page.

Wikidata property IDs above are from memory — confirm each on the property page as you enter it.

## 3. Links from people who already work with Stellr

Ask each for one link to the relevant Stellr page (event page for hosts, /competitions or /curriculum for schools):
- Host venues (STEM School Highlands Ranch, and each 2026–27 venue) — "Upcoming events at our facility".
- Schools and districts that sent teams — school news pages and CTE pathway pages.
- Industry judges' employers — community/STEM-outreach pages.
- Teacher Grant recipients (2027) — school sites and their LinkedIn badge.

## 4. Local press around each live Challenge

One short release per event, sent a week before and a results note within a
week after (see `docs/content-drafts/2026-09-aeo/news-03-TEMPLATE-event-results.md`).
Targets: local news desk and education reporter in the host city, plus Patch
for the host town. Local coverage is what competing programs have and Stellr
doesn't, and it is exactly what answer engines cite for "competitions near me".

## 5. Fix at source (found during the AEO work)

- **Event pages say "Humanities Place In The Solar System"** — should be "Humanity's Place…". It's Sanity content (the event tagline), repeated on every event page.
- **Campaign dates render as "08-15 – 12-15, 2026"** on /events/space-design-campaign-fall — reads oddly to people and parsers; "15 Aug – 15 Dec 2026".
- **Campaign Guide (Teacher, ADVANCED) trade-study totals are wrong**: its scores total 3.25 / 2.85 / 3.10, not 3.20 / 2.90 / 3.15, so the sensitivity note ("A and C within 0.05") is also wrong. (The public guide is a summary and no longer shows the worked example.)
