# Plan: in-app e-signature engine alongside DocuSign

Overflow path live by **Fri 9 Oct 2026**; every previously deferred item scheduled and complete by **Fri 23 Oct**.

## Context

DocuSign (eSignature Starter, $600/yr, bought 6 Aug 2026, term ends about 6 Aug 2027) allows 40 envelopes a month. September used 23; one 30-student group nearly exhausts a month. When the allowance runs out, each agreement fails individually and the participant is left without paperwork. Direct member sign-ups are not papered at all.

The review also found:

- Signed PDFs are not stored in the web app; downloads fetch live from DocuSign.
- No provider seam: ten callers import `lib/docusign.ts` directly.
- Production Supabase is on the Free plan: no backups, 1 GB file storage.
- No security headers anywhere; Google Tag Manager, HubSpot and Vercel Analytics load on every page, so any link token in a URL reaches third parties (already true of the group join link on the registration confirmation page).
- The Privacy Policy, Terms, school data-terms checkbox and the agreement templates contradict each other and the code in several places, and name DocuSign as the consent channel in 11+ places.

**Outcome:** a signing engine inside the web app that takes agreements automatically once DocuSign's allowance is spent, always takes the new membership agreement, stores every signed PDF from both engines with an encrypted second copy, meets the security and minors' data commitments below, and replaces DocuSign at the end of the term.

## Decisions (settled with the owner)

| Topic | Decision |
|---|---|
| Engine | Native, inside the web app. Self-hosted Documenso/DocuSeal rejected (second always-on server, not clearly better). |
| Legal bar | ESIGN/UETA audit trail; no third party; no counsel, so standard wording that the owner approves. |
| Routing | DocuSign until the monthly cap, then native until the allowance resets. |
| Membership agreement | New document, always native, live 9 Oct. Wording due Mon 5 Oct. |
| Counter-signature | Applied automatically on mentor/volunteer completion under a recorded standing authorisation. |
| Retention | **7 years from signing**, as the Privacy Policy states today; automatic deletion after that. |
| Deletion | Deleting a participant keeps a signed agreement (unlinked, access-restricted) until its 7 years expire; in-flight ones are voided. |
| Guardian identity | Email link only, as with DocuSign. The policy stops calling consent "verifiable". |
| Email | Stay on Resend Free; queue sends under a daily budget. |
| Database | Stay on Supabase Free; rely on the encrypted second copy; storage alerts. |
| Second copy | Google Workspace shared drive, encrypted before upload with a key only Stellr holds. |
| Templates | Converted from production DocuSign exports for 9 Oct; visual editor by 23 Oct. |

Compliance requirements confirmed by the owner:
- Every minor signs, under-13s included, the same as today. On native the guardian signs first; the student's request is sent only once the guardian has completed, so nothing is collected from a child before a parent has consented.
- Photo and media release stays opt-out, as on the current form. The Privacy Policy and Terms are corrected to describe an opt-out (they currently promise "explicit consent").
- Completed PDFs are never emailed as attachments. Signers get a gated download. For DocuSign envelopes the owner switches off DocuSign's "attach documents to completion email" setting.
- Medical and dietary information stays on the member record for future events; the Privacy Policy is updated to say so.
- Editing and publishing the Terms of Service and Privacy Policy pages is part of this body of work, not a separate task.

## Architecture

### 1. Provider seam — `lib/esign/`

House pattern: `lib/background-provider/{types,index}.ts`.

| File | Purpose |
|---|---|
| `types.ts` | `EsignProvider`: `create`, `getRecipients`, `remind`, `void`, `getFieldValues`, `getSignedDocument`, `supports(type)`, `sendsOwnEmails`; `AllowanceExhaustedError` |
| `index.ts` | `getProvider(id)`, `providerForRow(row)` |
| `providers/docusign.ts` | Thin adapter over `lib/docusign.ts` (file and exports kept so existing `vi.mock('./docusign')` tests pass) |
| `providers/native.ts` | The new engine |
| `routing.ts`, `issue.ts` | Provider choice, create, fall back |
| `operations.ts` | `remindEnvelopeRow`, `voidEnvelopeRow`, provider-aware recipient sync |
| `completion.ts` | `onEnvelopeCompleted`, shared by the DocuSign webhook and the native sign route; idempotent via `completion_notified_at` |
| `archive.ts`, `replicate.ts` | Store, load, encrypt and replicate signed records |
| `emails.ts`, `outbox.ts` | Signing and completion emails; send queue and daily budget |
| `retention.ts` | `retain_until`, purge, restrict |

Add to `lib/docusign.ts`: `'membership'` in `AgreementType`, a typed `DocusignApiError` (`errorCode`), `getEnvelopeCertificate()`, `getAccountUsage()`.

Callers moved behind the seam: `lib/docusign-agreements.ts` (split into `dispatchAgreement` and `dispatchTyped`), `lib/docusign-reissue.ts`, `lib/docusign-recipients.ts`, `lib/docusign-optout.ts`, `lib/deletion/external.ts`, both resend routes, both download routes, `app/api/cron/docusign-reminders/route.ts`, `app/api/webhooks/docusign/route.ts`. `lib/esign/seam.test.ts` fails if anything else imports `lib/docusign`.

`describeEnvelope` in `lib/docusign-status.ts` stays the single status vocabulary; native statuses map onto DocuSign's. Add `unsent` and `issue_failed` states and a `member` role label.

### 2. Automatic fallback — `lib/esign/routing.ts`

State: single-row table `esign_provider_state` (`mode` `auto | docusign_only | overflow_only`, `monthly_cap`, `reserve`, `overflow_types`, `overflow_allowlist`, `exhausted_until`, account-reported `sent / allowed / period_end`).

`chooseProvider(db, type)`: membership → native; manual mode; `exhausted_until` in the future → native; account-reported or app-counted usage at `cap − reserve` → native; else DocuSign.

- **Authoritative usage:** `getAccountUsage()` reads `billingPeriodEnvelopesSent`, `billingPeriodEnvelopesAllowed` and `billingPeriodEndDate` from DocuSign's account endpoint (fields confirmed to exist; confirm the production integration user may read them). Cached 15 minutes, refreshed by the daily cron. This removes the dependence on a hand-entered reset day and counts envelopes sent from DocuSign's own web UI.
- **Authoritative error:** on `ENVELOPE_ALLOWANCE_EXCEEDED`, set `exhausted_until` to the period end (one alert), retry the same agreement on native. A 60-student group then never calls DocuSign again. An error within 48 hours after a computed reset backs off 6 hours, not a month.
- **Outage fallback** (Phase 2): DocuSign 5xx or timeout also falls back to native; never for sandbox-credential errors.
- **Admin:** "E-signature engine" card on `app/(admin)/admin/docusigns/page.tsx` (engine, used/cap, reset date, mode, queue depth, storage used, last cron runs), backed by `app/api/admin/esign/state/route.ts`. Engine column in `components/admin/DocusignTable.tsx`.

### 3. Schema

Additive first; rename in Phase 3 behind compatibility views. Every new table: RLS enabled, `service_role` policy, explicit `GRANT` to `service_role`, `REVOKE ALL … FROM anon, authenticated` (the baseline's default privileges grant ALL to both, and the anon key is public). New SQL functions: `REVOKE EXECUTE … FROM PUBLIC`.

Migration 1:
- `docusign_envelopes`: `provider`, `signed_pdf_path`, `signed_pdf_sha256`, `certificate_path`, `archived_at`, `archive_attempts`, `archive_error`, `replicated_at`, `completion_notified_at`, `retain_until`, `restricted_at`; widen `envelope_type` for `membership`; `participant_id` FK to `ON DELETE SET NULL`. `REVOKE` anon/authenticated on both `docusign_*` tables.
- `docusign_envelope_recipients`: `invite_sent_at`, `invite_attempts`, `invite_error`, `token_version`, `token_expires_at`, `consented_at`, `signed_ip`, `signed_user_agent`, `signature_kind`, `signature_text`, `signer_values jsonb`.
- `esign_provider_state`; `esign_email_budget` (sends per UTC day); `esign_access_log` (who viewed or downloaded which record).
- `esign_audit_events`: append-only. `GRANT SELECT, INSERT` only, `BEFORE UPDATE OR DELETE` trigger that raises, `prev_hash`/`hash` chain, no cascading FK.
- Private bucket `signed-agreements`.

Migration 2: `esign_templates` (key, version, `pdf_path`, `pdf_sha256`, `field_map`, `text_html`, `disclosure_version`, `approved_by`, `approved_at`, active); `docusign_envelopes.template_id`, `prefill`; bucket `agreement-templates`; `school_data_terms_version` and hash on `registrations`.

Also `supabase/seed.sql`, `lib/deletion/registry.ts`, `scripts/verify-deletion-registry.mjs`, baseline re-dump after production apply. Migration versions come from the tooling.

### 4. Signed-record archive, second copy, retention

- **Store:** `signed-agreements/{provider}/{yyyy}/{row_id}/signed.pdf` plus `certificate.pdf` (DocuSign) or `audit.json` (native). No names in paths. SHA-256 on the row. Status flips to completed only after the PDF is stored and hashed.
- **Backfill:** admin route `app/api/admin/esign/archive-backfill/route.ts` plus a retry step in the daily cron. Sandbox-era and "DEMONSTRATION DOCUMENT" envelopes are reported and excluded.
- **Downloads:** both routes serve a 60 to 120 second signed URL after an authorisation check (the 4.5 MB function body limit rules out streaming), write `esign_access_log`, set `Cache-Control: no-store`, and refuse under admin impersonation. Guardians download through their token session.
- **Second copy:** nightly, each new PDF and audit file is encrypted (AES-256-GCM, `ESIGN_BACKUP_KEY`) and uploaded to a Google Workspace shared drive folder via the existing service account. The same job writes an encrypted export of the agreement tables, because Supabase Free has no database backups. Retention deletions are propagated to the drive.
- **Retention:** `retain_until = completed_at + 7 years`. A purge job deletes the PDF, audit file, replica and row after that date. A deletion request before then deletes operational data and sets `restricted_at` (no access except for a legal claim), with a written explanation to the requester. Unsigned invites that never complete are voided and their recipient data cleared after 30 days.

### 5. Native engine

- **Templates:** converter script turns each exported production DocuSign template (PDF plus tab coordinates) into an `esign_templates` row. The base PDF is rebuilt through `copyPages` into a clean document (strips JavaScript, actions, attachments) and its hash recorded. Field map: `{ name, role, type, page, x, y, w, h, source: prefill|signer|system, required }`. Versions are immutable; an envelope pins its version; production refuses a version without `approved_at`.
- **Link and session:** the emailed link carries the token in the URL fragment (`/sign#…`), so it never reaches server logs, analytics, crawler logging or referrers. The page posts it once to `app/api/sign/session/route.ts`, which verifies `recipientRowId.HMAC(ESIGN_TOKEN_SECRET, id:token_version)` with `safeStrEqual` and sets a 30-minute httpOnly, `SameSite=Strict` cookie. Tokens expire after 30 days (reminders carry a fresh link) and die on void, reissue or completion. `ESIGN_TOKEN_SECRET` is dedicated, Production-scoped, with no fallback to another secret.
- **Sign page:** `app/(public)/sign/page.tsx`, `@stellr/web-ui` components, Design System V2 tokens, `VOICE.md` copy. No GTM, HubSpot or Vercel Analytics on `/sign` (tracker components become path-aware; the same exclusion is applied to the pay-token page and the confirmation page's `?join=` leak is removed). Headers for `/sign` and `/api/sign` in `next.config.mjs`: CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `X-Robots-Tag: noindex`, `X-Content-Type-Options: nosniff`.
- **States:** invalid, expired and voided links show identical generic text; "not your turn yet" names no other signer. For a minor's document the guardian confirms the participant's year of birth before anything is shown (stops a mistyped guardian address exposing a child's details; removable).
- **Steps:** ESIGN disclosure (right to paper, how to withdraw, how to get a copy, system requirements; unticked checkbox; versioned text stored with the signature) → document with an HTML text equivalent → editable fields → review screen → sign. Paper alternative: a "request a paper form" path to `privacy@`.
- **Sign API:** `app/api/sign/[action]/route.ts`. `Origin` checked against `SITE_URL`; `rateLimitGuard` per IP and a database counter per recipient; zod validation with length caps; conditional update on recipient status so a double submit cannot seal twice. Audit events (viewed via client beacon, consented, signed, declined) record IP from Vercel's forwarded header and user agent, for the signer only, stored only in the legal record.
- **Signature:** typed name (Phase 1); drawn alternative (Phase 2) stored as an image only, no stroke timing or pressure.
- **Rendering:** `lib/esign/native/render.ts`, pdf-lib with an embedded, subset Unicode font via `@pdf-lib/fontkit` (`pdfSafe` turns non-Latin names into `????`, unacceptable on a legal document). Route added to `outputFileTracingIncludes`.
- **Sealing:** Phase 1: certificate page (signers, timestamps, IP, user agent, template hash, disclosure version, audit-chain head) plus SHA-256. Phase 2: certificate-based PDF signature (PAdES, `@signpdf`) with an RFC 3161 timestamp from a public timestamp authority (which receives only a hash); the `.p12` is a dedicated base64 env var, Production scope, guarded like `assertLiveCredentials`. Documents sealed in Phase 1 receive the certificate seal retroactively as an archival seal.
- **Ordering:** for every minor, guardian first, then the student (all ages, shared inbox or not). The student's link is created and emailed only after the guardian completes. One canonical age helper (`lib/age.ts`) replaces the divergent `isMinor` copies for e-sign immediately and everywhere else in Phase 3.
- **Auto counter-signature:** system stamp plus an audit event citing the standing authorisation.
- **Opt-out read-back:** `getFieldValues` returns `CredentialSharingOptOut` from `signer_values`; `lib/docusign-optout.ts` unchanged.

### 6. Emails

- Native: `signatureRequestEmail` per signer (carries the notice items a parent is owed: what is collected, why, that consent is required, how to refuse, link to the policy). `agreementCompletedEmail` to every signer with a link to the gated download, never an attachment. All new templates escape interpolated values (`escapeHtml`). No promotional content.
- DocuSign rows keep today's templates; branch on `provider`.
- **Queue:** `esign_email_budget` counts sends per UTC day with a reserve for payment and registration mail; guardians first; stops on 429 or quota errors; drained by the four existing daily cron slots, on sign events, on admin page load, and by an admin "send now" button. A 60-student group takes two or more days on Resend Free.
- Reminders: same cadence (7 days, every 7, max 4). Manual resend gets a cooldown on `last_manual_resend_at` and a per-recipient daily cap.

### 7. Membership agreement

- Type `membership`, variants `membership_adult` and `membership_minor`; `lib/membership-agreement.ts` `dispatchMembershipAgreement` → `dispatchTyped(…, { forceProvider: 'native' })`.
- Trigger: `app/api/members/onboarding/route.ts` after the role sync (covers self-serve, admin invite and `/join`); the adult signs in the flow without waiting for an email. `onboardingRequirements` gains the derived flag.
- Defaults: skipped when a valid event agreement is on file; never covers event paperwork; volunteers sign only the mentor agreement; non-blocking until Phase 3.
- Its data, retention and school-records clauses must match the revised Privacy Policy, since it overrides the Terms where they conflict.

## Builds that reduce the eight risks

| Risk | Builds |
|---|---|
| 1. Email is the only delivery channel, under 100/day | In-flow signing at the end of registration and onboarding when the registrant is the signer; "Sign now" in `components/member/DocusignsSection.tsx`; signing link folded into emails already sent (confirmation, pay link) and a `{{agreement_link}}` merge field for the Email Reminders tab; one email per guardian covering siblings; budget table with reserve; queue depth on the admin card with an alert when the backlog exceeds a day; Resend bounce webhook restoring the "Email bounced" state (Phase 2); `sendEmail` failures surfaced instead of swallowed |
| 2. Legal text fidelity | Base PDF taken byte-for-byte from the DocuSign export and hashed; coverage checker (`scripts/check-esign-template.mjs`) fails if any DocuSign tab, including unlabelled checkboxes and the mentor address fields, has no field-map entry; render tests comparing extracted text and field positions against the source; admin side-by-side preview; owner approval recorded per version; version and hash printed on the certificate page |
| 3. Seven days, one developer | `mode` switch with `docusign_only` as the safe default; `overflow_allowlist` canary (native only for listed test addresses); `overflow_types` cut line; `issue_failed` rows retried by cron and listed in admin as "Needs paperwork", so a failure on both engines is never silent; reconciliation job listing participants who need an agreement and have none; Playwright spec for the full signing flow |
| 4. Day-one seal is hash-based | Append-only audit table with hash chain; daily chain-head hash written to the encrypted drive copy as an off-database anchor; weekly integrity job re-hashing stored PDFs and verifying the chain, alerting on mismatch; certificate seal and trusted timestamp in Phase 2, applied retroactively |
| 5. Wrong allowance reset | Account usage read from DocuSign; error path and 6-hour backoff retained |
| 6. Token leakage | Fragment token and session cookie; no trackers; security headers; expiry and rotation; generic invalid-link states; year-of-birth check; existing pay-token and join-token leaks fixed |
| 7. Crons do not run outside production | Each job is a pure function with unit tests and an admin "run now" route with dry-run; opportunistic draining on user and admin activity; heartbeat check alerting when any job has no `cron_runs` row in 26 hours; `guardCron` in `lib/cron.ts` made constant-time and fail-closed when `CRON_SECRET` is unset |
| 8. Storage has no backups | Nightly encrypted replication of PDFs, audit files and an agreement-table export to the shared drive; storage usage on the admin card with an alert at 70% of 1 GB (roughly 2,500 to 4,000 documents); font subsetting and object streams to keep PDFs small; `scripts/esign-restore-drill.ts` decrypts a random sample and verifies hashes, run quarterly; backup key escrowed in the owner's password manager |

## Security hardening in the same area

- Fix the resend IDOR in `app/api/members/teams/[id]/participants/[pid]/docusign-resend/route.ts` (participant not scoped to the team; `.maybeSingle()` breaks after a reissue; no cooldown).
- `GET /api/members/teams/[id]` returns every participant's date of birth, health conditions, emergency contacts and guardian emails to any participant of the team. Restrict to the owner; participants get names and status only.
- Admin download: sanitise the filename, log access, scope to admins holding the agreements staff scope.
- DocuSign webhook: ignore out-of-order events that would overwrite `completed`.
- Remove `PROD_DATABASE_URL` from local `.env.local` files (owner).
- Owner checks: Clerk MFA enforced for admin accounts; MFA on the Supabase, Vercel, Resend and Google consoles.

## Policy and document workstream

In scope for this work: I draft the wording, the owner approves it (no counsel), and I edit and ship the pages, with a new "Last Updated" date and change banner, on the day native takes real agreements.

| Document | Changes |
|---|---|
| Privacy Policy (`app/(public)/privacy/page.tsx`) | DocuSign references become "DocuSign or Stellr's own signing system"; signing records generated and held by Stellr, including IP address and browser details; "verifiable" removed, consent method described accurately; students under 13 sign their own section only after a parent or guardian has consented; guardian phone and relationship, ethnicity, gender, T-shirt size disclosed; **medical and dietary information is kept on the member record for future events** (resolves the §8 "deleted promptly after the event" versus §10 "duration of account" contradiction; removable on request); retention table corrected (7 years for signed records, signing metadata category); deletion rights reconciled with retained signed records; **photo and media release described as an opt-out on the consent form**, replacing "explicit consent"; sub-processor table corrected (Google Workspace including the encrypted backup, Checkr, Printful, Discord, Vercel Analytics, the timestamp authority; Resend, Supabase and Vercel rows expanded); data-location statement; a single accurate FERPA position; change-notice wording aligned with the Terms |
| Terms (`app/(public)/terms/page.tsx`) | Electronic signing disclosure; third-party list; photo opt-out wording (replacing "explicit consent"); notice wording; account rules matching guardian-plus-member signing |
| School data terms | New page `app/(public)/school-data-terms/page.tsx`, versioned; the group form checkbox (`components/forms/GroupRegistrationForm.tsx`) links to it without naming DocuSign; version and hash stored on the registration; carve-out for signed consents as Stellr's legal records; notice to teacher contacts who accepted the old wording |
| Agreement templates (new version) | Remove "not an education record", "DocuSign parental permission forms" and "seven years following account deactivation"; retention and medical-data clauses matched to the revised policy. Signature blocks and the media opt-out are unchanged. |
| Internal (`docs/compliance/`) | Retention schedule; written information security program with a named owner; incident response plan (30-day Colorado notice, 72-hour school notice); data protection assessment for minors (Colorado SB 24-041); sub-processor register and data map |

## Schedule

**Phase 1 — to Fri 9 Oct (overflow live)**

| Day | Work | Verified by |
|---|---|---|
| Sat 3 | Migration 1 on dev; seam; callers moved; no behaviour change; `lib/age.ts`; `guardCron` fix | Existing Vitest suite, seam-guard test, `e2e/core/registration-docusign.spec.ts`, one dev sandbox issue/resend/void |
| Sun 4 | Archive, backfill, signed-URL downloads with access log; routing with account usage; admin card; hardening fixes | Routing tests (period edges, reserve, 60 sequential dispatches make one DocuSign call after exhaustion, membership never DocuSign); archive idempotency; IDOR and teams-API tests |
| Mon 5 | Promote Sat+Sun with `mode='docusign_only'`. Template converter, coverage checker, render with Unicode font, security headers, tracker exclusion | Owner: run migration and backfill, download a PDF, compare the card with DocuSign's billing page |
| Tue 6 | Session exchange, sign page and API, disclosure, audit chain, outbox and budget, completion pipeline | Token, session, sign-route and outbox tests; adult signing end to end on dev in the Browser pane at mobile width; header and no-tracker checks via network requests |
| Wed 7 | Minors (guardian first, then student, all ages), media and credential opt-outs, mentor auto counter-sign, reminders/reissue/void, membership agreement, in-flow signing; Privacy Policy, Terms and school data terms page edits | Playwright spec driving `/sign`; status-mapping tests; owner approves policy, terms, school terms and template wording |
| Thu 8 | Encrypted drive replication and table export; retention fields; real iPhone and Android; stamped PDFs compared with production DocuSign documents; fallback drill on dev; promote with `mode='docusign_only'` | Dev runs: adult, minor under 13, minor 13 to 17 (each with two inboxes and a shared inbox), mentor, membership adult and minor; restore drill on dev |
| Fri 9 | Production: allowlist canary, owner signs a test adult and a test minor agreement, checks PDF, certificate page, hash, emails (no attachments), status, download, drive copy; revised policy and terms pages go live; then `mode='auto'` | `cron_runs` rows next morning |

Gate for real minors' consent on native: security headers, no trackers, fragment token and session, guardian-first ordering, disclosure, gated download, policy and terms pages published, drive copy working. If the gate is not met, `mode` stays `docusign_only`. Cut line: mentor/volunteer via `overflow_types`, then membership.

**Phase 2 — Sat 10 to Fri 16 Oct**

Certificate-based seal with trusted timestamp, applied retroactively; drawn signature; in-page PDF viewer (pdf.js) alongside the HTML text equivalent; Resend bounce webhook; outage fallback; visual field editor v1 (placement with live preview, pattern from `components/admin/EventCertificates.tsx`; upload purpose with PDF allowlist, magic-byte check and sanitising rebuild); retention purge job; weekly integrity job; cron heartbeat; reconciliation list; `docs/compliance/` documents; accessibility pass against WCAG 2.1 AA on the sign page.

**Phase 3 — Sat 17 to Fri 23 Oct**

Visual field editor v2 (drag-and-drop on a pdf.js canvas, immutable versions, approval step); `isMinor` consolidation across the app; table rename to `agreements` / `agreement_recipients` in two promotions (compatibility views first); membership agreement backfill for existing members and blocking enforcement (`ACCESS_GATES_ENFORCE` behaviour decided with the owner, which also settles the policy's unenforced "will not confirm participation until consent" promise); guardian request flow for review, deletion and withdrawal, verified by emailed link.

## Needed from the owner

- **Today:** production template exports (`npm run docusign:templates`); a shared drive folder with the roster service account added as content manager; confirm Clerk and console MFA; switch off DocuSign's "attach documents to completion email" setting.
- **By Mon 5 Oct:** membership agreement wording (adult and minor) as PDF.
- **By Wed 7 Oct:** approval of the policy, terms, school data terms and revised agreement wording; counter-signature authorisation wording; named owner for the security program.
- Production migrations, the backfill and env vars (`ESIGN_TOKEN_SECRET`, `ESIGN_BACKUP_KEY`, later the signing certificate) are set by the owner.

## Decommission (before about 6 Aug 2027)

1. `mode='overflow_only'`; in-flight DocuSign envelopes complete, or are voided and reissued.
2. No completed DocuSign row with `archived_at IS NULL` or `replicated_at IS NULL`; spot-check hashes and certificates.
3. Remove Connect config, webhook route, adapter, `lib/docusign.ts`, scripts, `DOCUSIGN_*` env vars, live-fetch fallback.
4. Remove DocuSign from the policy pages and school data terms; cancel auto-renewal before the notice window.

## Residual risks

1. **Email-link-only guardian identity.** A student can sign as their own parent; that leaves no valid parental release. Accepted by the owner; the audit trail records IP and device, which allows review after the fact.
2. **7-year retention is shorter than a young participant's claim period** (a 12-year-old's waiver is deleted at 19; Utah claims run to about 22). Accepted by the owner.
3. **Under-13s sign, and the media release is opt-out.** Both were confirmed by the owner. Guardian-first ordering keeps a child's signature, IP address and device details from being collected before a parent consents. The COPPA standard expects disclosure consent to be separable; the opt-out box is how the form provides that, and the policy now says so plainly.
4. **No counsel.** The FERPA position, the school data terms and the waiver wording are the items most worth a lawyer's hour. Utah does not enforce parental pre-injury waivers at all, whichever engine signs them.
5. **Supabase Free:** recovery depends entirely on the nightly drive copy (up to 24 hours of loss) and storage runs out at roughly 2,500 to 4,000 documents.
6. **Resend Free:** large groups wait days for links.
7. **Scope:** Phase 1 is large for seven days. The mode switch keeps DocuSign as the default until Friday's production test passes.
8. **Development sessions and production data.** The policy says education records are not used for product development and names no AI tooling. The engine is built and tested on synthetic fixtures only.

## Found, outside this feature (not in this plan)

- Registration is confirmed on payment regardless of consent status (addressed in Phase 3 only for agreements).
- Individual, group and group-join registration routes have no rate limit, CAPTCHA or honeypot.
- No `npm audit`, Dependabot or secret scanning in CI.
- DocuSign account setting: anonymised data sharing for AI training is switched on by default.
