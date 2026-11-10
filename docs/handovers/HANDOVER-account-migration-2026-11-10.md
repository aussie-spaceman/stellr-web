# Handover: Stellr web platform — account migration and state of play — 10-Nov-2026

**Who this is for:** the owner and future Claude sessions on Stellr's Team account, Stellr staff and volunteers, a future developer, and the board or auditors.

**What it covers:** what the platform is, how it was built, where things stand, where knowledge lives, and how minors' data and security are handled. It names no individual. Account ownership, secrets and incident detail are in the owner-only private handover in Stellr's Google Drive.

Tracker: [`tracker/2026-11-10-account-migration.md`](tracker/2026-11-10-account-migration.md).

---

## 1. What changed on 10-Nov-2026

Until 10-Nov-2026, the AI-assisted development of this platform ran on an individual's personal Claude account. On 10-Nov-2026 that work moved to **Stellr Education's Claude Team (non-profit) account**, which Stellr owns, and the personal account was closed.

**What moved, and how:**
- **Repo knowledge** (this folder, `CLAUDE.md`, the skills, release records) needed no move. It lives in git.
- **Claude Code's working memory** for this repo (about 160 notes) stays on the development Mac. It was curated and re-pointed at the new account. The untouched originals are archived privately.
- **Everything that existed only on the personal account** was exported to Stellr's private Drive before the account closed. That covers 22 artifacts (reports, run-sheets, plans), 6 scheduled cloud routines, the cloud memory store, account skills, claude.ai Docs, chats and Projects, and Claude Design files. Design files that are safe to publish are in `design/handoff/`.
- **Connectors** (Google Workspace, HubSpot, Stripe, Supabase, Vercel, GitHub, DocuSign and others) were re-authorised on the Team account with least privilege. Production database access by agents still needs the owner's explicit yes per migration (see `CLAUDE.md`).
- **Services on personal identities** move to Stellr-owned accounts in order of blast radius: GitHub, then Vercel, then Supabase and Clerk, then the rest, with DNS last. Progress is tracked in the tracker above and in the private ownership register.

---

## 2. System map

| Layer | Service | What it does here | Code |
|---|---|---|---|
| Hosting | Vercel | `www` and `app` (production project), a dev project, 27 cron jobs, Blob media store | `vercel.json`, `proxy.ts` |
| Database and files | Supabase (Postgres + Storage) | All member, registration, event and signing data. Separate dev and production projects. | `lib/supabase*.ts`, `supabase/migrations/` |
| Sign-in | Clerk | Accounts, roles, sessions. Separate dev and production instances. | `lib/admin-auth.ts`, `app/api/webhooks/clerk` |
| Payments | Stripe | Registration checkout, group invoices, scholarship coupons, refunds | `lib/stripe.ts`, `app/api/stripe/webhook` |
| Email | Resend | Transactional email, outbox with quota handling, bounce notices | `lib/email.ts`, `app/api/webhooks/resend` |
| E-signature | In-house signing engine (DocuSign was the legacy provider) | Participation agreements (adult, minor, mentor), audit trail | `lib/esign/`, `lib/docusign*.ts` |
| Background checks | Checkr | Adult mentors only | `lib/background-provider/` |
| CRM | HubSpot | Leads and school outreach (no minors' records) | `lib/hubspot*.ts` |
| Content | Sanity | Public site content | `lib/sanity.ts`, `app/api/webhooks/sanity` |
| Google | Sheets, Calendar, Drive, Places | Rosters, calendars, encrypted e-sign backups, address lookup | `lib/google-*.ts` |
| Video | JaaS (8x8) | Mentor/coaching calls and recordings | `lib/video-provider.ts` |
| Sales and booking | Apollo, Motion | Prospecting; booking pages | `lib/apollo-*.ts`, `lib/motion-bookings.ts` |
| Store | Printful | Merchandise fulfilment | `lib/store/` |
| Other | GTM, LinkedIn, IndexNow, DigiCert timestamps | Analytics tags, credential sharing, search pings, signature timestamps | various |

The design system, V2, is the default on every surface. Tokens come from `design/tokens.json` and components from `@stellr/web-ui`. See `CLAUDE.md`.

## 3. Environments and branches

- **`dev` branch → dev Vercel project → dev Supabase and Clerk.** All PRs land here first. It is the integration branch.
- **`main` branch → production** (`www.stellreducation.org`, `app.stellreducation.org`). Only the `promote` skill merges `dev` into `main`, with a merge commit.
- Migrations reach **production before the code that needs them**, during `promote` Step 3. Applying production SQL needs the owner's explicit yes. The approval-gated Action `.github/workflows/prod-migrate.yml` replaces this once `docs/RUNBOOK-agent-controls.md` §7 records it as proven.
- `docs/ENV-MATRIX.md` lists every variable per environment. `scripts/production-guard.mjs` stops a local dev server from starting on production credentials.

## 4. How work flows

1. Each piece of work runs in its own **git worktree** (`.claude/worktrees/<name>`), never in the main checkout.
2. **`ship`** (`.claude/skills/ship/`) verifies the work against the ask. CI gates it, then the PR merges to `dev`.
3. **`promote`** (`.claude/skills/promote/`) checks what is shipping, applies any migration to production first, records a rollback target, merges `dev` → `main`, verifies the live site, and writes `.claude/releases/promote-<date>.md`.
4. **`close-out`** (`.claude/skills/close-out/`) writes an honest gap review, a handover in `docs/handovers/`, a tracker file in `docs/handovers/tracker/`, a private Google Doc snapshot and memory. It enforces the public-repo personal-data rule.
5. **CI** (`.github/workflows/ci.yml`) runs typecheck, lints (including `lint:tokens` and `lint:pii`), unit tests, build, end-to-end, Storybook, Lighthouse, database and tenant jobs, and a schema-drift check. Nightly jobs add e2e, mutation testing and an IDOR canary. `security.yml` runs Semgrep, OSV, gitleaks and supply-chain checks. Read a green CI run by its step outcomes, not its badge.

## 5. Where knowledge lives

| Kind | Where | Notes |
|---|---|---|
| Rules for any agent or developer | `CLAUDE.md`, `VOICE.md` | Binding |
| Index | `docs/README.md` | Start here |
| Feature and session history | `docs/handovers/` (about 145 handovers), `docs/handovers/tracker/` (about 78 trackers) | Newest by filename date |
| Production releases | `.claude/releases/` (77 records, 09-Sep to 10-Nov-2026) | Each has a rollback target |
| Plans, specs, reviews | `docs/PLAN-*`, `REC-*`, `TENANCY-*`, `THREAT-MODEL.md`, `SECURITY-*`, `code-review-report*.md` | |
| Compliance pack | `docs/compliance/` | Security program, minors' assessment, data map, retention, incident response |
| Runbooks | `docs/RUNBOOK-*` and setup guides | |
| Workflow skills | `.claude/skills/` (ship, promote, close-out) | Skills load from the **main checkout**, so pull it before trusting a skill change |
| Claude Code memory | On the development Mac, under Claude Code's per-project memory folder | Curated 10-Nov-2026; originals archived privately |
| Sessions open at the switch | §9 B5: the S5 multi-tenant and Ad Grants handovers | Each has its own handover and tracker |
| Scheduled tasks | Claude desktop app on the development Mac (8 tasks: AEO monthly panel, three Ad Grants reviews, older one-offs) | Local files. Re-approve each once ("Run now") after the account switch |
| Names, account ownership, secrets inventory, incidents, per-session Doc snapshots | Owner-only private handover and Docs in Stellr's Google Drive | Never in the repo |
| Exports from the closed personal Claude account | Owner-only, encrypted, in Stellr's Google Drive | Chats are kept encrypted with a delete-by date |

## 6. Minors' data: where it is and how it is protected

Stellr's participants include school students, many of them minors. **Where their data sits (table and bucket names only):**
- **Supabase tables:**
  - `participants` and `members`: date of birth, grade, health, dietary needs, emergency contacts, school. Encrypted `*_enc` columns are in a shadow phase.
  - `registrations`, `member_allergies`, `member_ethnicities` and `member_pending_consent` (guardian consent).
  - Signing records: `agreements`, `agreement_recipients`, `esign_audit_events` and `esign_access_log`.
  - `credentials`, `survey_*`, `chat_messages`, `privacy_requests` and `deletion_archive`.
- **Storage buckets:** `signed-agreements`, `agreement-templates`, `uploads`, `teacher-licenses` and `campaign-proposals`. The public Blob store `stellr-media` holds media only.
- **Third parties:**
  - Google Sheets: school rosters.
  - Google Drive: encrypted signing backups.
  - DocuSign: legacy pre-fill.
  - Resend and Clerk: email delivery and sign-in.
  - HubSpot: leads only. Stripe: payers. Checkr: adults only.

`docs/compliance/sub-processors-and-data-map.md` and `data-protection-assessment-minors.md` have the full picture.

**Controls:**
- Row-level security on every table.
- Tenant isolation tests and a nightly IDOR canary.
- Field encryption (`docs/FIELD-CRYPTO.md`).
- A retention schedule and deletion runbook.
- The `lint:pii` CI gate on docs.
- The rule that agent-read content (registration answers, emails, uploads, database rows) is data, never instructions.

**Decided 10-Nov-2026:** the repo moves to a Stellr GitHub organisation and becomes **private**. Older docs and PR bodies written before the personal-data rule (13-Oct-2026) are then redacted. Tracked in the tracker above.

## 7. Security posture and open risks

The written program is `docs/compliance/information-security-program.md`. **Open at 10-Nov-2026** (rows in the tracker):
- **Single-person ownership.** One individual administers the key services, and they move to Stellr-owned accounts with a second admin. Until that is done, losing that person's access would stall operations.
- **Governance slots.** The incident-response deputy, counsel and insurer, and the leaver procedure, are still "to confirm".
- **Backups.** Self-managed off-site backups (`docs/RUNBOOK-backups.md`) are designed but not installed.
- **Agent controls.** The separate agent identity, the guard-file review rule and the read-only production role (`docs/RUNBOOK-agent-controls.md`) are not yet proven.
- **Hosting tier.** Vercel Hobby is a personal tier with hard usage meters. The move to Pro is in `docs/RUNBOOK-vercel-pro.md`.
- **Credentials.** Some credentials were rotated as part of this handover. The rotation log is private.

---

## 8. Development history

The repo began on 03-Jun-2026. Until 08-Sep-2026 most work went straight to `main`, often without a PR, so June to August bullets cite PRs only where one exists. From 09-Sep-2026 almost everything reached `main` through `dev` and a promotion PR; a few Apollo fixes and handovers in the first two days went to `main` directly.

By 10-Nov-2026: 1,068 commits, 606 merged PRs, 77 promotion records (09-Sep-2026 to 10-Nov-2026), 233 migrations and 32 daily crons.

### June 2026: the first build

- **03-Jun-2026.** Initial build: a Next.js public site with Sanity events, on Vercel. Resend email followed on 04-Jun-2026.
- **04–05-Jun-2026.** Registration v1: individual and group registration, Stripe payments for individuals, a Google Sheets roster sync and the Supabase member database. Next.js 15.
- **09–10-Jun-2026.** Member portal and admin: Student Manager for teachers, team and payment visibility, DocuSign consent forms, community module phase 1, training modules and event management.
- **11–12-Jun-2026.** Membership UI, member delete, refunds and Member IDs. Supabase and Sanity upgrade (#1); group registration clean-up (#2).
- **15–17-Jun-2026.** Video meetings through JaaS, community chat, mentor cohorts, an RLS fix, daily crons to suit the Vercel Hobby plan, and the web store.
- **18–19-Jun-2026.** Design System V2 lands with the web app and admin redesign (#3). Store and Discord added; background checks move to Checkr.
- **22–30-Jun-2026.** Admin and member refresh, a rebuilt course builder, Spaces, resources, coaching, pricing, the canonical member record, the Checkr integration (26-Jun-2026), membership schema, seeds and entitlements, testimonials and public pages.

### July 2026: review and clean-up

- **01–02-Jul-2026.** Community flow audit fixes (#4, #5); video, transcript and public page work; volunteer registration.
- **06–07-Jul-2026.** Space sources and roles, volunteer roster sync and admin access work (#6–#8); prospectus page.
- **08–09-Jul-2026.** First code review: date-only fields fixed for time zones, one payment status, invoice payment fixes, P0 fixes (#9), security and advisor fixes, and a dead-code sweep (37 files removed).
- **13-Jul-2026.** Interactive lesson type in the course builder and course player.
- **24-Jul-2026.** Google Tag Manager, funnel events, Event and Competition structured data, and SEO (#10).

### August 2026: consent, identity and Spaces

- **06-Aug-2026.** Group join link fixed, both group links always sent, group members deduplicated by email (#11).
- **10-Aug-2026.** AEO begins: crawl surface, structured data and dated impact figures. HubSpot lead forms created.
- **11–13-Aug-2026.** Lead tracking behind consent, a Cookie settings link so consent can be withdrawn, privacy banner wording and HubSpot lifecycle fixes (#12–#17); footer fixed on phones (#19).
- **12-Aug-2026.** All email moved onto one sender domain.
- **13–14-Aug-2026.** HubSpot waitlist notices and dead-letter alerts; teacher onboarding (#20, #21, #23); cancelled sessions no longer block a member delete (#22); four-email welcome sequences per tier (#24).
- **21-Aug-2026.** Event page pricing and slug protection. Apollo.io disclosed in the Privacy Policy.
- **24-Aug-2026.** Teacher Stipend page and form, renamed the Teacher Grant Program on 01-Sep-2026.
- **25–26-Aug-2026.** Clerk identity matched on the primary email; onboarding asks by audience; one age rule; minors' emergency contact. Space access counted by who can enter, event Spaces, and a Space roster with suspend, revoke and full-portal view-as.
- **27–28-Aug-2026.** Every upload goes straight to storage (25 MB limit). An event's Space is keyed to its Sanity id; every tier gets a Space. Campaigns follow the school year; the registration toggle really gates registration.

### September 2026: environments, process and integrations

- **01-Sep-2026.** Google Ad Grants website-policy fixes, campaign page parity, and event and campaign flyers.
- **02-Sep-2026.** Teacher tiers aligned with the 2027 flyer; config-driven landing pages at `/lp/[slug]`; the pill radius generated from tokens.
- **03-Sep-2026.** Motion bookings reconciled into HubSpot from Google Calendar, daily because Hobby allows nothing more frequent.
- **04-Sep-2026.** Apollo engagement creates HubSpot Participant Pipeline deals (#25, #26). Production refuses to issue from the DocuSign sandbox (#27).
- **04–09-Sep-2026.** DocuSign moved from the developer sandbox to a production account, with a status overhaul (#35, #37; handover #38). Until then production had issued consent forms from the sandbox (`HANDOVER-docusign-2026-09-09.md`).
- **08–10-Sep-2026.** The dev/prod split: `APP_ENV` and CI (#28, #29), a dev Supabase project and a dev Vercel project (#33, #34), the schema committed for the first time (#36), non-production email sent only to a safelist (#40), seeded dev fixtures (#43, #45) and session isolation (#47).
- **10-Sep-2026.** Playwright E2E (#49), the core access tier (#54), E2E in CI (#56), and a suite that cannot pass against production (#62). The deploy skill split into `ship` and `promote` (#51). First promotion records.
- **10-Sep-2026.** Apollo webhook outage: failures made loud and a daily reconcile added (#42, #48; handover #53).
- **14-Sep-2026.** Events open to grades 7–12, starting with the Colorado SDC (#68, promoted #69).
- **15-Sep-2026.** Local dev refuses production credentials (#78). The dev Vercel project tracks `dev` (#83). Stripe promotion codes at registration checkout (#84, promoted #91). Vercel Function Storage cut by building only `main` and `dev` (#92, promoted #93). The close-out tracker becomes a repo file (#81).
- **17–18-Sep-2026.** Codebase clean-up: one admin-auth helper, one Stripe client, one HubSpot transport, dead exports removed; 3,943 lines gone (#99–#107, promoted #110).
- **18-Sep-2026.** Resumable registration payment: a durable pay link, resume on resubmit, admin send (#111, promoted #113). The production guard refuses a live Stripe key locally (#119).
- **21–22-Sep-2026.** Checkr hardening (#128), media moved from `/public` to Vercel Blob (#129), and verifiable credentials with LinkedIn sharing (#131), promoted in #133. Checkr adjudication and certification run (#146, #148).
- **23-Sep-2026.** Refunds made in Stripe are detected, and a registration can be deleted without a refund (#166, promoted #168).
- **24-Sep-2026.** Checkr live in production (#175). Credentials policy, terms, guardian opt-out and DocuSign read-back (#171) and admin-created member invites (#181), promoted in #183. Member hard delete removes the Clerk login (#192, promoted #195). E2E runs one job at a time (#178).
- **25-Sep-2026.** AEO phases 1 and 2: crawl signals, schema, teacher guides and answer-first FAQs (#198, #200). Event award certificates and credentials (#201). All promoted in #203. Avery 8395 name badges (#206, promoted #208).
- **28-Sep-2026.** Mentor Volunteer Agreement issued on event assignment (#220); CSV exports neutralise formula cells (#221); the event Email Reminders tab (#229); DocuSign reissue and the `cron_runs` ledger (#224); admin alerts fall back to the staff inbox (#228); badge templates (#225); duplicate migration versions linted (#230); feature-branch Vercel deployments stopped (#239); one tracker file per session (#237).
- **28–29-Sep-2026.** DocuSign: a distinct email per signer role (#241) and sequenced signatures when student and guardian share an inbox (#243). Checkr PDF reports and the clearance summary export (#247, #253, #256). Spare badges (#259, promoted #260 on 01-Oct-2026).

### October 2026: signing, survey, check-in and two security reviews

- **02-Oct-2026.** Late registrants caught up on All-participants emails (#263). Scholarship offers with in-app review, three emails and reimbursement (#267, promoted #270). Stellr signing, an in-app e-signature engine beside DocuSign, shipped switched off (#273), with Privacy and Terms updated for student self-registration (#274), promoted in #276.
- **03-Oct-2026.** Survey quotes in Privacy and Terms (#278); signing aligned to Participation Agreements V2.3 (#280).
- **05–06-Oct-2026.** The post-event survey moves into the web app, replacing the Google Form (#283), then follow-ups, v1.1 and survey history in member accounts (#294, #300, #301, #303, #308). Staff can correct a signer's email on a live agreement (#285, #289). The CI `changes` job uses a blobless checkout and E2E fails closed (#286). Docs-only dev builds are skipped (#307).
- **07-Oct-2026.** Stellr signing switched on in production. Credential family link for guardians (#312); credential page in admin view-as (#317); adults joining sign the Educator/Chaperone agreement (#316).
- **08-Oct-2026.** Educator PD credentials (#320) and two-page PD artwork (#341). DocuSign opt-out answers read from signed forms (#327). Event check-in v2 with name and DOB lookup and a tablet desk (#328). Team profiles and balanced company assignment (#329). Mentor Certificates of Appreciation (#342). DMARC ramp started.
- **09–10-Oct-2026.** Deep review 1: security hotfixes A and B (#346, #347, promoted #348), then the High findings across consent, payments, registration, minors' data and Realtime RLS (#351–#367, promoted #360 and #368). Legal pages updated for the credential family link (#358).
- **10–12-Oct-2026.** Deep review 2: Next.js 16.4.0 and the recommended cut (#370–#377, promoted #378), including a shared daily Resend budget (#377) and a 7-year purge of `deletion_archive` (#375). Medium fixes (#381–#390, promoted #391), Low fixes (#393–#397, promoted #398) and a `tar` pin (#400).
- **13-Oct-2026.** HubSpot event options follow Sanity (#402). The personal-data rule: skills name people by role and `members.id` because the repo is public (#409), and `lint:pii` runs in CI (#414, #415, promoted #416).
- **14–15-Oct-2026.** Content refresh (#420, #421). One check-in QR banner for every in-person event (#422).
- **15–16-Oct-2026.** Mobile and tablet review, phases 0–4: no sideways scroll, 16px fields, a cached public site and AA contrast tokens (#426–#429, promoted #430).
- **16–18-Oct-2026.** Image transformations cut: WebP only, Sanity images skip the optimiser, pre-sized slides (#436, #437, #439, promoted #441). Worktree sweep checks by outcome (#433).
- **19–20-Oct-2026.** A new named Finalist event award (#447, promoted #448).
- **22-Oct-2026.** Vercel Active CPU cut after a 75% warning (#451); `apollo-reconcile` finishes within 60 seconds and resumes (#452); certificate Save position fixed (#453). Promoted in #454.
- **27–28-Oct-2026.** Public site: awards and Summer Camp as step 4, a 15-minute call, the PD certificate, a Future History page, a 45-day money-back guarantee and the 2027 flyer (#458–#462, #464). Every dependency brought current (#463); Tailwind 3.4 to 4.3 with the token pipeline kept (#465). Promoted in #467. Group registrations finish what a cut-off request left (#471, promoted #472).
- **29-Oct-2026.** Licence verification alerts (#474). Group billing follows the roster: revised invoices, discounts, refunds and withdrawals (#477). Promoted in #475.
- **30–31-Oct-2026.** Admin member filters, an activity dashboard and a Friday digest email (#481, promoted #482). Check-in desk with group check-in, scanning and offline mode (#484, promoted #485). Node pinned to 24.x (#486). Scholarship cancellation (#490), default artwork per theme (#491) and a team profile override (#494), promoted in #492.

### November 2026 (to 10-Nov-2026): multi-tenancy and group payments

- **03-Nov-2026.** Multi-tenant Stage 0, security and child safety: hardened view-as, check-in scoped to the caller's events, readiness for Supabase's new API keys, sealed `SECURITY DEFINER` functions, escaped JSON-LD, upload byte checks, a server-side age gate, a COPPA login guard and a paid-seat agreement gate (#498–#505, promoted #506).
- **04-Nov-2026.** Stage 1: open registration with age controls, a 50-page PDF cap, monitoring, security headers, a CI database job and ops runbooks (#509); the legacy Supabase key fallback removed (#508). Stages 2–4: the assurance harness, the tenant and event data model, database isolation, an audit chain, field encryption in shadow mode and the IDOR suite (#510, #511). Member merge and school email for under-18s (#512); course audience for volunteers and mentors (#513). Promoted in #515 with 14 production migrations. The owner overrode the restore-rehearsal and 72-hour gates.
- **04–05-Nov-2026.** Staff can add a participant to a group (#517, promoted #518). Training recordings, Resource lessons and a Space Training tab (#519, #529, #530); a re-added participant's live consent form relinks (#520). Promoted in #522.
- **05-Nov-2026.** CI and E2E: the event-manager boundary test (#523), the e2e lock held only for the suite and queued (#525, #541), report-only E2E on a disposable Supabase stack (#526), report sessions ended before upload (#527), and Lighthouse reporting scores (#539).
- **05–06-Nov-2026.** S5 waves 1 and 2 (#528, #534, #535, #540, #547) and registration sign-in for an email on file (#549), promoted in #548.
- **06-Nov-2026.** The proxy runs on gated paths whatever the extension (#553). Group invoices take any number of roster changes (#554). Individual and group registration sign in first when the email is on file (#555, #558, #567). Active CPU phase 2 (#556). S5 wave 3 (#562–#565). A priced event whose price can't be read is refused (#570). Promoted in #561. The Nevada SDC ran the same day.
- **09-Nov-2026.** Change how a group pays after registering (#573, promoted #574). S5 wave 4 (#576–#580); the Event Manager role on the member page and uploaded background checks (#581); group payment options, "Invoice for some" and students sharing the teacher's cost (#584); one notice and self-service fixes for bounced signing emails (#585). Promoted in #587, with five migrations applied to production first.
- **09–10-Nov-2026.** S5 wave 5 (#588, #594, #598, #601). Awards leave no-shows off (#590). The email outbox: a Resend quota refusal delays mail instead of dropping it (#592). Saved event email templates and post-event merge fields (#596). Teachers add discount codes to group invoices (#597). Promoted in #600, with two migrations first.
- **10-Nov-2026.** An "All attendees" email group and mentor and event-manager check-in (#605, promoted #606, one migration first). The Google Ad Grants account rebuilt outside the repo (handover #609). S5 wave 6 Lane B opened as #610.

### How work flows

Each piece of work runs in its own Claude Code session and its own git worktree under `.claude/worktrees/`, cut from `origin/dev`. The **`ship`** skill checks the work against what was asked, lets CI decide (read job by job, never by the badge), opens a PR and squash-merges it into `dev`. `dev` deploys to the dev Vercel project and the dev Supabase project. The **`promote`** skill lists what `main..dev` will ship, names the blast radius, applies any migration to production first with the owner's explicit yes, records a rollback target, merges `dev` into `main` with a merge commit, confirms a production deployment exists for the merge SHA, checks the live site, and writes a record in `.claude/releases/`. The **`close-out`** skill then writes an honest handover in `docs/handovers/`, one tracker file in `docs/handovers/tracker/`, a private Google Doc snapshot, and an update to the agent's memory, and lands the docs on `dev` through their own PR. `npm run tracker` lists every open row. Nothing promotes, and no production SQL runs, without the owner's yes in that session.

---

## 9. Where things stand on 10-Nov-2026

### B1. On `dev` but not on `main`

`origin/main` is at `91bb225e` (#606, production READY and checked). Late on 10-Nov-2026, `git log --oneline origin/main..origin/dev --first-parent` showed four commits:

| PR | What | Migration |
|---|---|---|
| #607 | Promotion record for 10-Nov-2026 and the public copy of the S5 session transfer handover | None |
| #609 | Close-out of the Ad Grants rebuild: handover and tracker | None |
| #610 | S5 wave 6 Lane B (B14b): a tenant's signing mail goes from the tenant's own sender, and a tenant envelope with no sender is never sent as Stellr. No change for Stellr with default flags | None |
| #608 | Close-out docs for the attendee email group (#605): handover and tracker | None |

No migration must reach production first. The next promotion carries #610's runtime change, so it goes through the full `promote` skill.

Not pushed: S5 wave 6 Lanes A, C and D, and the integration branch, exist only as local branches. Lane A is squashed and merged with #605 on a local branch; its consent-safety review, regression review and fix pass are still owed. A verified backup bundle is held with the owner's private handover. Lane A carries migration `20261110164339_tenant_guardian_consent`. It goes to the dev database after its PR's `db` job passes, and to production before any promotion that includes it.

### B2. Work in flight

**Multi-tenancy, Stage 5** (plan of record: `docs/TENANCY-S5.md`). Stellr runs as tenant #1 with no visible change.

| Wave | Where | Notes |
|---|---|---|
| 1 and 2 | Production (#548) | The owner waived the four witnessed registrations |
| 3 | Production (#561) | Four tenant migrations applied just after the merge, on the owner's instruction |
| 4 | Production (#587) | Includes the community CHECK rule the owner approved |
| 5 | Production (#600) | No migrations. `tenant-db` CI job report-only after one green run |
| 6 | Lane B on `dev` (#610); A, C, D local only | Integration run and cross-review done; Lane A's reviews and fix pass owed. See B5 |

Wave 6, still owed: the integration run and cross-review, fixes for confirmed findings, shipping lane by lane (B, then A as a diff against B, then C, then D), A16's migration on the dev database, and the owner adding `tenant-db` to branch protection after its first green run on the Lane C PR. Owner decisions wave 6 raised, all proposals until approved: the CA for the tenant connection secret, the guardian identity assurance level, guardian-invitation caps, new copy (cap message, desk consent-pending message, student bounce notice, guardian-consent document), and whether moving a participant needs a fresh guardian signature.

Every S5 flag (`TENANT_ROUTING_ENABLED`, `AUTHZ_SOURCE`, `LOADSCOPED_MODE`, `TENANT_DB_ENABLED`, `TENANT_EVENT_MAIL_ENABLED` and others) defaults to off, and no promotion flipped one. Production's values were not read: the Vercel connector is refused on env listing. Tracker row `promote-s5-wave2.12` asks the owner to confirm none is set. S5 finishes only when the gates in `docs/TENANCY-S5.md` hold: the cross-tenant ratchet at 0, 100% of mutations audited, at least 7 clean days of `AUTHZ_SOURCE=shadow` before the flip, and a signed 30-day production checklist. Real tenant hosts also need Vercel Pro, a subzone, Clerk session sharing and a cookie-domain review.

**Other live threads from the 09-Nov-2026 and 10-Nov-2026 handovers.** Every runtime PR from those days is on production. What remains is first real use and people waiting:

- First real use of each new feature: an "All attendees" send and a mentor check-in (#605), the first outbox drain (#592), a teacher-added discount code (#597), saved templates and the certificate merge field (#596), the bounce Fix email flow (#585), an Event Manager grant and an uploaded background check (#581), and a Stripe test-mode drill for shared teacher cost (#584).
- The Minnesota EDC is on 24-Nov-2026. Before it: the group's corrected invoice, a bounced guardian address on a live consent form, and the Event Manager grant the owner asked for (rows in B3).
- Teachers waiting on a reply or a roster change: `teacher-invoice-discount.1`, `group-payment-options.5` and `.6`, `group-payment-change.2`.
- Ad Grants (no repo code): scheduled checks on 13-Nov-2026, a weekly review on 30-Nov-2026 and a monthly review on 01-Dec-2026. Advertiser verification needs the owner (`ad-grants-rebuild.9`).
- Close-out PR #608 merged late on 10-Nov-2026.

### B3. Open tracker rows

`npm run tracker` on 10-Nov-2026: **704 open rows**, 27 closed by reference, across 98 sources (20 frozen sessions in `TRACKER.md` and 78 files in `tracker/`). #608 adds 6 more when it merges. A row stays open until it is ticked or another file lists it under **Closes**, so some open rows are already done.

**Counts by theme and file** (file slugs from `docs/handovers/tracker/`; `T n` is session n in `TRACKER.md`):

| Theme | Rows | Files (open rows) |
|---|---|---|
| Platform: CI, E2E, Vercel, tooling | 127 | deps-tailwind4 11, e2e-lock-queue 8, e2e-local-stack 8, active-cpu-phase-2 7, image-transformations 7, concurrency-deploy-volume 7, playwright-report-exposure 6, e2e-speedups 6, vercel-active-cpu 6, sanity-images 6, presize-blob-images 6, event-manager-e2e 5, lighthouse-url-list 4, e2e-apt-cache 4, worktree-sweep 4, skills-ci-waits 4, vercel-retention 4, worktree-cleanup 3, ci-blobless-checkout 1, T6 7, T4 6, T10 5, T7 1, T3 1 |
| Registration, payments, invoicing | 96 | group-payment-options 12, group-registration-followups 10, scholarship-offers 10, teacher-invoice-discount 7, scholarship-cancel 7, group-billing-roster 7, group-payment-change 6, group-invoice-any-changes 6, minnesota-grades-7-12 6, group-price-refusal 4, T12 8, T5 7, T8 6 |
| Events: check-in, badges, certificates, awards, teams | 91 | team-profiles 10, check-in-desk 9, event-check-in-v2 9, artwork-defaults 8, Finalist award file (`2026-10-19-…`) 7, awards-no-show 6, check-in-banner 6, roster-grade-display 4, badge-spares 4, team-profile-override 3, cert-position-save 2, T17 14, T18 9 |
| Members, roles, training, admin | 76 | member-merge-school-email 16, training-audience 12, event-manager-role 8, training-recording-builder 8, training-resources-space-tab 6, admin-dashboard-digest 6, T15 9, T16 6, T20 5 |
| Signing (DocuSign, Stellr signing) | 73 | esign-native-engine 11, bounce-notices 10, agreement-correct-recipient 8, opt-out-readback 7, esign-prod-switch-on 7, docusign-shared-inbox 6, mentor-agreement-emails 2, T21 12, T22 10 |
| Credentials and PD | 51 | educator-pd 12, legal-credential-family-link 10, mentor-credentials 7, credential-family-link 7, credential-view-as 5, T11 7, T13 3 |
| Public site, ads, SEO, CRM | 42 | ad-grants-rebuild 11, website-iteration 11, mobile-review 9, hubspot-event-options 8, insim-redirect 3 |
| S5 promotions | 34 | promote-s5-wave3 16, promote-s5-wave2 11, proxy-matcher-gated-prefixes 7 |
| Email | 33 | resend-quota-outbox 7, dmarc-ramp 7, email-catch-up 6, email-templates-fields 4, T23 6, T14 3 |
| Legal, privacy, public-repo rule | 26 | legal-self-registration 15, public-repo-personal-data 6, lint-pii 5 |
| Post-event survey | 23 | post-event-survey 11, survey-iteration 9, survey-followups 3 |
| Security review | 19 | deep-review-v2 19 |
| Background checks (Checkr) | 13 | checkr-report-export 5, T9 8 |

**Top rows, HIGH and unproven in production first.**

Unproven in production:

1. `promote-s5-wave3.7`. Crons after the S5 changes: no `cron_runs` read since #561. Compare a day's runs with the day before. `docs/TENANCY-S5.md` also asks that `event-emails` and `docusign-reminders` keep their result keys after wave 5.
2. `promote-s5-wave3.3`, `promote-s5-wave2.5`. The tenant derivation trigger and the eligibility trigger on a real participant write: confirm `tenant_id` is set and `app_errors` is clear.
3. `promote-s5-wave2.3`, `promote-s5-wave2.4`. Real registrations and the #549 join-link journeys through the S5 code. The witnesses were waived and no browser run covers the join-link journeys.
4. `promote-s5-wave3.5`. A typed sign-in from a registration page, and one brand-new login. Never witnessed: agents may not create accounts on Clerk's hosted service.
5. `esign-prod-switch-on.1`. No Stellr-signed agreement has completed in production. The canary (an adult and a minor, then PDF, download and Drive copy) has not run.
6. `esign-native-engine.19`. First real DocuSign V2.3 agreements: pre-fill and opt-out read-back never exercised from the app.
7. `opt-out-readback.1`, `.2`. First production read of the unread signed forms, and a check that the recorded answers match the signed PDFs.
8. `legal-credential-family-link.4`. Credential pages made public before 09-Oct-2026 by holders who are Minors under the new rule are still public.
9. `credential-view-as.1`. The fix has been live since 07-Oct-2026 but was never exercised signed in as an admin.
10. `training-recording-builder.4`. No real JaaS recording session yet.
11. `training-audience.3`. Production `object_type_relations` (event to course) is unchecked. If it is empty, as on dev, no course can attach to an event.
12. `check-in-desk.1`, `.2`. A real iPad camera scan, and Add to Home Screen with offline reload, are unproven.
13. `check-in-banner.1`. A past event's check-in was still open on production at the 15-Oct-2026 read, so `/check-in` redirected to it.
14. `member-merge-school-email.3`. A member merge changes `members.email` but not the Clerk login's address.

People waiting, or owner action needed:

15. `group-invoice-any-changes.2` (same as `promote-s5-wave3.4`). The Minnesota group's open invoice is for 17 places, not 15. The owner sends the corrected invoice from the roster.
16. `bounce-notices.1`. A live Minnesota consent form still holds a bounced guardian address.
17. `teacher-invoice-discount.1`, `group-payment-options.5` and `.6`, `group-payment-change.2`. Three teacher requests await a reply or a roster change.
18. `event-manager-role.2`. Grant the Event Manager role the owner asked for on the Minnesota event.
19. `16.1`. Two duplicate Clerk logins from a member clean-up were still live at the 24-Sep-2026 close-out. Deleting them is the owner's call.

Production state and platform:

20. `deep-review-v2.20` and `4.8`. `db:status --prod` lists two September migrations as pending. They were applied on 10-Sep-2026 under other ledger names. Cosmetic, but every promotion sees it.
21. `promote-s5-wave2.6`, `.7`. The `prod-migrations` environment needs reviewers, a branch rule and its secret, then §7 of the agent-controls runbook. The events mirror needs a production backfill and the parity query.
22. `resend-quota-outbox.2`, `.4`. The first production outbox drain is unread. The Resend plan (Free: 100 emails a day, 3,000 a month) is an owner decision.
23. `group-payment-options.2`. A Stripe test-mode drill for "students share the teacher's cost", which has run only against fakes.
24. `public-repo-personal-data.3` to `.5`. Older docs and PR bodies still hold personal data from before the rule. The owner decides on redaction or a private repo.
25. `dmarc-ramp.4`, `.5`. The full-quarantine and `p=reject` steps are open; their target dates (22-Oct-2026, 05-Nov-2026) have passed.
26. `23.1`. Alerts sent before 28-Sep-2026 reached nobody. A read-only audit of failed or flagged items was due before 03-Oct-2026.

**Rows that are probably done but not ticked.** `event-manager-role.1` and `group-payment-options.1` (migrations applied and code promoted in #587); `lint-pii.3` (promoted in #416; only the CI step check is left). Rows tied to past events also need re-reading against production and closing through a **Closes** list: the Colorado SDC (03-Oct-2026: `17.9`, `18.2`, `mentor-credentials.2`, `.3`) and the Nevada SDC (06-Nov-2026: `event-check-in-v2.1`, `artwork-defaults.3`, `team-profile-override.1`, `training-resources-space-tab.4`, `training-audience.4`, `member-merge-school-email.2`).

### B4. Known risks the docs flag

- **No database backups.** Supabase Free keeps none. The only off-site copy is the nightly e-sign replica of signed PDFs and agreement tables. Members, registrations, payments and credentials have no copy (`docs/RUNBOOK-backups.md`: "Not yet installed", every step an owner action). The 04-Nov-2026 promotion went ahead without the restore rehearsal or a fresh dump.
- **Agent controls not proven.** `docs/RUNBOOK-agent-controls.md` §7 reads "Proven on: (not yet)". The runbook, written 03-Nov-2026, says the agent works under the owner's GitHub identity and can reach production through the Supabase connector; no step is recorded as done. Until §7 is proven, production SQL runs only through the promote skill's Step 3 with the owner's explicit yes. Row `promote-s5-wave2.6` still lists the `prod-migrations` environment's reviewers, branch rule and secret as owed.
- **Governance slots marked "to confirm".** The compliance pack (`docs/compliance/`, drafts dated 02-Oct-2026) is unapproved. The program owner, a deputy, counsel, insurer and vendor security contacts are unconfirmed, and so are DPA status and data location for most providers. Several legal positions (COPPA, the Colorado Privacy Act, breach-notice duties) wait for counsel.
- **Policy and code conflicts.** `docs/compliance/README.md` lists 14. Among them: admin MFA is promised in School Data Terms §5 but not enforced; School Data Terms §6 deletion jobs don't exist; some logs have no retention. The list predates later fixes (for example #375's 7-year `deletion_archive` purge), so re-check each item before acting.
- **Vercel Hobby limits.** 4 hours of Fluid Active CPU per rolling 30 days, and at 100% Hobby pauses every project in the team. Usage reached 78% on 05-Nov-2026. Hobby also caps deployments at 100 a day, allows only daily crons (32 in `vercel.json`), and its terms rule out tenant onboarding or fees. `docs/RUNBOOK-vercel-pro.md` sets the move to Pro at the first partner contract or 85% CPU.
- **A merge is not a deployment.** Twice (18-Sep-2026, 12-Oct-2026) a promotion merge triggered no production build. The promote skill checks for a deployment of the merge SHA.
- **Resend Free plan.** 100 emails a day and 3,000 a month, shared by everything Stellr sends. Since #592 a refusal delays mail rather than losing it, but the first production drain is unproven.
- **Public repo.** `lint:pii` checks only added lines and cannot see names, so names rely on a manual read. Historical personal data remains in older docs and PR bodies until the owner decides on redaction or a private repo.
- **Signing.** DocuSign is expected to run until about 06-Aug-2027 (`docs/compliance/sub-processors-and-data-map.md`). Stellr signing has no completed production agreement yet and still lacks a CA-issued seal certificate (`esign-prod-switch-on.3`).
- **S5 checks not yet binding.** The `tenant-db` and `tenant-host-routing` CI jobs are report-only, so a failure blocks nothing. The S3 derivation stays in log mode, so a row it cannot derive is stamped Stellr, and a tenant event's mirror row must exist before its first Sanity publish. No production cron run has been read back since the Stellr-only cron filters landed (B11, #563; row `promote-s5-wave3.7`). Each is listed in `docs/TENANCY-S5.md` under "Risks to keep in view".
- **One person.** `docs/compliance/information-security-program.md` notes that the program owner and the developer are, today, the same person, working with AI coding tools. Wave 6 branches and the full S5 handover sit on that person's machine.

---

### B5. Sessions open at the switch, and their handovers

Two other Claude Code sessions were working when the account switched. Both stopped at a safe point and wrote their own handover. **Read each before continuing its work on the Team account.**

| Session | State at the switch | Its handover | What the next session picks up |
|---|---|---|---|
| **S5 multi-tenant build** | Idle. #606 promoted and recorded (#607). Wave 6 Lane B merged to `dev` (#610). Lanes A, C and D local only, backed up in a verified bundle. | Public copy: [`HANDOVER-s5-session-transfer-2026-11-10.md`](HANDOVER-s5-session-transfer-2026-11-10.md). A newer, fuller private copy and the wave 6 bundle are with the owner's private handover; where they differ, the private copy wins. | Restore the wave 6 branches from the bundle. Finish Lane A's consent-safety and regression reviews and its fix pass. Ship A (as a diff against B), then C, then D. Apply Lane A's migration to the dev database after its PR's `db` job passes. Owner decisions are listed in the private copy. |
| **Google Ad Grants rebuild** | Idle. No repo code changed. Close-out merged (#609). Four Search campaigns live from 10-Nov-2026. | [`HANDOVER-ad-grants-rebuild-2026-11-10.md`](HANDOVER-ad-grants-rebuild-2026-11-10.md), tracker [`tracker/2026-11-10-ad-grants-rebuild.md`](tracker/2026-11-10-ad-grants-rebuild.md) (rows `ad-grants-rebuild.1`–`.11`) | The first-serve check on 13-Nov-2026, the weekly review (Mondays) and the monthly review (1st). These are scheduled tasks in the Claude desktop app on the development Mac. After signing in to the Team account, open each `ad-grants-*` task and click "Run now" once so it can run unattended. The conversion-tag fix and advertiser verification need the owner. |

The cloud routine "Weekly scorecard numbers" died with the personal account. Its prompt was saved privately; recreate it on the Team account (tracker row `account-migration.7`).

### Known gaps in this record

- Whether S5 wave 6 Lanes A, C and D changed after the local backup was made: only Lane B is pushed.
- Whether the past-event HIGH rows were resolved at the events: the tracker records no closure.
- Whether DMARC moved past partial quarantine: the tracker shows those steps open, and DNS was not read.
- June to August history comes from commit subjects. That period has few PRs and no promotion records.

---

## 10. For a new Claude session on the Team account

1. Read `CLAUDE.md`, then this file, then `npm run tracker`.
2. Before any work: check the main checkout's branch and status, and do the work in a worktree (`ship` rule 1).
3. Connector tool IDs changed with the account switch. If a tool you remember is missing, load it by name with ToolSearch. Don't assume access was lost.
4. Never put a person's name, email, credential number or mailbox ID in the repo, a commit or a PR body. Run `node scripts/lint-pii.mjs --stdin` over PR text before `gh pr create`.
5. Production SQL needs the owner's explicit yes for that migration.
