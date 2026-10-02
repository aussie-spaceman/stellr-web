# Handover — Stellr signing (in-app e-signature engine), 2 Oct 2026

Plan: `docs/PLAN-esign-2026-10-02.md` (approved by David, 2 Oct). Branch
`feat/esign-seam`, squash-merged to `dev`. **Not promoted.** Production stays on
DocuSign until the steps below are done: the engine ships with
`mode = docusign_only` and is inert without `ESIGN_TOKEN_SECRET`.

## What shipped (all three phases)

- **Provider seam** (`lib/esign/`): every DocuSign call goes through
  `EsignProvider`; `seam.test.ts` refuses new direct imports.
- **Routing**: DocuSign until its monthly allowance is spent (its own
  `ENVELOPE_ALLOWANCE_EXCEEDED` is authoritative; account usage read daily),
  then Stellr signing until the reset; also on a DocuSign outage (5xx, 429,
  network, 25 s timeout). Membership agreement always Stellr signing. Admin →
  Consent forms → E-signature engine: mode, types, allowlist canary.
- **Stellr signing** (`/sign`, `lib/esign/native/`): link key in the URL
  fragment → 30-minute httpOnly session; year-of-birth check for a child's
  form; ESIGN disclosure; guardian attestation; guardian first, then the
  student (all ages); typed or drawn signature (image only); a different name
  needs an explicit second step; pdf.js viewer; WCAG 2.1 AA (axe in e2e);
  session renews from the link if it runs out.
- **Records**: signed PDF + audit file in private bucket `signed-agreements`,
  SHA-256 on the row, append-only hash-chained audit trail, certificate seal
  (PAdES) with RFC 3161 timestamp (also applied retroactively by the daily
  `seal` step), encrypted copy to a Google Workspace shared drive, nightly
  table export, integrity checks, heartbeat. Signed copies are never emailed:
  signers get a 30-day download link.
- **Retention**: 7 years from signing then deleted; deletion requests restrict
  instead; unfinished requests voided and their signing data deleted 30 days
  after the last link.
- **Email**: daily signing budget (Resend Free), outbox, one email per parent
  for siblings, `{{agreement_link}}` merge field, bounces via
  `/api/webhooks/resend`.
- **Admin**: Needs paperwork list; Agreement documents (preview, visual field
  editor, checks, typed-confirmation approval); membership backfill; Privacy
  requests (`/admin/privacy-requests`).
- **Public**: `/privacy/request` (review, correction, deletion, withdrawal,
  confirmed by emailed link); Privacy Policy, Terms and new
  `/school-data-terms` revised (Last Updated 09-Oct-2026).
- **Elsewhere**: one age calculation (`lib/age`); tables renamed
  `agreements` / `agreement_recipients` behind compatibility views; security
  headers and no trackers on private routes; teams API no longer leaks
  teammates' details; resend IDOR fixed; cron guard fail-closed.

## Production, in order (David)

1. **Migrations**, oldest first: `20261002173459_esign_provider_archive`,
   `20261002180041_esign_signed_record_retention`,
   `20261002180802_esign_native_engine`, `20261002213222_agreements_rename`,
   `20261002214001_privacy_requests`. Re-read `db:status --prod` afterwards.
2. **Env (Production scope)**: `ESIGN_TOKEN_SECRET` (≥32 random chars),
   `ESIGN_BACKUP_KEY` (escrow in the password manager), `ESIGN_BACKUP_DRIVE_FOLDER_ID`,
   `ESIGN_COUNTERSIGN_NAME/_TITLE/_AUTHORITY`, `ESIGN_SEAL_P12` +
   `ESIGN_SEAL_P12_PASSWORD` (a **CA-issued** document-signing certificate;
   self-signed is refused in production), `RESEND_WEBHOOK_SECRET`. Optional:
   `ESIGN_DAILY_EMAIL_BUDGET` (60), `ESIGN_TSA_URL`.
3. **Resend**: webhook for `email.bounced` → `https://<app host>/api/webhooks/resend`.
4. **Templates**: production exports (`npm run docusign:templates`) and the
   original source PDFs; convert with `scripts/esign-template.ts convert <key>
   <export> --pdf <original>`, publish, check (`--pdf`, `--export`), approve.
   Membership agreement wording (adult + minor).
5. **Promote** with `mode = docusign_only`. Then the 9 Oct production test:
   allowlist canary, a test adult and minor signed, PDF + seal + download +
   drive copy checked, then `mode = auto`.
6. **After the new code is live**: `docs/esign/migration-step-2-drop-compat-views.sql`.
7. **DocuSign account**: switch off "attach documents to completion email" and
   the AI data-sharing default.

## Open

See `tracker/2026-10-02-esign-native-engine.md`. Decisions only David can
make are marked there. `docs/compliance/README.md` lists 14 conflicts between
the policies and the code that need an owner decision.

## Verification (dev, 2 Oct)

- Unit 1,239 passing; typecheck, token and migration lint clean.
- e2e: `esign-signing.spec.ts` (parent + student sign, axe at every step,
  drawn signature, seal verified offline on the downloaded copy, no trackers,
  forged links), `privacy-requests.spec.ts`, editor and admin guards;
  `registration-docusign`, `registration-resume`, `member-account` pass.
- Fallback drill (`scripts/esign-fallback-drill.ts`): 6/6 on dev.
- Rename compatibility checked through the API under the old names (read,
  embed through both views, insert, update, delete; anon refused).
