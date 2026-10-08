# Survey follow-ups — 2026-10-07

Slug: `survey-followups`. Handover: `HANDOVER-survey-followups-2026-10-07.md`. Doc snapshot: `1V0aesRqnOe_S9SNorB0VcmWfEBi4Peni59Whb1e1jYY`.
PR #294 → `dev` as `0c4ce5f`; promoted in #296 (`7291e88`). Migration: `20261003020253_members_backfill_deleted_at` (in the prod ledger).

The three post-event survey follow-ups are live in production: the per-event certificate gate (off everywhere), the media permission resolver (Admin → Media do-not-use, roster `media_ok`), and the 7-year survey retention job (monthly, report-only). The signed-in prod check and the first retention report are already tracked as `post-event-survey.6` and `.7`, and are not repeated here.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| survey-followups.1 | Media list shows **check** for every DocuSign-signed minor on prod | 7 Oct: all 23 completed minor agreements on prod are DocuSign, with no `agreement_version` and no `form_data_read_at`, so `lib/survey/media.ts` cannot see their media box and marks them "check". Minors with no form show "no". | Until this closes, open the signed PDF (Admin → Consent forms) before using any minor's image. It closes when `DOCUSIGN_AGREEMENT_VERSION` is set (`post-event-survey.5`) and one DocuSign V2.3 row has both `form_data_read_at` and `agreement_version` and shows yes/no on `/admin/media`. | ☐ |
| survey-followups.2 | Stellr-signed minor forms resolve to yes/no, not "check" | Prod templates `minor`, `adult` and `mentor` v1 all carry a `MediaOptOut` field (checked 7 Oct), and the resolver reads it from `signer_values`. No Stellr-signed minor agreement had completed on prod by 7 Oct. | After the first native minor agreement completes (the e-sign prod canary), open `/admin/media` filtered to that event and check that the student shows yes or no, with the right reason. | ☐ |
| survey-followups.3 | Turning survey retention deletion on | Decided 2 Oct: report-only. `SURVEY_RETENTION_APPLY` is unset on prod. Nothing falls due before 2033 (account holders) or 2034 (no account). | Before October 2033, read the latest `survey-retention` row in `cron_runs`; set `SURVEY_RETENTION_APPLY=true` on prod only if the due list looks right. | ☐ |
| survey-followups.4 | `deleted_at` backfill for inactive members | Migration `20261003020253` is in the prod ledger. 7 Oct: prod has 0 inactive members without `deleted_at` (it matched no rows on prod); dev updated 1. | — | ☑ |
| survey-followups.5 | David's 9 decisions recorded and applied | 2 Oct, all answered. In `main`: the no-account rule is no longer marked "proposed" (`lib/survey/retention.ts`, retention schedule row 27); the legacy importer, mapping and mapping doc were removed in #294; minors are not exempt from the gate; the consent loader reads the agreement columns from #280 (`lib/survey/consent.ts`). | — | ☑ |
| survey-followups.6 | Plan §6 heading said "local, not pushed" | Corrected in this close-out PR to name #294 and #296. | — | ☑ |
