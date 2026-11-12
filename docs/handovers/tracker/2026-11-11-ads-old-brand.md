# Old business name removed from Google Ads — 2026-11-11

Slug: `ads-old-brand`. Handover: `HANDOVER-ads-old-brand-2026-11-11.md`. Doc snapshot: `1Rcp5BmX3Eu2f86y2iYGW8rnsUGYh5_e6UNOlL9TwU-0`.
No repo code changed; account work only (Google Ads 671-715-4074). Close-out PR #… → `dev`. Migration: none.

Two old-name conversion actions and the paused "Leads #4" campaign were removed on 11 Nov 2026. Every pre-rebuild campaign is now Removed. Old-name ads survive only inside removed campaigns, which can't be edited.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| ads-old-brand.1 | Rename the Google tag AW-10893614207 | Named "Industry Simulation Education"; shown under "Data sources" on every conversion action (read 11 Nov). The rename screen didn't load in the hidden in-app browser. | Owner: Ads › Tools › Data manager › Google tag › rename to "Stellr Education". | ☐ |
| ads-old-brand.2 | Old-brand check in the weekly review task | Auto mode blocked `update_scheduled_task` on `ad-grants-weekly-review`. The prompt is unchanged. | Owner: add check 8 to the task (flag InSim / insimeducation.com / Simulation Education / Industry Simulation Education in any enabled item; "industry simulation" is allowed only as an event description; report the Google tag name), or approve the update in a session. | ☐ |
| ads-old-brand.3 | Old ad stops surfacing on the Overview | Overview is set to all time and "2 filters · 12 campaigns", so it includes removed campaigns. The removed Website traffic-Search-1 ad tops "Most-shown search ads". | Owner: set the Overview/Campaigns view to Enabled campaigns, or use a date range after 10 Nov. | ☐ |
| ads-old-brand.4 | Unchecked places for the old name | Advertiser verification and payments-profile legal name, audience/remarketing list names, and the auto-created assets setting were not read on 11 Nov. | Read each once. Rename lists if needed. Flag a legal-name mismatch rather than changing it. | ☐ |
| ads-old-brand.5 | Old-name conversion actions removed | "Submit lead form (www.insimeducation.com)" (label `JDwlCIq9`) and "Page view (www.insimeducation.com)" (`Qm_oCKDK`) were removed 11 Nov. The toast read "You've removed 2 conversion actions" and both rows showed the removed icon. Neither label is in live `gtm.js` v18 or the repo. | — | ☑ |
| ads-old-brand.6 | All pre-rebuild campaigns Removed | "Leads #4" removed 11 Nov ("1 campaign removed"). A campaign-list read-back shows all 8 old campaigns Removed and the 4 new ones Enabled. | — | ☑ |
