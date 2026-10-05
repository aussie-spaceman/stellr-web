# Correct a signer's email from the app — 2026-10-05

Slug: `agreement-correct-recipient`. Handover: `HANDOVER-agreement-correct-recipient-2026-10-05.md`. Doc snapshot: none.
PR → `dev` (this branch); not promoted. Migration: `20261005161443_esign_audit_corrected.sql`, applied to dev only.

Admins and event managers can fix a signer's address on a live agreement ("Correct email"). It goes through the DocuSign API, or Stellr signing's own tables, so signatures are kept and no envelope is used. The participant record is fixed with it.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| agreement-correct-recipient.1 | Gabriel Armijo, Colorado SDC, agreement `64057565`, envelope `3306a0af` | Prod read 5 Oct ~16:22Z. Guardian `completed`; Minor `autoresponded` at the typo `chasintgeharvest@gmail.com`. The parent says the right address is theirs, `chasingtheharvest@gmail.com`. | After promote: Correct email on the roster (Minor → `chasingtheharvest@gmail.com`). Confirm the Minor goes to `sent`, then `completed` once signed. This is the first proof on the production plan. | ☐ |
| agreement-correct-recipient.2 | Production migration | Applied to dev; ledger version matches the file. | David applies it to prod before the promote merges. | ☐ |
| agreement-correct-recipient.3 | Native correction live | Unit tests only. No live native agreement on dev. | When Stellr signing issues on dev or prod: correct one signer. Check the old link is refused, the new invite arrives, and `esign_audit_events` has `corrected` with `esign_verify_audit` returning NULL. | ☐ |
| agreement-correct-recipient.4 | Other signers re-notified | `resend_envelope=true` reset a bounced co-signer to `sent` on demo. Treated as a reminder. | If it causes confusion, try `resend_envelope=false` on a demo envelope and check whether DocuSign still emails the corrected signer. | ☐ |
| agreement-correct-recipient.5 | One web action a month | The template save for the V2.3 labels (`esign-native-engine` tracker) competes with any manual web correction. | Do the label work through the API, or plan it into a fresh billing cycle. | ☐ |
| agreement-correct-recipient.6 | DocuSign support case 18095860 | Open; support asked whether to close (5 Oct). | David replies: resolved via the API, close the case. | ☐ |
| agreement-correct-recipient.7 | Demo test envelope `733f2396` | Now addressed to `david.shaw+dscorrect-*` aliases; dev participant `72e712f7` guardian email changed to match. Test data from the MN grade-7 check. | Void with the other MN test rows (`minnesota-grades-7-12` tracker). | ☐ |
