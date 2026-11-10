# Handover: Google Ad Grants rebuild, 10 Nov 2026

Tracker: `tracker/2026-11-10-ad-grants-rebuild.md` (rows `ad-grants-rebuild.1`–`.11`).

**No repo code changed in this session.** All the work was in the Google Ads
account (customer ID 671-715-4074, the Ad Grants account) through the Ads web
UI and bulk uploads. Nothing was committed or promoted except this handover.
The plan and status page is a private claude.ai artifact:
https://claude.ai/artifact/RpNDLgZGRNXuvXtvvyEzjZ (republished on the Stellr Claude account, 10 Nov 2026).

## Context

The account had served almost nothing since its Grants reinstatement in
September. The last live campaign, "Search - Space Settlement - Leads #4"
(started 20 Oct), had 0 impressions all time. Support at Google had found no
fault, and David had just asked them for a Tier 2 escalation. This session
re-reviewed the account, checked Google's Grants policy pages, and rebuilt the
account.

### Why it wasn't serving (verified in the account)

- **Demand.** 9 broad keywords, each at 10–100 US searches a month (Keyword
  Planner), with each ad group narrowed to one state through AI Max
  "locations of interest".
- **Location policy.** Campaign location was "All countries and territories".
  Grants requires proper location settings (support.google.com/nonprofits/answer/117827).
- **Bidding.** On 6 Nov the agency's login switched bidding to Maximise clicks
  with a $2.00 limit. Grants allows Maximise clicks only "to begin"; otherwise
  campaigns must use Maximise conversions, Maximise conversion value, Target CPA
  or Target ROAS.
- **Stale ad groups.** Two ad groups advertised events already over (Colorado
  Space 3 Oct, Nevada 6–7 Nov). Texas, South Carolina and Nebraska, all open,
  had no ad group.
- **Conversions.** The Individual and Group lead form actions are
  "Misconfigured", and neither has ever recorded a tag ping (Webpages tab
  empty), even though GTM v18 is live with both tags on `lead_submitted`.
- **Keywords.** Some keywords named other organisations, including the
  competition family Stellr never names publicly (David's naming rule, 24 Sept
  2026).
- **Goals.** "Page view (www.insimeducation.com)" (719 all time) and "Website
  traffic" were Primary goals. Grants says page views must not count.

Site audit (live site + repo):
- The site meets the Grants website basics.
- Ads can never count a completed registration, because `/register` is on the
  no-ads list (`lib/no-ads.ts:29-30`).
- On event pages, "Register Now" isn't tracked (`components/sections/EventCtas.tsx:83`).
- Ad tags wait for cookie consent (`components/analytics/ConsentMode.tsx:50-69`).

## What changed in the account (10 Nov)

Four new Search campaigns went live. "Leads #4" is paused.

| Campaign | Budget/day | Locations | Landing pages |
|---|---|---|---|
| Events - Live Competitions | $110 | TX, SC, NE, CO, SD, MN, IA (Presence) | one ad group per open event → `/events/<slug>`, plus a general group → `/competitions` |
| Programs - Robotics, Olympiad & Space | $110 | US (Presence or interest) | all four ad groups → `/lp/first-robotics-teachers` (owner decision: no new page) |
| Homeschool Families | $60 | US (Presence or interest) | `/lp/homeschool-students` |
| Educators - Grants & Curriculum | $45 | US (Presence or interest) | `/grant`, `/curriculum`, `/events/space-design-campaign-fall`, `/educators` |

- **Overall:** 17 ad groups, 18 responsive search ads (one replaced, see below),
  132 phrase-match keywords, 16 sitelinks and 93 campaign negative keywords.
  Budgets total $325/day, under the $329 Grants cap.
- **Bidding:** Maximise clicks as the allowed starting strategy. AI Max is off
  everywhere.
- **Brand campaign:** dropped by owner decision ("too small for brand building").
- **Programs campaign ad groups:**
  - Robotics teams
  - Science Olympiad teams
  - Space camp families
  - Space settlement and space contests (the National Space Society student
    contests: O'Neill Space Settlement Contest, Live in a Healthy Space, Roadmap
    to Space Art, Global Space Debates, ISDC 2027 student track)

  Every keyword is a qualified version of the program name, since Grants
  doesn't allow another organisation's name on its own. Program names are kept
  out of the ad text (Google trademark policy, adspolicy/answer/6118).
- **Negative keywords:** the excluded competition family is a phrase negative
  in every campaign.
- **Conversion goals:** "Page view (www.insimeducation.com)" and "Website
  traffic" are now Secondary.
- **Replaced ad:** the "Homeschool competitions and robotics" ad was "Eligible
  (Limited) – Online gambling". Every asset was Eligible on its own, so the ad
  as a whole was limited. It was replaced with an ad that has no "compete",
  "competition" or "challenge" wording; the new one is Eligible and the old one
  is paused.

### Bulk-upload format that worked (Tools › Bulk actions › Uploads; Preview before Apply)

- **Campaign row:** `Action, Campaign, Campaign type, Campaign status, Budget,
  Budget type, Bid strategy type, Networks, Languages, Location, EU political ads`.
  - Location takes `Colorado,United States;Texas,United States`.
  - EU political ads must be `No`.
- **Ad row:** `Ad type` = `Responsive search ad`, with `Headline 1..15`,
  `Description 1..4` and `Final URL`.
- **Sitelink row:** `Asset action` = `Create new`, `Sitelink text`,
  `Description line 1/2`, `Final URL`.
- **Keywords:** a second upload after the ad groups exist, with columns
  `Action, Campaign, Ad group, Keyword, Match type` only. A blank `Criterion
  type` column causes "An internal error occurred".
- **Campaign negatives:** these did not validate in any format tried, so they
  were added in the UI (Keywords › Negative keywords).

### Scheduled tasks (Claude desktop app, owner's Mac)

| Task ID | When | Changes allowed |
|---|---|---|
| `ad-grants-weekly-review` | Mon 9:00 | pause Quality Score 1–2 keywords and finished-event ad groups only |
| `ad-grants-monthly-review` | 1st of month 9:30 | none (read-only compliance and performance review) |
| `ad-grants-first-serve-check` | 13 Nov 2026 9:00, once | none |

- Auto mode blocked a one-off task to pause the Minnesota ad group on 25 Nov,
  because it would change the account unattended. The weekly run on 30 Nov
  pauses it instead.
- The tasks were saved without a permission mode, so runs may stop for approval
  until each is run once with "Run now".

## Not verified

- **Serving.** The campaigns went live at about 11:30 MT on 10 Nov. No
  impressions had been seen by the end of the session, so serving is unproven
  until the 13 Nov check.
- **Lead tags.** No lead-form tag ping has ever reached Ads. The cause (no
  consented leads, or a tag fault) is unknown.
- **Replacement ad review.** The new homeschool ad shows Eligible, but Google
  can still review it again. The campaign summary still said "Some ads limited
  by policy" at the end of the session.
- **"Events in 8 States"** in ad and sitelink copy comes from the landing pages'
  own wording (`{{states}}` renders as eight). The open US events page lists 6
  states.
- **Relevance of the Programs ad groups.** Science Olympiad, Space Camp and NSS
  searchers land on a page written for robotics teachers, so landing-page
  relevance (Quality Score) is unknown until there is traffic.
- **Unknowns on Google's side:**
  - whether AI Max is allowed on Grants accounts
  - whether a month with zero impressions counts toward the 5% CTR rule
  - whether the Grants quality filter was suppressing the old ads

## Open items

See the tracker file for State / Next / Done on `ad-grants-rebuild.1`–`.11`.
