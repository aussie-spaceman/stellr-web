# Retention schedule

Status: draft for owner approval, 2 Oct 2026. Owner: David Shaw (to confirm).

This schedule lists every category of personal data the codebase holds that we could identify, where it lives, how long it is kept, what deletes it, and why we hold it. It must agree with the Privacy Policy (`app/(public)/privacy/page.tsx`, §10) and the School Data Terms (`lib/school-data-terms.ts`, §4 and §6). Where it does not, the gap is listed in `README.md` under "Conflicts found".

"Manual" means an admin deletes the record through the admin deletion tool (`lib/deletion/execute.ts`). Nothing deletes it on a schedule.

Anything marked **(to confirm)** could not be confirmed from the code.

## How deletion works today

- **Soft delete** (`lib/deletion/registry.ts`, `softDelete`): a member is marked `is_active = false`, `deleted_at` set, Clerk link cleared. A registration is marked `withdrawn`. **No personal data is removed.**
- **Hard delete** (`lib/deletion/execute.ts`): runs external clean-up (`lib/deletion/external.ts`: Stripe subscription cancelled, Clerk login deleted, in-flight agreements voided), restricts signed agreements (`retainSignedRecords` in `lib/esign/retention.ts`), writes a full JSON snapshot of the rows to `deletion_archive` (`lib/deletion/archive.ts`), then deletes the rows.
- **`deletion_archive` is never purged.** A hard-deleted member or participant, including health conditions and emergency contacts, survives there indefinitely. See Conflicts found.

## Schedule

| # | Category | Where stored | Retention | Deletion mechanism | Reason / legal basis |
|---|---|---|---|---|---|
| 1 | Member account: name, email, phone, date of birth, gender, grade, graduation year, T-shirt size, Discord handle, profile photo, marketing preference | Supabase `members`; login in Clerk | Duration of account (Privacy §10) | Manual (soft or hard delete). Clerk login removed on hard delete only (`cleanupClerkForMember`). No inactivity purge (to confirm whether one is wanted) | Contract (membership, participation); parental consent for minors |
| 2 | Medical and health conditions, allergies and dietary needs on the member record | `members.health_conditions`, `member_allergies` (migrations `028`, `030`) | Duration of account, so it is ready for future events; the member can change or remove it (Privacy §3.5, §8, §10) | Member edits their profile (to confirm the exact screen); manual delete | Consent; participant safety |
| 3 | Ethnicity | `member_ethnicities`; `participants.ethnicity` | Duration of account / of the participant record | Manual | Consent (optional field); used only in totals (Privacy §3.4) |
| 4 | Guardian and emergency contact: name, email, phone, relationship | `members.ec_*`; `participants.emergency_contact_*` | Duration of account, or until the minor's participant record is deleted; the copy inside a signed form is kept with the form (Privacy §10) | Manual | Obtaining consent; emergency contact at events |
| 5 | Registrations and participants, per event: identity, school, DOB, grade, gender, T-shirt, dietary, health conditions, emergency contacts, check-in, company, award | Supabase `registrations`, `participants`, `group_join_tokens` | Privacy §10: duration of account. School Data Terms §6: School Data deleted within 30 days of withdrawal or the school's written request; for students without an account, 12 months after the event | Manual only. Withdrawal is a soft delete and keeps the rows. No job enforces the 30-day or 12-month rules | Contract; school's instruction (School Data Terms) |
| 6 | Group roster spreadsheets shared by schools | Google Workspace (Sheets), `registrations.spreadsheet_id` | As row 5 (School Data Terms §6) | None in code. Sheets are never deleted by the app (to confirm the manual process) | School's instruction |
| 7 | Payments: Stripe customer and payment ids, payment status, refunds | Stripe (card data); Supabase `participants.stripe_payment_intent_id`, `registrations`, `event_refunds`, `store_orders`, `members.stripe_customer_id` | 7 years (Privacy §10, US tax and accounting) | No automated purge (to confirm). On member delete the Stripe customer is kept and tagged `stellr_deleted` (`cleanupStripeForMember`) | Legal obligation (tax, accounting) |
| 8 | Store orders and shipping addresses | `store_orders`, `store_order_items`, `member_addresses`; Printful | (to confirm). Privacy §10 has no row for these | Manual (`member_address` and `store_order` entities in the registry) | Contract |
| 9 | Signed agreements: executed PDF, DocuSign certificate or native audit file, drawn-signature image; the hash-sealed original kept beside the certificate-sealed copy (path in the `sealed` audit event; the purge removes both) | Private bucket `signed-agreements` (`lib/esign/storage.ts`); row in `docusign_envelopes` (`retain_until`, `restricted_at`) | **7 years from signing**, then deleted (Privacy §10; School Data Terms §4). `retain_until = completed_at + 7 years` (`retainUntil`, `RETENTION_YEARS`) | `purgeExpired` in `lib/esign/retention.ts`, run daily by `runEsignMaintenance` (`lib/esign/maintenance.ts`, step `retention`) from the `docusign-form-data` cron. Deletes off-site copies, stored files, drawn images, audit trail, then the row | Legal record of consent and agreement (ESIGN/UETA); defence of claims |
| 9a | Signed agreement after a deletion request or participant deletion | As row 9, `restricted_at` set | Until `retain_until`; kept only to answer a legal claim | `retainSignedRecords` / `restrictForRequest` (`lib/esign/retention.ts`); member and signer downloads refuse restricted records; admin download still possible and logged | Defence of legal claims |
| 9b | DocuSign's own copy of DocuSign-signed forms | DocuSign account | DocuSign's terms (Privacy §7.1). Not deleted by `purgeExpired` | None in code. Owner to set or run a DocuSign purge (to confirm) | As row 9 |
| 10 | Signing metadata: signer name, email, typed signature, field values, IP address, user agent, viewed / consented / attested / signed times, disclosure version, year-of-birth check counter | `docusign_envelope_recipients` (migration `20261002180802_esign_native_engine.sql`); repeated inside the PDF certificate page and audit file | With the signed agreement: 7 years from signing (Privacy §10) | Deleted by cascade when `purgeExpired` deletes the agreement row | Proving the signature |
| 11 | Pre-filled document values (participant details put into the form) | `docusign_envelopes.prefill` | With the agreement | `purgeExpired`; cleared to `{}` by `expireUnsigned` | Producing the document |
| 12 | Audit trail of each signing step (incl. IP and user agent) | `esign_audit_events`: append-only, hash-chained, trigger refuses update and delete | With the agreement | Only `esign_purge_audit()` can remove rows; called by `purgeExpired` and `expireUnsigned` | Tamper-evident proof of signing |
| 13 | Unsigned Stellr signing requests | Same tables as rows 9 to 12 | Voided 30 days after the last link sent (links last 30 days; each reminder renews) | `expireUnsigned` in `lib/esign/retention.ts`: voids the request, clears typed names, answers, IP, browser, drawn image and audit trail; one "voided" audit event with no personal data remains. The request row stays with the participant until the participant is deleted (`retainSignedRecords` removes unsigned rows for participants, not for members) | No legal effect, so nothing to keep |
| 13a | Unsigned DocuSign requests | DocuSign; `docusign_envelopes` | DocuSign's envelope expiry (to confirm). Voided on registration withdrawal or participant delete (`cleanupDocusignByColumn`) | Manual / delete flow | As row 13 |
| 14 | Access log: who viewed or downloaded a signed record (admin Clerk id, member id or signer row id, time) | `esign_access_log` (append-only, no foreign key) | **Indefinite.** `purgeExpired` keeps it on purpose. Not listed in Privacy §10 | None | Accountability for access to signed records |
| 15 | Encrypted copy of each signed record | Google Workspace shared drive folder `ESIGN_BACKUP_DRIVE_FOLDER_ID` (`lib/esign/backup-store.ts`) | Deleted with the original (Privacy §10) | `removeReplicas` (`lib/esign/replicate.ts`), called first by `purgeExpired`. Drive `files.delete` is permanent, not trash | Recovery: Supabase Free has no database backups |
| 16 | Encrypted daily export of the agreement tables (envelopes, recipients, audit events, access log, templates, routing state) with the audit-chain anchor | Same drive folder, `export-YYYY-MM-DD.json.enc` | **30 rolling daily exports** (`KEEP_EXPORTS = 30`). A purged or cleared record survives in older exports for up to 30 days | `exportTables` prunes beyond 30 | Recovery; off-database anchor for the audit trail |
| 17 | Agreement templates | `esign_templates`, bucket `agreement-templates` | Kept; versions are immutable once approved | None needed. No personal data | Proving which wording was signed |
| 18 | Background checks: status, result label, dates, last provider payload; teacher licence number, state, expiry | `member_background_checks`, `member_teacher_licenses` (migration `059`). The consumer report itself stays at Checkr; exports fetch it live and store nothing (`lib/background-report-export.ts`) | Check valid 3 years. Row kept until member hard delete (cascade). No other deletion (to confirm). Checkr's retention (to confirm). Not in Privacy §10 | Cascade on member hard delete | Safeguarding minors; FCRA obligations sit with Checkr and Stellr as user of reports (to confirm with counsel) |
| 19 | Email sending records: recipient emails and names per event email; campaign sends; Resend message ids; bounce status | `event_email_sends.recipients`, `email_campaign_sends`, `docusign_envelope_recipients.invite_email_id`; Resend's own logs, which hold the private signing and download links | Local: indefinite (to confirm). Resend: per Resend plan (to confirm) | None in code | Delivery evidence; legitimate interest |
| 20 | Email budget counters | `esign_email_budget` | Indefinite; counts only, no personal data | None | Operations |
| 21 | Credentials and credential page activity | `credentials`, `credential_events` | Duration of account; tombstoned on erasure (Privacy §10) | `tombstoneCredentialsFor` in the delete flow; `credential_events` cascade | Contract; member's choice to publish |
| 22 | Photos and videos | Vercel Blob / media store (to confirm) | Until removal is requested, or indefinitely (Privacy §10) | Manual | Consent with opt-out (Privacy §7.4) |
| 23 | Marketing and enquiry contacts | HubSpot | (to confirm). Not removed by member deletion (`external` list has no HubSpot step) | Manual in HubSpot | Legitimate interest; consent for newsletter |
| 24 | Operational logs: `cron_runs`, `member_activity_log`, `crawler_hits` (no personal data), `deletion_requests` | Supabase | Privacy §10: technical/usage logs "generally 12 months". No purge exists for any of these (to confirm) | None | Monitoring and accountability |
| 25 | Deletion snapshots | `deletion_archive` | **Indefinite.** No purge | None | Support recovery of mistaken deletes |
| 26 | Platform logs | Vercel runtime logs (about one hour on Hobby, per `20260928180000_cron_runs.sql`); Vercel Analytics; Supabase and Clerk dashboards | Provider defaults (to confirm) | Provider | Security; operations |

## Owner decisions this schedule depends on

- 7 years from signing for signed agreements, then automatic deletion (owner, 2 Oct 2026). Residual risk: shorter than a young participant's claim period (`docs/PLAN-esign-2026-10-02.md`, Residual risk 2).
- Medical and dietary information stays on the member record for future events.
- Supabase Free (no database backups); the encrypted drive copy is the recovery path.

## Actions to close the gaps

1. Decide a purge period for `deletion_archive` (suggest 30 days, matching School Data Terms §6) and build the job.
2. Build the School Data Terms §6 jobs: delete withdrawn participants after 30 days; delete participants without an account 12 months after the event; include roster spreadsheets.
3. Set retention for `esign_access_log`, `cron_runs`, `member_activity_log`, `event_email_sends` and add rows to Privacy §10.
4. Set a DocuSign purge for completed envelopes older than 7 years, and decide what happens to the DocuSign account after decommission.
5. Decide whether background-check rows and store orders need their own periods.
