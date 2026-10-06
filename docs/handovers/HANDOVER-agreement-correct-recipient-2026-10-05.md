# Handover: correct a signer's email in the app — 2026-10-05

Slug: `agreement-correct-recipient`. Tracker: `tracker/2026-10-05-agreement-correct-recipient.md`.
Plan: approved in session (Claude plan file `refer-to-latest-email-spicy-hearth.md`).

## Why

DocuSign support, case 18095860 (Emmanuel Jr, 3 Oct 2026). The account is on a
Basic/Starter **API** plan:

- The web portal allows **one** send, correction or template save per billing
  cycle. After that it shows "Envelope Limit Reached".
- The eSignature REST API can create, send and correct against the normal allowance.

So "Correct" in DocuSign's UI is effectively unavailable, and until now the only fix
for a typo or bounce was void and reissue:

- it used 1 of the 40 monthly envelopes;
- it threw away signatures already given (Blake, 29 Sept).

**Decision reversed.** On 29 Sept David declined an in-place "change signer email"
admin action (`HANDOVER-docusign-shared-inbox-2026-09-29.md`, option #3), because the web
UI showed no Correct. On 5 Oct he asked for exactly that, through the API. His choices:

- access: admins and event managers;
- fix the participant record in the same action;
- build DocuSign and Stellr signing (native) now.

**The template edits are affected too.** The once-a-month web limit also covers
**template saves**. The open V2.3 template-label task (`esign-native-engine` tracker)
competes with any manual correction for the month's single web action. Do it through
the API (`scripts/docusign-label-minor-tabs.ts` pattern) or in a fresh cycle.

## What was built

| Piece | Where |
|---|---|
| DocuSign API correction | `lib/docusign.ts` `correctRecipient`. It does `PUT /envelopes/{id}/recipients?resend_envelope=true` with only `{recipientId, email, name}`. It refuses envelopes that aren't sent/delivered and finished signers. It checks `recipientUpdateResults[].errorDetails` (DocuSign answers 200 on a per-recipient failure), maps `ENVELOPE_LOCKED`, and reads the recipient back. While nobody has signed, it rewrites that signer's own prefilled email fields. |
| Provider seam | `EsignProvider.correctRecipient` + `CorrectionRefusedError` (`lib/esign/types.ts`). The DocuSign adapter maps lib refusals (status 409) to the neutral error. `correctRecipientRow` lives in `lib/esign/operations.ts`. |
| Native (Stellr signing) | `lib/esign/providers/native.ts`. It updates `agreement_recipients` and bumps `token_version` (the old link dies), moves a bounced signer from `autoresponded` back to `sent`, and re-invites only when it is that signer's turn. It rewrites `prefill` emails only while nobody has signed. Audit event `corrected`. |
| Migration | `20261005161443_esign_audit_corrected.sql` adds `corrected` to the `esign_audit_events.event` CHECK. **Applied to dev** (ledger version matches the filename). **Not applied to production.** |
| Service | `lib/agreement-correction.ts`. Validates; calls the engine; syncs recipients; updates `agreements.signer_email`. Updates the participant column for the role (Guardian → `emergency_contact_email`; Minor/Adult/Mentor/Volunteer → `email`), but **only if it still holds the old address**. Never touches `members` or Clerk. Refuses the Stellr counter-signer. |
| API | `GET/POST /api/admin/agreements/[id]/correct-recipient`. Gated by `requireEventAccess(agreement.event_slug)`; agreements with no event are admin-only. Logs `docusign_corrected` to `member_activity_log`. |
| UI | `components/admin/CorrectSignerEmailButton.tsx`, a dialog portalled to `<body>` (inside a table cell it inherited `whitespace-nowrap` and spacing). Mounted on the event roster (shown red when the pill is bounced, before Reissue), the Agreements table and the member agreement panel. |
| Copy | Bounce guidance now says "use Correct email" (status detail, admin alerts, Needs paperwork, Resend bounce alert). The reissue confirm points to Correct first. |
| Ops script | `scripts/agreement-correct-recipient.ts <agreementId\|envelopeId> [recipientId newEmail --apply] [--env-file …]`. Lists signers, dry-runs by default, and logs to the activity log. |

## Proven (5 Oct, DocuSign demo account + dev DB)

1. **Raw API correction** on demo envelope `733f2396…`, Minor → `david.shaw+dscorrect@…`.
   - The PUT succeeded and the read-back showed the new address with status `sent`.
   - The signing email arrived at the new address.
   - **Side effect:** the uncorrected, bounced Guardian also went from `autoresponded` back to `sent`. `resend_envelope=true` re-notifies the other current signers too.
2. **Full service path via the script** (`--apply`) on the same envelope, Guardian → `david.shaw+dscorrect-guardian@…`:
   - `agreement_recipients`, `agreements.signer_email` and `participants.emergency_contact_email` were all updated;
   - `docusign_corrected` was logged;
   - the email arrived.
3. **The UI dialog** via Playwright (admin storage state, worktree server :3011), on `/admin/docusigns`: Minor → `+dscorrect-ui`, with the success message.
   - It correctly reported that the participant record held a different address and was left alone (step 1 had bypassed the service).
   - After the portal fix, the layout was checked at 1400px and 390px.
4. Unit tests: `lib/docusign-correct.test.ts`, `lib/agreement-correction.test.ts`, `lib/esign/providers/native-correct.test.ts`, the adapter case in `providers/docusign.test.ts`, and the route test.

## Not proven

- **The production DocuSign plan.** The demo account is a developer sandbox, so the "API allowed, web UI limited" behaviour rests on support's email. The first real correction (tracker row .1) is the proof.
- **The native engine live.** Dev had no live native agreement, so it is unit-tested only.
- **Rewriting the prefilled email fields.** The demo envelope's GuardianEmail was blank, so nothing matched. Unit-tested only.
- **The roster mount in a browser.** The test event isn't in Sanity, so the Agreements table was used instead. It is the same component.
- **Whether `resend_envelope=false` would still email the corrected signer** without re-notifying the others. Testing it was blocked by auto mode.

## Production, in order

1. Apply `20261005161443_esign_audit_corrected.sql` to production **before** the code merges (`promote`). Prod migrations are run by David.
2. Promote.
3. Correct Gabriel Armijo's Minor address (tracker .1), then watch for his signature.

## Close-out (6 Oct 2026)

**Landed:**
- #285 → dev `8d1969d`; promoted in #287 (`17b6080`, 6 Oct 15:01Z).
  - #287 also carried the post-event survey #283, another session's work that merged into `dev` minutes earlier.
  - Its prerequisites were done by David and checked before the merge:
    - both survey migrations applied, with ledger rows (`db:status --prod`);
    - `SURVEY_TOKEN_SECRET` set on both Vercel projects (checked with `vercel env ls`, names only).
- Promotion record and the `main` → `dev` sync: #288 (`589451d`).

**Smoke-check finding, fixed:**
- The new route answered a signed-out POST with 404, not 401: the guard read the agreement before checking the caller.
- Fixed in #289 (`8c2ba1e`, auth first).
- Promoted in #291 (`d9b1d9f`), another session's promotion. Re-checked on prod afterwards: a signed-out POST now gets 401.

**Proven in production:** David corrected Gabriel Armijo's Minor at 15:17Z (tracker .1).
- The Guardian's signature was kept.
- The Minor went to `sent` at `chasingtheharvest@gmail.com`.
- The participant row was updated and `docusign_corrected` logged.

**Gaps, stated honestly:**
- **Not exercised outside unit tests:**
  - the native correction (.3);
  - rewriting DocuSign's prefilled email fields (.9);
  - `resend_envelope=false` (.4).
- **No e2e spec covers the correction flow.** It was verified with a one-off Playwright script against a local server, then removed.
- **I hand-picked the migration timestamp at first** (`20261005160000`), against the repo rule. Before shipping it was regenerated, then aligned to the dev ledger's own version (`20261005161443`).
- **Ship skill Phase 1's gating question** (checklist confirmation) was not asked separately. The approved plan was taken as the contract.
- **Test data was changed:** the demo envelope `733f2396` and the dev participant `72e712f7` (.7).
