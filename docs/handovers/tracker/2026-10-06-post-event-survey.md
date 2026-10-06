# Post-event survey — 2026-10-06

Slug: `post-event-survey`. Handover: `HANDOVER-post-event-survey-2026-10-06.md`. Doc snapshot: `1i9QoA74s7WDfPk4Z49350Hlmr6EJIM5TzZXYwXH0SdA`.
PR #283 → `dev` as `d63e27d`, promoted in #287 (`17b6080`); PR #294 → `dev` as `0c4ce5f`, promoted in #296 (`7291e88`). Migrations: `20261002235036`, `20261003002925` and `20261003020253`, all in the prod ledger.

The post-event survey is live in production. v1 is published and 7 events have scheduled surveys, the first being Nevada SDC on 7 Nov 08:00Z. No invitation has been sent in production yet, and no survey email has reached a real inbox.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| post-event-survey.1 | First live run, Nevada SDC | Opens 7 Nov 08:00Z (00:00 PST). 0 invitations on prod as of 6 Oct. | On 6 Nov, open Nevada's Survey tab and check the invitable, awaiting-V2.3 and no-email counts. After 7 Nov 16:00Z, read `cron_runs` (job `surveys`) for `invited`/`deferred`/`failed`. | ☐ |
| post-event-survey.2 | Survey emails seen in a real inbox | Never sent. Every dev and e2e run dropped `RESEND_API_KEY`. | On dev: `npm run survey:seed-dev -- --reset`, then `-- --open --send`. That routes to the dev safelist; check the layout and links in Gmail and Outlook before 7 Nov. | ☐ |
| post-event-survey.3 | David's phone walk-through of the 3 role paths (handover §10, at most 5–6 min each) | Not reported. v1 was published on 6 Oct regardless. | Use the dev seed links on a phone. Any wording change becomes `post_event.v2.json`, published on dev and prod. | ☐ |
| post-event-survey.4 | Daily email budget vs event size | `SURVEY_DAILY_EMAIL_BUDGET` is unset, so 30/day. With e-sign's 60, that is 90 of Resend Free's 100. Larger events spread invitations over several days. | Before 7 Nov, compare Nevada's (and Minnesota's, 24 Nov) invitable count with 30. Raise the env var only if Resend headroom allows. | ☐ |
| post-event-survey.5 | DocuSign-signed minors invitable | Needs `agreements.agreement_version` ≥ 2.3. `DOCUSIGN_AGREEMENT_VERSION` is not set on prod (checked 6 Oct). The V2.3 DocuSign tab labels are the e-sign side's. | Set the env var once the V2.3 DocuSign template is live (e-sign tracker). Until then, those minors show as "awaiting V2.3 consent". | ☐ |
| post-event-survey.6 | Signed-in prod check of `/admin/media` and the certificate-gate switch | Smoke check only: signed out it returns 404, like all /admin routes; the CSV route returns 401. | Open `/admin/media` signed in, and one event's Survey tab. Leave the gate off. | ☐ |
| post-event-survey.7 | First `survey-retention` report | The cron is scheduled `0 3 2 * *`. `SURVEY_RETENTION_APPLY` is unset, so it only reports. Nothing is due before 2033. | After 2 Nov 03:00Z, read `cron_runs` (job `survey-retention`): ok, due = 0. | ☐ |
| post-event-survey.8 | Not modelled: pending account (§7.2), ward, home state | No data exists for any of them. School state stands in for home state; the minor rule uses age by state, high-school grade, or unknown DOB. | A product decision: add fields at registration if David wants them. | ☐ |
| post-event-survey.9 | Event time zone | Derived from the Sanity state; non-US falls back to Denver. Uruguay opens 10 Sept 2027 at 03:00 local (06:00Z). | Add a Sanity `timeZone` field if a non-US event needs exact local midnight. | ☐ |
| post-event-survey.10 | Retire the Google Form | Still in use. | After Nevada's survey has collected responses, retire the form. | ☐ |
| post-event-survey.11 | Published v1 carries a stale `intro.status: "DRAFT - needs David's sign-off"` field | Not rendered anywhere; harmless. | Drop the field in the next version (v2), if one is made. | ☐ |
| post-event-survey.12 | Production foundation | Prod ledger has all 3 migrations. v1 published (15:58Z). `SURVEY_TOKEN_SECRET` set on both projects (Vercel env list). First `surveys` cron run 16:09Z: ok, 6 distributions created. #296 deployment READY, with smoke checks in `.claude/releases/promote-2026-10-06b.md`. | — | ☑ |
