# DocuSign opt-out read-back + explicit media answers — 2026-10-08

Slug: `opt-out-readback`. Handover: `HANDOVER-opt-out-readback-2026-10-08.md`. Doc snapshot: `1X8ga0GU2JuyNfchJ5vAGCG2IKjDwdWHOqQ0atMbXbos`.
PR #327 → `dev` as `5b3aece`; promoted in #326 (`6d71632`). Migration: `20261007203818_agreement_form_opt_outs` (dev + prod, ledger correct).

Opt-out boxes are now read from DocuSign's recipient tabs and named by the sentence beside each box on the signed PDF. The answers go into `agreements.form_opt_outs`, and the cron backfills every unread form. `/admin/media` says who answered, and on which form. Live in production; nothing has been read on prod yet (8 Oct).

| # | Item | State | Next | Done |
|---|---|---|---|---|
| opt-out-readback.1 | **HIGH** First prod read of the 28 unread forms | 8 Oct: all 28 completed originals on prod have `form_opt_outs IS NULL`: 23 DocuSign minor, 4 DocuSign volunteer, 1 Stellr-signed adult. The 8 Oct 09:22Z cron ran the old code (merge was 15:14Z): `failed: 7`. | After about 09:25Z on 9 Oct, read `cron_runs` for `docusign-form-data`. Expect `processed: 28`, no `failed`, `ok: true`. Then confirm no `form_opt_outs IS NULL` rows remain. On failures, `errors` now holds DocuSign's message. Alternative: `npx tsx scripts/backfill-form-opt-outs.ts --env-file <prod>` (dry run first). | ☐ |
| opt-out-readback.2 | **HIGH** Answers match the signed forms | Naming proven on template PDFs and a sandbox draft, never on a completed (flattened) DocuSign PDF. | Pick 2 read forms (an opted-out one if any exists). Open each signed PDF (Admin → Consent forms) and compare its boxes with `form_opt_outs`. | ☐ |
| opt-out-readback.3 | `/admin/media` shows explicit answers | 7 Oct: 23 "check" rows on prod. The new wording has only been seen on dev. | After .1, open `/admin/media?show=all`. Every signed student should read "Parent/guardian ticked / left unticked … on the agreement signed …". Any left on "check" means a box wasn't named: open that form. | ☐ |
| opt-out-readback.4 | Webhook path on a real completion | Untested since deploy; no DocuSign completion on prod after 8 Oct 15:14Z. | On the next DocuSign completion, check its row has `form_opt_outs` set within minutes, i.e. not left for the cron. | ☐ |
| opt-out-readback.5 | Credential opt-outs from forms take pages down | Untested. A ticked `CredentialSharingOptOut` runs `applyGuardianOptOut`. Only V2.3 minor forms carry the box; V2.1/V2.2 have none. | After .1, if any row has `CredentialSharingOptOut: true`, check the activity log for "Guardian opted out of public credential pages" and that the member's credentials are private. | ☐ |
| opt-out-readback.6 | Why `GET /form_data` failed | Unknown: Hobby log retention is 1 h, and the sandbox has no completed envelopes. The suspected cause is the account setting "Allow sender to download form data". | Low priority: no code uses the call any more. Close as won't-fix unless something else needs `form_data`. | ☐ |
| opt-out-readback.7 | Opt-outs sent by email | Not in the data, so they stay on the manual list (unchanged). | None in code. Keep adding them by hand; the page says so. | ☐ |

## Closes

None yet. `survey-followups.1` and the 24 Sept credentials close-out HIGH (opt-out read-back) close once `.1`–`.3` (and `.4` for the credential HIGH) are ticked. See the handover.
