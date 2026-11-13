# Handover: the Staff role (13–14 Nov 2026)

**Merged to `dev`; none of it is promoted.** Phases 0–5 are on `dev` (head `3927c1ca`). The owner is promoting in a separate session. Four migrations are applied to the **dev** database only.

## Context

The owner asked for a new role, **Staff**, between Event Manager (a volunteer for one event) and Admin (the whole tenancy), for the Stellr tenancy only.
- **Who Staff are:** paid staff, or highly engaged volunteers who are essentially unpaid staff.
- **What they can do:**
  - read the whole admin portal;
  - read and write everything in Competitions and Members;
  - see all events and member data.
- **Condition:** a staff-specific agreement is signed before access starts.

The session did these things, in order:
1. A public review of leading practice and law (PII, minors, security).
2. Read the codebase.
3. Asked the owner 15 scoping questions; their decisions are in the plan.
4. Wrote a 6-phase plan.
5. Shipped every phase to `dev`.

- Plan and progress log (private): `~/Documents/Claude/Handover/staff-role-2026-11-13/PLAN.md`.
- Research brief: `docs/compliance/staff-role-review.md`.
- Runbook: `docs/RUNBOOK-staff-role.md`.
- Design: `docs/AUTHZ.md` (Vocabulary; Staff and capabilities).

### Owner decisions (13 Nov)

- **Names:** "staff" means only the new role. The old meanings were renamed: Duties, and **crew** (admin, staff, event manager, volunteers, mentors).
- **Staff write:**
  - member records, schools, volunteers;
  - events, rosters, check-in, event emails, surveys;
  - assigning Event Managers;
  - refunds and payment changes.
- **Staff exports:** the same as an admin, every export logged, no step-up (an accepted risk).
- **Prerequisites:** the Staff agreement, a cleared background check, MFA, and the Staff training. **Term:** 3 years.
- **Hidden from Staff:** view-as, role-management pages, privacy requests.
- **Granting:** an admin-only panel on the member page.
- **Read logging:** every view of a minor's record is logged, by IDs only.
- **Agreement text:** being drafted outside the repo (Cowork).

**Defaults this session set, which the owner can override.** All of these stay admin-only:
- clearance decisions: verifying or unverifying a license or uploaded check, removing an uploaded check, adjudication;
- deleting or merging members;
- Staff, Admin and Duties grants;
- scholarship decisions, the store catalogue, Community, Academy, e-sign and email-campaign writes;
- the survey minor-agreement override.

## What changed (PRs to `dev`)

| Phase | PR | Merge | What |
|---|---|---|---|
| 0 | #663 | `bac59d66` | "staff" freed. `staff_roles` became `admin_duties` (Duties). `tenant_role 'staff'` became `'duty_holder'`. Generic staff became crew (`requireEventCrew`, `tenant_crew`, `isCrewTarget`, `event_crew_check_ins`). The shared inbox is now the team inbox. Migration `20261113120000` with compatibility views. `lint:staff-word`. |
| 1 | #672 | `9b288d37` | Staff is a portal role (Clerk claim `staff`, Stellr only). `lib/authz/capabilities.ts` is deny by default. `STAFF_HIDDEN_ADMIN_PATHS` in `proxy.ts`. Migration `20261113200000` (`tenant_role 'staff'`). |
| 2 | #673 | `a0d20a93` | `staff_grants` and `staff_role_settings`, plus envelope type `staff` (migration `20261113210000`). `lib/staff.ts`: grant, reconcile, revoke, sweep. Staff agreement on the native engine. Hooks. `app/api/admin/members/[id]/staff`. `lint:staff-word` now refuses retired names. |
| 3 | #674 | `4d11572b` | Every admin route and page takes its capability. New admin-only `store:write`. `test/staff-route-matrix.test.ts`. |
| 4 | #676 | `76be50f3` | `record_access_log`, append-only, IDs only (migration `20261114090000`). Activity-log actor `'staff'`. Exports audited. Staff section in the Friday digest. |
| 5 | #678 | `3927c1ca` | Staff panel on the member page. `app/api/admin/staff-settings`. Admin-only controls hidden on the member page. Runbook, research brief and compliance docs. |

Migrations on **dev** (ledger aligned): `20261113120000`, `20261113200000`, `20261113210000`, `20261114090000`.

Checks on dev:
- Old-name compatibility views read and upsert correctly.
- `staff_grants` and `record_access_log` are unreadable to `anon` and `authenticated`.
- `record_access_log` refuses UPDATE and DELETE even to the service role.
- The dev Clerk instance had no user with `role='staff'` (counts only).

## Not verified

- **No live Staff session.** No one holds Staff on dev, and the UI (panel, sidebar, hidden controls) wasn't seen in a browser. CI's e2e suites render the admin member page.
- **The end-to-end activation path hasn't run on real data:** grant, agreement signed, training completed, MFA on, activate, suspend, revoke. It's covered by unit tests with an in-memory database and a fake Clerk.
- **Production Clerk** hasn't been checked for an existing `role='staff'`.

## Open items

Rows are in `tracker/2026-11-14-staff-role.md`.

- `staff-role.1`: production Clerk `role='staff'` count before promoting phase 1.
- `staff-role.2`: the four migrations on production, before the code.
- `staff-role.3`: the `PLATFORM_AUDIT_ENABLED` decision. It's unset on both Vercel projects, so the audit chain is off.
- `staff-role.4`: publish the `staff` agreement template (Cowork text).
- `staff-role.5`: choose the Staff training module.
- `staff-role.6`: drop the compatibility views a release after the rename reaches production.
- `staff-role.7`: purge jobs for `record_access_log` (3 years) and ended `staff_grants` (7 years).
- `staff-role.8` (a **gap**): activation doesn't mirror `member_roles 'staff'`, which the plan called for. Community spaces marked "Staff" therefore don't open for Staff.
- `staff-role.9`: admin-only buttons are hidden for Staff only on the member page. Other pages Staff can read still show write buttons, which the API refuses.
- `staff-role.10`: some actor labels are still wrong for Staff. Registration invoice and participant routes record Staff as `event_manager` or `member`. `esign_access_log` records Staff downloads as `admin`, though `actorId` identifies the person.
- `staff-role.11`: counsel questions in `docs/compliance/staff-role-review.md`: COPPA applicability, FERPA, SOPIPA-style operator status, NRS 432A.710.
- `staff-role.12`: a per-role Clerk session lifetime and idle timeout (NIST 800-63B-4), which depends on the Clerk plan.
- `staff-role.13`: a first live run on dev: grant a test member, then sign, train, add MFA, activate, suspend and revoke.
