# Multi-tenant plan: stages, decisions and ledger

The public summary of the plan that turns Stellr into one shared platform other organisations ("tenants") can run their own-branded events on. The full plan (revision 2, approved by the owner in early November 2026) is held privately because it carries working notes; this file copies its structure and its decisions, not its personal or commercial detail. People are named by role only: "the owner" is the programme's owner.

Where this file and a stage's own record disagree, the stage's record wins: `docs/TENANCY-S3.md`, `docs/TENANCY-S4.md`, `docs/S4-SPIKE.md` and, for Stage 5, `docs/TENANCY-S5.md` (the plan of record) with `docs/S5-DECISION-REGISTER.md` (owner decisions) and the tracker `docs/handovers/tracker/2026-11-11-s5-programme.md` (open items). Tracker row `s5-programme.37` asked for this file.

Written 14 Nov 2026 against `dev` at `1d9b6977`. Production (`main`) carries the 13 Nov promotion (#680, `fba19669`); `dev` has since added #682, #683, #685 and #686, none of them multi-tenant work.

## What the platform is for

- **Scope:** event management and event conduct only. Community features stay Stellr's.
- **Who uses it:** a platform super-admin who sees every tenant and can open a tenant read-only for support; tenant admins and event managers who do what Stellr's admins and event managers do for events; participants whose identity can follow them from one tenant to another, with consent.
- **Who builds it:** Claude Code does the development. The owner approves each promotion and each production migration.
- **Three focus areas, applied to every stage:** security built to the strictest practical standard; child safety and the law in the USA and Australia, built to the stricter of the two; and the lowest possible infrastructure cost, with a written trigger for every paid item.

## Stages

Week 0 was Monday 2 Nov 2026. Durations are indicative: a stage ends when its gates pass, not on a date (decision 20).

| Stage | One line | Indicative length |
|---|---|---|
| S0 | Live security and child-safety fixes: seal the database functions anonymous callers could run, revoke broad table grants, harden view-as, server-side age checks, content safety, data hygiene | weeks 0 to 5 |
| S1 | Recoverability, cost-controlled infrastructure and agent controls: self-built encrypted backups, agent identity separation, error capture, open registration with age-based controls, CSP and HSTS in report-only, a CI database | weeks 0 to 5, beside S0 |
| S2 | Assurance harness: route manifest and AST guard check, cross-tenant and IDOR generator, two-tenant seed, static analysis and mutation testing, migration reports, threat model | weeks 5 to 10 |
| S3 | Tenant and event data model, with Stellr as tenant #1 in the background: tenant tables, the Postgres events mirror, trigger-derived `tenant_id`, table registry, role mapping | weeks 4 to 12 |
| S4 | Database-enforced isolation, audit primitive and field encryption: the `tenant_app` role and `tenantDb()`, the hash-chained `platform_audit_events`, `lib/field-crypto.ts` in shadow | weeks 9 to 19 |
| S5 | App tenancy conversion and authorisation convergence: host routing, `lib/authz.ts`, codemods onto `tenantDb` and the events facade, per-tenant crons, the SMMA guardrail, audit on every mutation | weeks 12 to 32 |
| S6 | Super-admin console, support mode, MFA and metering; authority moves from Clerk metadata to Postgres | 3 to 5 weeks; started alongside S5 wave 7 (`W7-23`) |
| S7 | Shared identity, consent ledger and guardians: identities, per-tenant consent grants that can be revoked, a sealed share function, 14 and over only | 8 to 12 weeks, after the S5 registration slice |
| S8 | Events in Postgres with an in-app editor, and localisation: money per currency, time zones, US grades and AU Year levels, addresses and phone numbers | 6 to 9 weeks, after the S5 reader and admin slices |
| S9 | Payments in two regions (US/USD and AU/AUD): Stripe Connect, a double-entry ledger, per-currency fees, refunds and payouts | 8 to 11 weeks, after S8 |
| S10 | White-label surfaces and communications compliance: tenant subdomains, branding on the Design System V2 tokens, transactional mail only, a brand sweep | 5 to 7 weeks, beside S9 |
| S11 | Pilot-critical conduct, safeguarding and integration fencing: tenant agreement templates on the native e-sign engine, check-in, safeguarding records per jurisdiction, incident capture, integrations fenced off for tenants | 4 to 6 weeks |
| S12 | Onboarding, the US and AU legal pack, the knowledge base and a security self-assessment | 7 to 10 weeks; legal drafting from S3 in the docs lane |
| S13 | Shadow tenant and pilot provisioning: an adults-only shadow tenant with real money, daily canary probes, the first partner provisioned | 4 to 8 weeks |
| S14 | The pilot's live event and hypercare | 5 to 8 weeks |
| S15 | Release-1 waves (group registration, volunteers and mentors, credentials, surveys) and invite-only general availability for further tenants | 10 to 16 weeks, beside S13 and S14 |

**Milestones (indicative):** M0, S0 and S1 closed (live holes closed, backups proven, agent contained); M0b, S3's gates; M0c, S4's gates; M1, Stellr runs as tenant #1 with no visible change (end of S5); M2, the pilot is provisioned (end of S13); M3, the pilot's live event (S14), anchored to the partner's event date; M4, general availability (S15).

**Future modules, not scoped here:** judging and accommodation. Each gets its own scoping session once `lib/authz.ts`, `tenantDb` and the events table exist, so both are built tenant-native. If the first partner's event needs them, they sit on the path to M3 (tracker `s5-programme.48` asks for that partner's event profile).

## Lanes

At most three code lanes and a docs lane run at once. Lanes split by file ownership, not by mechanism: a file has one owner, and any unclaimed `lib/**` or root config file belongs to Lane C. The globs are in `docs/TENANCY-S5.md`, "Lanes and file ownership"; the merge rules for shared files are beside them.

| Lane | Owns | Rule |
|---|---|---|
| A: participant flows and registration | `app/api/register/**` (sole owner), the flow pages, check-in, signing, surveys, credentials, team profiles, volunteers, Stripe and webhook routes, `lib/registration/**`, `lib/esign/**` | One lane owns `app/api/register/**` |
| B: tenant edge and platform | `proxy.ts`, CSP, the tenant tree `app/%5Ft/**`, the Stellr root layout, analytics, community, email and event-email libraries, crons, the rate limiter, `e2e/tenancy/**` | Lands host and cron changes behind `TENANT_ROUTING_ENABLED` or a no-op proof |
| C: staff surface | `lib/authz.ts`, `lib/authz/**`, admin routes and pages, `lib/events/**`, `lib/audit/**`, `tenantDb` and `loadScoped`, the IDOR suite, generated baselines, `package.json`, `.github/**` | Strictly one PR at a time |
| D: docs | `docs/**` and `.env.local.example` (names only) | No code, no migrations. Shared prose docs travel only in Lane D's docs trains |

Since wave 7 each slice is about 30 files or fewer, generated baselines merge through a fixed queue, and at most four large PRs are open at once (`docs/TENANCY-S5.md`, "Wave 7 status").

## Decisions already made

### The plan's binding owner decisions

Numbered as in the private plan, so either can be cited.

| # | Decision |
|---|---|
| 1 | White-label SaaS: tenants run their own-branded events. Stellr is the vendor and does not approve tenant events |
| 2 | First tenants are US and Australian nonprofits and schools. Districts and for-profit organisations are out of release 1 |
| 3 | The tenant is controller of its event data. Stellr is processor, and controls only a thin shared identity layer |
| 4 | Cross-tenant sharing ships in release 1. People under 14 are never shared, and tenants cannot hold them |
| 5 | Shared: core identity and contact (name, date of birth, email, phone, school, grade), guardian and emergency contact. Never shared: medical, dietary or allergy data, history, credentials |
| 6 | Consent is a per-tenant grant at registration, showing the exact fields, logged, and revocable per organisation. For 14 to 17-year-olds the guardian gives it |
| 7 | Stellr collects payments, holds them and transfers to the tenant after the event, less a per-registration platform fee. US tenants: Stellr is merchant of record. AU tenants: the tenant is merchant of record through `on_behalf_of` on Stellr's US platform |
| 8 | Stripe takes USD and AUD. Each tenant has one payment region and currency |
| 9 | Vercel Pro starts when a new partner signs a contract. Until then the site stays on Hobby, no tenant is onboarded and no tenant fees are taken (`docs/RUNBOOK-vercel-pro.md`) |
| 10 | Legal, tax and security reviews use free options; the risk ratings say where that leaves a gap |
| 11 | Events move from Sanity into Postgres with an in-app editor. Sanity stays for marketing |
| 12 | Tenant participants get an event-only experience: no community features, a scoped "My events" page |
| 13 | Everyone gets a login. Tenant events take students aged 14 and over only, enforced in the database. Stellr's own events keep younger students under its COPPA controls |
| 14 | Each tenant gets a subdomain under a Stellr-owned zone, with its branding and a "powered by Stellr" footer |
| 15 | Agreements are the tenant's own templates on Stellr's native e-sign engine. The guardian-consent and share-consent documents are locked by the platform. DocuSign stays Stellr-only |
| 16 | Background checks: tenants attest them per jurisdiction (US checks; Australian Working With Children Checks). Bring-your-own Checkr comes later |
| 17 | Release-1 scope: registration, payments, paperwork, check-in, volunteers and mentors, awards, certificates and credentials, surveys, team profiles. Judging and accommodation are future modules |
| 18 | Support access is read-only by default. Break-glass write needs a reason, a time limit and the tenant's consent, and every action goes to a tamper-evident audit log the tenant can see |
| 19 | Enablement is the knowledge base plus a ticket form |
| 20 | Quality-gated, no fixed date |
| 21 | MFA (Clerk Pro) is enforced for staff and tenant admins before the first tenant-admin account is created |
| 22 | Australian data stays in the US region under APP 8 contract terms |
| 23 | Supabase stays on Free until a quota forces Pro. Self-built backups, no point-in-time recovery (`docs/RUNBOOK-backups.md`) |
| 24 | Anyone can register. Sign-up is never invite-only; the controls are by age: 18 and over register at once, 13 to 17 through guardian consent, under 13 only after verifiable parental consent (3 Nov 2026; built behind flags in #509) |

### Decisions made during S3 to S5

The wording that counts is at the link.

| Decision | Where it is recorded |
|---|---|
| S4 isolation uses a tenant role and a transaction-local tenant (Option B), not a tenant JWT (4 Nov 2026) | `docs/S4-SPIKE.md`, section 1 |
| No date hold and no 72-hour rule for S5 merges to `dev` (4 Nov 2026); the 72-hour no-flip windows declined for wave 7 (11 Nov 2026) | `docs/TENANCY-S5.md`, "What may merge when"; register `W7-3` |
| The tenant tree is `app/%5Ft`, because a folder named `_t` never routes (built in B5, #534) | `docs/TENANCY-S5.md`, "Risks to keep in view" |
| One shared email pool for all tenants until SES (9 Nov 2026) | `docs/TENANCY-S5.md`, "Owner gates" |
| `postgres` (postgres.js) approved as a runtime dependency for the tenant driver only (9 Nov 2026) | `docs/TENANCY-S5.md`, "Merge rules for shared files" |
| Under-18s are refused at tenant events until guardian consent; the consent flow uses the native engine and a platform-locked document (10 Nov 2026) | `docs/TENANCY-S5.md`, "Owner decisions wave 5 raised" |
| A Stellr member's profile is not used at a tenant event until S7's consent grant; tenant forms take typed details only (10 Nov 2026) | same |
| The tenant database connection requires `sslmode=verify-full` with a supplied root CA (10 Nov 2026) | same; built in C11t (#624) |
| `tenant-db` becomes a required check from C18 (10 Nov 2026); required on `dev` since then | same; tracker `s5-programme.5` |
| `TENANT_GUARDIAN_CONSENT_ENABLED` may go on only where Lane C's tenant-event refusals are live, and only with `LOADSCOPED_MODE=enforce` | register `REF-1` and `W7-14` |
| Wave 7's dev switches, canary tenant, dev Sanity dataset, consent placeholder, pooler TLS and code yeses | register `W7-1` to `W7-8` |
| Credentials, wallet pages, held invitations, volunteer interest, held surveys and the Stellr-host unsubscribe | register `W7-9` to `W7-16` |
| P1 on `dev` while C13 and B16 are open; who sets `dev` variables; the deployment check after every flip; no per-IP check-in cap before P5 | register `W7-17` to `W7-20` |
| The canary's send cap, the supervised `AUTHZ_SOURCE=postgres` window, the dev canary zone and its cookie-review answers | register `W7-21`, `W7-22`, `W7-24` to `W7-31` |
| S6 starts alongside wave 7 (13 Nov 2026) | register `W7-23` |
| The programme recommendations of the 13 Nov review: proceed, each production action with its own yes | register `W7-32` |

The decisions still open from waves 2 to 6, and the scoping questions nobody answered, are drafted in `docs/S5-DECISION-BACKFILL-DRAFT.md` for the register. The S1 to S4 owner actions and decisions are in `docs/OWNER-CHECKLIST-S1-S4.md`.

## Ledger

Two columns that are easy to confuse are kept apart:

- **On production** means the stage's code (and any migration) is merged to `main` and deployed. It says nothing about whether it has been switched on or proven.
- **Gate passed** means every proof the stage's gates name is recorded. A stage can be fully on production with its gate not passed: S3 to S5 all are.

| Stage or wave | On production | Gate passed | Evidence | What stops the gate |
|---|---|---|---|---|
| S0 | **Partly.** The DB-N3 hotfix (#502; migration `20261102220634_seal_definer_functions_db_n3.sql`, applied before promotion #506, `33ebff30`, 3 Nov 2026), view-as hardening and check-in scoping (#500), and the Supabase key switch (#501, then #508 via #515) | **No** | `.claude/releases/promote-2026-11-03.md`; `docs/SECURITY-HOTFIX-C-2026-11-02.md` | Not built on `dev`: the table-grant revoke and the default-privilege change (`docs/SECURITY-HOTFIX-C-2026-11-02.md`, "Not in this hotfix"); no migration after `20261104400000` runs `ALTER DEFAULT PRIVILEGES`. Open PRs #687, #689, #690 and #691 address parts of this and are not on `dev` |
| S1 | **Yes (code).** Open registration with age controls, the 50-page PDF cap, error capture and the email transport, headers, the CI database and the ops scripts (#509, promoted in #515, `3d1a76ad`, 4 Nov 2026) | **No** | `.claude/releases/promote-2026-11-04.md` | Backups are not installed (`docs/RUNBOOK-backups.md`, Status), so no restore drill or heartbeat; agent controls proven on 2 of 9 rows (`docs/RUNBOOK-agent-controls.md`, section 7: rows 5 and 6 on 12 Nov 2026); the schema diff is skipped without `PROD_SCHEMA_DUMP` (`.github/workflows/ci.yml`); no per-age-band e2e on `dev` (open PR #695). Owner steps: `docs/OWNER-CHECKLIST-S1-S4.md` |
| S2 | **Yes.** Route manifest, AST guard check, IDOR generator, two-tenant seed, scanners, migration reports (#510 and #511, promoted in #515) | **No** | `test/route-manifest.test.ts`, `test/idor/idor-routes.test.ts`, `scripts/migration-report.mjs` | "100% of routes classified" and "generator count equals manifest" hold in CI. Not recorded: the owner spotting a seeded dangerous change in a migration report. The scanners and the IDOR canary are report-only until their `*_ENFORCE` variables are set (`.github/workflows/security.yml`, `.github/workflows/idor-canary.yml`) |
| S3 | **Yes.** Tenant tables, events mirror, derivation trigger in log mode, expand and backfill (#510; migrations `20261104100000` to `20261104140000`, applied to production on 4 Nov 2026) | **No** | `.claude/releases/promote-2026-11-04.md`; `docs/TENANCY-S3.md` | The rehearsal on a restored dump was overridden by the owner and no dump was taken (`.claude/releases/promote-2026-11-04.md`); the production mirror backfill and parity query are owed (tracker `s5-programme`, "Related rows"); derivation is still `log` everywhere (no migration sets `enforce`), so the "7 days of trigger-derived ids" and "0 orphans" boxes in `docs/TENANCY-S3.md`, "Enforce cut-over checklist", are open |
| S4 | **Yes.** `tenant_app` and 35-table policies, storage prefix rule, `platform_audit_events`, field crypto in shadow (#511; migrations `20261104200000` to `20261104400000`, 4 Nov 2026); `tenant_id` on the `via_parent` tables (C0b, #564; migrations `20261106070722` to `20261106074112`, applied 6 Nov 2026) | **No** | `docs/TENANCY-S4.md`; `docs/FIELD-CRYPTO.md`; `docs/PLATFORM-AUDIT.md` | The isolation matrix and the audit tamper test run in CI's `db` job (`supabase/tests/database/`), but that job is report-only (`DB_CI_ENFORCE` unset; `.github/workflows/ci.yml`); Stryker does not run, so the 80% mutation gate cannot be measured (tracker `s5-programme.40`); the plaintext gate fails by design until the master key, shadow mode, backfill and plaintext decisions are done (`docs/FIELD-CRYPTO.md`, Gates); no FORCE RLS (readiness check unrun) |
| S5 waves 1 and 2 | **Yes.** Wave 1 (#528) and wave 2 (#534, #535, #540, #547, with #549), promoted in #548 (`5386f5e7`, 6 Nov 2026 UTC) | **No** (S5 gates are measured for S5 as a whole) | `docs/TENANCY-S5.md`, "Wave 2 status" | See "S5 as a whole" |
| S5 wave 3 | **Yes.** #562, #563, #564, #565, promoted in #561 (`028bea6e`, 6 Nov 2026) | **No** | "Wave 3 status" | same |
| S5 wave 4 | **Yes.** #576, #578, #579, #580, promoted in #587 (`6026dd22`, 9 Nov 2026); B9's CHECK applied to production first | **No** | "Wave 4 status"; `.claude/releases/promote-2026-11-09.md` | same |
| S5 wave 5 | **Yes.** #588, #594, #598, #601, promoted in #600 (`89559a4f`, 10 Nov 2026 UTC). No migration | **No** | "Wave 5 status"; `.claude/releases/promote-2026-11-09b.md` | same |
| S5 wave 6 | **Yes.** B14b #610 via #612 (`3d90a6dd`, 10 Nov 2026); Lanes C (#624) and A (#625) with Lane D's docs (#637) via #643 (`5d18d321`, 12 Nov 2026), A16's migration applied to production first | **No** | "Wave 6 status"; `.claude/releases/promote-2026-11-12b.md` | same |
| S5 wave 7 | **Yes.** #646 to #662, #665 to #671, #675 and #677, promoted in #680 (`fba19669`, 13 Nov 2026). No migration | **No.** Wave 7's own exit (switches proven on `dev`, the K9 canary run) has not happened: the flip log holds only the P0 baseline | "Wave 7 status"; tracker `s5-programme.31`, "Wave 7 flip log" | No tenancy switch has been on in a hosted environment |
| S5 as a whole | Waves 1 to 7 as above; every tenancy switch is off on both Vercel projects (`docs/TENANCY-S5-data.md`, "Where it stands") | **No** | `docs/TENANCY-S5.md`, "Gates" | Cross-tenant ratchet not at 0 (`MAX_TENANT_DESTINED_STELLR_ONLY` 18 in `test/idor/stellr-only-dispositions.test.ts`; `MAX_UNEXERCISED` 5 and `MAX_ERROR` 3 in `test/idor/idor-routes.test.ts`); tenant-host cases 48 failing and 18 unproven of 124 (`test/baselines/tenant-host-idor.json`); 104 mutating handlers and 4 GET writers unaudited (`test/baselines/unaudited-mutations.json`); 117 legacy authorisation sites in 82 files (`test/baselines/authz-legacy-idioms.json`); no `AUTHZ_SOURCE=shadow` window; the 30-day checklist (`docs/TENANCY-S5-flow-checklist.md`) unsigned |
| S6 | **No.** Approved to start (`W7-23`); nothing built | **No** | `docs/PLAN-S6-DRAFT.md` | Not started |
| S7 to S15 | **No** | **No** | | Not started. Their prerequisites are in the stage table above |

**The next wave.** S5 wave 8 is drafted in `docs/PLAN-S5-wave8-DRAFT.md`; the tracker expects the final plan after the K9 canary run (`s5-programme.43`).

## Keeping this file true

- A promotion that carries stage code updates the "On production" cell, citing the promotion PR and merge commit.
- A gate moves to "Yes" only when every proof in that stage's gate list is recorded in its own record, with the date. Partial progress stays in "What stops the gate".
- Ids, counts and dates only: no person, member id, production id or key goes in this file.
