# Stellr signing switched on in production — 2026-10-07

Slug: `esign-prod-switch-on`. Handover: `HANDOVER-esign-prod-switch-on-2026-10-07.md`. Doc snapshot: `1uZeVaKg1jUbY1khriJj3F-jdoMUbuUx7k39Vyi1yxAw`.

What shipped, and where:
- PRs #302, #304, #309, #316 and #319 were squash-merged to `dev`.
- They were promoted in #305 (`8a8777f`), #310 (`564cfc7`) and #318 (`ee441ad`). All three promotions were opened by other sessions.
- No migrations.

Stellr signing is on in production. The DocuSign allowance reads correctly, the V2.3 documents are approved and active, and adult memberships sign the Educator / Chaperone agreement. All 27 signed records are backed up, encrypted, to Drive "E-Sign Backups".

| # | Item | State | Next | Done |
|---|---|---|---|---|
| esign-prod-switch-on.1 | **HIGH.** First Stellr-signed agreement completed in production | One native `adult` agreement was issued after the switch-on (status `sent`, 7 Oct). None has completed. The canary (allowlist, test adult + minor, then PDF, download and backup checked) has not been run. | Add a test address to the overflow allowlist, issue and sign an adult and a minor agreement, then check the PDF, download, audit trail and Drive copy | ☐ |
| esign-prod-switch-on.2 | Backup folder ID corrected | `ESIGN_BACKUP_DRIVE_FOLDER_ID` reset by David to E-Sign Backups (`1bfhEXSG…`); redeploy BUILDING at 19:53Z. All 55 existing files are in that folder (Drive listing). | After 09:22Z on 8 Oct, check that `export-2026-10-08.json.enc` is in E-Sign Backups, not Participant Agreements | ☐ |
| esign-prod-switch-on.3 | CA-issued seal certificate | Parked by David. The steps are in the session: RSA key, CSR, `.p12`; node-forge reads both OpenSSL 3 default and `-legacy` files. Signed PDFs are unsealed until then. | David buys an exportable document-signing / S/MIME certificate and sets `ESIGN_SEAL_P12` and `_PASSWORD` | ☐ |
| esign-prod-switch-on.4 | Bounce tracking for Stellr signing emails | `RESEND_WEBHOOK_SECRET` is not in production (`vercel env ls`, 7 Oct), so `/api/webhooks/resend` cannot verify bounces | Create the Resend webhook for `email.bounced` and set the secret | ☐ |
| esign-prod-switch-on.5 | "Store signed documents now" within its time limit (#319) | Live in #318. Not exercised on production: nothing was waiting after it deployed. | Read the card message after the next manual run with records waiting | ☐ |
| esign-prod-switch-on.6 | Countersignature values | `ESIGN_COUNTERSIGN_NAME`, `_TITLE` and `_AUTHORITY` exist in production; their contents were not seen | Check the first completed mentor or volunteer agreement signed through Stellr signing | ☐ |
| esign-prod-switch-on.7 | Unused template keys `membership_adult` and `membership_minor` | Still offered by `TEMPLATE_KEYS` (admin documents list) and the `TemplateKey` type; nothing issues them since #316 | Remove them from `lib/esign/native/template-admin.ts` and `plan.ts` | ☐ |
| esign-prod-switch-on.8 | Interrupted manual maintenance run | The `cron_runs` row for `esign-maintenance-manual` started 17:20:26Z on 7 Oct never finished (Vercel killed it at 60 s, before #319) | None needed: it is history. Ignore it in the ledger | ☑ |
| esign-prod-switch-on.9 | DocuSign allowance on the card | Shows 38 left, 0 of 40 (David's screenshot, 7 Oct), after #302 | None | ☑ |
| esign-prod-switch-on.10 | Template approval on production | minor, adult and mentor v1 approved and active (prod SQL, 16:19Z 7 Oct), after #304 and #309 | None | ☑ |

## Closes

- `esign-native-engine.4`: production V2.3 templates. minor, adult and mentor v1 were published by David and approved and active at 16:19Z on 7 Oct (prod `esign_templates`).
- `esign-native-engine.5`: membership agreement wording. Superseded by David's decision on 7 Oct: an adult joining signs the Educator / Chaperone agreement (#316, live in #318 `ee441ad`). A Minor joining already signs the Student / Minor agreement.
- `esign-native-engine.2` (partly): `ESIGN_TOKEN_SECRET`, `ESIGN_BACKUP_*` and `ESIGN_COUNTERSIGN_*` are set in production. The seal and `RESEND_WEBHOOK_SECRET` remain; they are now `esign-prod-switch-on.3` and `.4`.
