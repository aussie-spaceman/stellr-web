# Compliance documents

Internal documents for Stellr Education's handling of personal data, most of it about school students. They implement the "Internal (`docs/compliance/`)" row of the policy workstream in `docs/PLAN-esign-2026-10-02.md`.

**Owner: David Shaw (to confirm).**

**Review cadence:** once a year, and on any material change: a new vendor, a new category of data, a plan change at Supabase, Resend or Vercel, a change to the Privacy Policy, Terms or School Data Terms, or after any incident.

These are drafts written without counsel. They are not legal advice. Counsel review is recommended, starting with the incident response plan and the minors' assessment.

## Documents

| File | What it is |
|---|---|
| [retention-schedule.md](retention-schedule.md) | Every category of personal data, where it lives, how long it is kept, and what deletes it |
| [information-security-program.md](information-security-program.md) | Written information security program (WISP): roles, assets, access, secrets, encryption, signing-link security, monitoring, vendors, training, testing |
| [incident-response-plan.md](incident-response-plan.md) | Detection, triage, containment, evidence, notification (Colorado 30 days, schools 72 hours), decision tree, review |
| [data-protection-assessment-minors.md](data-protection-assessment-minors.md) | Assessment for minors' data under Colorado SB 24-041 and COPPA, with residual risks and sign-off |
| [sub-processors-and-data-map.md](sub-processors-and-data-map.md) | Sub-processor register matching Privacy §7.1, and a data-flow map |

Sources checked: Privacy Policy and Terms (Last Updated 09-Oct-2026), School Data Terms version `2026-10-v1` (`lib/school-data-terms.ts`), and the code on branch `feat/esign-seam` as of 2 Oct 2026. Every control cites the file that implements it.

## Conflicts found

Places where the published Privacy Policy, Terms, School Data Terms and the code disagree. The policies were not changed; each item needs an owner decision: change the code, change the wording, or accept.

1. **Drawn signatures are stored, the policy says typed only.** Privacy §3.10 lists "the name they typed as their signature" and says "a typed signature is stored as text, and we keep no handwriting, timing or pressure data". The code accepts a drawn signature and stores it as a PNG in the `signed-agreements` bucket (`lib/esign/native/signature-image.ts`, column `signature_image_path`, commit ea78c0f). No timing or pressure is kept, but a drawn image is handwriting. Privacy §3.10 should mention "or an image of the signature you drew".
2. **Deleted people survive in `deletion_archive`.** Every hard delete writes a full JSON snapshot of the row (participants include health conditions, date of birth and emergency contacts) to `deletion_archive` (`lib/deletion/archive.ts`, migration `026_deletion.sql`). Nothing ever purges it. This contradicts Privacy §12 (deletion), Privacy §10 ("until the associated minor participant record is deleted"), and School Data Terms §6 (delete within 30 days).
3. **School Data Terms §6 deletion is not implemented.** The terms promise deletion within 30 days of students withdrawing or a written request, and deletion 12 months after the event for students without an account. In code, withdrawal is a soft delete that keeps every participant row (`lib/deletion/registry.ts`, `registration.softDelete`); hard delete is manual; no job enforces 30 days or 12 months. Roster spreadsheets in Google Sheets are never deleted by the app. Privacy §7.7 ("We delete it at the school's request when its students withdraw") is met only if an admin does it by hand.
4. **MFA for administrators is promised, not enforced.** School Data Terms §5 says "multi-factor sign-in for administrators". Nothing in code enforces it; the plan lists Clerk and console MFA as an owner check not yet confirmed.
5. **Backups outlive "deleted with the original" by up to 30 days.** Privacy §10 says encrypted backup copies are "Deleted with the original". Per-record copies are (`removeReplicas` in `purgeExpired`). But the nightly encrypted table exports (`exportTables` in `lib/esign/replicate.ts`, 30 kept) contain the agreement, recipient (names, emails, IP, browser, field values) and audit rows, so a purged record, or unsigned data cleared by `expireUnsigned`, persists in older exports for up to 30 days. Either say "within 30 days" or accept.
6. **DocuSign's copy is not deleted at 7 years.** Privacy §10 says signed forms are kept 7 years "then deleted automatically". `purgeExpired` deletes Stellr's copy only; DocuSign's own copy stays in the DocuSign account. Privacy §7.1 says DocuSign keeps its own copy under its terms, but §10 does not carve it out. Needs a DocuSign purge setting or wording.
7. **Unsigned member agreements are not deleted with the member.** Privacy §10 says requests never completed are "deleted with the participant record". `retainSignedRecords` removes unsigned rows for participants and registrations, but for a member it leaves them with `member_id` set to NULL (`lib/esign/retention.ts`, comment at the `removedUnsigned` step). Unsigned DocuSign requests are not expired by Stellr's code at all; they rely on DocuSign's envelope expiry (to confirm).
8. **The access log and other logs are kept forever; the policy is silent or says 12 months.** `esign_access_log` (admin Clerk id, member id or signer row id, per view or download) has no deletion path and `purgeExpired` keeps it deliberately. Privacy §10 has no row for it. `cron_runs`, `member_activity_log` and `event_email_sends.recipients` (names and emails) have no purge either, against Privacy §10 "Technical/usage logs: Generally 12 months".
9. **Restricted records can still be opened by any admin.** Privacy §10 and §12 say a record kept after a deletion request is used "for nothing else"; `lib/esign/retention.ts` says "shown to nobody". Member and signer downloads refuse restricted records, but `app/api/admin/docusigns/[id]/download/route.ts` lets any admin download one (logged with `restricted: true`). The plan also called for scoping admin downloads to an agreements staff scope; `STAFF_SCOPES` has no such scope.
10. **School Data Terms §3 does not allow disclosures the Privacy Policy allows.** School Data Terms §3 lists the only recipients of School Data: service providers, the student's parent or guardian, event staff and mentors, and those the law requires. Privacy §7.3 (results, names and school affiliations shared with co-organisers and sponsors) and §7.4 (names, results, school affiliations and photos published unless a parent opts out) describe disclosures of the same students' data that §3 does not cover. §2 lists "results, awards and credentials" as uses, not public disclosure.
11. **"Signed documents are never sent as attachments" depends on an owner setting.** Privacy §7.1 (Resend row) says so. True for Stellr signing. For DocuSign envelopes it holds only once the owner switches off DocuSign's "attach documents to completion email" setting, which the plan lists as an owner action not yet confirmed.
12. **Records with no row in Privacy §10.** Background-check records (`member_background_checks`, `member_teacher_licenses`), store orders and shipping addresses, and HubSpot contacts have no stated retention period. Member deletion does not remove HubSpot contacts (`lib/deletion/external.ts` has no HubSpot step).
13. **Motion is not in the provider list.** `lib/motion-bookings.ts` reads bookings made on Motion pages. If people enter their name and email on a Motion booking page, Motion is a provider and belongs in Privacy §7.1 (to confirm).
14. **COPPA position, for counsel (not a code conflict).** Privacy §2 says "We comply with … COPPA". COPPA generally does not reach nonprofits (to confirm with counsel). Where it is applied, email-link-only parental consent is generally accepted only for internal use, not for disclosure such as publishing a child's photo or name. Privacy §7.4 relies on that consent, with an opt-out, for publication. Owner has accepted both; counsel should confirm the wording.

Earlier contradictions the plan listed in the policy pages (medical data "deleted promptly after the event" against "duration of account", "explicit consent" for photos, "verifiable" parental consent, DocuSign as the only signing channel) no longer appear in the 9 Oct Privacy Policy and Terms. The agreement templates are now the Participation Agreements V2.3 (2 Oct 2026, Word source in the Governance shared drive), and the engine follows them: retention for the membership plus 7 years after deactivation, a minor's agreement valid while current, a parent co-signing for a Mentor under the age of majority.

## Questions the owner must answer

Collected from the "(to confirm)" marks in these documents.

**Ownership and people**
- Confirm David Shaw as program owner; name a deputy and a developer role if different.
- Counsel and insurer contacts; vendor security contacts.
- Leaver procedure; training record.

**Security actions**
- Clerk MFA enforced for admins, and MFA on Supabase, Vercel, Resend, Google, Stripe, DocuSign, Checkr, HubSpot and GitHub. Dates done.
- `PROD_DATABASE_URL` and production keys removed from local `.env.local` files and worktrees.
- `ESIGN_BACKUP_KEY` escrowed in the password manager; a procedure for rotating it (the code reads one key).
- DocuSign settings: completion-email attachments off; AI data sharing off.
- HSTS on the domains.

**Retention decisions**
- Purge period for `deletion_archive`.
- Build or drop the School Data Terms §6 jobs (30 days after withdrawal, 12 months after the event, roster spreadsheets).
- Retention for `esign_access_log`, `cron_runs`, `member_activity_log`, `event_email_sends`, background-check rows, store orders and addresses, HubSpot contacts, photos and videos.
- Whether payment records are purged locally at 7 years.
- DocuSign purge of completed envelopes older than 7 years, and the account after decommission.
- Where members remove their medical and dietary information (the exact screen).

**Vendors**
- DPA status and data location for each provider in the register.
- Whether Motion and Twilio (when SMS goes live) are added to Privacy §7.1.
- Resend's and Checkr's own log and report retention.
- Guardian-first routing order on every DocuSign template.

**Law (counsel)**
- Whether the CPA, and SB 24-041 below the volume thresholds, apply to Stellr; FERPA-data exemption.
- Whether COPPA applies to Stellr as a nonprofit.
- Utah and other states' breach-notice duties; Colorado notice content; consumer reporting agency threshold.
- Whether marketing email should default off for under-18 members (`members.marketing_consent` defaults to true).
- How long to keep incident records.
