# Written information security program (WISP)

Status: draft for owner approval, 2 Oct 2026. Owner: David Shaw (to confirm).

Stellr Education is a small Utah nonprofit. Most of the people whose data we hold are school students, many under 18 and some under 13. This program sets out the safeguards that fit that size and that risk. It is the program the Privacy Policy §11 and School Data Terms §5 refer to. Each control names the code that implements it, so it can be checked.

## 1. Roles

| Role | Who | Responsibilities |
|---|---|---|
| Program owner | David Shaw (to confirm) | Owns this program; approves changes; runs the annual review; decides on incidents and notifications; holds the backup key escrow |
| Developer | (to confirm; today the same person, working with AI coding tools on synthetic data) | Keeps the controls below working; reviews dependencies; runs the restore drill |
| Admins | Clerk users with `publicMetadata.role = 'admin'` (`lib/admin-auth.ts`) | Full admin portal; can download signed records (every download logged) |
| Event managers | Clerk role `event_manager`, scoped to assigned events (`event_manager_assignments`) | Competitions admin for their events only; get Checkr summaries, never reports (`lib/background-report-export.ts`) |
| Alert recipients | Members holding staff scope `all` or `community` in `staff_roles` (`lib/notify.ts`); falls back to the staff inbox if none | Receive integrity, heartbeat and other admin alerts |

## 2. Asset inventory

Systems that hold or process personal data. "In code" means the repo calls or configures it.

| System | Use | In code | Notes |
|---|---|---|---|
| Vercel (Hobby) | Hosting, crons (`vercel.json`), Vercel Analytics, Blob | Yes (`@vercel/analytics`, `@vercel/blob`) | Runtime logs kept about one hour |
| Supabase (Free plan) | Postgres database, file storage (`signed-agreements`, `agreement-templates` buckets) | Yes | **No database backups on this plan.** 1 GB file storage |
| Clerk | Sign-in, admin roles | Yes (`@clerk/nextjs`) | Passwords held by Clerk, not Stellr |
| Resend (Free plan) | Transactional email, including signing links | Yes (`lib/email.ts`, `api.resend.com`; bounce webhook via `svix`) | 100 emails a day; signing mail budgeted (`lib/esign/outbox.ts`) |
| Stripe | Payments, refunds | Yes (`stripe`) | Card data never touches Stellr |
| Google Workspace | Staff mail; roster Sheets; Calendar; encrypted backup shared drive | Yes (`@googleapis/drive`, `sheets`, `calendar`; service account) | Backups encrypted before upload |
| DocuSign (eSignature Starter, until about 6 Aug 2027) | Signing until the monthly cap | Yes (`lib/docusign.ts`) | Holds its own copy of signed forms |
| Checkr | Background checks for adult mentors and volunteers | Yes (`lib/background-provider/checkr.ts`) | Sends name, email, work location only |
| HubSpot | Lead capture, enquiries | Yes (`lib/hubspot.ts`) | Not on signing or private pages |
| Sanity | Site content | Yes | No personal data |
| Printful | Store fulfilment | Yes (`api.printful.com`) | Name and delivery address |
| Apollo.io | Organisation lookup on educator pages | Yes (`api.apollo.io`) | Advertising consent only |
| Google Tag Manager / Analytics / Ads, Meta, LinkedIn | Analytics and ad measurement | Yes (`app/layout.tsx`) | Not loaded on private routes |
| Motion | Booking pages for calls; bookings read back from Google Calendar (`lib/motion-bookings.ts`) | Yes | Not in Privacy §7.1 (to confirm) |
| Discord | Community chat | No integration found | Members give their handle |
| Timestamp authority (DigiCert by default) | Trusted timestamp on sealed PDFs | Built (`lib/esign/native/seal.ts`, d94aa50); needs a CA-issued seal certificate in production | Receives a hash only |
| GitHub | Source code, CI (`.github/workflows/ci.yml`) | Yes | No production data |
| Anthropic, OpenAI, Perplexity APIs | AEO prompt panel script (`scripts/aeo-prompt-panel.ts`) | Yes | Public prompts only, no personal data |

## 3. Access control

- **Least privilege in the database.** Every table is reached through the service role on the server. The agreement tables and every `esign_*` table revoke all rights from `anon` and `authenticated` (migrations `20261002173459_esign_provider_archive.sql`, `20261002180802_esign_native_engine.sql`). New SQL functions revoke `EXECUTE` from `PUBLIC`.
- **Admin roles** come from Clerk metadata and are re-checked on every request (`lib/admin-auth.ts`). Staff scopes exist (`STAFF_SCOPES`); today every admin holds `all`.
- **Impersonation** ("view as member") uses an HMAC-signed cookie and re-checks admin status each request (`lib/impersonation.ts`). Downloading a signed record under impersonation is refused (`app/api/members/docusigns/[id]/download/route.ts`).
- **Signed records** are served only by a 120-second signed URL after an authorisation check (`lib/esign/archive.ts`, `SIGNED_URL_TTL_SECONDS`), with `Cache-Control: private, no-store` (`lib/esign/download-response.ts`). Restricted records are refused to members and signers; admins can still open them, and the log marks it.
- **MFA — owner action.** School Data Terms §5 promises "multi-factor sign-in for administrators". This is not enforced in code. The owner must: enforce MFA for admin accounts in Clerk; turn on MFA for the Supabase, Vercel, Resend, Google, Stripe, DocuSign, Checkr, HubSpot and GitHub consoles; record the date done here. **(to confirm)**
- **Leavers.** Remove the Clerk role, the `staff_roles` scope and every console seat on the day someone leaves (to confirm the procedure).

## 4. Secrets management

- All secrets are Vercel environment variables, scoped by environment. None are committed. Local `.env.local` files must hold dev values only; the plan records `PROD_DATABASE_URL` in local files and production keys in two worktrees as owner clean-up. **(to confirm done)**
- `ESIGN_TOKEN_SECRET`: dedicated to signing links, at least 32 characters, Production scope, no fallback to another secret (`lib/esign/native/tokens.ts`). Rotating it kills every outstanding signing and download link.
- `ESIGN_BACKUP_KEY`: 32-byte AES key, base64 (`lib/esign/backup-crypto.ts`). **Escrowed in the owner's password manager.** Without it the off-site copies cannot be read. The code reads one key, so after a rotation the old key must be kept, labelled with its date range, to decrypt older copies.
- `ESIGN_SEAL_P12` and its password (when the seal ships): Production scope only.
- `CRON_SECRET`: compared in constant time; crons fail closed when unset and skip outside production (`lib/cron.ts`).
- Google service account key: used for Sheets, Calendar and the backup drive (`lib/esign/backup-store.ts`).

## 5. Encryption

- **In transit:** TLS for every site and every provider API (Vercel and providers; to confirm HSTS settings on the domain).
- **At rest:** provider-level disk encryption at Supabase, Google, Resend and the others (to confirm each provider's statement).
- **Off-site copy:** AES-256-GCM before upload, format `SEB1 | IV | tag | ciphertext`; tampering fails decryption (`lib/esign/backup-crypto.ts`). Google never holds the key.
- **Integrity of signed records:** SHA-256 recorded on each stored PDF; a hash-chained, append-only audit trail (`esign_audit_events`, trigger `esign_audit_events_guard`); certificate-based PAdES seal with a trusted timestamp (`lib/esign/native/seal.ts`, `certificate-seal.ts`; applied at completion, and retroactively by the daily `seal` step).

## 6. Signing-link security

- The token travels in the URL fragment (`/sign#…`), so it never reaches server logs, analytics or referrers (`signingUrl` in `lib/esign/native/tokens.ts`).
- Tokens are HMAC-SHA256 over recipient, purpose, version and expiry; compared in constant time; 30-day expiry; killed on void, reissue or completion by bumping `token_version`.
- The page exchanges the token once for a 30-minute `httpOnly`, `SameSite=Strict`, `Secure` cookie (`lib/esign/native/http.ts`).
- For a minor's document the opener must give the child's year of birth; five wrong answers lock the link (`openLink`, `MAX_FAILED_CHECKS` in `lib/esign/native/flow.ts`). Invalid, expired and voided links look the same.
- State-changing sign requests check `Origin` / `Sec-Fetch-Site` and are rate-limited per IP (`lib/esign/native/http.ts`, `lib/rate-limit.ts`; in-memory, per instance).
- **No trackers on private routes.** `/sign`, pay links and join links (`lib/private-routes.ts`) load no GTM, HubSpot, cookie banner or Vercel Analytics (`app/layout.tsx`, `proxy.ts`). Clerk's script still loads site-wide.
- **Headers** (`next.config.mjs`): site-wide `X-Frame-Options: SAMEORIGIN`, `nosniff`, `strict-origin-when-cross-origin`, `Permissions-Policy`. Private routes add `Referrer-Policy: no-referrer`, `Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow`, `X-Frame-Options: DENY`, and a CSP of `frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`. There is no full script-source CSP yet.

## 7. Logging and monitoring

| Control | Code | What it catches |
|---|---|---|
| `cron_runs` ledger | `lib/cron-runs.ts`, migration `20260928180000_cron_runs.sql` | Whether each job ran and which steps failed |
| Heartbeat | `lib/esign/heartbeat.ts`: maintenance checks reminders and event emails; the reminder cron checks maintenance and form-data | Any signing job silent for 26 hours, alerted to admins |
| Integrity check | `lib/esign/integrity.ts`, daily, 15 records a day cycling the archive | PDF hash mismatch, broken audit chain, unreadable file, alerted |
| Off-database anchor | `exportTables` in `lib/esign/replicate.ts` | Audit-chain heads written daily to the encrypted export |
| Access log | `esign_access_log`, append-only | Every view or download of a signed record |
| Engine card | `lib/esign/state.ts`, admin consent forms page | Storage use (warning at 70% of 1 GB), queue depth, last cron runs |
| Bounces | `lib/esign/bounces.ts` | Signing emails that bounced |
| Admin alerts | `lib/notify.ts` | Routed to `staff_roles` holders, staff inbox fallback |

## 8. Vendor management

- Keep the sub-processor register (`sub-processors-and-data-map.md`) in step with Privacy §7.1. Add a provider to the policy **before** it receives personal data (Privacy §7.1; School Data Terms §3).
- For each vendor, file the DPA or note the standard terms, the data location and the MFA status. Most are **(to confirm)**.
- Known vendor settings to fix: DocuSign "attach documents to completion email" off; DocuSign anonymised data sharing for AI training off (plan, "Found, outside this feature"). **(to confirm)**

## 9. Training

- Everyone with admin access reads this program, the incident response plan and the Privacy Policy on joining and each year, and records the date (to confirm the record).
- Rules: never put production data into development, tests or AI tools (plan Residual risk 8); never forward a signing link; report a suspected incident the same day.

## 10. Testing

- Unit tests (Vitest) and type checks run in CI on every push (`.github/workflows/ci.yml`, job `verify`). E-sign tests include tokens, retention, replicate, integrity, outbox, routing, seam.
- End-to-end tests (Playwright) drive the signing flow on dev (`e2e/core/esign-signing.spec.ts`, `registration-docusign.spec.ts`).
- **Restore drill, quarterly** and after any key or folder change: `npx tsx scripts/esign-restore-drill.ts`. It decrypts a random sample, checks hashes, and compares the latest export's audit anchor with the live database. Record the date and result here.
- Fallback drill on dev: `scripts/esign-fallback-drill.ts`.
- Known gaps: no `npm audit`, Dependabot or secret scanning in CI; no rate limit, CAPTCHA or honeypot on registration routes (plan, "Found, outside this feature").

## 11. Review

- Review this program once a year, and after any incident, new vendor, new category of data, or change of plan at Supabase, Resend or Vercel.
- Record each review below.

| Date | Reviewer | Changes |
|---|---|---|
| (to confirm) | David Shaw (to confirm) | First version |
