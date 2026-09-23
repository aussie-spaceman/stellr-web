# FOLLOW-ON — DocuSign minor consent: credential-sharing opt-out

**Raised:** 21 Sept 2026 · **From:** `docs/PLAN-credentials-linkedin-2026-09-21.md` §3.4 · **Status:** code done 23 Sept 2026 (`feat/credentials-policy-docs`); **template edit (steps 1–2) outstanding**

## Decision it implements (D1, 21 Sept 2026)

The parental / guardian consent form reads as the guardian **automatically
opting their child in** to a public credential page (name + achievement, which
the student may share, e.g. on LinkedIn at 16+), **unless the guardian
specifically notes otherwise on the form.**

The credentials build ships with the opt-out model in code
(`docusign_envelopes.credential_sharing_opt_out`, default `false`) and an admin
toggle on the Consent forms table. What is *not* done yet is letting the
guardian record the opt-out on the form itself.

## Work

1. **Template copy.** Add a clause to the minor consent template (the one
   `DOCUSIGN_TEMPLATE_ID` points at), alongside the existing photo/video clause:
   *"Stellr may publish my child's name and achievement on a Stellr credential
   page that my child may choose to share (for example on LinkedIn, from age
   16). Tick here if you do NOT consent: ☐"* — final wording per `VOICE.md`
   and legal review.
2. **Tab.** Add a checkbox tab on the **Guardian** role, `tabLabel:
   CredentialSharingOptOut`, unticked by default, not required. Edit the
   template in place so its GUID (and `DOCUSIGN_TEMPLATE_ID`) does not change.
   Do it in the sandbox account first; carry to production with
   `npx tsx scripts/docusign-templates.ts export` / `import --apply`, which
   preserves tab labels (see the script header for why that matters).
3. **Read it back.** In `app/api/webhooks/docusign/route.ts`, on
   `envelope-completed` for `envelope_type = 'minor'`, call
   `GET /envelopes/{id}/form_data` (add `getEnvelopeFormData` to
   `lib/docusign.ts` beside the other envelope reads) and set
   `credential_sharing_opt_out = true` when the checkbox is ticked. Coverage
   rows (`reused_from`) inherit through `consentForMinor` already.
4. **Retry.** If the `form_data` read fails at completion, leave the column
   `false` (the decided default) and log; add a sibling of
   `app/api/cron/docusign-reminders` that re-reads completed minor envelopes
   from the last 7 days whose form data was never fetched. Track the fetch
   with a `form_data_read_at timestamptz` column.
5. **Tests.** `lib/docusign-status.test.ts` sibling for the form-data parse;
   webhook unit test for the write.
6. **Docs.** Note the template edit in `docs/DOCUSIGN-CONNECT.md` and the
   new column in `docs/SCHEMA-BASELINE.md`.

## Why it is a follow-on

The template lives in the DocuSign dashboard, not the repo, and changing a
legal document the guardian signs needs a copy/legal pass. Nothing in the
credentials build depends on it: the default already matches the decided
model, and the admin toggle covers a guardian who opts out by email meanwhile.

## Progress — 23 Sept 2026

Done in code (`feat/credentials-policy-docs`):

- Step 3: `getEnvelopeFormData` in `lib/docusign.ts`; parse in
  `lib/docusign-form-data.ts` (tab absent → `null`, leave stored value);
  write in `lib/docusign-optout.ts`, called from the Connect webhook.
- Step 4: `form_data_read_at` (migration `20260923120000_docusign_form_data_read.sql`)
  and `/api/cron/docusign-form-data` (daily 09:15 UTC, 7-day lookback).
- Step 5: `lib/docusign-form-data.test.ts`.
- Step 6: `docs/DOCUSIGN-CONNECT.md` updated.
- **Decision changed 23 Sept:** an opt-out (form or admin toggle) now takes any
  already-public pages private and emails the family
  (`applyGuardianOptOut` in `lib/credentials-notify.ts`). The previous
  "leave them up" rule is reversed.

Still to do by hand:

1. Final clause wording — the draft copy of the Participation Agreement in
   Drive carries it; legal review first.
2. Add the `CredentialSharingOptOut` checkbox (Guardian role, unticked, not
   required) to the minor template in the **sandbox** account, edit in place,
   then carry to production with `scripts/docusign-templates.ts`.
3. Sandbox check: sign one envelope with the box ticked and confirm the row
   gets `credential_sharing_opt_out = true` and `form_data_read_at` set. The
   checked value is assumed to come back as `"X"`; the parser also accepts
   `true`/`on`, but confirm on the first real read.
