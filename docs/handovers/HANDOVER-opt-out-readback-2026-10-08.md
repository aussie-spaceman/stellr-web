# Handover — DocuSign opt-out read-back + explicit media answers (7–8 Oct 2026)

Slug `opt-out-readback`. Tracker: `tracker/2026-10-08-opt-out-readback.md`.
Code: #327 → `dev` as `5b3aece`; promoted in #326 (merge `6d71632`, 8 Oct 15:14Z,
finished by another session). Production `main` is now `8892455` (READY).
Migration `20261007203818_agreement_form_opt_outs`: applied to dev and prod,
ledger correct on both (read 8 Oct).

## Context

The admin **Media do-not-use** list (Operations) showed "Media box not on file:
check the signed form" for every DocuSign-signed student. The question asked
was whether the app could say plainly whether the parent or guardian opted
out, from DocuSign or Stellr Sign.

What the review found on production (7 Oct, aggregate reads only):
- 27 completed agreements, all DocuSign (23 minor, 4 volunteer), and not one
  had ever been read back. `cron_runs` for `docusign-form-data` showed
  `{"failed": N}` every day from 2 Oct (8 Oct as well: 7 failed), while
  recording each run as `ok: true`.
- So **no DocuSign opt-out of any kind had ever been recorded**: media, quotes,
  digital communications or credential sharing. This is the HIGH risk from the
  24 Sept credentials close-out, realised. The failing call was
  `GET /envelopes/{id}/form_data` itself, not a label mismatch.
- Every DocuSign form since June carries the media box. On V2.1/V2.2 DocuSign
  auto-labelled it (`Checkbox 4f0e538d-…`), so a label lookup could never find
  it.
- The root cause of the `form_data` failure was never confirmed: Hobby keeps
  runtime logs for one hour, the sandbox has no completed envelopes, and the
  DocuSign MCP connector is a different user. The new code doesn't use that call.

## What changed (#327)

- **Read path** (`lib/esign/providers/docusign.ts`, `lib/docusign.ts`):
  - `GET /envelopes/{id}/recipients?include_tabs=true` gives each checkbox's
    `selected` and position.
  - `GET /envelopes/{id}/documents/{documentId}` gives the signed PDF.
  - Each box is named by the "I DO NOT consent to …" sentence printed beside
    it (`nameCheckboxes` in `lib/docusign-form-data.ts`, using pdf.js). Labels
    are ignored, so the V2.3 template that briefly carried
    `CredentialSharingOptOut` on the quote box can't cause a misread.
  - A box with no sentence beside it stays unknown and is never guessed.
- **`agreements.form_opt_outs` jsonb**: `{MediaOptOut: true|false, …}`.
  - `true` means ticked ("I do NOT consent").
  - `NULL` means the form has not been read.
  - `{}` means the form was read but no box could be identified.
  - Written by `recordCredentialOptOutFromForm` (`lib/docusign-optout.ts`)
    for DocuSign and Stellr Sign alike. The boolean columns are still only
    ever set to true.
- **Cron** (`app/api/cron/docusign-form-data`):
  - Reads every completed original with `form_opt_outs IS NULL`. There is no
    7-day lookback any more.
  - Takes 50 per run, newest first, within a 2-minute read budget.
  - Each failure goes into `cron_runs.errors`, so the run is `ok=false`.
- **Media rule** (`lib/survey/media.ts`):
  - A read media box counts as known on any form version; the V2.3
    requirement is gone.
  - New reason `agreement_no_opt_out`.
  - `mediaReasonDetail` gives wording such as "Parent/guardian ticked / left
    unticked … on the agreement signed Oct 2, 2026".
- **Admin page** `/admin/media`:
  - New "Show: Everyone, with the reason" option (`?show=all`).
  - The CSV gains an "Agreement Signed" column.
- **pdf.js in the bundle**: `next.config.mjs` now ships the pdf.js worker and
  standard fonts with `/api/cron/**` and `/api/webhooks/docusign`. This was
  proven with `next build` + `next start` reading a sandbox draft (the 6 Oct
  lesson).
- **`scripts/backfill-form-opt-outs.ts`**: a dry run prints each form's
  answers (row ids only, no names); `--apply` records them.

## Verified

- **Box naming:**
  - all 4 boxes on the V2.1 minor/adult/mentor DocuSign exports;
  - all 6 on the dev V2.3 templates, including wrapped sentences.
- **Sandbox, unsent draft envelope** (deleted after each run):
  - a direct call read both boxes, and read the media box flipping to ticked;
  - the same read worked through a production build.
- **Dev:** the migration was applied, and the backfill `--apply` recorded 2
  Stellr-signed rows.
- **Admin page:** loaded signed in, with no console errors.
- **CI:** #327 `verify` and `e2e` passed, as did the `dev` push run
  (`e2e` 5m48s).

## Not verified

- **No completed DocuSign envelope has been read by the new code anywhere.**
  The sandbox has none, and on prod every one is still `form_opt_outs IS NULL`
  (8 Oct). The first prod run is the cron at about **09:22Z on 9 Oct**.
- **The answers have not been checked against a signed PDF.**
- **The webhook path has not been exercised** on a real completion since the
  deploy.
- **The cron's new `ok=false` reporting has not been seen** on a real failure.

## Related rows

- `survey-followups.1` ("check for every DocuSign minor") now closes on
  different terms. #327 no longer needs `DOCUSIGN_AGREEMENT_VERSION`; a read
  media box is enough. Close it once `opt-out-readback.1–.3` are ticked.
- The 24 Sept credentials close-out HIGH (opt-out read-back unproven) closes
  with `opt-out-readback.1` and `.4`.
- `docs/handovers/FOLLOW-ON-docusign-minor-credential-optout.md` still
  describes the `form_data` design. It belongs to another session, so it is
  not edited here; treat this handover as superseding its read path.

## Open items

See the tracker file. Most important: read `cron_runs` after the 9 Oct run,
then compare two forms' answers with their signed PDFs.
