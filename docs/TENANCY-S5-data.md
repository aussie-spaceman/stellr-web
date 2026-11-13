# Tenancy S5: data path, loadScoped and audit runbook

What `LOADSCOPED_MODE`, `TENANT_DB_ENABLED`, `TENANT_DB_AREAS`, `TENANT_DATABASE_URL`, `TENANT_DATABASE_CA_CERT` and `PLATFORM_AUDIT_ENABLED` do, the order to flip them, the owner's steps for the tenant login, and how to roll each one back. This is D4 in `docs/TENANCY-S5.md`, which stays the plan of record. Checked against the code on 9 Nov 2026: `dev` at `b620a113`, with all of wave 5 merged (B14 #588, A7 #594, and C16's payment-method follow-up, C11 and C12 in #598). Updated on 11 Nov 2026 for wave 6's C11t and C18 (Lane C, #624) and Lane A's audited routes (#625), read on `dev` at `b8c1fba3`. **Since promoted:** wave 5, in #600 on 9 Nov 2026; wave 6's Lanes A and C, in #643 (`5d18d321`) on 12 Nov 2026. Updated on 12 Nov 2026 for wave 7's O1 (#654), O3 (#658) and C20c (#648), read on `dev` at `82472e0d`; wave 7 is on `dev` only, not promoted. If the code and this file disagree, the code wins and this file is fixed.

Sibling records: `docs/AUTHZ.md` (`AUTHZ_SOURCE`), `docs/TENANCY-S5-routing.md` (`TENANT_ROUTING_ENABLED`), `docs/S5-CRONS-LIMITS-SMMA.md` (`RATE_LIMIT_STORE`, the crons and the mail share), `docs/TENANCY-S4.md` (`tenantDb` and the `tenant_app` role), `docs/PLATFORM-AUDIT.md` (the audit table). Names and defaults of every variable: `docs/ENV-MATRIX.md`, section 6.

## Where it stands

**Unset is correct on both Vercel projects today.** With every variable here unset, Stellr runs exactly the queries it ran before S5, writes no audit row and opens no tenant connection. Nothing in the S5 PRs sets one. **C18 (wave 6, #624, on production since #643 on 12 Nov 2026) converts the first area,** `events-config`: an event's companies under `app/api/admin/events/[slug]/companies` reach `tenantDb` through `readArea` and `writeArea`, and only when `TENANT_DB_ENABLED` is `true` and `TENANT_DB_AREAS` lists the area. With those two unset, `TENANT_DB_ENABLED`, `TENANT_DB_AREAS`, `TENANT_DATABASE_URL` and `TENANT_DATABASE_CA_CERT` change nothing.

| Variable | Read by | Unset | Other values | Reaches today |
|---|---|---|---|---|
| `LOADSCOPED_MODE` | `lib/tenancy/load-scoped-mode.ts`, through `loadRecord` and `loadEventRecord` in `lib/tenancy/load-scoped.ts` | `off`: today's query by id, nothing else | `shadow`, `enforce`. Anything else is `off`, reported once per instance to `app_errors` | The `tenant_crew` routes that load a record by id: C16's, C17's under `events/[slug]`, the refund preview (`lib/refunds/preview.ts`), the bounced-signer email change and the saved event email templates (both added straight to `tenant_crew` on 9 Nov 2026), and in wave 5 the admin group payment-method route |
| `TENANT_DB_ENABLED` | `lib/tenancy/db.ts`, and the area switch in `lib/tenancy/area-switch.ts` | `tenantDb` throws before anything connects; every area answers `service` | Exactly `true` | The `events-config` area (C18, on `dev` and production since #643), and only while `TENANT_DB_AREAS` lists it |
| `TENANT_DB_AREAS` | `lib/tenancy/area-switch.ts` | Every area `service` | Comma-separated `<area>:shadow`, `<area>:shadow:<rate>` (0 to 1, default 1), `<area>:tenant`. Only `events-config` is declared | `events-config` (C18, on `dev` and production since #643): an event's company list, count and rename (below) |
| `TENANT_DATABASE_URL` | `lib/tenancy/driver.ts`, loaded by `db.ts` only when `TENANT_DB_ENABLED` is `true` and no test driver is registered | With the flag on, `tenantDb` throws: there is no fallback connection | The `tenant_app_login` pooler URL, with `sslmode=verify-full` for any non-local host (owner steps below) | Nothing until the flag is on and an area is listed |
| `TENANT_DATABASE_CA_CERT` | `lib/tenancy/driver.ts` alone, for a host other than `localhost` or `127.0.0.1`, with the flag on (C11t, wave 6) | With the flag on and a non-local URL, `tenantDb` throws before any pool exists | A **server-only secret**: the PEM of the root CA that signs the database's certificate. One or more CA certificates and nothing else. Literal `\n` escapes are read as newlines | Nothing until the flag is on |
| `PLATFORM_AUDIT_ENABLED` | `lib/audit/platform.ts`, `lib/audit/route.ts`, `lib/cron-audit.ts` | No audit row, no session read, nothing scheduled | Exactly `true` | Every handler the audit gate counts as audited (see below) |

### `LOADSCOPED_MODE`

`loadScoped` loads one row by id only if it belongs to the caller's scope. The mode applies to **Stellr's own tenant-wide scope only**, which is what a Stellr admin runs as:

- `off`: the legacy query, unchanged. The scope is not planned.
- `shadow`: both queries run, the legacy result answers, and any difference (found against not found, or a different row) goes to `app_errors` with the route label `LOADSCOPED <route>` and the message `loadScoped shadow mismatch: <table> <reason>`. It never throws for the scope. Each converted call makes a second query.
- `enforce`: the scoped query alone. In Stellr scope, while the S3 derivation runs in log mode, derived tables also match `tenant_id IS NULL`, so Stellr keeps every row it sees today.

**Every other scope always runs as `enforce`, whatever the mode says:** another tenant's staff, and an event manager narrowed to their events. So an event manager naming another event's record already gets the route's own 404, since wave 4 (C16). Flipping the mode changes only what Stellr's admins get.

A missing row, a malformed id, another tenant's row and another event's row all get the route's own 404, built fresh each time. `GET /api/admin/health/integrations` reports the resolved mode as `loadScopedMode`.

### `TENANT_DB_ENABLED` and `TENANT_DATABASE_URL`

`tenantDb(tenantId)` runs each call in its own transaction as `tenant_app`, a role that does not bypass row level security, with the tenant pinned transaction-locally and read back before and after every statement (`docs/TENANCY-S4.md`, "How a tenant transaction runs"). Since C11 the transport is postgres.js (3.4.9, owner-approved on 9 Nov 2026), in `lib/tenancy/driver.ts`:

- **Loaded only on demand.** With the flag off nothing imports postgres.js and nothing connects. With it on, `db.ts` loads the driver on first use.
- **One connection string, checked before use.** It must be a `postgres://` or `postgresql://` URL whose user is `tenant_app_login`, or the pooler's `tenant_app_login.<project-ref>`. It must name one user and one host (a host name or IPv4 address, not IPv6) and carry no query parameter except `sslmode`. Anything else throws an error that names the rule and never echoes the string. A pasted owner or service connection string is refused.
- **TLS, with full certificate checking (owner decision, 10 Nov 2026; C11t, wave 6).** For any host other than `localhost` or `127.0.0.1` the URL must carry `sslmode=verify-full`, given once: no `sslmode`, any other mode or a second `sslmode` is refused. `TENANT_DATABASE_CA_CERT` must hold the root CA: every PEM block must parse and be a CA certificate, so a pasted server certificate is refused. postgres.js then checks the server's chain against that CA alone and its certificate's name against the host (an IPv4 host against its address), with TLS 1.2 or later. A missing or refused URL or CA throws before a pool exists, and there is no fallback to an unchecked mode. Local hosts, such as CI's throwaway database, use no TLS. Neither the URL nor the CA appears in an error or a log line, and only `lib/tenancy/driver.ts` reads the CA (`lib/tenancy/driver-wiring.test.ts`). **Not yet tried against the hosted pooler:** the O3 canary (owner step 5, below) is that try, and it has not run (P6, pending).
- **A refused setting shows (O3, wave 7).** Every refusal of the URL or the CA throws `TenantDbConfigError`, still a `TenantContextError` with the same message, now carrying a fixed reason (`missing`, `not-verify-full`, `wrong-login`, `not-a-ca` and so on). The first refusal in `tenantDriverFromEnv` writes one `TENANTDB config` row to `app_errors` per server instance, with the text `tenantdb_config_refused url=<reason or ok> ca=<reason, ok or not-needed>`, never a value. It loads `lib/app-errors` by dynamic import only then. The driver itself still never logs. The companies list's failed read logs the same reason code (`errorCodeOf`).
- **Countable connections.** Every connection sets `application_name` to `stellr-tenantdb` (`TENANT_APPLICATION_NAME`), so `pg_stat_activity` can count them. Through the transaction pooler the server session may carry the pooler's own name instead; the canary reports which, and if so count by `usename`.
- **Pool.** At most 3 connections per server instance, idle connections closed after 20 s, every connection replaced after 5 minutes, 10 s to connect, `prepare: false` for the pooler's transaction mode, every statement on the extended protocol so the server runs one statement per call.
- **No service-role fallback.** A missing or refused URL is a thrown `TenantContextError`.

### `TENANT_DB_AREAS`

The per-area switch (C12) decides, per area and per call, which path answers. It reads `TENANT_DB_ENABLED` too: with that flag off every area is `service` whatever this says.

- `service`: today's read only. The tenant read is not even built.
- `shadow`: today's read answers. For the sampled share of calls the `tenantDb` read runs **after the response**, read-only (`SET TRANSACTION READ ONLY`, read back after the pin), at most 2 at a time per instance, with a 5 s timeout. The service rows are hashed when the request answers, and the two are compared ignoring row order and the usual differences between the two clients. A difference goes to `app_errors` as `tenantdb_shadow_mismatch area=… reason=…` with counts and ids only, never row content. The reasons are `count`, `ids`, `content`, `tenant_error`, `timeout` and `no_tenant`. Shadow writes go through the service path alone, so nothing is written twice.
- `tenant`: the `tenantDb` read or write alone. A failure is the request's failure. There is no fallback to the service path.

An entry that does not parse, names an undeclared area, gives a rate to `tenant`, or repeats an area is ignored, so its area stays on `service`. Ignored entries are reported once per instance as `CONFIG TENANT_DB_AREAS`, by count only.

### The first area: `events-config` (C18)

`lib/events/admin-config.ts` holds the queries behind `companies`, `offerings` and `merch/commit` under `app/api/admin/events/[slug]`, moved out of the routes. Each route takes its tenant from `requireEventRoute`, never from the request.

- **Service path:** today's supabase-js query. With defaults this is all that runs: `tenantDb` is not built and no connection opens.
- **Tenant path:** SQL through `tenantDb`, pinned to the caller's tenant. Under the tenant policies another tenant's event reads as empty, and a write naming it is refused by the database.
- **Shadow:** a sampled share of list reads also runs the tenant read after the response, read-only. Writes take the service path alone.
- **Who reaches it.** The three routes moved from `stellr_only` to `tenant_crew`. Stellr's admins and event managers get today's answers. Their writes audit behind `PLATFORM_AUDIT_ENABLED`, with five new actions (`event_company.count.set`, `event_company.placement.change`, `event_offering.record.create`, `event_offering.record.delete`, `merch.batch.commit`).
- **A failed list read** logs its error code only (a SQLSTATE or an error class name), then answers today's 500, so a `tenantDb` that cannot start shows in the logs.

**What C18 converted, and what it left.** Each part left has an owner slice. Where the code names none, the slice is a proposal for the owner.

| Part | Path today | Owner slice |
|---|---|---|
| An event's company list, the count (with the settings row's `company_count`) and a company's rename | **Converted:** `readArea` and `writeArea` | C18, done |
| A participant's move between companies | Service path. Confined for a tenant's staff by `findEventParticipant` and `findEventCompany`, run before the write (`test/events-admin-config-c18.test.ts`) | Waits on `tenant_app`'s column grants on `participants`, which `lib/events/admin-config.ts` leaves to Lane A. Proposed: the slice that settles those grants also moves this write onto `writeArea` |
| Auto-Assign, `override` and `override_all` | Service path. A tenant's staff get `refuseOutsideStellr`'s 503, because they read team profiles, which tenant events do not take | Proposed: A10 (team profiles), with the slice that lets tenant events take them (see PR amendments, wave 4) |
| Store offerings and the merch batch | Service path through a `StellrOnlyDb`. A tenant's staff get `refuseOutsideStellr`'s 503, and another tenant's event answers 404 for everyone (below) | Proposed: C23 (store admin), or Stellr-only for good if the owner gives tenants no store |
| The other configuration routes under `events/[slug]`: awards, badge and certificate templates, badges, certificates, check-in, credentials | `stellr_only` | C19 (`lib/security/stellr-only-dispositions.ts`) |

**CI.** `test/integration/two-tenant/events-config.int.test.ts` runs in the `tenant-db` job, which C18 made required in the workflow: no `continue-on-error` on the job or any step. Its scope step also runs for `lib/events/admin-config.ts` and the three routes (`test/ci-tenant-db-required.test.ts`). It passed on #624 and #625.

### Stellr-only routes refuse another tenant's event (waves 6 and 7)

`refuseUnlessStellrEvent` (`lib/tenancy/load-scoped.ts`) reads the event's owner from the events mirror by slug, an unmirrored slug counting as Stellr's. `remind`, `docusign-reissue`, the guardian route, `offerings` and `merch/commit` under `app/api/admin/events/[slug]` ask it after `refuseOutsideStellr` and before any read about a person, any email and any envelope. Another tenant's event answers 404 for everyone, a Stellr admin included, **in every `LOADSCOPED_MODE`**, because `off` and `shadow` do not narrow the reads that follow. A failed owner read answers a retryable 503. For Stellr's own events the answer is today's, at the cost of one `events` read per request (#624).

**Money routes on Stellr's Stripe (C20c, wave 7, #648, on `dev`).** The same refusal now covers the routes that use Stellr's Stripe account, coupons and mail. `invoice-paid` and `payment-link` under `app/api/admin/events/[slug]` ask `refuseUnlessStellrEvent` after the staff check, before the body or any registration is read. `registrations/[id]/invoice` and `registrations/[id]/finish-setup` ask it after `loadEventRecord`, on the loaded row's event, so a foreign event answers as a missing group. `refunds/preview` uses `previewRefundOnStellrEvent` (`lib/refunds/preview.ts`): after the participant load it reads that place's registration, then its event's owner, before the payment is read, so this admin-only GET makes two extra reads for Stellr. Another tenant's event answers 404 and a failed owner read a retryable 503. The delete dialog (`components/admin/DeleteEntityButton.tsx`) now treats only a 404 preview as "no refund to offer" and blocks the delete on any other failure.

### `PLATFORM_AUDIT_ENABLED`

With it on, each audited handler appends one row to `platform_audit_events`, the append-only, hash-chained table in `docs/PLATFORM-AUDIT.md`. Who is audited by now: the C7 mechanism; wave 3's A14, B12 (every cron) and B18; wave 4's B16 (54 member and community handlers), C13 (42), C15 (7), C16 and C17; and in wave 5 the 5 register routes (A7; pay and pay-seat record no payment start for an answer given before a Checkout was tried, such as a tenant's 503 or any 4xx) and the admin group payment-method GET and POST (the POST records the method and, for "Invoice for some", a participant count, never ids). Wave 6 adds C18's three event configuration routes (#624) and 5 more mutating team route files (6 handlers) under `app/api/members/teams` (A8, #625), so every mutating team route is now audited, and A16's consent steps (`registration.guardian_consent.request`, `.sign`, `.decline`, `.expire`, `.lift`, `.void`), ids only. What is still unaudited is `test/baselines/unaudited-mutations.json`, regenerated at each merge: on `dev` at `b8c1fba3`, 112 mutating handlers and 6 GET writers, with every one of the 24 crons audited.

What it costs and what it cannot do:

- **Most live paths write after the response** (`runAfterResponse`), so a row can be lost with its instance. An audit failure never changes a response.
- **Routes with `{ session: true }`** read Clerk's session inside `after()`. That is not yet proven on a real request: if it cannot read it, the row says `actor_unresolved`. Wave 3's routes and C13's 42 handlers use it.
- **Crons write no event outside production**, even with the flag on (`lib/cron-audit.ts`). The cron proof is the first production `cron.run.finish` rows checked against that day's `cron_runs` (query in `docs/S5-CRONS-LIMITS-SMMA.md`, "Cron audit").
- **Chains.** The register routes, C15's seven events and B16's member rows all go on Stellr's chain until the owner decides otherwise; a register row for another tenant's event carries `event_tenant_id` in its metadata. Crons go on the platform chain. **A row on the wrong chain cannot be moved or removed**, so the chain decisions come before the production flip.
- **Size.** Watch the table against Supabase Free's 500 MB. There is no retention path yet.

## Before any flip

1. **S4 state on production.** `20261104200000`, `210000`, `300000` and `400000` are applied, and `tenancy_cutover_checks` Section D shows 0 NULL `tenant_id` (`docs/TENANCY-S5.md`, Owner gates). Needed before `LOADSCOPED_MODE=enforce` or any area on `tenant`.
2. **One variable at a time, `dev` first, then production, each with the owner's yes** (owner decision, 11 Nov 2026). After each change, redeploy the newest READY deployment: a running deployment does not pick up a new value.
3. **Outside event hours**, and with Active CPU read on the Vercel Usage page before and after.
4. **Proof by step outcome, not badge.** Since C18 the CI `tenant-db` job has no `continue-on-error`, so a failure fails the run, and it is a required check on `dev` (with `verify`, `e2e` and `db`; `main` requires `verify` and `e2e` only, read 12 Nov 2026). A PR its scope step skips still finishes green without running the tests.
5. **A positive signal for each flip (O1, wave 7).** After the redeploy, `GET /api/admin/health/integrations` (admin only) shows every S5 switch as it resolved, under `tenancy`: modes, booleans and counts, never a raw value. `unrecognised` names a variable whose value fell back to its default, and `invalidCombinations` lists a switch set without what it needs. Then `supabase/tests/s5_watch_only.sql` reads what the flip wrote, read-only and filtered by the flip's time: `psql "$DEV_DB_URL" -v flip_at='<timestamptz>' -f supabase/tests/s5_watch_only.sql`. CI e2e writes to the same `dev` database, so every check filters by time and route. Each flip's row goes in the tracker's "Wave 7 flip log" (`s5-programme.31`).

## The order

A proposal for the owner. The plan fixes no order between these flags; the reasons are given so a different order can be chosen knowingly.

| Step | Where | What | Why here |
|---|---|---|---|
| 1 | `dev` | `PLATFORM_AUDIT_ENABLED=true` | It changes no response, and once on it records the admin actions made during the later flips. Check one real row from a `{ session: true }` route and from a register route, then `npx tsx scripts/verify-audit-chain.ts` exits 0 |
| 2 | `dev` | `LOADSCOPED_MODE=shadow` | The scoped read beside the legacy one. Use the admin record screens (refund preview, correct-recipient, group payment method), then read `app_errors` for `LOADSCOPED` rows: expect none |
| 3 | `dev` | `LOADSCOPED_MODE=enforce` | Only after a clean shadow. A mismatch here points at a row stamped with the wrong tenant or none, which RLS would trip over later too, so it is cheaper to find first |
| 4 | production | `LOADSCOPED_MODE=shadow`, then `enforce` | After step 1 of "Before any flip". The plan sets no shadow length for this flag; the owner chooses one |
| 5 | `dev`, then production | Create `tenant_app_login`, `TENANT_DATABASE_URL` and `TENANT_DATABASE_CA_CERT` (owner steps below), and see the O3 canary PASS against the `dev` pooler | Inert until step 6 |
| 6 | `dev` | `TENANT_DB_ENABLED=true` | C18, the first caller, is on `dev` and production (#624, promoted in #643). With no area listed it still changes nothing. The health route then shows `tenancy.tenantDb.config` with `url` and `ca` both `ok`; a fixed reason there, or a `TENANTDB config` row, means the setting is refused |
| 7 | `dev` | `TENANT_DB_AREAS=events-config:shadow:<low rate>` | C18's area. Use the admin companies screen on a Stellr event to give it reads. Start low and read Active CPU before raising the rate: each sampled call adds a transaction after the response. Read `TENANTDB` rows in `app_errors` |
| 8 | `dev` | `events-config:shadow:1`, then `events-config:tenant` | After a clean sampled shadow |
| 9 | production | Steps 6 to 8 again | After `dev` holds |
| 10 | production | `PLATFORM_AUDIT_ENABLED=true` | Whenever its own decisions are made (below). It does not depend on, or block, steps 2 to 9 |

**Decisions to settle before step 10** (all listed under the owner decisions of waves 3 and 4 in `docs/TENANCY-S5.md`): consent audit rows and the purge (A14, extended to C13 and C15's member and erased-person uuids); the limits on upload signing (A14); the `store/checkout` route limit (B18); the cost of an extra `auth()` call and `after()` write per audited member request, and whether read-like GETs are audited at all (B16); which chain a member's registration rows (B16) and C15's seven events go on.

## Owner steps: `tenant_app_login` and `TENANT_DATABASE_URL`

Needed only for a deployed `tenantDb` flip, not to build, merge or run CI. The owner creates the `dev` login (owner decision, 11 Nov 2026). Do `dev` first, then production, each on its own Supabase project and its own Vercel project.

1. **Create the login.** In the Supabase SQL editor, as `postgres`:

   ```sql
   CREATE ROLE tenant_app_login LOGIN NOINHERIT PASSWORD '<generated, at least 32 random bytes>';
   GRANT tenant_app TO tenant_app_login;
   ```

   Generate the password locally and paste it once. Never print it, commit it or put it in a ticket.
2. **Build the connection string** from the project's pooler settings: transaction mode (port 6543), user `tenant_app_login.<project-ref>`, database `postgres`. Then make it pass the driver's checks:
   - **Remove every query parameter except `sslmode`.** A string copied with `pgbouncer=true` or similar is refused.
   - Percent-encode any `@`, `,` or `%` in the password.
   - **End it with `?sslmode=verify-full`,** once. The driver refuses a non-local URL without it (owner decision, 10 Nov 2026).
3. **Store it in Vercel** as `TENANT_DATABASE_URL`, a server-only secret, never under a `NEXT_PUBLIC_` name. `dev`'s string on the `dev` project, production's on production.
4. **Store the root CA** as `TENANT_DATABASE_CA_CERT`, a server-only secret, never under a `NEXT_PUBLIC_` name: the certificate blocks and nothing else. A value saved with literal `\n` escapes is accepted. Keep it beside the URL so the two change together. **Which PEM is pending:** the provider's root CA if it verifies, otherwise a bundle, decided by the canary in the next step (P6) and recorded in tracker `s5-programme.30`. Never a weaker `sslmode`.
5. **Run the pooler TLS canary on your own machine** (O3, `scripts/tenant-db-canary.ts`), before `TENANT_DB_ENABLED` is set anywhere. CI cannot show this, because its database runs on `127.0.0.1` with no TLS. The URL goes in an environment variable for one run, never on the command line or in `.env.local`:

   ```zsh
   read -rs "TENANT_DB_CANARY_URL?Pooler URL: " && export TENANT_DB_CANARY_URL   # zsh; nothing is echoed
   # in bash instead: read -rsp 'Pooler URL: ' TENANT_DB_CANARY_URL && echo && export TENANT_DB_CANARY_URL
   npx tsx --conditions=react-server scripts/tenant-db-canary.ts --ca <PEM A file> --label A
   npx tsx --conditions=react-server scripts/tenant-db-canary.ts --ca <PEM B file> --label B   # only if A fails
   unset TENANT_DB_CANARY_URL
   ```

   - **Refused before connecting:** a local host, any `sslmode` but `verify-full`, a login other than `tenant_app_login` (or the pooler's `tenant_app_login.<ref>`), by the driver's own URL rules, an unreadable PEM, a server certificate passed as the CA, and the production project (unless `--production` is passed on purpose).
   - **A diagnostic handshake** prints each certificate the pooler presents: subject, issuer, SANs and sha256. It does not refuse an unverified chain, so that a failure shows what was presented; its verdict is reported, never acted on (owner answer `PR658-1` in `docs/S5-DECISION-REGISTER.md`).
   - **The real check** goes through the app's own driver and `tenantDb` under `verify-full`, in a read-only transaction: it reads back `current_user` and `app_tenant_id()`, counts `public.event_companies`, and reports whether `application_name` reaches Postgres.
   - **PASS** needs the connection under `verify-full`, `current_user` `tenant_app`, Stellr's tenant id read back and a count above 0. Exit status 0 is PASS, 1 FAIL, 2 a usage error.
   - **Output:** codes, counts and certificate names only, never the URL, password, host or PEM.

   If no CA verifies, P7 to P9 stop and the certificate comes back to the owner as a new decision (`W7-7`); the driver keeps refusing until it verifies. Then store the chosen PEM and the URL on `stellr-web-dev` as sensitive values. An agent confirms the role in `pg_stat_activity`.
6. **Confirm the pooler's client limit** on the plan page (`docs/S4-SPIKE.md`, section 2). Each instance opens at most 3 connections.
7. **Leave `TENANT_DB_ENABLED` unset** until step 6 of the order.

**Rotating the password.** `ALTER ROLE tenant_app_login PASSWORD '<new>';` in the SQL editor, update `TENANT_DATABASE_URL`, redeploy the newest READY deployment straight away. Connections already open stay up until they are replaced (at most 5 minutes); new ones fail on the old password until the redeploy.

**Changing the CA.** Update `TENANT_DATABASE_CA_CERT` and redeploy. Each instance keys its pool on the URL and the CA together (`tenantDriverFromEnv`), so a new CA gets a new pool rather than reusing connections built on the old one.

## Rollback

Each rollback is the variable unset (or set back) and a redeploy of the newest READY deployment. None of these paths deletes data.

| Variable | Rollback | What it leaves behind |
|---|---|---|
| `LOADSCOPED_MODE` | Unset (`off`) | Nothing: `loadScoped` only reads. Another tenant's staff and event managers stay on `enforce`, as they are whatever the mode |
| `TENANT_DB_AREAS` | Remove the area's entry, or the whole variable | Rows written in `tenant` mode stay; they are ordinary rows in the same tables. Shadow never wrote through `tenantDb` |
| `TENANT_DB_ENABLED` | Unset | Every area falls back to `service`. Any caller that used `tenantDb` directly rather than through `readArea` or `writeArea` now fails closed, so a slice that adds such a caller states its own rollback |
| `TENANT_DATABASE_URL` | Unset the flag first (above). To stop the login without a redeploy: `ALTER ROLE tenant_app_login NOLOGIN;` in the SQL editor, which refuses new connections; open ones end within the 5-minute lifetime, or terminate them from `pg_stat_activity` where `usename = 'tenant_app_login'` | With the flag still on, `tenantDb` callers fail closed until it is unset |
| `TENANT_DATABASE_CA_CERT` | Unset the flag first. Unsetting the CA alone with the flag on makes every non-local `tenantDb` call fail closed | Nothing |
| `PLATFORM_AUDIT_ENABLED` | Unset | **Every row already written stays.** The table is append-only: removing a row needs the owner to disable its trigger, and leaves a gap the chain check shows. Stopping the flag stops new rows only |

## What is not yet proven

- **`tenant-db` on `main`.** Its first run against a real database, on #598, passed every step, including "Two tenants through the real driver": `test/integration/tenant-db.int.test.ts` and the two-tenant kit's test, with the read-only shadow path (`SET TRANSACTION READ ONLY` before the role, then the read-back). Since C18 it is required in the workflow, and it passed on #624, the first run of `test/integration/two-tenant/events-config.int.test.ts`, and on #625. It is a required check on `dev`; `main` requires only `verify` and `e2e`, so adding it there is the owner's call (read 12 Nov 2026).
- **The driver against a hosted pooler.** CI connects to a local database on `127.0.0.1`, where the driver uses no TLS. `lib/tenancy/driver-tls.test.ts` proves the checks with real TLS handshakes against a local server and a generated CA, but `verify-full` against the real pooler has not been tried. The O3 canary is built for it (owner step 5); its run, P6, and so the PEM choice, are pending.
- **C18 on a deployment.** No `events-config` read has gone through `tenantDb` anywhere but CI; the shadow step on `dev` is the first.
- **The audit actor read inside `after()`**: one real row on `dev` per route kind, before production.
- **C16's scope check on a deployment**: one admin call to a `loadRecord` route and one by an event manager inside their event on `dev`, reading `loadScopedMode` on the health route (wave 4, still open).
