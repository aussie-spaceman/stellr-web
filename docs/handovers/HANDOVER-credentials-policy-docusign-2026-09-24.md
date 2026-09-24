# HANDOVER — Credentials policy, guardian opt-out & DocuSign template fields (23–24 Sept 2026)

**Status:** shipped and promoted. #171 + #180 (with #181) live in production since
24 Sept 20:20Z — promotion #183, merge `e2a99e3`, deployment
`dpl_Decx4PkoAEdACrqPLeCyA7ZhmTBe`. Rollback target `dpl_5gBb2Ub8PavTa7sQcqL8DJHB9ob4`.
Release record: `.claude/releases/promote-2026-09-24.md`. Close-out tracker (Google Doc):
"Stellr — Credentials policy, guardian opt-out & DocuSign template fields: session close-out (24 Sept 2026)".

## What is live

- **Privacy Policy / Terms** — 23 Sep banners; Privacy 3.11, 5, 7.4 (`#credentials`), 10, 12, 13, 14
  (change notices on the website only — David's decision, settled); Terms 5.1, 5, 11.3, 13.
- **Guardian opt-out takes public pages down** — `applyGuardianOptOut` (lib/credentials-notify.ts)
  from the admin toggle and the DocuSign webhook; emails guardian, student Cc'd. Runbook:
  `docs/RUNBOOK-credential-optout.md`. Admin route response field is `unpublished`.
- **DocuSign read-back** — on `envelope-completed` for an original minor envelope the webhook reads
  `GET /envelopes/{id}/form_data` and looks for `CredentialSharingOptOut`
  (`lib/docusign-optout.ts`, `lib/docusign-form-data.ts`). `form_data_read_at` stamps every
  successful read; `/api/cron/docusign-form-data` (09:15 UTC) retries unread ones for 7 days.
- **DOB** sent to the template as DD-MMM-YYYY (`formatFormDate`).
- **Production DocuSign templates** — minor `91c01c7d-a0b8-4f2a-b8f5-62f94481d81c` was rebuilt in
  DocuSign's new editor on 24 Sept; that editor has **no Data label setting**, so every field lost
  its label and nothing prefilled. Relabelled in place with `scripts/docusign-label-minor-tabs.ts`.
  All three production templates pass `scripts/check-docusign-template.mjs`.

## Open — in priority order

1. **Prove the opt-out read-back (high criticality).** Never exercised on a real signed envelope.
   Unproven: that `/form_data` reports a checkbox that sits inside a **checkbox group** (the new
   editor wraps every checkbox in one) under its own `tabLabel`; and that ticked reads as `"X"`.
   Failure mode is silent: `readCredentialOptOut` returns `null` → `tab_absent`, the row is stamped
   `form_data_read_at`, the cron never retries, the guardian's "no" is lost.
   **Test:** send one production consent envelope with David as guardian, tick the credential
   opt-out (page 3), complete it, then read the `docusign_envelopes` row. If it came back
   `tab_absent`, switch `getEnvelopeFormData` to `GET /envelopes/{id}/recipients?include_tabs=true`
   and match the checkbox on `tabLabel`, `name` or `tabGroupLabels`, using `selected === 'true'`;
   then re-read any minor envelopes completed since 24 Sept (clear their `form_data_read_at`
   and let the cron pick them up — 7-day window).
2. **First cron run** 25 Sept 09:15 UTC — Vercel logs for `/api/cron/docusign-form-data`: 200,
   `{processed, results}`, no `failed`. Also confirm it appears under Vercel → stellr-web →
   Settings → Cron Jobs (the deployment API does not expose crons; only a 401 was seen).
3. **First real consent form after the fix** — phone, relationship, DOB (DD-MMM-YYYY), school,
   state of residence, guardian email all filled.
4. **Sandbox templates are the June versions** — minor has no opt-out box; sandbox mentor labels
   its phone `GuardianPhone` (app sends `MentorPhone`). Dev envelopes therefore don't represent
   production. Bring the production JSON into the sandbox (edit in place, or re-point dev's
   `DOCUSIGN_*_TEMPLATE_ID`) and run the checker. A labelled V2-2 test copy (`4bb9fc2c…`) was
   moved to the sandbox's Deleted Items on 24 Sept at David's request.
5. **Student fields need a student email** (pre-existing) — DOB / SchoolName / SchoolState are on
   the `Minor` role, which `createConsentEnvelope` adds only when the student has an email. David
   to decide: move them to `Guardian`, or accept.
6. **Legal wording** — confirm the V2-2 PDF in the production minor template is the reviewed text.
7. **Missing space after `</strong>`** — a JSX text run containing an HTML entity drops its leading
   space ("No waiver.If"). Fixed on /privacy and /terms only. Sweep:
   `curl -s <url> | grep -o '</strong>[A-Za-z]'`; fix with `{' '}`.
8. **Dev ledger (cosmetic)** — #181's migration is recorded on dev as `20260924192237`; realign to
   `20260924120000` in the dev SQL editor.

## How to work on DocuSign templates now

- Never trust a template edit by eye. Download the JSON (Templates → ⋯ → Download) and run
  `node scripts/check-docusign-template.mjs <minor|adult|mentor> <file>`.
- To restore minor labels: `npx tsx scripts/docusign-label-minor-tabs.ts [--env-file <f>] [--template <id>] [--apply]`
  — dry run by default; matches by role/page/line; same GUID.
- Production credentials: Vercel will not export Sensitive vars (`[SENSITIVE]` placeholders).
  Write a plain-text `.env.docusign-prod.local` by hand (TextEdit saves RTF by default — use
  Format → Make Plain Text); DocuSign shows a private key only once, so generate a fresh RSA pair
  in Apps and Keys, use it, then delete it and the file. Never print lines of that file.

## Environment facts learned

- Auto mode blocks production DB writes (MCP `apply_migration` → "Production Deploy") even with
  in-session approval, and some dev writes ("Modify Shared Resources"). David runs them in the SQL
  editor (include the ledger `INSERT` with the file timestamp); verify read-only afterwards.
- Dev's `CRON_SECRET` differs from `.env.local`'s; trigger dev crons from the Vercel dashboard.
  Every cron returns `skipped` off production.
- Dev's only minor envelope is the e2e fixture `00000000-0000-4000-9000-000000000001`
  (Ada, `STL-2026-E2EADA01`); the timeline table is `member_activity_log`.
