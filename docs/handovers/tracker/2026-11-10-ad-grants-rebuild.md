# Google Ad Grants rebuild — 2026-11-10

Slug: `ad-grants-rebuild`. Handover: `HANDOVER-ad-grants-rebuild-2026-11-10.md`. Doc snapshot: `1btwQEirA3NnYhvZX-_7YRxhba6yb_ILCloj6orTpBf0`.
No repo code changed; account work only (Google Ads 671-715-4074). Close-out PR #… → `dev`. Migration: none.

The Ad Grants account was rebuilt and four Search campaigns went live on 10 Nov 2026 ($325/day, Maximise clicks, AI Max off). The old "Leads #4" campaign is paused. Scheduled weekly and monthly review tasks run in the owner's Claude desktop app.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| ad-grants-rebuild.1 | New campaigns serve | Enabled 10 Nov ~11:30 MT. No impressions observed by the end of the session. | Read the `ad-grants-first-serve-check` result on 13 Nov. If nothing is serving, check keyword statuses and the search terms report before escalating to Google. | ☐ |
| ad-grants-rebuild.2 | Lead-form conversion tag fires | Individual and Group lead form actions "Misconfigured"; Webpages tab has never recorded a ping (checked 10 Nov). GTM v18 live with both tags on `lead_submitted`. | Owner: submit one contact and one notify-me form on the live site with cookies accepted and Tag Assistant open, then check each action's Webpages tab within 24 h. | ☐ |
| ad-grants-rebuild.3 | Switch bidding to Maximise conversions (Grants bidding policy) | All 4 campaigns on Maximise clicks since 10 Nov. Allowed only "to begin". | Switch once the lead goals record conversions (Google's guide: 15–30 in 30 days). The weekly review flags it, and flags it again after 6 weeks. | ☐ |
| ad-grants-rebuild.4 | Account CTR ≥ 5% every month | No data yet. There is no brand campaign to prop CTR up (owner decision). | Monthly review on 1 Dec reports November. If below 5%, add a small brand ad group. | ☐ |
| ad-grants-rebuild.5 | Replacement homeschool ad stays Eligible | New ad Eligible and old "Online gambling"-limited ad paused, 10 Nov. Campaign summary still said "limited" at the time. | Confirm in the 13 Nov check that the campaign status cleared. | ☐ |
| ad-grants-rebuild.6 | Pause Minnesota ad group after the 24 Nov event | Unattended one-off task blocked by auto mode. | Weekly review on 30 Nov pauses it, or pause it by hand on 25 Nov. | ☐ |
| ad-grants-rebuild.7 | "Events in 8 States" claim in ads and sitelinks | Taken from the landing pages' `{{states}}` wording. `/events` lists 6 open US states. | Confirm the count. If not 8, change the headline and sitelink (and the LP wording) to the true number. | ☐ |
| ad-grants-rebuild.8 | Owner decisions on conversion coverage | Registrations can't convert (`/register` is no-ads), "Register Now" isn't tracked, and ad tags need Accept. | Decide: (a) a Register Now click conversion in `EventCtas.tsx` + GTM; (b) consent mode for ad tags (cookieless pings). | ☐ |
| ad-grants-rebuild.9 | Advertiser verification and funding-source confirmation | "Recommended" in Admin › Policy summary; also an account-security notice. | Owner completes both (needs identity documents) and reviews account access. | ☐ |
| ad-grants-rebuild.10 | Scheduled tasks run unattended | Created without a saved permission mode. Not yet run. | Open each `ad-grants-*` task in the app and click "Run now" once to pre-approve the browser tools. | ☐ |
| ad-grants-rebuild.11 | Draft Keyword Planner plans left in the account | Three or more drafts named "Plan from Nov 10, 2026". They don't serve. | Delete them in Tools › Keyword Planner. | ☐ |
