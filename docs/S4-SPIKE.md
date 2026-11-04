# S4 spike: how the database enforces one tenant

**Decision (4 Nov 2026): GO on Option B, a dedicated non-BYPASSRLS role reached only through `tenantDb()`. NO-GO on Option A, a server-minted tenant JWT, for now.**

This is the go/no-go record the multi-tenancy plan asks for at the start of S4. It compares the two ways the database can make one tenant's code see only that tenant's rows. It sets the query-plan and latency budget, and designs how `/_t/[tenant]` routing puts the tenant in the ISR/CDN cache key (S5 builds the routing).

What landed with this decision is described in `docs/TENANCY-S4.md`.

## 1. The question

Today every route reaches Supabase through `supabaseServer()` (`lib/supabase.ts`) with the secret key. That key acts as `service_role`, which has BYPASSRLS. Tenant scoping is therefore app code only (threat model, TB4).

S4 needs a path where the **database** refuses another tenant's rows, even when the app code is wrong. The plan names two candidates:

- **Option A: a tenant JWT.** The server mints a short-lived JWT carrying `tenant_id` and a role, and Supabase verifies it. RLS policies read the tenant through a STABLE helper over `auth.jwt()`.
- **Option B: an allow-listed `forTenant()` path.** Server code opens a transaction on a dedicated role that does not bypass RLS. It pins the tenant for that transaction with `set_config(…, true)`, and policies read the tenant through a STABLE helper over `current_setting`.

## 2. What each option needs

| | Option A: tenant JWT | Option B: tenant role and transaction-local tenant |
|---|---|---|
| **How a request becomes "tenant X"** | Server signs `{role, tenant_id, exp}`. supabase-js sends it as `Authorization: Bearer`, next to the publishable key on `apikey`. PostgREST verifies it and switches to the role in the claim. | Server opens a pooled Postgres connection and runs `BEGIN; SET LOCAL ROLE tenant_app; SELECT set_config('stellr.tenant_id', $1, true); …; COMMIT`. |
| **Supabase new API keys** (`sb_publishable_`/`sb_secret_`, `lib/supabase-keys.ts`) | The new keys are not JWTs and cannot carry a tenant. A minted JWT needs a **signing key Supabase trusts**. Either the legacy HS256 JWT secret, which Supabase now treats as legacy beside its asymmetric signing keys and which can also mint `service_role` tokens; or a private key we hold registered with the newer JWT Signing Keys feature (the import path is an owner check). Both are a new long-lived secret, and the second is a newer Supabase feature. | Untouched. It does not go through the Data API at all, so it neither needs nor affects the keys. It needs a Postgres login on the Supavisor pooler, which is a standard part of every project. |
| **Clerk** | Clerk stays authentication only. Clerk session tokens (Supabase third-party auth) arrive as role `authenticated` and cannot carry a host-chosen tenant: claims come from user metadata, and one user can belong to several tenants. A restrictive tenant policy `TO authenticated` would either break the existing Realtime chat and survey reads (no claim) or need an "unless the claim is missing" hole. So A also needs a separate role in the claim, plus `GRANT tenant_app TO authenticator`, a Supabase-managed role. | Clerk is untouched. The server resolves the tenant (host map in `proxy.ts`, S5) and checks membership (`lib/authz.ts`, S5) before calling `tenantDb(tenantId)`. |
| **Can a browser forge it?** | No, provided the signing key stays server-side. The token is minted per request and short-lived. If the token reaches a browser it is a bearer credential for that tenant until it expires. | No. The login exists only in server env; no browser ever holds it. The tenant id comes from server-side resolution, never from the request body. |
| **Residual risk** | Signing-key theft mints any role, `service_role` included. A tenant cannot be re-pinned from inside SQL: the claim is signed. | SQL in the tenant path could call `set_config` (or a function that runs SQL text) to re-pin another tenant or drop the role. Mitigated in layers by `tenantDb`. It runs only statements `tenantSql` minted, and binds every value. Its text check refuses `SET`/`RESET`/`DO`, more than one statement, comments, `U&` escapes, `set_config`, `pg_settings` and the core functions that run SQL text, in any spelling. It reads the pin back after every statement and rolls back if the pin moved. What remains is an unknown path that re-pins and restores within one statement, written into an allow-listed file (`docs/TENANCY-S4.md`, "What tenantDb does and does not stop"). `tenant_app` also holds no other privilege: no identity, platform or child tables, and routing, ownership and role tables are read-only. |
| **Superuser or ALTER ROLE needed** | `GRANT … TO authenticator` on a Supabase-managed role. No superuser, but it touches platform plumbing we do not own. | `CREATE ROLE tenant_app NOLOGIN NOINHERIT NOBYPASSRLS` needs CREATEROLE, which the hosted `postgres` role has. Rehearsed as a non-superuser on Postgres 17 (§6). The login role is an owner action, also non-superuser (§6). No ALTER ROLE. |
| **Transactions** | PostgREST runs one statement per HTTP request. A multi-statement unit of work needs an RPC function per use case. | Native: `tenantDb(id).transaction(fn)` runs any number of statements, all or nothing. |
| **Cost** | $0. | $0. Supavisor is included on Free. The pooler's client limit (about 200 on the smallest compute; owner to confirm on the plan page) is far above what Hobby's functions open. |
| **New dependency** | A JWT library (or WebCrypto) and the key. | A Postgres client in S5 (postgres.js, transaction mode, `prepare: false`). It goes through the supply-chain gates: minimum release age, lockfile-lint, `npm audit signatures`. `lib/tenancy/db.ts` defines the driver interface now and imports nothing. |
| **Query plans** | Same as B: `tenant_id = (SELECT app_tenant_id())` with the helper reading `auth.jwt()`. | See §3. |
| **Latency** | Each statement is one HTTP round trip to PostgREST, as today, plus signing (under 1 ms). | One TCP+TLS connect per warm function instance, then about 3 extra in-region round trips per transaction for the pin and read-back. See §4. |

### Why B

1. **No new Supabase feature, no superuser, no secret that can mint `service_role`.** The plan's tie-breaker. A needs either the retiring legacy JWT secret or imported JWT signing keys. B needs only `CREATE ROLE` (CREATEROLE) and a pooler login.
2. **It does not touch the live authenticated paths.** The policies are `TO tenant_app`, so Realtime chat and the survey and community reads, which run as `authenticated` with Clerk tokens, are not evaluated against them. A's role switch through `authenticator` is platform plumbing we do not control.
3. **Real transactions.** Registration, refunds and roster edits are multi-statement. Under A each would need an RPC.
4. **The same policies serve A later.** If browser-direct tenant reads are ever needed (for example tenant-scoped Realtime), `app_tenant_id()` can also read a verified claim without changing a single policy.

What B costs: a Postgres client dependency and a pooled login (S5), and the injection residual above. That residual is narrowed by the tagged-template-only API and kept tight by the allow-list (`lib/tenancy/db-callers.ts`, enforced by `lib/tenancy/db.test.ts`).

## 3. Query plans on the hot tables

**Method.** Measured on Postgres 17 (PGlite), built from `supabase/baseline.sql` plus every migration, with this lane's two migrations applied. The data was 60,000 `registrations`, 120,000 `participants` and 20,000 `event_participations` across 200 events (190 Stellr, 10 canary; the canary has 3,000 registrations). The same query ran as `service_role` (today) and as `tenant_app` with each tenant pinned. Times are the mean of 20 warm runs in a single-process WASM build: read them as relative, not absolute.

| Query | service_role plan | tenant_app plan | ms (service / tenant) |
|---|---|---|---|
| Roster: `registrations WHERE event_slug = …` | Bitmap index scan `registrations_event_slug_idx` | **Same index scan**, plus `Filter: tenant_id = (InitPlan)` on the 300 matching rows | 5.5 / 5.0 |
| One row: `registrations WHERE id = …` | `registrations_pkey` | `registrations_pkey` + filter | 0.44 / 0.46 |
| Whole tenant: `count(*) FROM registrations` | Full scan of 60,000 | **`registrations_tenant_id_idx`** bitmap scan (S3's index) | 7.5 / 0.7 (canary), 7.6 (Stellr) |
| `event_participations WHERE event_slug = …` | `event_participations_event_slug_idx` | same index + filter | 0.96 / 1.03 |
| `event_participations WHERE member_id = …` | `idx_event_part_member` | same index + filter | 0.30 / 0.32 |

**What it shows:**

- **`app_tenant_id()` is evaluated once per query.** Policies call it as `(SELECT public.app_tenant_id())`, so it becomes an InitPlan, never a per-row call. Plans show `InitPlan 1 -> Result`, then `Filter: (tenant_id = (InitPlan 1).col1)`.
- **The selective index still wins.** On event-scoped queries the planner keeps the `event_slug`/`id`/`member_id` index and applies the tenant as a cheap filter on rows it already fetched. When the tenant is the only predicate, it uses the `tenant_id` index S3 added. No new index is needed today.
- **`participants` has no `tenant_id` yet** (`via_parent`). Through `registrations` with an explicit tenant, the planner uses a `BitmapAnd` of `registrations_event_slug_idx` and `registrations_tenant_id_idx`, then `participants_registration_id_idx`. Until `participants` gets its own column and composite FK (the next S4 step), `tenant_app` has **no grant on it at all**, so it fails closed rather than relying on a join policy.

**Budget (S5 gate):**

- RLS adds no more than **10% or 2 ms** (whichever is larger) to any hot-path query at production volume. Check it with `EXPLAIN (ANALYZE)` as `tenant_app` against `service_role`.
- Every tenant table keeps an index led by `tenant_id` (already enforced by the S3 lint).
- Add a composite `(tenant_id, <key>)` index only when a plan shows the tenant filter discarding more than half the rows an index returned. None does today.

## 4. Latency budget for the Option B path

| Step | Budget | Notes |
|---|---|---|
| Connect (TCP + TLS to Supavisor, transaction mode) | ≤ 100 ms, **once per warm instance** | Reused across requests. The Vercel function region must match the Supabase region. |
| Pin: `SET LOCAL ROLE` + `set_config` + read-back | ≤ 3 ms per transaction | Three in-region round trips. They can later be merged into one `SELECT set_config('role', …, true), set_config('stellr.tenant_id', $1, true)` if needed. |
| Read-back after each caller statement | ≤ 1 ms per statement | One in-region round trip (`SELECT current_user, app_tenant_id()`), added after review so a statement cannot leave the pin moved. A route with many small statements should batch them. |
| RLS overhead per statement | ≤ 10% or ≤ 2 ms | §3. On writes, the guard also does one primary-key lookup per foreign key to a tenant table (and one on `events` for the event key). |
| Route p95 | ≤ +20 ms against the same route on `service_role` | Measured per feature area as S5 converts it. A conversion that misses this budget does not ship. |

Transaction-local settings are what make pooling safe. `SET LOCAL` and `set_config(…, true)` end at `COMMIT`/`ROLLBACK`, so a Supavisor transaction-mode connection never carries one request's tenant into the next. `tenantDb` reads the pin back before the caller's first statement and after every statement, and rolls back if the role or tenant did not stick or moved.

## 5. Tenant in the ISR/CDN cache key: `/_t/[tenant]` (design; S5 builds it)

1. **Resolve once, at the edge.** `proxy.ts` maps `Host` to a tenant slug from a cached `tenant_domains` map: in-memory, short TTL, refreshed on a miss. Stellr's own hosts map to `stellr`. An unknown host gets a 404 and never falls back to Stellr's content.
2. **Rewrite, never redirect.** `NextResponse.rewrite('/_t/{slug}{path}')`. The browser URL is unchanged, but the route Next renders, and so the ISR entry and Vercel's CDN key, is the rewritten path, so the tenant is part of the cache key.
3. **Pages take the tenant from `params.tenant` only.** A page under `app/_t/[tenant]/…` must never read `headers()`/`Host` to decide the tenant. One reason is that reading headers opts the page out of ISR. The other is that a header-derived tenant on a cached page is exactly the cross-tenant leak. S5 adds a lint banning `headers()` under `app/_t/`.
4. **No direct requests to `/_t/*`.** `proxy.ts` 404s any incoming request whose original path starts with `/_t/`. Without this, `GET /_t/other-tenant/…` on tenant A's host would render, and cache, B's page under A's host.
5. **Tenant-scoped data caches.** `unstable_cache`/fetch-cache keys and `revalidateTag` tags carry the tenant: `t:{tenantId}:events`, never `events`. Inside the page, data comes from `tenantDb(tenantIdFor(params.tenant))`, so even a wrong cache key could only ever hold that tenant's rows.
6. **Gates (S5):** a Host-header spoof test, a warm-cache body-hash comparison across two tenant hosts, and a test that `/_t/*` is unreachable from outside.

## 6. Evidence

All of it was run locally on Postgres 17 (PGlite), built from `supabase/baseline.sql` plus every timestamped migration, the way CI's `db` job builds its database.

- **The pgTAP matrix** (`supabase/tests/database/tenant_isolation.test.sql`, 741 assertions) passes. So do the existing `tenancy.test.sql` (245) and `security.test.sql` (52).
- **The matrix can fail (fault injection).** Each fault below was applied, then the matrix was re-run:

  | Fault | Result |
  |---|---|
  | `registrations` policies replaced by `USING (true)` | caught: 19 failures |
  | Policies dropped on `event_participations` | caught: 8 failures |
  | `app_tenant_id()` hard-wired to Stellr | caught: 365 failures |
  | `tenant_app` given BYPASSRLS | caught: 467 failures |
  | A stray `TO PUBLIC USING (true)` permissive policy added to `registrations` | still passes, correctly: the RESTRICTIVE guard policy contains it |

- **No superuser needed.** Both migrations applied, and re-applied idempotently, as a role with `NOSUPERUSER CREATEROLE NOBYPASSRLS` owning the schema: the hosted `postgres` shape. As that role, creating a login (`CREATE ROLE … LOGIN NOINHERIT`) and `GRANT tenant_app TO` it both worked. That login, after `SET LOCAL ROLE tenant_app` and a pin, saw exactly its own tenant row. It got `permission denied` on `participants` and, without the role switch, on the schema. It could not `SET ROLE service_role`. The whole matrix also passes with that non-superuser as the test runner, so a green CI run (where `postgres` is a superuser) is not hiding a privilege the hosted role lacks.
- **Why FORCE waits.** The derivation trigger function and its tables were given to an owner **without** BYPASSRLS, and FORCE was set on `public.events`. A canary-event registration was then **silently stamped with Stellr's tenant** (logged `no_event`). Without FORCE it got the canary tenant. Whether hosted `postgres` has BYPASSRLS cannot be read from here, so FORCE is a separate, owner-gated step (`docs/TENANCY-S4.md`). It is not needed for Option B either: `tenant_app` owns no table, so plain RLS already binds it.

## 7. Follow-ups this decision creates

- **S4 (next step):** give the 10 `via_parent` tables (`participants`, `agreement_recipients`, …) their own `tenant_id` with composite foreign keys, then extend the policies and the matrix to them.
- **S4 (owner-gated):** the FORCE RLS migration, after the readiness check in `supabase/tests/tenancy_force_rls_readiness.sql`.
- **S5:** the Postgres client driver behind `TenantSqlDriver`, the owner-created login, `TENANT_DB_ENABLED`, the routing in §5, then conversions one feature area per PR (each adds itself to `lib/tenancy/db-callers.ts` and brings two-tenant tests).
- **S5:** tenant upload and signing code builds paths with `tenantObjectPath` and checks them with `assertTenantObjectPath`. Storage API traffic runs as `service_role`, `anon` or `authenticated`, never as `tenant_app`, so the rule lives in server code; a `storage.objects` trigger backstop is an owner decision (`docs/TENANCY-S4.md`, "Storage").
