# Tenancy S5: data path, loadScoped and audit runbook

What `LOADSCOPED_MODE`, `TENANT_DB_ENABLED`, `TENANT_DB_AREAS`, `TENANT_DATABASE_URL` and `PLATFORM_AUDIT_ENABLED` do, the order to flip them, the owner's steps for the tenant login, and how to roll each one back. This is D4 in `docs/TENANCY-S5.md`, which stays the plan of record. Checked against the code on 9 Nov 2026: `dev` at `b620a113`, with all of wave 5 merged (B14 #588, A7 #594, and C16's payment-method follow-up, C11 and C12 in #598). None of wave 5 is on production. If the code and this file disagree, the code wins and this file is fixed.

Sibling records: `docs/AUTHZ.md` (`AUTHZ_SOURCE`), `docs/TENANCY-S5-routing.md` (`TENANT_ROUTING_ENABLED`), `docs/S5-CRONS-LIMITS-SMMA.md` (`RATE_LIMIT_STORE`, the crons and the mail share), `docs/TENANCY-S4.md` (`tenantDb` and the `tenant_app` role), `docs/PLATFORM-AUDIT.md` (the audit table). Names and defaults of every variable: `docs/ENV-MATRIX.md`, section 6.

## Where it stands

**Unset is correct on both Vercel projects today.** With every variable here unset, Stellr runs exactly the queries it ran before S5, writes no audit row and opens no tenant connection. Nothing in the S5 PRs sets one. **No route reads or writes through `tenantDb` yet,** so `TENANT_DB_ENABLED`, `TENANT_DB_AREAS` and `TENANT_DATABASE_URL` change nothing until C18 converts the first area.

| Variable | Read by | Unset | Other values | Reaches today |
|---|---|---|---|---|
| `LOADSCOPED_MODE` | `lib/tenancy/load-scoped-mode.ts`, through `loadRecord` and `loadEventRecord` in `lib/tenancy/load-scoped.ts` | `off`: today's query by id, nothing else | `shadow`, `enforce`. Anything else is `off`, reported once per instance to `app_errors` | The `tenant_staff` routes that load a record by id: C16's, C17's under `events/[slug]`, the refund preview (`lib/refunds/preview.ts`), and in wave 5 the admin group payment-method route |
| `TENANT_DB_ENABLED` | `lib/tenancy/db.ts`, and the area switch in `lib/tenancy/area-switch.ts` | `tenantDb` throws before anything connects; every area answers `service` | Exactly `true` | Nothing: no route calls `tenantDb`, `readArea` or `writeArea` |
| `TENANT_DB_AREAS` | `lib/tenancy/area-switch.ts` | Every area `service` | Comma-separated `<area>:shadow`, `<area>:shadow:<rate>` (0 to 1, default 1), `<area>:tenant`. Only `events-config` is declared | Nothing until C18 |
| `TENANT_DATABASE_URL` | `lib/tenancy/driver.ts`, loaded by `db.ts` only when `TENANT_DB_ENABLED` is `true` and no test driver is registered | With the flag on, `tenantDb` throws: there is no fallback connection | The `tenant_app_login` pooler URL (owner steps below) | Nothing until the flag is on and a caller exists |
| `PLATFORM_AUDIT_ENABLED` | `lib/audit/platform.ts`, `lib/audit/route.ts`, `lib/cron-audit.ts` | No audit row, no session read, nothing scheduled | Exactly `true` | Every handler the audit gate counts as audited (see below) |

### `LOADSCOPED_MODE`

`loadScoped` loads one row by id only if it belongs to the caller's scope. The mode applies to **Stellr's own tenant-wide scope only**, which is what a Stellr admin runs as:

- `off`: the legacy query, unchanged. The scope is not planned.
- `shadow`: both queries run, the legacy result answers, and any difference (found against not found, or a different row) goes to `app_errors` with the route label `LOADSCOPED <route>` and the message `loadScoped shadow mismatch: <table> <reason>`. It never throws for the scope. Each converted call makes a second query.
- `enforce`: the scoped query alone. In Stellr scope, while the S3 derivation runs in log mode, derived tables also match `tenant_id IS NULL`, so Stellr keeps every row it sees today.

**Every other scope always runs as `enforce`, whatever the mode says:** another tenant's staff, and an event manager narrowed to their events. So an event manager naming another event's record already gets the route's own 404 on `dev` (wave 4, C16). Flipping the mode changes only what Stellr's admins get.

A missing row, a malformed id, another tenant's row and another event's row all get the route's own 404, built fresh each time. `GET /api/admin/health/integrations` reports the resolved mode as `loadScopedMode`.

### `TENANT_DB_ENABLED` and `TENANT_DATABASE_URL`

`tenantDb(tenantId)` runs each call in its own transaction as `tenant_app`, a role that does not bypass row level security, with the tenant pinned transaction-locally and read back before and after every statement (`docs/TENANCY-S4.md`, "How a tenant transaction runs"). Since C11 the transport is postgres.js (3.4.9, owner-approved on 9 Nov 2026), in `lib/tenancy/driver.ts`:

- **Loaded only on demand.** With the flag off nothing imports postgres.js and nothing connects. With it on, `db.ts` loads the driver on first use.
- **One connection string, checked before use.** It must be a `postgres://` or `postgresql://` URL whose user is `tenant_app_login`, or the pooler's `tenant_app_login.<project-ref>`. It must name one user and one host (a host name or IPv4 address, not IPv6) and carry no query parameter except `sslmode`. Anything else throws an error that names the rule and never echoes the string. A pasted owner or service connection string is refused.
- **TLS.** Required for any host other than `localhost` or `127.0.0.1`. By default the connection is encrypted but the server's certificate is not checked. `sslmode=verify-full` in the URL asks Node to check the certificate against its default trust store; the code has no setting to supply Supabase's root CA, and whether `verify-full` connects to the pooler has not been tried. Which of the two to require is an open owner decision (wave 5).
- **Pool.** At most 3 connections per server instance, idle connections closed after 20 s, every connection replaced after 5 minutes, 10 s to connect, `prepare: false` for the pooler's transaction mode, every statement on the extended protocol so the server runs one statement per call.
- **No service-role fallback.** A missing or refused URL is a thrown `TenantContextError`.

### `TENANT_DB_AREAS`

The per-area switch (C12) decides, per area and per call, which path answers. It reads `TENANT_DB_ENABLED` too: with that flag off every area is `service` whatever this says.

- `service`: today's read only. The tenant read is not even built.
- `shadow`: today's read answers. For the sampled share of calls the `tenantDb` read runs **after the response**, read-only (`SET TRANSACTION READ ONLY`, read back after the pin), at most 2 at a time per instance, with a 5 s timeout. The service rows are hashed when the request answers, and the two are compared ignoring row order and the usual differences between the two clients. A difference goes to `app_errors` as `tenantdb_shadow_mismatch area=… reason=…` with counts and ids only, never row content. The reasons are `count`, `ids`, `content`, `tenant_error`, `timeout` and `no_tenant`. Shadow writes go through the service path alone, so nothing is written twice.
- `tenant`: the `tenantDb` read or write alone. A failure is the request's failure. There is no fallback to the service path.

An entry that does not parse, names an undeclared area, gives a rate to `tenant`, or repeats an area is ignored, so its area stays on `service`. Ignored entries are reported once per instance as `CONFIG TENANT_DB_AREAS`, by count only.

### `PLATFORM_AUDIT_ENABLED`

With it on, each audited handler appends one row to `platform_audit_events`, the append-only, hash-chained table in `docs/PLATFORM-AUDIT.md`. Who is audited by now: the C7 mechanism; wave 3's A14, B12 (every cron) and B18; wave 4's B16 (54 member and community handlers), C13 (42), C15 (7), C16 and C17; and in wave 5 the 5 register routes (A7; pay and pay-seat record a payment start only when a Checkout was tried) and the admin group payment-method GET and POST (the POST records the method and, for "Invoice for some", a participant count, never ids). What is still unaudited is `test/baselines/unaudited-mutations.json`, regenerated at each merge: on `dev` at `b620a113`, 123 mutating handlers and 6 GET writers, with every one of the 24 crons audited.

What it costs and what it cannot do:

- **Most live paths write after the response** (`runAfterResponse`), so a row can be lost with its instance. An audit failure never changes a response.
- **Routes with `{ session: true }`** read Clerk's session inside `after()`. That is not yet proven on a real request: if it cannot read it, the row says `actor_unresolved`. Wave 3's routes and C13's 42 handlers use it.
- **Crons write no event outside production**, even with the flag on (`lib/cron-audit.ts`). The cron proof is the first production `cron.run.finish` rows checked against that day's `cron_runs` (query in `docs/S5-CRONS-LIMITS-SMMA.md`, "Cron audit").
- **Chains.** The register routes, C15's seven events and B16's member rows all go on Stellr's chain until the owner decides otherwise; a register row for another tenant's event carries `event_tenant_id` in its metadata. Crons go on the platform chain. **A row on the wrong chain cannot be moved or removed**, so the chain decisions come before the production flip.
- **Size.** Watch the table against Supabase Free's 500 MB. There is no retention path yet.

## Before any flip

1. **S4 state on production.** `20261104200000`, `210000`, `300000` and `400000` are applied, and `tenancy_cutover_checks` Section D shows 0 NULL `tenant_id` (`docs/TENANCY-S5.md`, Owner gates). Needed before `LOADSCOPED_MODE=enforce` or any area on `tenant`.
2. **One variable at a time, `dev` first, then production.** After each change, redeploy the newest READY deployment: a running deployment does not pick up a new value.
3. **Outside event hours**, and with Active CPU read on the Vercel Usage page before and after.
4. **Proof by step outcome, not badge.** The CI `tenant-db` job is report-only (`continue-on-error: true`), so it can look green and still have failed.

## The order

A proposal for the owner. The plan fixes no order between these flags; the reasons are given so a different order can be chosen knowingly.

| Step | Where | What | Why here |
|---|---|---|---|
| 1 | `dev` | `PLATFORM_AUDIT_ENABLED=true` | It changes no response, and once on it records the admin actions made during the later flips. Check one real row from a `{ session: true }` route and from a register route, then `npx tsx scripts/verify-audit-chain.ts` exits 0 |
| 2 | `dev` | `LOADSCOPED_MODE=shadow` | The scoped read beside the legacy one. Use the admin record screens (refund preview, correct-recipient, group payment method), then read `app_errors` for `LOADSCOPED` rows: expect none |
| 3 | `dev` | `LOADSCOPED_MODE=enforce` | Only after a clean shadow. A mismatch here points at a row stamped with the wrong tenant or none, which RLS would trip over later too, so it is cheaper to find first |
| 4 | production | `LOADSCOPED_MODE=shadow`, then `enforce` | After step 1 of "Before any flip". The plan sets no shadow length for this flag; the owner chooses one |
| 5 | `dev`, then production | Create `tenant_app_login` and `TENANT_DATABASE_URL` (owner steps below) | Inert until step 6. Settle the TLS decision first |
| 6 | `dev` | `TENANT_DB_ENABLED=true` | Only when C18 ships the first caller (`docs/TENANCY-S4.md`, owner actions). With no area listed it still changes nothing |
| 7 | `dev` | `TENANT_DB_AREAS=events-config:shadow:<low rate>` | C18's area. Start low and read Active CPU before raising the rate: each sampled call adds a transaction after the response. Read `TENANTDB` rows in `app_errors` |
| 8 | `dev` | `events-config:shadow:1`, then `events-config:tenant` | After a clean sampled shadow |
| 9 | production | Steps 6 to 8 again | After `dev` holds |
| 10 | production | `PLATFORM_AUDIT_ENABLED=true` | Whenever its own decisions are made (below). It does not depend on, or block, steps 2 to 9 |

**Decisions to settle before step 10** (all listed under the owner decisions of waves 3 and 4 in `docs/TENANCY-S5.md`): consent audit rows and the purge (A14, extended to C13 and C15's member and erased-person uuids); the limits on upload signing (A14); the `store/checkout` route limit (B18); the cost of an extra `auth()` call and `after()` write per audited member request, and whether read-like GETs are audited at all (B16); which chain a member's registration rows (B16) and C15's seven events go on.

## Owner steps: `tenant_app_login` and `TENANT_DATABASE_URL`

Needed only for a deployed `tenantDb` flip, not to build, merge or run CI. Do `dev` first, then production, each on its own Supabase project and its own Vercel project.

1. **Create the login.** In the Supabase SQL editor, as `postgres`:

   ```sql
   CREATE ROLE tenant_app_login LOGIN NOINHERIT PASSWORD '<generated, at least 32 random bytes>';
   GRANT tenant_app TO tenant_app_login;
   ```

   Generate the password locally and paste it once. Never print it, commit it or put it in a ticket.
2. **Build the connection string** from the project's pooler settings: transaction mode (port 6543), user `tenant_app_login.<project-ref>`, database `postgres`. Then make it pass the driver's checks:
   - **Remove every query parameter except `sslmode`.** A string copied with `pgbouncer=true` or similar is refused.
   - Percent-encode any `@`, `,` or `%` in the password.
   - Add `?sslmode=verify-full` only if the owner chose certificate checking (wave 5 decision), and only after it has been tried on `dev`.
3. **Store it in Vercel** as `TENANT_DATABASE_URL`, a server-only secret, never under a `NEXT_PUBLIC_` name. `dev`'s string on the `dev` project, production's on production.
4. **Confirm the pooler's client limit** on the plan page (`docs/S4-SPIKE.md`, section 2). Each instance opens at most 3 connections.
5. **Leave `TENANT_DB_ENABLED` unset** until step 6 of the order.

**Rotating the password.** `ALTER ROLE tenant_app_login PASSWORD '<new>';` in the SQL editor, update `TENANT_DATABASE_URL`, redeploy the newest READY deployment straight away. Connections already open stay up until they are replaced (at most 5 minutes); new ones fail on the old password until the redeploy.

## Rollback

Each rollback is the variable unset (or set back) and a redeploy of the newest READY deployment. None of these paths deletes data.

| Variable | Rollback | What it leaves behind |
|---|---|---|
| `LOADSCOPED_MODE` | Unset (`off`) | Nothing: `loadScoped` only reads. Another tenant's staff and event managers stay on `enforce`, as they are whatever the mode |
| `TENANT_DB_AREAS` | Remove the area's entry, or the whole variable | Rows written in `tenant` mode stay; they are ordinary rows in the same tables. Shadow never wrote through `tenantDb` |
| `TENANT_DB_ENABLED` | Unset | Every area falls back to `service`. Any caller that used `tenantDb` directly rather than through `readArea` or `writeArea` now fails closed, so a slice that adds such a caller states its own rollback |
| `TENANT_DATABASE_URL` | Unset the flag first (above). To stop the login without a redeploy: `ALTER ROLE tenant_app_login NOLOGIN;` in the SQL editor, which refuses new connections; open ones end within the 5-minute lifetime, or terminate them from `pg_stat_activity` where `usename = 'tenant_app_login'` | With the flag still on, `tenantDb` callers fail closed until it is unset |
| `PLATFORM_AUDIT_ENABLED` | Unset | **Every row already written stays.** The table is append-only: removing a row needs the owner to disable its trigger, and leaves a gap the chain check shows. Stopping the flag stops new rows only |

## What is not yet proven

- **`tenant-db` as a gate.** Its first run against a real database, on #598, passed every step, including "Two tenants through the real driver": `test/integration/tenant-db.int.test.ts` and the two-tenant kit's test, with the read-only shadow path (`SET TRANSACTION READ ONLY` before the role, then the read-back). It is still report-only, so a later failure blocks nothing until the owner makes it required.
- **The driver against a hosted pooler.** CI connects to a local database on `127.0.0.1`, where the driver uses no TLS, so CI has tried neither TLS mode; `sslmode=verify-full` against the pooler has not been tried.
- **The audit actor read inside `after()`**: one real row on `dev` per route kind, before production.
- **C16's scope check on a deployment**: one admin call to a `loadRecord` route and one by an event manager inside their event on `dev`, reading `loadScopedMode` on the health route (wave 4, still open).
