# Handover: Stellr signing switched on in production — 2026-10-07

Slug: `esign-prod-switch-on`. Tracker: `tracker/2026-10-07-esign-prod-switch-on.md`.
Follows `HANDOVER-esign-native-engine-2026-10-02.md` (the engine build) and its
tracker rows `esign-native-engine.1–.20`.

## Context

David reviewed Admin → Consent forms on 6 Oct and found four problems:
- Stellr signing showed "not switched on".
- The pill read "0 DocuSign envelopes left".
- There was no off-site backup.
- No agreement documents were stored.

This session fixed the code faults, got the production documents published, and
walked David through the environment settings. By the end of 7 Oct, Stellr
signing was on in production.

## What changed (all in production)

| PR | Change | Promoted in |
|---|---|---|
| #302 | `effectiveCap` ignores DocuSign's `account_allowed`. The Starter API plan reports 1 allowed (the web-UI allowance), against 40 API envelopes. `failed:` placeholder rows no longer count as envelopes. | #305 (`8a8777f`) |
| #304 | `lib/esign/native/dommatrix.ts`: a 2D `DOMMatrix` installed before pdf.js loads. `@napi-rs/canvas` is not in the Vercel bundle, so template checks threw "DOMMatrix is not defined". | #305 |
| #309 | pdf.js gets its worker from `globalThis.pdfjsWorker`, and its fonts from `process.cwd()`. Inside the Next bundle, `require.resolve` returns a module id, which gave "Invalid `workerSrc` type". | #310 (`564cfc7`) |
| #316 | An adult joining signs the Participation Agreement — Educator / Chaperone, recorded as `adult` (David, 7 Oct). There is no separate membership document. | #318 (`ee441ad`) |
| #319 | "Store signed documents now" stops copying after 35 s, inside its 60 s limit. The card reports how many were copied, and explains a cut-off run instead of a JSON parse error. | #318 |

What David did in production:
- Published minor, adult and mentor v1 from dev's v3 (the V2.3 Word source) with `scripts/esign-template.ts publish`, and approved all three (16:19Z, 7 Oct).
- Set `ESIGN_TOKEN_SECRET` and `ESIGN_COUNTERSIGN_NAME`, `_TITLE` and `_AUTHORITY`, then redeployed.
- Set `ESIGN_BACKUP_KEY` and `ESIGN_BACKUP_DRIVE_FOLDER_ID`. He added the service account `stellr-sheets@stellr-498516.iam.gserviceaccount.com` as Content manager on the shared drive Stellr → 6 Governance → E-Sign Backups.
- Moved 55 backup files there. They had been written to "Participant Agreements" while the folder ID briefly pointed at that folder.
- Reset the ID to `1bfhEXSGJOVv4b6y6Qne8BRW3U9AGq2MQ` and redeployed. The deployment was BUILDING at 19:53Z.

## How things were verified

- **Allowance:** David's screenshot shows "38 DocuSign envelopes left this period, 0 of 40".
- **pdf.js fixes:** the bundle-only failures were reproduced with a real `next build` and `next start`, using a temporary route that called `checkVersion`. Without the fix, all three templates failed with the production error; with it, all three passed. David's live approvals then succeeded.
- **Templates:** production `esign_templates` has minor, adult and mentor v1, all `active` and approved by David.
- **Backup:** 27 of 27 records have `replicated_at`, and Drive "E-Sign Backups" lists 55 `.enc` files. These are 27 `-signed.pdf.enc`, 27 `-certificate.pdf.enc`, and `export-2026-10-07.json.enc`.
- **Native issue:** one native `adult` agreement was issued in production after the switch-on (status `sent`, not yet signed).

## Not verified

- **No Stellr-signed agreement has completed in production.** The planned canary has not been run: an allowlisted address, a test adult and minor signed, then the PDF, download and backup copy checked.
- **The corrected folder ID.** The first write into E-Sign Backups after the reset will be `export-2026-10-08.json.enc`, from the 8 Oct 09:22Z run.
- **#319 on production.** Nothing was waiting to copy after it deployed.
- **The countersignature values.** Their names exist in Vercel, but their contents are unseen. The first completed mentor or volunteer agreement on Stellr signing shows them.

## Lessons

- Server code that touches `require.resolve`, optional native packages, or file paths must be checked with a real `next build`. vitest and tsx never exercise the bundle.
- Auto mode refuses to materialise production credentials, even after an in-chat "allow it". David runs prod-credential scripts himself.
- Count off-site copies from `agreements.replicated_at`, not from a Drive title search. Each DocuSign record has two files, and the search missed the certificates and the export (24 reported, 55 actual).
- GitHub runner outages show up as a `verify` failure with no steps ("failed to be acquired"). `gh run rerun --failed` clears it.

## Open items

See the tracker file. The ones that matter most:
- `esign-prod-switch-on.1` (HIGH): the production canary.
- `.2`: confirm the 8 Oct export lands in the right folder.
- `.4`: `RESEND_WEBHOOK_SECRET` is not set, so Stellr-signing bounces are not recorded.
- `.3`: the seal certificate, parked by David.
