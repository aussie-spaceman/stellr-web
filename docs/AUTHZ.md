# Authorisation: `lib/authz.ts`

One API for "who may do this", in place of the legacy guard idioms. This file covers the API, how today's roles map onto the S3 tables, what keeps those tables true, what must hold before `AUTHZ_SOURCE` changes, and how a route moves to a new class.

Plan of record: `docs/TENANCY-S5.md`. Built by C1, C5a, C6 and C9. Code wins over this file; if they disagree, fix this file.

## Vocabulary (13 Nov 2026)

"Staff" means only the Staff role, between Event Manager and Admin, which is being built next. The older meanings were renamed, and `npm run lint:staff-word` keeps it that way:

| Was | Now | Means |
|---|---|---|
| `staff_roles`, `STAFF_SCOPES`, `/admin/staff` "Staff roles" | `admin_duties`, `DUTY_SCOPES`, `/admin/duties` "Duties" | Which admins get which alerts and digests. Never portal access. |
| `tenant_role 'staff'` | `tenant_role 'duty_holder'` | The S3 mirror of an `admin_duties` row |
| "staff" for admin or event manager (`requireEventStaff`, `requireTenantStaff`, `tenant_staff`, `isStaffTarget`, `STAFF_CLERK_ROLES`) | **crew** (`requireEventCrew`, `requireTenantCrew`, `tenant_crew`, `isCrewTarget`, `CREW_CLERK_ROLES`) | Crew is admin, staff, event manager, volunteers and mentors; each helper admits the subset it names |
| `event_staff_check_ins`, `staff_key` | `event_crew_check_ins`, `crew_key` | Desk check-ins of volunteer mentors and event managers |
| staff inbox (`staffAlertEmail`) | team inbox (`teamInboxEmail`) | The shared mailbox admin alerts fall back to |
| `member_role_type 'staff'` | unchanged | Will mirror the Staff role; its backfilled rows were removed |

## Staff and capabilities (13 Nov 2026)

Staff is a portal role between Event Manager and Admin, **Stellr only**: the Clerk claim `staff` (clerk source) or a Stellr `tenant_memberships` row `staff` (postgres). A `staff` row on any other tenant grants nothing.

- **Portal:** Staff enters `/admin` (`decidePortalAccess`). `proxy.ts` sends Staff away from `STAFF_HIDDEN_ADMIN_PATHS`: view-as, `/admin/duties`, `/admin/members/access`, `/admin/privacy-requests`.
- **Events:** `decideEventAccess` gives Staff every Stellr event with `isAdmin: false`, so an admin-only branch inside an event route still refuses it.
- **Capabilities:** `lib/authz/capabilities.ts` names what each role may do. Admin holds all; Staff holds `STAFF_CAPABILITIES` (`portal:read`, `competitions:write`, `refunds:write`, `event_managers:assign`, `members:write`, `schools:write`, `volunteers:write`, `export`); everyone else none. Guard with `requireCapability(cap)`, `api.requireCapability(cap)` or `page.requireCapability(cap)`.
- **Fails closed:** every route still guarded by `isAdminClaims` / `isStellrAdmin` refuses Staff until it is converted to a capability, so a route nobody converted stays admin-only.
- **Converted (phase 3, 13 Nov 2026):** every admin page reads for Staff (`page.requireCapability('portal:read')` or `hasCapability('portal:read')`), except the hidden pages. In `/api/admin`, every GET Staff should see takes `portal:read`. Writes take their area's capability: members, schools, volunteers, assigning Event Managers, artwork and PD certificates, and surveys. Exports take `export`. Event routes already admitted Staff (every Stellr event, `isAdmin: false`); their admin-only branches now accept the area's capability, except the minor-agreement override, which stays admin-only. Clearance decisions (verify or unverify a teaching license or an uploaded check, removing an uploaded check, adjudication) take `clearance:verify`, which is admin-only. `test/staff-route-matrix.test.ts` reads every handler's capabilities from the code. It fails if an admin-only area accepts a Staff capability, or if a write uses a capability outside its area.
- **Granting** is `lib/staff.ts` (prerequisites: staff agreement, cleared background check, MFA, training); never set the claim by hand.

## Where it stands

**Routes now decide through `lib/authz`** (corrected 12 Nov 2026; this section used to say none did). The conversion slices since wave 3 moved them on: on `dev` at `82472e0d`, 89 files under `app/` import `@/lib/authz`, 71 of them under `app/api`, most often through `isStellrAdmin`, `requireEventRoute`, `authz`, `requireEventCrew` and `requireTenantCrew`. The role-sync helpers (`lib/authz/role-sync.ts`, `lib/authz/role-sync-report.ts`) still keep the tables in step from the duties and event-managers routes and `lib/deletion/execute.ts`. What that means:

- **Guards are mixed.** The converted ones decide through `lib/authz`; 190 legacy sites in 135 files (`test/baselines/authz-legacy-idioms.json`) still read the Clerk claim, `admin_duties` or `event_manager_assignments` directly, until the remaining slices (to C23) and C25.
- **`AUTHZ_SOURCE=shadow` now compares real decisions** on the converted routes, so a shadow window is evidence for those routes and silent on the legacy ones. Until a flip, `clerk` decides everywhere. `GET /api/admin/health/integrations` shows the resolved source as `tenancy.authzSource` (S5 wave 7, O1).
- **No shadow window has run in a hosted environment.** Wave 7's P3 is the first, a 7-day rehearsal on `dev` that starts counting only once the first expected canary mismatch row appears, which proves the switch took effect (`docs/TENANCY-S5.md`, Wave 7 status).

`npx tsx scripts/authz-idioms.mjs` measures what is left (`test/baselines/authz-legacy-idioms.json`). Authorisation has converged when that baseline reaches 0, at C25. The flip may be the first S6 step.

## The API

Import from `@/lib/authz`. `proxy.ts` must import from `@/lib/authz/decide`: `lib/authz.ts` is `server-only`, and the proxy may not add a database read.

| Call | Answers | Replaces |
|---|---|---|
| `getAuthzSource()` | the configured source, read per call | |
| `getPrincipal()` | who is asking. Under postgres, a failed lookup gives the signed-out principal | |
| `assertPlatformAdmin()` | `platform_admin` routes. Postgres: `platform_admins` only | |
| `assertTenantRole(tenantId, roles)` | holds one of `roles` in that tenant. A platform admin is not implied | |
| `requireStellrAdmin()`, `isStellrAdmin()` | a Stellr admin | `isAdminClaims`, `currentUserIsAdmin`, the admin-only wrappers |
| `requireTenantCrew(tenantId, roles)` | staff of a tenant. A platform admin passes Stellr, and another tenant only in S6 support mode | |
| `hasPortalAccess()` | may enter the admin shell: an admin or an event manager. Never `staff` | `hasAdminPortalAccess` |
| `requireEventAccess(slug?)` | the legacy return shape plus `tenantId`. `isAdmin` and `assignedSlugs: null` mean every event of that tenant, not every event | `lib/event-access.ts` |
| `accessCoversEvent(access, slug)` | does a section-level answer cover a row of this event? A read error is false | |
| `hasScope(scope)` | a staff scope, from `admin_duties`. Stellr only | `currentUserHasScope` |
| `isCrewTarget(target)` | is the target of view-as or deletion staff? A lookup error under postgres counts as staff, so the action is refused | `isCrewRole`, the set in `lib/deletion/external.ts` |
| `portalRoleFromClaims(claims)` | pure and database-free, for `proxy.ts` | the inline read in `proxy.ts` |
| `assertWritable()` | S6 support-mode placeholder. Always passes in S5 | |
| `page.requireAdmin()`, `page.requireTenantAdmin()`, `page.requireEventSection()`, `page.requireStellrAdmin()` | signed out goes to `/sign-in`; signed in without access gets `notFound()` | `requireAdminPage` |
| `api.requireStellrAdmin()`, `api.requireTenantCrew()`, `api.requireEventAccess()` | `{ ok, value }` or `{ ok: false, deny }` | |

Pass `{ route: '<route pattern>' }` as the options, so a shadow mismatch names the route. A concrete path never goes there.

Most conversions use the predicate form, so each route keeps its own deny response byte for byte. Deny shapes differ today (403 with different bodies, `redirect('/account')`, `notFound()`).

The decisions are pure functions in `lib/authz/decide.ts`. `lib/authz/equivalence.test.ts` runs each one against its legacy idiom over the whole truth table, in both sources. `lib/authz/two-tenant.test.ts` covers the second tenant.

## `AUTHZ_SOURCE`

| Value | Decides from | On a database error |
|---|---|---|
| `clerk`, unset, or anything unrecognised | the Clerk session claim, exactly as the legacy helpers do. Claim-only decisions add no database read | as legacy: an assignment read error throws, a scope read error is "no scope" |
| `shadow` | the Clerk claim. Also computes the postgres answer and logs any difference | the Clerk answer stands. The failure is logged. Nobody is denied by shadowing |
| `postgres` | `platform_admins` and `tenant_memberships`. Clerk supplies identity only | **denies** (403). `isCrewTarget` answers staff |

A set but unrecognised value uses `clerk` and writes one `authz_source_unrecognised` row to `app_errors`, because after a flip a typo would quietly restore Clerk's authority.

A mismatch goes to `app_errors` as `authz_mismatch <decision> member=<members.id> clerk=<answer> postgres=<answer>`, or `lookup_failed` or `error` in place of the two answers. The message holds fixed labels and a validated uuid only. The member is part of the digest, so each drifted member gets a row of their own. Writes share the `app_errors` rate limit.

**Shadow reads are not sampled.** Each shadowed decision runs the postgres read path as well (the principal is cached per request). The plan of record's risk note says "sampled and limited to admin"; `lib/authz.ts` has no sampling. So measure Active CPU when shadow goes on, and decide on sampling before any call site that serves ordinary members moves to `lib/authz`.

## Role mapping

`lib/tenancy/role-mapping.ts`. For Stellr the postgres rules are this table read backwards, so a complete, synced mapping gives the same answers as `clerk`.

| Today's authority | Row in the S3 tables | Written by |
|---|---|---|
| Clerk `publicMetadata.role = 'admin'` | `tenant_memberships` `tenant_admin` for Stellr | `scripts/set-admin.ts`, `scripts/map-tenancy-roles.ts --apply` |
| same | `platform_admins` | **Owner only:** `scripts/map-tenancy-roles.ts --apply --platform-admins` or the same flag on `scripts/set-admin.ts` |
| `event_manager_assignments.clerk_user_id` | `tenant_memberships` `event_manager`, one per person, not per event | `app/api/admin/event-managers/route.ts`, event deletion, `--apply` |
| `admin_duties.member_id` | `tenant_memberships` `duty_holder`, keyed by member | `app/api/admin/duties/route.ts`, `--apply` |

What the mapping does not carry, on purpose:

- **Per-event confinement.** The `event_manager` row says the person is one. `event_manager_assignments` still says which events, and it stays the authority. A row whose `tenant_id` is still NULL counts as Stellr's.
- **`admin_duties.scopes`.** Scopes stay in `admin_duties`, Stellr only, in both sources. Tenants get no scopes in release 1, and on another tenant's host no scope holds.
- **The portal.** `duty_holder` never opens `/admin`, in either source. Today an `admin_duties` holder without the Clerk claim cannot enter, and Stellr stays that way.

Who gets admin email is a separate question: `lib/authz/audiences.ts`, ready for B17. Stellr keeps its current sources whatever `AUTHZ_SOURCE` says.

## Keeping the tables true (C9)

`lib/authz/role-sync.ts` dual-writes alongside the event-manager and staff-role routes, event deletion and `scripts/set-admin.ts`. Under `clerk` nothing reads these rows, so no decision changes.

- The sync functions never throw. In a route, a failed write leaves the status and body alone. It goes to `console.error`, `app_errors` (which the daily digest emails) and `membership_sync: 'failed'` on the activity row, with fixed labels and a Postgres code only.
- `scripts/set-admin.ts` prints a warning and exits 2 when the row was not written. The Clerk change stands, so that a revoke never waits on a second system. Under `postgres` that person keeps access until the row is removed. Revisit this at C25, when Clerk stops being the authority.
- `.upsert()` cannot be used on `tenant_memberships`: both unique indexes are partial, and PostgREST's `on_conflict` cannot name a predicate, so Postgres answers 42P10. Each write reads, inserts, and takes a 23505 as success.

**The drift check:** `npx tsx scripts/map-tenancy-roles.ts --check`. It is read-only and exits 1 on drift. It fails on:

- a missing or stale Stellr membership;
- a `platform_admins` row with no Clerk admin role;
- a Clerk `event_manager` role with no assignment;
- an assignment with no Clerk portal role;
- another tenant's `event_manager` row and assignments that disagree.

A Clerk admin outside `platform_admins` is listed but does not fail: that list is the owner's decision. `--check` never repairs. `--apply` adds what is missing for Stellr; a stale row is for a person to read and remove. The output holds account ids, so it stays off the repo.

**Run it after any role change made another way, above all in the Clerk dashboard, and immediately before each `AUTHZ_SOURCE` change.** After C9, the owner gate is to stop assigning `admin` or `event_manager` in the dashboard, or to run `--check` after any change.

## What must hold before a flip

These come from C1's notes (the comments in `lib/authz.ts`, `lib/authz/decide.ts`, `lib/authz/principal.ts` and `lib/authz/tenant.ts`, and the C1 analysis), plus what C5a and C9 added. Each is open today.

**Before `shadow` on production:**

1. **Routes call `lib/authz`.** Otherwise the window is empty. Proof: `test/baselines/authz-legacy-idioms.json` has fallen for the areas you need covered, and on `dev` a deliberate drift (a Clerk `event_manager` role with no assignment, on a test account) writes an `authz_mismatch` row. Remove the drift afterwards. A window that cannot fail is not evidence.
2. **The drift check passes on dev, then production.** The drift is real. `lib/authz/equivalence.test.ts` pins it: under `postgres` a Clerk `event_manager` with no assignment loses the portal, and a stray assignment gains it. Admin and scope answers never move on unsynced data.
3. **The roles are mapped.** `scripts/map-tenancy-roles.ts --apply` on each environment. The owner decides `--platform-admins`.
4. **Active CPU has room.** Shadow is not sampled (above).

**Before `postgres` on production:**

5. **At least 7 clean days of `shadow` on production**, with real admin and event-manager traffic in the window: 0 `authz_mismatch` rows, including `lookup_failed`. Each `lookup_failed` would have been a denial under `postgres`, so a recurring one is a blocker, not noise.
6. **The ratchet is at 0.** A flip changes only callers of `lib/authz`. A legacy guard keeps trusting Clerk, so a partial flip leaves two authorities side by side.
7. **No page is left on `page.requireAdmin`.** It admits admins and event managers and does not confine an event manager. `proxy.ts` does that, from the Clerk claim. Under `postgres`, a claim of `admin` with only an `event_manager` row passes it and reaches every page using it. Each page moves to `requireStellrAdmin`, `requireTenantAdmin` or `requireEventSection`. The ratchet counts each use (`pageRequireAdmin`), so it cannot reach 0 while one is left.
8. **The `proxy.ts` prefilter is settled (B20, owner's choice).** The admin check in `proxy.ts` reads only the Clerk claim, and must stay database-free because it runs on every request. Under `postgres`, someone with a table role and no claim is bounced to `/account`, and event-manager confinement still follows the claim. Either sync the claim from Postgres, or relax the proxy to signed-in-only and rely on the page guards.
9. **The drift check passes immediately before the flip**, and stale rows have been read and removed. `--check` does not repair them, and under `postgres` a stale row grants access.
10. **The `platform_admins` list is decided, route by route.** Under `postgres` only that table passes `assertPlatformAdmin`. A route in the `platform_admin` class locks out every Clerk admin the owner leaves off the list, which is a visible change for Stellr.

**Before a second tenant has real events (these are separate from the flip, and each is a hard stop):**

11. **`AUTHZ_SOURCE=postgres` first.** The `clerk` source knows only Stellr and refuses any other tenant. It reads no `events` row, so it cannot see which tenant owns an event.
12. **`currentTenantId()` stops being a stub with its callers ready.** `lib/authz/tenant.ts` returns Stellr today. Before it returns anything else, every caller that trusts `isAdmin` or `assignedSlugs` on a row loaded by global id must be on `loadScoped` or `accessCoversEvent`.
13. **A mirror miss must deny.** `loadEventTenantId` answers Stellr when `events` has no row or a NULL `tenant_id`. That is safe only while every event is Stellr's. Role sync has the same blind spot: an assignment on an unmirrored event looks like a Stellr one.
14. **A `tenant_crew` route names the event.** `requireEventAccess()` without a slug passes an event manager with any or no assignment, so it counts as a `tenant` check only with a slug. Otherwise the route also calls `requireTenantCrew`.
15. **MFA for staff and tenant admins (S6).** `/admin` stays a 404 on tenant hosts until membership checks and MFA exist, because a Clerk role is valid on every host.

## The runbook

Each step is the owner's. Dev first, then production, one environment at a time, and choose a time away from a live event: under `postgres` a database outage denies staff, and shadow adds reads.

**Shadow**

1. `npx tsx scripts/map-tenancy-roles.ts --check`. Exit 0, or fix what it lists.
2. Set `AUTHZ_SOURCE=shadow` on the Vercel project and redeploy the newest READY deployment. A running deployment does not pick up a new value.
3. Sign in as an admin and as an event manager, and open an event in the admin screens.
4. Read the mismatch rows. Keep the output off the repo.

```sql
SELECT route, message, count, occurred_at, last_seen
FROM public.app_errors
WHERE message LIKE 'authz\_%'
ORDER BY last_seen DESC;
```

**Check**

Watch for at least 7 days on production with real traffic. For each row, decide whether the table or Clerk is wrong, fix it, and run `--check`. A fix restarts the 7 days.

**Flip**

1. Confirm preconditions 5 to 10, and that the owner has read the report.
2. Run `--check` again.
3. Set `AUTHZ_SOURCE=postgres` and redeploy the newest READY deployment. Dev first, with a pass through the admin and event-manager screens.
4. Confirm an admin reaches `/admin`, an event manager reaches only their events, and a member does not reach `/admin`.

**Roll back**

Set `AUTHZ_SOURCE=clerk` (or remove it) and redeploy. This works because `scripts/set-admin.ts` and the Clerk dashboard still hold the Clerk roles. C25 deletes the legacy helpers; do not treat that as reversible with this switch alone.

## The authz codemod

**Not built yet (C10).** `ts-morph` is awaiting the owner's approval; the fallback is the TypeScript compiler API, which `lib/security/route-ast.ts` and `scripts/codemods/events-facade.ts` already use. The events-facade codemod is the working model: dry run by default, and a second run reports nothing to change.

The planned transforms:

| | Change |
|---|---|
| T1 | `isAdminClaims` and the inline role read become an authz predicate. The if-branch and response stay |
| T2 | `currentUserIsAdmin()` becomes the authz call |
| T3 | Same-file `requireAdmin` or `isAdmin` wrappers are inlined and deleted |
| T4 | `requireAdminPage()` becomes `page.requireAdmin()`. Not progress on its own: the ratchet keeps counting it |
| T5 | `requireEventAccess` is re-pointed at `lib/authz`. The shape is unchanged |
| T6 | Domain wrappers (`requireScholarshipAdmin`, `requireSurveyAdmin`, `canManageStoreCatalog`, `adminName`) are re-implemented over authz in their own files. Their callers then drop out of the ratchet |
| T7 | Test mocks move to `@/lib/authz` |

Anything it cannot match is reported, never rewritten. It runs on one feature area per PR, and a person adds `loadScoped` or `tenantDb`, the events facade, audit and the two-tenant tests in the same PR.

## Moving a route to another class

`lib/security/route-manifest.ts` holds the class. `lib/security/route-guards.ts` says what each class must reach.

| Class | Must reach | Satisfied by |
|---|---|---|
| `platform_admin` | `platform` | `assertPlatformAdmin` |
| `tenant_crew` | `tenant` | `assertTenantRole`, `requireTenantCrew`, `requireEventAccess` with a slug, `page.requireTenantAdmin` |
| `stellr_only` | `admin` | the legacy admin checks, and `requireStellrAdmin`, `isStellrAdmin`, `hasPortalAccess`, `hasScope`, `page.requireAdmin`, `page.requireEventSection` |

A platform check also counts as an admin check, and an admin or tenant check counts as a session check. Never the other way round: holding a role in some tenant does not make anyone a Stellr admin. A legacy admin check never meets `tenant` or `platform`, so a moved route fails the static check until it really calls the new guard.

A `lib/authz` call counts only when it is awaited and its answer is used, and a tenant check on a tenant taken from the request does not count. `isCrewTarget` and `accessCoversEvent` are not guards: they do not decide whether the caller gets in.

The static check cannot see whether the tenant asked about is the tenant of the row the handler then touches. That is what the IDOR tenant personas test (C6), so the static check alone is never enough to move a route.

In the PR that moves a route:

1. Change its class in `route-manifest.ts`, and update its entry in `lib/security/stellr-only-dispositions.ts`. `MAX_TENANT_DESTINED_STELLR_ONLY` only falls.
2. Keep each file's deny response as it is.
3. Do not call `.from()` directly on a table with a tenant column from a `tenant_crew` file. A route-manifest test fails on it. Use `loadScoped` or `tenantDb`.
4. Regenerate with `npm run idor:snapshot`, and read the diff. The staff personas run strict over these classes, with no accepted reason possible: a leak, honey write or 4xx oracle fails.
5. Add `audit()` and regenerate `unaudited-mutations.json` (`npx tsx scripts/s5-inventory.mjs --write`).
6. Shrink the legacy baseline (`npx tsx scripts/authz-idioms.mjs --write`).

If a count must rise, that takes `--allow-grow` and the `authz-ratchet-grow` PR label. The label needs only triage access, and `.github/CODEOWNERS` requests review without requiring it until the owner's ruleset does. Both are recorded as owner decisions in `docs/TENANCY-S5.md`.

While the source is `clerk`, moving a route does not change who gets in from Stellr: the Clerk `admin` claim passes `assertPlatformAdmin`, and the `admin` and `event_manager` claims map to `tenant_admin` and `event_manager` for Stellr only. The visible change comes at the flip.
