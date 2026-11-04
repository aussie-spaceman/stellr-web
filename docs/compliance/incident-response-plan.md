# Incident response plan

Status: draft for owner approval, 2 Oct 2026. Owner: David Shaw (to confirm).

**This is not legal advice.** It is an operating plan written without counsel. Breach-notice law differs by state and changes often. Have counsel review this plan, and call counsel early in any real incident involving personal data.

Revised 3 Nov 2026 (multi-tenancy plan S1): US and Australian notification clocks (§7), tenants (organisations running events on Stellr) as the parties we notify first for their participants' data, backups as the recovery path, and incidents involving AI agents.

## 0. The clocks at a glance

Times run from the moment named in each row. When several apply, the shortest wins. All to confirm with counsel.

| Clock | Who we tell | Starts when |
|---|---|---|
| Same day | Incident lead | Anyone suspects an incident |
| **72 hours** | **Each affected tenant** (for their participants' data), and **the School** (School Data) | We become aware of (tenant) or confirm (School Data Terms §5) unauthorised access to their data |
| **7 calendar days** | A **New York** school or district, for student data it shared (NY Education Law §2-d, 8 NYCRR §121.10) | Discovery |
| **30 days** | Our own **assessment** of a suspected eligible data breach of Australians' data (Privacy Act s 26WH). If we act for an Australian tenant, we give them what they need for their assessment well inside their 30 days | Reasonable grounds to suspect |
| As soon as practicable | **OAIC and affected Australians**, for an eligible data breach (s 26WK, 26WL), unless the tenant notifies for both of us | Assessment concludes it is eligible |
| **30 days** | Affected residents of Colorado, Florida, Washington and New York (NY General Business Law §899-aa, as amended Dec 2024), and the state regulators those laws name | Determination / discovery of the breach |
| 45 to 60 days | Residents of states with longer outer limits (for example Ohio 45, Texas 60 with the Texas AG within 30 days at 250+ Texans; to confirm) | Per state |
| "Most expedient time possible, without unreasonable delay" | Residents of states with no fixed number (for example California, Utah) | Discovery |

Where Stellr is the tenant's **service provider**, the tenant usually owns the notice to its participants and regulators; our duty is the 72-hour notice to the tenant and full cooperation. Where the data is Stellr's own (Stellr events, members, the community), Stellr gives every notice itself.

## 1. What counts as an incident

Any event that may have exposed, altered, lost or made unavailable personal data Stellr holds, or the systems that hold it. Examples:

- A signing, download, pay or join link reaching the wrong person or a third party.
- An admin account, console account or secret (`ESIGN_TOKEN_SECRET`, `ESIGN_BACKUP_KEY`, the Supabase service-role key, the Google service account key, `CRON_SECRET`) exposed or misused.
- The integrity check reporting a hash mismatch or broken audit chain (`lib/esign/integrity.ts`).
- A vendor telling us of a breach on their side (Supabase, Clerk, Resend, Google, DocuSign, Checkr, Stripe, HubSpot, Vercel).
- Loss of the database or file storage. Supabase Free has no backups; recovery is from Stellr's encrypted R2 backups (`docs/RUNBOOK-backups.md`) and, for signed records, the encrypted Drive copy.
- An email or roster spreadsheet with student data sent to the wrong address.
- An AI coding agent acting on injected text (from a page, file, email, ticket or database row), or making an unreviewed change to production. Includes a leak of the machine account's token or the agent's read-only database role.
- The backup age key, the `PROD_DATABASE_URL` secret, the R2 keys or the Supabase Storage S3 keys exposed.
- A backup heartbeat alerting repeatedly (availability: our recovery point is slipping).

## 2. Roles and contacts

| Role | Name | Contact |
|---|---|---|
| Incident lead (decides, notifies) | David Shaw (to confirm) | (to confirm) |
| Deputy | (to confirm) | (to confirm) |
| Counsel | (to confirm) | (to confirm) |
| Insurer (cyber or general liability) | (to confirm) | (to confirm) |
| Privacy inbox | privacy@stellreducation.org | — |
| Vendor security contacts | Supabase, Vercel, Clerk, Resend, Google Workspace, DocuSign, Checkr, Stripe, HubSpot | (to confirm; record each vendor's security or support route) |
| Colorado Attorney General | (to confirm current breach-notice submission route) | — |
| Utah Attorney General / Utah Cyber Center | (to confirm with counsel) | — |

## 3. Detection

Sources to watch:

- Admin alerts from `lib/notify.ts`: integrity failure, heartbeat (`lib/esign/heartbeat.ts`), storage warning on the engine card (`lib/esign/state.ts`).
- `cron_runs` rows with errors.
- Reports to privacy@ or hello@, including "URGENT: Minor Data" (Privacy §15).
- Vendor notices.
- Unusual entries in `esign_access_log` (for example, downloads of restricted records, or many downloads by one admin).
- Backup heartbeat alerts from Better Stack, and failed runs in the private backups repo.
- The daily `app_errors` digest (plan S1, once shipped).
- GitHub: pushes, PRs or workflow runs by the agent's machine account that the owner did not expect; `Production migration` runs nobody asked for.

Anyone who suspects an incident tells the incident lead the same day. Do not investigate alone in production and do not delete anything.

## 4. Triage (first 24 hours)

Record a timeline from the first report. For each question, write what you know and how you know it.

1. What data? Which tables, files or systems? Check against the retention schedule.
2. Whose data? How many people, how many minors, how many under 13, which states and countries? Which tenant's event or Stellr's own? Any New York school's data?
3. Was it encrypted with a key that was not also exposed? (The drive copy is AES-256-GCM; if `ESIGN_BACKUP_KEY` is safe, a leak of drive files alone is not a leak of readable data.)
4. Is it still happening?
5. Does it include data that triggers a state breach law? For Colorado (C.R.S. 6-1-716), "personal information" includes a name together with, among others, medical information, a student identification number, or an online account username or email with its password. Participant rows hold health conditions, so a leak of `participants` or `members` is likely notifiable (to confirm with counsel).
6. Is it School Data under the School Data Terms (data a school shared for a group registration)?

Severity:

| Level | Meaning | Example |
|---|---|---|
| High | Readable personal data of minors, health data, or signed records left our control | Service-role key leaked; roster with medical notes emailed to a stranger |
| Medium | Limited exposure, or exposure we can show was not accessed | One signing link forwarded, opened by no one else (check audit trail) |
| Low | No personal data exposed; availability only | A cron stopped for a day |

## 5. Containment

Pick what fits. Record each step and the time.

- **Signing links:** void the agreement and reissue (bumps `token_version`, killing the link). For a wide leak, rotate `ESIGN_TOKEN_SECRET`: every link and session dies; reissue outstanding agreements.
- **Native engine:** set `esign_provider_state.mode = 'docusign_only'` to stop new native agreements.
- **Admin account:** remove the Clerk `admin` role and `staff_roles` scope; revoke sessions in Clerk.
- **Keys:** rotate the Supabase service-role key, Google service account key, `CRON_SECRET`, Resend, Stripe, DocuSign, Checkr and HubSpot keys as relevant. If `ESIGN_BACKUP_KEY` is exposed, rotate it, keep the old key escrowed for old copies, and re-encrypt (to confirm a re-encryption procedure; the code reads one key).
- **Email misdirection:** ask the recipient to delete it and confirm in writing.
- **Data loss:** restore from the R2 backups (`docs/RUNBOOK-backups.md` §5 and §6): up to 1 hour of loss for the critical tables, 24 hours for the rest. Signed records can also come from the drive with `scripts/esign-restore-drill.ts --restore <id>`. Before reopening, re-apply any deletions made after the backup was taken (runbook §6 step 5).
- **AI agent:** revoke the machine account's token (GitHub → the account → Settings → Developer settings), remove its collaborator access, and change the `agent_ro` database password. Review every PR, push and workflow run it made since the last known-good point. Close any PR it opened during the incident without merging.
- **Backup secrets:** rotate the leaked R2 or Supabase S3 key, or the `backup_reader` password, in the private repo's secrets. If the **age private key** leaked, generate a new key pair, change `AGE_RECIPIENT`, and treat every locked archive as readable by whoever has both the key and R2 access. They cannot be deleted early, so rotate the R2 keys too.
- **Production migration:** if an unexpected run applied SQL, read the run summary (file, SHA-256, who started it, who approved) and the ledger row, then revert with a new migration through the same Action.

## 6. Evidence preservation

Preserve before you fix, where safe.

- `esign_audit_events` is append-only and hash-chained; the database refuses edits and deletes (trigger `esign_audit_events_guard`). Verify chains with `esign_verify_audit(envelope)`. Compare with the daily anchor in the encrypted export.
- **Pause the retention purge** if the incident touches signed records that may be near their `retain_until` date, so evidence is not deleted mid-investigation (to confirm the method: skip the `retention` step in `runEsignMaintenance`).
- Export `esign_access_log`, `cron_runs`, `member_activity_log` and relevant rows to a dated, encrypted file.
- **Vercel runtime logs last about an hour on Hobby.** Capture them at once.
- Export Clerk sign-in logs, Supabase logs, Google Workspace audit logs and Resend send logs while they still exist.
- Keep a single written timeline with times, sources and decisions.
- **Backups are evidence.** R2 bucket lock keeps each archive unchanged until it ages out (hourly 8 days, nightly 35, monthly 400). To keep one longer for an investigation, copy it to a `legal-hold/` prefix with its own longer lock rule before it expires.
- GitHub keeps Actions run logs (who started a `Production migration`, who approved it) for 90 days by default. Download the relevant ones.

## 7. Notification

Decide with counsel. The commitments below are the ones Stellr has made in writing or that the plan names.

| Who | When | Source |
|---|---|---|
| Affected Colorado residents | Without unreasonable delay, and **no later than 30 days** after determining a breach occurred | C.R.S. 6-1-716; Privacy §11 |
| Colorado Attorney General | Within the same 30 days, when **500 or more** Colorado residents are affected | C.R.S. 6-1-716 |
| Consumer reporting agencies | When 1,000 or more Colorado residents are notified (to confirm with counsel) | C.R.S. 6-1-716 |
| The School | **Within 72 hours** of confirming unauthorised access to or disclosure of School Data | School Data Terms §5 |
| Parents or guardians | For any minor's data: notify the parent or guardian, not the child | Privacy §2, §12 |
| Residents of other states | Each state's own law (Utah, where Stellr is incorporated: Utah Code 13-44-202, including notice to the Utah AG and Utah Cyber Center at 500+ Utah residents — to confirm with counsel). See the clocks in §0 | State law |
| **Tenants** | **Within 72 hours** of becoming aware of unauthorised access to, or loss of, their participants' data, with what we know so far; updates as we learn more. We then support the tenant's own notices to families and regulators | Tenant DPA (plan S12; to be drafted) |
| **New York school or district** (student data it shared) | **Within 7 calendar days** of discovery | NY Education Law §2-d; 8 NYCRR §121.10 (to confirm) |
| Affected New York residents; NY Attorney General, Department of State and State Police | Within 30 days of discovery | NY General Business Law §899-aa (to confirm) |
| **Australia: our assessment** | Within **30 days** of reasonable grounds to suspect an eligible data breach (serious harm likely, not prevented by remedial action); act quickly to contain | Privacy Act 1988 s 26WH |
| **Australia: OAIC and affected individuals** | As soon as practicable after an eligible breach is confirmed, by the OAIC statement form. If Stellr and an Australian tenant both hold the data, one notice can cover both (s 26WJ): agree with the tenant who sends it | Privacy Act 1988 s 26WK, 26WL (to confirm) |
| FTC (COPPA) | No set breach-notice clock under COPPA itself; record the incident against the §312.8(b) program and take counsel's advice on any FTC contact | 16 CFR §312.8 |
| Vendors | When the incident started in or affects their system | Contracts |
| Insurer | As the policy requires (to confirm) | Policy |

School Data Terms §5, exact wording:

> "If Stellr learns that School Data has been accessed or disclosed without authorisation, it will tell the School within 72 hours of confirming it, say what happened and what is being done, and cooperate with the School in notifying families where the law requires."

Notices say, in plain words: what happened, when, what data, what we have done, what the reader can do, and who to contact. Colorado notices have required content (to confirm with counsel). Send notices by email to the address on file; for minors, to the guardian address. Keep copies.

## 8. Decision tree

```mermaid
flowchart TD
  A[Suspected incident reported] --> B[Incident lead logs it, starts timeline]
  B --> C{Personal data involved?}
  C -- No --> L[Low: fix, record, review]
  C -- Yes --> D[Contain, preserve evidence]
  D --> E{Readable to someone unauthorised?<br/>e.g. not encrypted with a safe key}
  E -- No --> M[Record why not; review]
  E -- Yes or unknown --> T{A tenant's participants?}
  T -- Yes --> T1[Tell the tenant within 72 h of becoming aware;<br/>support their notices]
  T -- No --> F
  T1 --> F
  F{School Data from a group registration?}
  F -- Yes --> G[Tell the School within 72 h of confirming<br/>School Data Terms 5;<br/>New York school: within 7 days]
  F -- No --> AU
  G --> AU{People in Australia affected?}
  AU -- Yes --> AU1[Assess within 30 days, s 26WH;<br/>if eligible, notify OAIC and individuals<br/>as soon as practicable]
  AU -- No --> H
  AU1 --> H
  G --> H{Colorado residents affected and<br/>data is 'personal information' under 6-1-716?}
  H -- Yes --> I[Notify residents within 30 days of determination;<br/>guardians for minors]
  I --> J{500 or more Coloradans?}
  J -- Yes --> K[Notify Colorado AG within 30 days]
  J -- No --> N
  K --> N[Check other states' laws with counsel]
  H -- No --> N
  N --> O[Post-incident review within 2 weeks]
```

## 9. Post-incident review

Within two weeks of closing:

- What happened, root cause, timeline, who was affected.
- Which controls worked and which did not.
- Changes to make, each with an owner and date. Update the WISP, the retention schedule and the sub-processor register if they change.
- Keep the review, the timeline and copies of notices for at least 7 years (to confirm).

## 10. Testing this plan

Walk through one scenario a year (for example, "a guardian's signing link was forwarded to a class group chat") with whoever holds admin access. Record the date and the gaps found. Rotate through: a forwarded signing link; the database lost (restore from backups, timed against the 4-hour target); an AI agent acting on injected text; a breach affecting an Australian tenant's participants (72-hour tenant notice, 30-day assessment).
