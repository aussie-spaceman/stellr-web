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

## Aligned to the Participation Agreements V2.3 (2 Oct, branch `feat/esign-agreements-v2-3`)

David supplied the V2.3 Word files (Adults, Mentors, Minors; Governance shared
drive) as the latest and correct versions. The engine now follows them:

- **Titles**: Participation Agreement — Student / Minor; — Educator /
  Chaperone; Mentor and Volunteer Agreement (`AGREEMENT_TITLE`, emails, portal,
  admin, DocuSign subjects).
- **"Minor"**: under the state's age of majority (AL/NE 19, MS 21, else 18;
  `lib/age.ageOfMajority`), or a student at any age. State = the school's.
- **Minor agreement validity**: no end date; reused only on the current
  version (`agreement_version`, `AGREEMENT_VERSION = '2.3'`), so families
  re-sign only when the agreement changes. Pre-V2.3 rows are not reused
  (accepted by David: returning families sign V2.3 once). Stellr signing rows
  record 2.3; DocuSign rows record `DOCUSIGN_AGREEMENT_VERSION`, which stays
  unset until David has updated the DocuSign templates (expected 3 Oct).
  Adults, mentors, volunteers keep 3 years. `agreementExpiry` / `agreementValid`
  / `agreementCovers` in `lib/docusign-agreements.ts`.
- **Mentor under the age of majority** (§3A): a parent (the emergency
  contact) signs first, always on Stellr signing (`lib/esign/issue.ts`).
- **Membership for a Minor**: the Student / Minor agreement, recorded as
  `minor`, so it covers their events too.
- **New fields**: MinorEmail, MinorGrade, QuoteOptOut (minor); emergency
  contact (mentor); MentorAddress (mentor, signer-entered).
- **Opt-outs**: `media_opt_out`, `quote_opt_out`, `digital_comms_opt_out`
  read back on completion (both engines) and shown in Admin → Consent forms.
- **Retention**: membership + 7 years after deactivation
  (`startRetentionClock` on deactivation; `retainUntilOnCompletion`); a
  deletion request keeps only a minimal record. Disclosure is now versioned
  (`2026-10-v2`).
- Migration `20261002235609_esign_agreements_v2_3.sql` (dev applied, ledger
  aligned). Dev templates minor/adult/mentor v3 published and approved, with
  text versions generated from the .docx. **v2 is active on dev until this
  branch lands**: activating v3 early broke every other PR's e2e on the shared
  dev DB (3 Oct). On merge, make v3 active (`update esign_templates set active
  = (version = 3) where key in ('minor','adult','mentor') and version in (2, 3)`).

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

## Close-out (6 Oct)

**Where it is.** Everything is in production and inert. #273 was promoted in
#276 (`f9722fa`, 2 Oct) and the V2.3 alignment #280 in #279 (`29be23e`, 3 Oct).
All six migrations are in production. `esign_provider_state.mode` is
`docusign_only`, and neither Vercel project has any `ESIGN_*` variable
(`vercel env ls`, 6 Oct). DocuSign therefore takes every agreement except the
two kinds only Stellr signing can issue: the membership agreement, and a mentor
under the age of majority. Those land in "Needs paperwork" with an admin alert,
retried daily, until the `ESIGN_*` variables are set (tracker .2; David
accepted this on 3 Oct).

**After the merge (3–6 Oct).**
- v3 is active on dev (it matches dev's code now). Minor v3 also carries
  `document_version = 'V2.3'`, which the post-event survey's gate for minors
  looks up (tracker .20).
- #280 also fixed two e2e failures that hit every PR on the shared dev DB:
  - the admin template list crashed on one unreadable draft;
  - member-account's sign-out ended the saved Ada session for every other
    spec. That test now makes its own session (`e2e/fixtures/sign-in.ts`).
- DocuSign's new editor cannot set data labels, so the three V2.3 DocuSign
  templates were labelled through the API (#295,
  `scripts/docusign-label-minor-tabs.ts --doc minor|mentor|adult`, `--list`,
  `--dump`). The editor had also mislabelled two fields:
  - the minor quote box carried `CredentialSharingOptOut`, so a quote opt-out
    would have recorded a credential opt-out;
  - the mentor emergency phone carried `MentorPhone`, so the mentor's own
    phone would have printed there.
  The mentor parent block's three Mentor-role fields were deleted (an
  under-age mentor never signs on DocuSign). All three templates pass
  `scripts/check-docusign-template.mjs`, whose contract is now V2.3.
- `DOCUSIGN_AGREEMENT_VERSION` is set in both projects (David, 6 Oct). It is a
  Secret, so the value could not be read back.

**Not verified.**
- No DocuSign V2.3 envelope has been sent from the app yet. The new pre-fill
  fields, and the read-back of the quote/media/digital-comms opt-outs from
  DocuSign's form data, are unproven (tracker .19, HIGH). Check the first
  completed minor, mentor and adult agreement.
- Stellr signing has never run in production: there are no production
  templates (tracker .4) and no `ESIGN_*` variables (tracker .2).

**Lessons.**
- Never activate data on the shared dev DB that dev's code or specs depend
  on before the matching code has merged. Activating v3 early broke #278 and
  `main`'s CI for an hour.
- A production DocuSign template edited in the web UI needs its labels
  re-checked through the API every time.
