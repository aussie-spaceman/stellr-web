# DocuSign consent: student and guardian share an inbox — 2026-09-29

Slug: `docusign-shared-inbox`. Handover: `HANDOVER-docusign-shared-inbox-2026-09-29.md`. Doc snapshot: `1IVUD5fidVahVJZaaD6ya2nBYEcT1YPoaHRgYqA3QPrE`.
PR #243 → `dev` as `e8314d8`, PR #246 → `dev` as `04b9015`; promoted in #249 (`50d7e61`, another session). Migration: none.

When the student and guardian emails match, consent envelopes now route the student after the guardian, and every status surface calls the waiting student "queued" rather than "never opened". Only envelopes created after the deploy are affected.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| docusign-shared-inbox.1 | Alexander Blake reissued envelope `2b2f3d6c` | Guardian `rob@savagenet.com` and Minor `alex@savagenet.com`, both `sent`, 0 of 2 (prod read 29 Sept 03:01Z). Old `24bee625` voided. Robert replied to by David. | Re-read the recipient rows before 3 Oct. If either is unsigned, David chases. | ☐ |
| docusign-shared-inbox.2 | Jacksen Davidson guardian signature `55c4a7ed` | Minor completed 22 Sept; Guardian `resadvd@gmail.com` `sent`, never opened; `reminder_count` 0 (prod read 29 Sept 03:01Z). Left to the reminder cron at David's request. | After 09:00Z on 29 Sept, confirm `reminder_count` ≥ 1 and a `cron_runs` row for docusign-reminders. If it is still unopened on 1 Oct, David emails the family: the parent section is not signed. | ☐ |
| docusign-shared-inbox.3 | Sequential routing seen in prod | Merged and promoted (#249). Unit-tested on the request body only. No shared-inbox envelope has been issued since the deploy. | On the next one, read its recipients: Minor `routing_order` 2 and status `created` until the Guardian signs, then `sent`. | ☐ |
| docusign-shared-inbox.4 | "Queued" status wording | In prod (#249). Unit tests only; never viewed in a browser. | Covered by row 3: when a queued envelope exists, check the roster detail line reads "… queued — sent once the parent/guardian signs". | ☐ |
| docusign-shared-inbox.5 | Why Robert could not sign the student copy | Unknown. He signed Guardian first, then opened the student copy (the sequence the fix enforces). Seven other shared-inbox families completed both. | If another shared-inbox family reports the same, ask what DocuSign displayed before changing anything else. | ☐ |
| docusign-shared-inbox.6 | DocuSign connector cannot act on app envelopes | The connector authenticates as `david.shaw@insimeducation.com`. Envelopes are sent by `david.shaw@stellreducation.org`, so reads, recipient updates and reminders are refused. | David decides whether to grant shared access, or to connect the connector as the sending user. | ☐ |
| docusign-shared-inbox.7 | Shared-inbox audit of all participants | 9 found (prod read, 28 Sept). 7 complete; Blake reissued (row 1); Davidson open (row 2). | — | ☑ |
| docusign-shared-inbox.8 | Fixes on `main` | `git merge-base --is-ancestor` confirms `e8314d8` and `04b9015` are on `origin/main`. Deployment READY per the other session's record #250; not checked by this session. | — | ☑ |
