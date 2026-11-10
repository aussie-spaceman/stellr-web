# Bounced signing emails: notices and self-service fixes — 2026-11-09

Slug: `bounce-notices`. Handover: `HANDOVER-bounce-notices-2026-11-09.md`. Doc snapshot: `1l77-EtqsSuGMO9o_aq6JY3-Kni8_NXz6v7-Tekd1tfg`.
PR #585 → `dev` as `68e10fc2`; promoted in #587 (`6026dd22`, production `dpl_AsbweAviH9NXG3WfmCYRPrm3zUZc`); record #589 (`57b78a4b`). Migration: `20261109200000_agreement_email_changes` (dev and production, ledgers realigned).

Every bounced signing email (DocuSign or Stellr signing, bounced or held by the suppression list) is announced once per address from `lib/esign/bounce-notices.ts` to admins, the event's active managers, a group's registrant and nominated teacher, and the other signer on a guardian + student form. Organisers fix a bounced address in Your group, a parent fixes the student's through a one-time link, and a student only suggests the parent's for an adult to approve (`lib/esign/email-changes.ts`).

| # | Item | State | Next | Done |
|---|---|---|---|---|
| bounce-notices.1 | The bounced guardian address on the Minnesota EDC form of student `1b859f4c-911a-4db4-ac69-55112d5a9288` (names in the Doc) | New notices re-sent 9 Nov 22:37Z after clearing `bounce_notified_email` on that one row with the owner's yes. Staff email confirmed in the staff inbox; teacher `f717aae6-5fbb-46e8-bd10-a56ee7177e99` bell recorded; student one-time suggestion link created (expires 16 Nov). Address still bounced: Stellr has no correct address | Wait for the student's suggestion or the teacher's Fix email; else staff Correct email once an address is known. Check `agreement_email_changes` for the agreement | ☐ |
| bounce-notices.2 | Delivery of the teacher's and the student's notice emails | Sent with no runtime errors; neither address on the suppression list. Their inboxes are not visible to Stellr | Check Resend's log for the two sends, or ask the teacher whether the notice arrived | ☐ |
| bounce-notices.3 | First live use of Fix email, a one-time link, and a suggestion approval | Covered by 34 unit tests only; never exercised on dev or production | The first real one (likely .1); confirm the `agreement_email_changes` row, the corrected DocuSign recipient and the change notice | ☐ |
| bounce-notices.4 | Event manager path | No event manager is assigned to the Minnesota event or any live event with a bounce, so managers have never received a notice | The next bounce on an event with an active manager; confirm their bell/email | ☐ |
| bounce-notices.5 | Second bounced signer on production: a student's own address on a 28 Oct Minnesota form no longer linked to any participant (form member `7b783fe3-a95d-4e86-bdee-c2d84a9105a6`) | Marked "already announced" by the backfill; nothing re-sent. Re-running would email that form's parent a fix link | Owner: re-run, void the orphaned form, or leave it | ☐ |
| bounce-notices.6 | `npm run verify:prod` GTM check | Fails on live HTML because it looks for a `<noscript>` that `components/analytics/GoogleTagManager.tsx` deliberately no longer renders. Not caused by #587 | Update the check in `scripts/verify-prod-services.ts` to the client-side loader | ☐ |
| bounce-notices.7 | `npm run verify:prod` reads the local env | Run 9 Nov from a worktree on dev keys, so its Stripe and DocuSign lines described dev, not production | Run it with production env (or make it refuse dev keys) before relying on it in a promote | ☐ |
| bounce-notices.8 | Owner review of guard-file edits in #585 | Merged to dev and promoted with the owner's "ship it" / "promote", not a separate CODEOWNERS approval: tenancy tests now accept a child table created after C0b (`LATER_CHILD_MIGRATIONS`, `POST_C0B`); `test/tenant-surface-baseline.json` hand-edited (2 notify edges → 1, `MAX_EDGES` 38 → 37) | Owner reads those hunks in #585 | ☐ |
| bounce-notices.9 | `/sign/email` on tenant hosts | `pending` in `lib/tenancy/tenant-surface.ts`; links are built on Stellr's host (`SITE_URL`) | When tenant routing goes live, build a tenant-host link and check the agreement's tenant against the host | ☐ |
| bounce-notices.10 | Session worktree `.claude/worktrees/bounce-notices` | Left on disk: a worktree-isolated session cannot remove itself | Next `npm run worktrees -- --apply` from the main checkout | ☐ |
| bounce-notices.11 | Migration on production before the code | Applied 9 Nov with B9, Event Manager, group payers and teacher share, each with the owner's yes; ledger rows re-read under their filenames | — | ☑ |
| bounce-notices.12 | Promotion | #587 merged (`6026dd22`), deployment READY on the merge SHA; www 200, app 307, cron guard 401; `/api/sign/email` answers a bogus link 404; no runtime errors after deploy | — | ☑ |

## Closes

- `event-manager-role` (prod migration `20261109120000` before promote): applied 9 Nov with the owner's yes, ledger re-read; promoted in #587.
- `group-payment-options` (both prod migrations before promote): `20261109180000` and `20261109190000` applied 9 Nov with the owner's yes, ledger re-read; promoted in #587.
- S5 wave 4 B9 (`20261106234759`, owner approval of the rule): owner approved 9 Nov; applied, 4 checks validated; promoted in #587.
