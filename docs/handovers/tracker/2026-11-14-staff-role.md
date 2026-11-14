# The Staff role — 2026-11-14

Slug: `staff-role`. Handover: `HANDOVER-staff-role-2026-11-14.md`. Doc snapshot: `1MAYjexSvD_pzE9gbq9BYXZjeRNsqVJyn5U3Z9FIG7MI`.
PRs #663 (`bac59d66`), #672 (`9b288d37`), #673 (`a0d20a93`), #674 (`4d11572b`), #676 (`76be50f3`), #678 (`3927c1ca`) → `dev`; not promoted. Migrations: `20261113120000`, `20261113200000`, `20261113210000`, `20261114090000` (dev only).

Staff (Stellr only, between Event Manager and Admin) reads the admin portal and changes Competitions and Members once an admin grants it and five prerequisites hold; "staff" now means only this role (Duties and crew replaced the old meanings).

| # | Item | State | Next | Done |
|---|---|---|---|---|
| staff-role.1 | No existing Clerk user holds `role='staff'` in production | Dev counted 14 Nov: 0 (2 admin, 1 event_manager, 12 none). Production not checked | Count production Clerk users by `publicMetadata.role` (counts only) before promoting #672 | ☐ |
| staff-role.2 | The four migrations on production | Applied on dev, ledger aligned; not on production | Promote: apply `20261113120000`, `20261113200000`, `20261113210000`, `20261114090000` before the code, outside event hours, with the owner's yes | ☐ |
| staff-role.3 | Platform audit chain on | `PLATFORM_AUDIT_ENABLED` unset on both Vercel projects (checked by name, 14 Nov); `record_access_log` does not depend on it | Owner decides; set on dev first, then production | ☐ |
| staff-role.4 | Staff agreement published | Template key `staff` wired (native only, version `staff-1`); placeholder field map `staff-v1.fields.json`; no PDF published; wording drafted outside the repo | Upload and approve the PDF in Admin → Agreement documents, key `staff` | ☐ |
| staff-role.5 | Staff training module chosen | `staff_role_settings.training_module_id` null on dev; nobody can activate until set | Build or pick the Academy module (safeguarding, privacy, mandated reporting) and choose it in the Staff panel | ☐ |
| staff-role.6 | Compatibility views dropped | `staff_roles` and `event_staff_check_ins` views exist on dev | One release after the rename reaches production, a migration drops both | ☐ |
| staff-role.7 | Purge jobs for the append-only tables | `record_access_log` (3 years) and ended `staff_grants` (7 years) in the retention schedule (rows 35–36); no job; the log refuses DELETE | Add a dedicated purge function and cron | ☐ |
| staff-role.8 | Activation mirrors `member_roles 'staff'` | Not built: `lib/staff.ts` writes the Clerk role and `tenant_memberships` only; community spaces with "Staff" visibility don't open for Staff | Grant and remove `member_roles` role `staff` in `reconcileStaffGrant` and `revokeStaff`, with tests | ☐ |
| staff-role.9 | Admin-only buttons hidden for Staff everywhere | Hidden on the member page only; other pages Staff read (scholarships, store, community, academy, e-sign) still show write buttons the API refuses | Pass capabilities to those components (layout already knows the role) | ☐ |
| staff-role.10 | Staff named correctly in every actor label | Fixed in activity log and five routes; registration invoice and participant routes still say `event_manager`/`member`; `esign_access_log` says `admin` (actorId identifies) | Use `crewActorType()` in those routes; widen `esign_access_log` actor type | ☐ |
| staff-role.11 | Counsel questions answered | Listed in `docs/compliance/staff-role-review.md` | Owner sends to counsel | ☐ |
| staff-role.12 | Per-role session lifetime and idle timeout | Clerk sets these instance-wide; not built | Check the Clerk plan for per-user limits | ☐ |
| staff-role.13 | First live run on dev | Not run: no Staff grant exists | After .4 and .5: grant a test member; sign, train, MFA; see it activate; turn MFA off and see it pause; revoke | ☐ |
