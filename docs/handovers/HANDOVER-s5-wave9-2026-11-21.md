# Handover: S5 wave 9 and the state of the single-instance multi-tenant work, 21 Nov 2026

Slug `s5-wave9`. Tracker: `tracker/2026-11-21-s5-wave9.md`. Earlier programme tracker: `tracker/2026-11-11-s5-programme.md`, the open S5 list after the account move, which this file updates.

Use this file to pick the multi-tenant programme up from scratch. It covers four things: where the programme stands on production, what this session shipped, what is waiting on the owner, and the order of the next work.

## 1. Where things stand (21 Nov 2026, 21:01Z)

- **Production:** `main` = `847be2e5` (promotion #844), deployment `dpl_AiSe7FFunWw8h6gXttKp7WMEeRos`. Rollback target: `dpl_9tUB9WvyBx9xSGKDoeVe1bpvu2ZG` (#818, `dfe7e877`).
- **dev:** `74ab2ca7`, which is main plus the promotion record (#845). Nothing unpromoted is waiting from this session.
- **Live in production:**
  - S5 waves 1 to 8;
  - wave 9: C25 done, sampled shadow reads, Staff on the Competitions pages, seven routes platform-admin only, Stellr-only lists filtered;
  - every S5 ratchet at its floor (section 3).
- **Single instance, one tenant in practice:** Stellr is tenant #1, and no other tenant exists on production. Every tenancy switch is off on production; the table below lists each one.

| Switch | Production | dev |
|---|---|---|
| `AUTHZ_SOURCE` | unset, so `clerk` | unset, so `clerk` |
| `TENANT_ROUTING_ENABLED` | off | canary zone only (`.devzone.stellreducation.org`) |
| `TENANT_DB_ENABLED` | off | **`true` since 21 Nov 2026, with `TENANT_DB_AREAS` unset**, so no area reads through `tenantDb` |
| `derivation_mode` (`tenancy_settings`) | `log` | `log`; the enforce flip is due after 27 Nov 22:53Z (section 5) |
| `PLATFORM_AUDIT_ENABLED`, `TENANT_EVENT_MAIL_ENABLED`, `TENANT_GUARDIAN_CONSENT_ENABLED`, `LOADSCOPED_MODE` | off or default | off or default |

The single source for switches is `lib/tenancy/flags.ts`, and the admin health route reports them as `tenancy`. The order of flips and their evidence is in `docs/TENANCY-S5.md` and the flip log in the programme tracker.

## 2. What this session did

All of it is merged to `dev` and promoted in #818 (20 Nov) or #844 (21 Nov), except where marked.

| PR | What | Merge |
|---|---|---|
| #819–#823, #826, #827 | Wave 8 finished: C19c, B25 plus the Action's WD-1 exception (#826), A12/BOUNCE links on the tenant host, ENF prep, and the wave 8 status doc | promoted in #818 |
| #828 | Register routes run with tenant routing on in the tenant-host suite (failing 12 → 2) | #818 |
| #829 | C20/C21: scholarships admin and event-managers onto `lib/authz`, Stellr-only for other tenants | #818 |
| #830, #832, #838, #839, #840 | **C25, the admin conversion.** Old-style authz idioms 99 → 1, and the legacy helpers in `lib/admin-auth.ts` and `lib/event-access.ts` deleted | #818 (#830), #844 |
| #831 | Audit coverage: unaudited mutations 19 → 0, GET writers 4 → 0. Eight anonymous public forms exempted by the owner, each with its reason in `AUDIT_EXEMPTIONS` | #818 |
| #839 | **Sampled shadow reads** (owner decision 21 Nov): under `AUTHZ_SOURCE=shadow`, every grant is compared and denials at `AUTHZ_SHADOW_DENY_SAMPLE` (default 0.05) | #844 |
| #840 | **Staff get the Competitions pages** (owner decision 21 Nov, per `docs/RUNBOOK-staff-role.md`). `lib/authz/equivalence.test.ts` is now a 181-row expected-answer table, 30 rows of it for Staff | #844 |
| #841 | Stellr-only admin lists keep to Stellr's rows (ratchet 26 → 0) | #844 |
| #842 | IDOR suite: unexercised 5 → 0, error 3 → 1 (store/checkout, BF-33). No cross-tenant write found. Accepted honey writes must name the tables they write | #844 |
| #843 | Staff file-upload and menu gaps; owner decisions on the unproven cap (22 → 24), BF-15 (a), `OPERATIONAL_WRITERS`/BF-9 and the D7 sign-off; the production role mapping recorded | #844 |
| #845 | Promotion record and sync | dev |

**Owner actions taken in this session, recorded by count only:**
- **Production role mapping:** `scripts/map-tenancy-roles.ts --apply --platform-admins --production`. Result: 2 `platform_admins` rows, and Stellr memberships match the Clerk authority.
- **dev `tenant_app_login`:** created by the owner. The pooler TLS canary verified against **Supabase Root 2021 CA** (`TLS_VERIFIED`, TLSv1.3), so no bundle is needed. Role `tenant_app` and Stellr's tenant were read back.
- **dev variables:** `TENANT_DATABASE_URL`, `TENANT_DATABASE_CA_CERT` and `TENANT_DB_ENABLED=true` are on `stellr-web-dev` as sensitive values.

## 3. Ratchets and gates, as of `847be2e5`

| Gate | Value | Where |
|---|---|---|
| Legacy authz idioms | **1** (`clerkRoleRead` in `components/layout/NavUserButton.tsx`, a client menu, not a guard) | `test/baselines/authz-legacy-idioms.json`, `scripts/authz-idioms.mjs` |
| Unaudited mutations / crons / GET writers | **0 / 0 / 0** | `test/baselines/unaudited-mutations.json` |
| Stellr-only admin list reads | **0** | `test/baselines/stellr-only-lists.json` |
| Tenant-destined Stellr-only routes | **0** | `MAX_TENANT_DESTINED_STELLR_ONLY` |
| IDOR unexercised / error | **0 / 1** | `test/idor/idor-routes.test.ts` |
| Tenant-host IDOR failing / unproven | **0 / 24** | `test/baselines/tenant-host-idor.json` (unproven only falls; growing it needs the `tenant-host-cap-grow` label) |
| Route manifest | 7 routes `platform_admin`, 2 still `platform_destined` (`events/slug-guard`, `schools/[id]`) | `lib/security/route-manifest.ts` |

## 4. Waiting on the owner

| Row | Ask | Recommendation |
|---|---|---|
| `s5-wave9.4` | Turn on `AUTHZ_SOURCE=shadow` on the production Vercel project, then watch `app_errors` for `authz_mismatch` for a week. Run `scripts/map-tenancy-roles.ts --check --production` immediately before | Start shadow now; sampling keeps the cost small. `postgres` only after a clean week |
| `s5-wave9.5` | BF-33: does the store catalogue get a tenant column, or is the store/checkout IDOR outcome accepted? | Accept for now: the store is Stellr-only and refuses tenants |
| `s5-wave9.6` | PR720-1: confirm the school directory stays tenantless | Yes; #842's onboarding case relies on it |
| `s5-wave9.7` | The 2 routes left `platform_destined`: `events/slug-guard` (Studio editors with the events duty) and `schools/[id]` (Staff hold `schools:write`) | Keep as they are |
| `s5-wave9.8` | Real tenant hosts: Vercel Pro (G1), the G5 subzone, Clerk session sharing, the cookie-domain review for production | Hold until a partner event is booked |
| `s5-wave9.9` | Confirm the temporary Clerk key `role-mapping-temp` is deleted | — |
| programme `.16` | Install the production backup routine | — |
| programme `.2` | Agent permission rules for the production migration Action | — |

## 5. Next work for a session, in order

1. **Read the dev `tenantDb` health** (`s5-wave9.2`). Signed in as a Stellr admin on dev, read `/api/admin/health/integrations` → `tenancy.tenantDb.config`. Both must say `ok`. If the URL fails, the owner re-stores `TENANT_DATABASE_URL` following `docs/TENANCY-S5-data.md`, "Owner steps". The password can be reset safely with `ALTER ROLE` on dev only. Then P7 to P9: set `TENANT_DB_AREAS=events-config` on dev, exercise the companies screen, and read the flip log signals.
2. **ENF-dev** (`s5-wave9.3`). If `public.tenancy_derivation_log` has no new rows after **2026-11-20 22:53Z** by **2026-11-27 22:53Z**, set `tenancy_settings.derivation_mode = 'enforce'` on the **dev** database only. Read `sample_key` before counting a row against the clock. Then K9.
3. **A10c / F10.** Unblocked now that `tenant_app_login` exists on dev (WD-3, WD-9 in `docs/S5-DECISION-REGISTER.md`).
4. **The last idiom.** `NavUserButton` needs a server-provided role to reach 0. Its parent `NavAccountMenu` renders on public pages with no server user, so this is a design question, not a quick swap (AUTHZ precondition 6).
5. **C18 leftovers:** the participant company move and Auto-Assign (`docs/TENANCY-S5-data.md`).
6. **Programme rows still open** in `tracker/2026-11-11-s5-programme.md`:
   - `.23`: consent resend and the desk marker;
   - `.24`: group check-in with one pending minor;
   - `.26`: the sweep change;
   - `.32`: the database "not ready" lock;
   - `.33`: one host-tenant check for emailed links;
   - `.34` and `.35`: production and dev proofs;
   - `.41`: the backfill entries not yet in the register.
7. **S6** (super-admin console, support mode, MFA, metering) runs alongside, per `W7-23`. Its draft is `docs/PLAN-S6-DRAFT.md`.

## 6. Not verified

- **No Staff session has opened `/admin/competitions` on production.** Tests prove the guard, but the live page was checked only signed out (404).
- **The connection canary's final result.** After a test company was added on dev, the canary's `RESULT PASS` was not confirmed. Every component passed: TLS, `verify-full`, the role and the tenant. The run before failed only on `NO_EVENT_COMPANIES`.
- **Whether `TENANT_DATABASE_URL` on dev holds the current password.** The clipboard was cleared around the paste. Row `.2` settles it.
- **The dev deployment carrying `TENANT_DB_ENABLED`.** A direct redeploy was refused by the permission check. Later merges into dev deploy it, but no one has read the health route since.

## 7. Things a new session should know

- **dev test data.** A row "Canary test company" (number 1) was added to `public.event_companies` for `seed-regional-challenge`, so the canary has a row to count. Leave it, or delete it if a test needs an empty table.
- **Merge timing.** Merges into `dev` while a promotion PR is open move its head, and GitHub refuses the owner's merge (it happened three times with #818). Hold dev merges while a promotion is open.
- **The tenant-host cap label.** If a PR grows a tenant-host cap, add the `tenant-host-cap-grow` label **before** CI runs. A label added afterwards needs a fresh push to be seen.
- **Parallel slices.** They regenerate the same baselines. After the first merges, merge dev into the next and regenerate the baseline with its generator; never resolve a baseline by hand.
- **Shell traps for owner instructions.** zsh expands `!` inside double quotes and `<…>` placeholders. Ship a script file instead of a one-liner (that is how the dev password was set).
- **The private handover** (`~/Documents/Claude/Handover/s5-wave8-pause-2026-11-16.md`) has the day-by-day log. This file is the public summary.
