# Handover: old business name removed from Google Ads, 11 Nov 2026

Tracker: `tracker/2026-11-11-ads-old-brand.md` (rows `ads-old-brand.1`–`.6`).

**No repo code changed and nothing was promoted.** All the work was in the
Google Ads account (customer ID 671-715-4074, the Ad Grants account), done
through the Ads web UI in the desktop app's built-in browser. The Claude in
Chrome extension was disconnected all session. The only commit is this
handover.

## Context

The day after the rebuild (`HANDOVER-ad-grants-rebuild-2026-11-10.md`), the
owner saw this ad in the Overview's "Most-shown search ads" card: headline
"Insimeducation | Simulation Education | Simulation", description ending
"Industry Simulation Education". Stellr no longer trades under that name. The
owner asked for it to be removed from every part of Google Ads.

The owner's rule (11 Nov): "industry simulation" may describe the events, as in
"industry simulation events for grades 7–12". It must never be used as the
organisation's name. Never use InSim, Insim Education, insimeducation.com,
Simulation Education or Industry Simulation Education. The business name is
always Stellr Education.

## What was found

- **The ad was history, not live.** It belongs to "Website traffic-Search-1",
  which was already Removed (15,253 impressions all time, most in 2022–23). The
  Overview card ranks ads over the selected date range (all time), and the view
  ("2 filters · 12 campaigns") includes removed campaigns.
- **Old-name ads:** three, all inside removed campaigns:
  - Website traffic-Search-1;
  - two ads in an ad group named "Industry Simulation Education", one in
    "Leads-Search (SD, MN, IA)" and one in "Leads-WebSearch (Vegas-Counties)".

  Removed campaigns can't be edited, and Google keeps their history.
- **Conversion actions:** two enabled actions were still named after the old
  domain:
  - "Submit lead form (www.insimeducation.com)", 590 conversions all time;
  - "Page view (www.insimeducation.com)", 719 all time, already Secondary.

  Neither label appears in the live GTM container (`gtm.js`, version 18) or in
  the repo, so neither could record anything.
- **Labels confirmed.** The Ads event snippets confirm which conversion label
  belongs to which action. On 13 Oct that mapping had been guessed from the
  names:
  - Individual Lead form = `rxIlCOyo`
  - Group lead form = `0kGNCLuw`
  - Website traffic = `NIRiCL3A`
  - the two removed old-name actions = `JDwlCIq9` and `Qm_oCKDK`
- **Google tag name:** the Google tag `AW-10893614207` is still named "Industry
  Simulation Education". That name appears under "Data sources" on every
  conversion action.
- **Clean:**
  - Account-level assets are one business logo (added 12 Oct) and no business
    name asset.
  - The GTM account is named "Stellr Education", with container
    "stellreducation.org".
  - The "Simulation Education" budget belongs only to the removed Smart
    campaign. The account has no shared budgets.
  - The four new campaigns' ad text: the Events campaign's visible ad text was
    read in the account. All 18 ads and 16 sitelinks were checked against the
    10 Nov session's upload content. None uses the old name.

## What changed in the account (11 Nov, each item approved by the owner)

| Item | Change |
|---|---|
| "Submit lead form (www.insimeducation.com)" | Removed |
| "Page view (www.insimeducation.com)" | Removed |
| "Search - Space Settlement - Leads #4" (paused) | Removed. This can't be undone. All 8 campaigns from before the rebuild are now Removed. |

Read-back after the changes:
- The toasts said "You've removed 2 conversion actions" and "1 campaign removed".
- The campaign list shows 8 campaigns Removed and 4 Enabled. The four new
  campaigns were not touched.

## Not done or not verified

- **Weekly review prompt.** Adding an old-brand check to the
  `ad-grants-weekly-review` scheduled task was part of the approved plan. Auto
  mode blocked the update, so the task prompt is unchanged (`ads-old-brand.2`).
- **Google tag name.** The rename screen (Tools › Data manager › Google tag)
  would not load in the hidden in-app browser (`ads-old-brand.1`).
- **Not checked in the account:**
  - the advertiser verification and payments-profile legal name;
  - audience and remarketing list names;
  - the auto-created assets setting.

  These were planned and are recorded as `ads-old-brand.4`.
- **Full assets of the Homeschool, Programs and Educators ads.** These weren't
  re-read in the account. The ad table shows only 3 headlines per ad, and their
  copy was checked against the 10 Nov upload content instead.
- **Overview view.** It still includes removed campaigns, so the old ad stays
  in the "Most-shown" card while the date range covers its history
  (`ads-old-brand.3`).
- **Ad Preview and Diagnosis.** Not run, because the new campaigns had 0
  impressions at the time (`ad-grants-rebuild.1`).

## Working in the Ads UI from the hidden in-app browser

- Tables virtualise to about 10 rows, and screenshots come back blank until the
  page settles. Set a 1400×1000 viewport and wait 15 s.
- Campaign IDs and names, conversion names and their `send_to` labels can be
  read from the page's embedded `document.scripts` data:
  - campaigns appear as `"2":"<id>","11":"<name>"`;
  - labels are in the "Event snippet for … conversion page" text.
- Ads › Conversions › "View all conversion actions" (`/aw/conversions/all`) has
  row checkboxes, and Edit › Remove. The confirmation dialog is one of many
  pre-rendered `[role=dialog]` nodes, so pick the visible one.

## Open items

See `tracker/2026-11-11-ads-old-brand.md`.
