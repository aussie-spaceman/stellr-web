# DRAFT: S6 plan (super-admin console, support mode, MFA, metering)

> **DRAFT, not approved.** The owner approved starting S6 alongside S5 wave 7 on 13 Nov 2026 (`docs/S5-DECISION-REGISTER.md`, `W7-23`), but no S6 plan, slice or branch exists yet. This draft sets out the scope, a first slice, the entry criteria and the open decisions. Nothing is scheduled until the owner approves it. Every "owner decides" marker is open, with the default S6 would build until it is answered.

Written 14 Nov 2026 against `dev` at `1d9b6977`. Stage list and ledger: `docs/PLAN-multi-tenant.md`. People are named by role only.

## Scope (from the multi-tenant plan)

S6 gives the platform the controls it needs before any tenant admin exists. It is indicatively 3 to 5 weeks, and was planned to start after the S4 spike and `lib/authz.ts`, both done (`docs/S4-SPIKE.md`; `docs/AUTHZ.md`).

1. **The super-admin console.** Tenants and their suspension, feature flags per tenant, per-tenant errors, and usage: registrations, events, gross volume in each currency, fees, emails and identities. Aggregates first; personal data only through support mode. Usage comes from a `usage_events` table with daily roll-ups.
2. **Support mode.** A read-only database role (`tenant_support_ro`) and a banner. Break-glass write needs a reason, the tenant's consent and a time limit of 60 minutes or less, plus a step-up re-authentication. Every support action shows on the tenant's own audit page, which is S6's view of `platform_audit_events` (`docs/PLATFORM-AUDIT.md`: "S6 shows each tenant its own slice"). Plan decision 18.
3. **MFA (G6, Clerk Pro).** A session claim checked in `proxy.ts`. Staff and tenant admins must use TOTP with backup codes; students are not forced. Passkeys only if the Clerk instance supports them. Enforced before the first tenant-admin account is created (plan decision 21).
4. **Authority moves from Clerk metadata to Postgres.** `platform_admins` and `tenant_memberships` become the authority; Clerk handles authentication only (`docs/THREAT-MODEL.md`, the "Admin role edited in Clerk metadata" row). The switch, its shadow log and the drift check are built in S5 (`docs/AUTHZ.md`, `AUTHZ_SOURCE`); the flip is the S5 slice C25, which "may be the first S6 step" (`docs/TENANCY-S5.md`, Lane C).

**S6 gates (from the plan):**

- every mutation is refused in support-read mode (`assertWritable()` in `lib/authz.ts` is a placeholder that always passes in S5: `docs/AUTHZ.md`, The API);
- break-glass is refused without consent, without a reason, without step-up, or after its time limit;
- an admin without MFA is refused on every admin route;
- usage figures equal SQL counts.

**Not in S6:** shared identity and consent grants (S7), events in Postgres (S8), payments (S9), tenant subdomains and branding (S10).

## What already exists

- **`lib/authz.ts`** with `assertPlatformAdmin()`, `requireTenantCrew()` (a platform admin passes another tenant "only in S6 support mode"), and the `assertWritable()` placeholder (`docs/AUTHZ.md`).
- **`AUTHZ_SOURCE`** with `clerk`, `shadow` and `postgres`, the role mapping (`lib/tenancy/role-mapping.ts`), and the drift check `scripts/map-tenancy-roles.ts --check` (`docs/AUTHZ.md`). No hosted shadow window has run (tracker `s5-programme.31`).
- **View-as** (`lib/impersonation.ts`), hardened in #500 with a dedicated secret, issuer binding, staff targets refused and mandatory audit (`.claude/releases/promote-2026-11-03.md`).
- **`platform_audit_events`**, hash-chained and append-only, with `scripts/verify-audit-chain.ts`; off on both Vercel projects (`docs/PLATFORM-AUDIT.md`, "Turning it on").
- **The Staff role** requires MFA as one of its five grant prerequisites (`lib/staff.ts`; `docs/RUNBOOK-staff-role.md`), checked at grant time. A request-time MFA check does not exist yet.
- **The switch registry and health report** (`lib/tenancy/flags.ts`, `GET /api/admin/health/integrations`, #654): a starting point for the console's view of switches.

## First slice candidate: C25

C25 is the S5 slice that runs the `AUTHZ_SOURCE=shadow` window on production, flips to `postgres`, and removes the legacy idioms (`docs/TENANCY-S5.md`, Lane C: "Shadow window, flip, contract"; owner-gated). It is the natural first S6 step because it moves authority to Postgres, which support mode and tenant admins both rest on.

**It cannot start yet.** Its preconditions are open:

- C25 depends on B17, B19, B20 and C13 to C23 (`docs/TENANCY-S5.md`, Lane C). C19 to C23 are not built: 117 legacy authorisation sites remain in 82 files (`test/baselines/authz-legacy-idioms.json`), and the ratchet must reach 0 first (`docs/AUTHZ.md`, precondition 6).
- `docs/AUTHZ.md`, "What must hold before a flip", preconditions 1 to 10 are all open: routes calling `lib/authz` with a deliberate drift proving the window can fail, the drift check passing on `dev` and production, roles mapped, Active CPU room, at least 7 clean production shadow days, no page left on `page.requireAdmin`, the B20 prefilter choice, and the `platform_admins` list decided route by route.

**So the first S6 slices are the parts that need none of that.** Proposed order:

| Order | Id | Slice | Depends on | Flag, or why it is a no-op for Stellr | Gate |
|---|---|---|---|---|---|
| 1 | S6-D | S6 decisions and design note: the open questions below, answered or defaulted; the support-mode and break-glass design written up | none | Docs only | The owner reviews the defaults |
| 2 | S6-MFA-a | Request-time MFA check for admin routes, behind a new default-off flag, reading the Clerk session's second-factor state; refuses with a page asking the person to turn on two-step verification | S6-D | Default off; with it on, only an admin or Staff without MFA sees a change | Unit tests per role; on `dev` with the owner's yes; the Staff role's grant check stays as it is |
| 3 | S6-AW | `assertWritable()` made real behind support mode: every mutating admin handler calls it, and it refuses while a support-read session is active | S6-D | No support-read session exists until S6-SUP, so it always passes | A guard test fails on any mutating admin handler that does not call it |
| 4 | S6-SUP | Support mode: the `tenant_support_ro` role (one migration, written with `npm run migration:new` and proven by CI only), a support session record, the banner, read-only by default | S6-AW | Reachable only by a platform admin, and only for a non-owner tenant, of which there are none | pgTAP: the role holds no write privilege; an e2e that a support-read session's mutation is refused |
| 5 | S6-BG | Break-glass: reason, the tenant's consent, a time limit of 60 minutes or less, step-up re-authentication, every action audited to the tenant's chain | S6-SUP | As S6-SUP | The four break-glass refusals in the S6 gates |
| 6 | S6-USE | `usage_events` and daily roll-ups, aggregates only | S6-D | Writes only counts; behind a default-off flag until the console reads it | Usage figures equal SQL counts on `dev` |
| 7 | S6-CON | The super-admin console: tenants, suspension, flags, per-tenant errors, usage | S6-USE, S6-SUP | Platform admins only; Stellr's admin screens unchanged | `assertPlatformAdmin()` on every route; no personal data outside support mode |
| 8 | C25 | Shadow window on production, flip to `postgres`, remove the legacy idioms | the preconditions above | Owner-gated flip; rollback is `AUTHZ_SOURCE=clerk` | `docs/AUTHZ.md` preconditions 1 to 10 and the S5 gate "Authorisation converged" |

Each slice follows S5's rules: about 30 files or fewer, generated baselines regenerated at merge, CODEOWNERS files reviewed by the owner (`lib/authz.ts`, `lib/authz/**`, `proxy.ts`, `lib/impersonation.ts`, `supabase/migrations/**` are all owned), no production SQL or variable change without the owner's yes.

## Entry criteria

S6 is approved to start (`W7-23`). Before each part starts, these hold:

| Part | Entry criteria |
|---|---|
| S6-D | None |
| S6-MFA-a | The owner's answer or default on how MFA is checked on Clerk's current plan (`S6-Q1`) |
| S6-AW, S6-SUP | The `platform_admins` list decided route by route, or the default below (`S6-Q3`) |
| S6-BG | How the tenant's consent is captured (`S6-Q4`) |
| S6-USE, S6-CON | Which usage figures the console shows, and where per-tenant errors come from (`S6-Q6`) |
| MFA enforced for tenant admins | Clerk Pro (G6) in place before the first tenant-admin account (plan decision 21) |
| C25 | `docs/AUTHZ.md` preconditions 1 to 10; C13 to C23, B17, B19 and B20 on production; 7 clean production shadow days |

**S6 is not a gate for S5 wave 8**, and shares files with it only in Lane C (`lib/authz.ts`). Lane C runs one PR at a time, so S6's Lane C slices queue behind wave 8's.

## Open decisions

Every one is **owner decides**. The default is what S6 builds until the owner answers.

| Id | Question | Options | Proposed safe default |
|---|---|---|---|
| S6-Q1 | MFA before Clerk Pro: enforce a request-time check now for Stellr admins and Staff using what the current Clerk plan exposes, or wait for Clerk Pro? | (a) now, behind a flag; (b) wait | (a), behind a default-off flag, flipped on `dev` first; Clerk Pro stays the trigger for tenant admins (decision 21) |
| S6-Q2 | Which roles must have MFA at request time? | (a) admin and Staff; (b) also event managers; (c) everyone with portal access | (c) for tenant admins once they exist; (a) first for Stellr, then event managers |
| S6-Q3 | Who is on `platform_admins`, route by route? Under `postgres`, only that table passes `assertPlatformAdmin` (`docs/AUTHZ.md`, precondition 10) | owner names them | The owner only, until named otherwise; nothing locks out existing Stellr admins while `AUTHZ_SOURCE=clerk` |
| S6-Q4 | How a tenant consents to break-glass write: a tenant admin's approval in the app, or a recorded written consent | (a) in-app approval by a tenant admin, logged; (b) written consent recorded by staff | (a); with no tenant admin, break-glass is refused |
| S6-Q5 | Break-glass time limit | 15, 30 or 60 minutes | 30 minutes, renewable once with a fresh reason |
| S6-Q6 | Which usage figures the console shows, and how long `usage_events` is kept | owner chooses | Counts only (registrations, events, emails, identities), gross volume and fees once S9 exists; raw events kept 90 days, daily roll-ups kept |
| S6-Q7 | Where support mode runs: the platform app host, or the tenant's own host | (a) platform host; (b) tenant host | (a): `/admin` stays a 404 on tenant hosts until membership checks and MFA exist (`docs/TENANCY-S5.md`, Risks) |
| S6-Q8 | Does view-as (`lib/impersonation.ts`) stay for Stellr once support mode exists? | (a) keep for Stellr, support mode for tenants; (b) replace | (a); before the first non-owner tenant, view-as refuses a target tied to that tenant (`docs/S5-DECISION-BACKFILL-DRAFT.md`, BF-40) |
| S6-Q9 | Is the authority flip (C25) S6's first production step, or the end of S5? | (a) S6's first step; (b) end of S5 | (a), which matches the S5 plan's note on C25 (`docs/S5-DECISION-BACKFILL-DRAFT.md`, SQ-6) |
| S6-Q10 | The `proxy.ts` admin prefilter under `postgres` (B20) | (a) sync a Clerk claim from Postgres; (b) signed-in only | (a): keeps the proxy database-free (`docs/S5-DECISION-BACKFILL-DRAFT.md`, BF-18) |
| S6-Q11 | Where the audit chain's recorded heads are kept, and how often (`docs/PLATFORM-AUDIT.md`, "Turning it on", step 5) | (a) a scheduled job; (b) taken by hand at each promotion | (b) until a Hobby cron's Active CPU is measured |

## Risks

- **Active CPU.** Nothing may add a database call to `proxy.ts` for Stellr hosts (`docs/TENANCY-S5.md`, Risks). The MFA check reads the session claim only.
- **Lockout.** A request-time MFA check or a short `platform_admins` list can lock Stellr's own admins out. Each ships behind a flag, on `dev` first, with the rollback written before the flip.
- **Support data exposure.** Support mode is the only route to a tenant's personal data for platform staff, and its actions land on the tenant's audit page; a mistake there is visible to the tenant and cannot be removed from the chain.
