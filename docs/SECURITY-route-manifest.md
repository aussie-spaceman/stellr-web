# Route manifest and AST guard check

Stage 2 of the multi-tenant plan. Every file under `app/` that Next serves as code is listed in **`lib/security/route-manifest.ts`** with one access class:

- route handlers (`route.ts`/`route.tsx`);
- metadata routes, which Next serves as GET route handlers: `opengraph-image`, `twitter-image`, `icon` and `apple-icon` (`.ts`/`.tsx`), and `sitemap.ts`, `robots.ts` and `manifest.ts`;
- pages (`page.tsx`).

**`test/route-manifest.test.ts`** fails when:

- one of those files is not in the manifest, or an entry names a file that is gone (the 100% classification gate);
- a handler does not call the guard its class needs, found by parsing the file with the TypeScript compiler (`lib/security/route-ast.ts`), not by regex;
- a public metadata route reads the database without being listed in `PUBLIC_DATA_GATES`, or no longer reaches the checks listed for it;
- a shared guard helper no longer reaches the check it is trusted for;
- the exceptions list changes size without the pinned count changing too, or an exception is no longer needed.

The earlier regex sweeps (`test/route-guards.test.ts`, `test/admin-page-guards.test.ts`) stay as a second net.

## The classes

| Class | Who calls it | What every handler must reach |
|---|---|---|
| `platform_admin` | Stellr platform staff, across tenants | `lib/authz`'s platform check (`assertPlatformAdmin`). A legacy admin guard does not count |
| `platform_destined` | a platform function by nature, waiting on the owner's choice (C15) | an admin check, the same as `stellr_only` |
| `tenant_staff` | a tenant's own staff, inside that tenant | a `lib/authz` tenant check: `assertTenantRole`, `requireTenantStaff`, `requireEventStaff`, `requireEventRoute`, `requireEventAccess` naming the event, or the `requireTenantAdmin` page adapter. A legacy admin guard does not count |
| `stellr_only` | Stellr's own admin portal and the `/api/admin` routes behind it | an admin check |
| `participant` | a signed-in member, on their own records | a session check (an admin check also counts) |
| `public` | anyone, no session | API: a rate limit, or an allow-listed reason. Pages: nothing |
| `webhook` | a third party calling in | a signature or shared-secret check |
| `cron` | Vercel Cron | `guardCron` in the **first statement** |

A capability token in the URL or a cookie (register, sign, survey, team profile, check-in) counts as **public**: the handler checks the token, and the class still requires a rate limit.

**Counts**, from `lib/security/route-manifest.ts` on `dev` at `b620a113` (9 Nov 2026, wave 5 merged), 508 entries, pinned by `test/tenant-surface-routes.test.ts`: `stellr_only` 165, `public` 132, `participant` 131, `tenant_staff` 35, `cron` 24, `webhook` 12, `platform_destined` 9, `platform_admin` 0.

### The rule for the admin surface

Every `/admin` page is **`stellr_only`**. Every `/api/admin` route is `stellr_only`, `platform_destined` or `tenant_staff`, which `test/route-manifest.test.ts` asserts. The one exception is `app/api/admin/sanity/event-sync`, which Sanity calls with a shared secret and no admin session: it is a `webhook`.

- **`stellr_only`** routes read and write Stellr's data by global id. As S5 converts one to `loadScoped` or `tenantDb`, it moves to `tenant_staff` (it acts inside one tenant) or a platform class (it acts across tenants). `test/idor/stellr-only-dispositions.test.ts` holds the routes destined for a tenant that are still here to a cap that only falls (`MAX_TENANT_DESTINED_STELLR_ONLY`, 21 after wave 5's payment-method follow-up).
- **`tenant_staff`** routes have moved there (C16, C17 and wave 5's admin group payment-method route) or arrived there new (the bounced-signer email change and the saved event email templates, 9 Nov 2026). Their handlers reach a `lib/authz` tenant check, and a static rule stops a `tenant_staff` file calling `.from()` directly on a table with a tenant column: it reaches those rows through `loadScoped`. A tenant's own staff still get a 503 from `refuseOutsideStellr` on actions whose helpers are not tenant-aware yet.
- **`platform_destined`** holds the 9 routes C15 moved out of `stellr_only`: staff roles, impersonation, deletion and its preflight, deletion and privacy requests, member merge, schools and the event slug guard. **They are not `platform_admin`,** because that class's check answers from the `platform_admins` table alone once `AUTHZ_SOURCE=postgres`, so putting a route there would decide by default, at the flip, that only the platform owner keeps it. The class keeps `stellr_only`'s guard, so the move changed nobody's access. Which of the 9 become owner-only is the owner's choice, route by route; `lib/security/stellr-only-dispositions.ts` lists them.
- **`platform_admin`** is still empty. The earlier assertion that it and `tenant_staff` stay empty is gone (C6): the first moves were deliberate diffs to the tests, as planned.

Community routes are `participant`. That they must never be reachable on a tenant host is a separate rule (the S5 host allow-list), not an access class.

## Adding a route or page

1. Create the file. `npx vitest run test/route-manifest.test.ts` now fails with "add these to lib/security/route-manifest.ts".
2. Add one line to the right section of `ROUTE_MANIFEST`, choosing the class with the table above. Decide by **who calls it**, not by the folder it sits in: a route under `/api/members` that anyone can call is `public`.
3. Call the guard for that class in every exported handler (`GET`, `POST`, …), either directly or through a function in the same file. For a page, the default-exported component must call it.
   - Admin check: `requireAdminPage`, `isAdminClaims`, `currentUserIsAdmin`, `currentUserHasScope`, `requireEventAccess`, `requireScholarshipAdmin`, `requireSurveyAdmin`, `canManageStoreCatalog`, or an inline `role === 'admin'` where the role is read from `sessionClaims` and the handler calls Clerk's `auth()` or `currentUser()`. A role from the request body or a database row does not count.
   - Tenant check (`tenant_staff`) and platform check (`platform_admin`): the `lib/authz` calls in the class table above. Moving a route into either class is a deliberate change: `docs/AUTHZ.md`, "Moving a route to another class".
   - Session check: `auth()`, `currentUser()`, `getCurrentMember`, `getSignedInMember`, `getOnboardedMember`, `currentStoreMember`, `resolveRequestMember`, and the other helpers in `DELEGATE_GUARDS`.
   - Rate limit: `rateLimitGuard` or `checkRateLimit` (the e-sign routes use `throttle`), or the async `limit` and `rateLimit` from `lib/rate-limit-async.ts`. An async call counts only when it is awaited and its answer is used.
   - Webhook: the provider's verifier (`constructEvent`, svix `verify`, `verifyConnectHmac`, …) or `timingSafeEqual`/`safeStrEqual` against the shared secret.
   - Cron: `const blocked = guardCron(req)` as the first line of `GET`.
4. Run the test again.

The full list of recognised calls is `BASE_GUARDS` and `DELEGATE_GUARDS` in **`lib/security/route-guards.ts`**.

### How a call is recognised

A guard counts only when it comes from where the guard really lives, not by its name alone:

- **Imported calls** count only from the listed module. `getOnboardedMember` must come from `lib/onboarded-member` (`@/lib/onboarded-member` and a relative path both resolve to it), `auth` from `@clerk/nextjs/server`, `guardCron` from `lib/cron`. A destructured dynamic import (`const { auth } = await import('@clerk/nextjs/server')`) counts the same way.
- **Method calls** count only on the provider's object. `wh.verify()` counts when `wh` is a svix `new Webhook(…)`. `stripe.webhooks.constructEvent()` counts when `stripe` comes from `lib/stripe`. `crypto.timingSafeEqual()` counts when `crypto` is node's. A method of the same name on any other object (an object literal, the request body, `URLSearchParams`) does not count.
- **Same-file functions** are followed into, but their names are never trusted. This applies at the top level and nested inside the handler.
- **Reachable code only.** Statements after an unconditional `return` or `throw` in a block do not count. A nested function counts only when it runs: called on the spot, passed to a call as a callback, or bound to a name that is referenced. A closure that is declared and never used does not count.

## A public metadata route that reads data

Metadata routes are always `public`: crawlers and link unfurlers fetch them with no session, and they have no rate-limit requirement. If one reaches a database client (`DATA_READERS`: `supabaseServer`, `supabaseServerTyped`, `supabase`, or `createClient`), list it in `PUBLIC_DATA_GATES` in `lib/security/route-guards.ts`. Give the calls and the `prop=literal` comparisons it must reach before it shows personal data, and say why. `EXPECTED_DATA_GATES` in the test pins the count. The credential share card is the one entry today. It shows the holder's name, who may be a minor, so it must call `ageBlock` and `credentialState` and check `visibility === 'public'` (`ogCardFor`). If any of those is dropped, the test fails.

## A new guard helper

Add it to `DELEGATE_GUARDS` with its file and the kinds it provides. The test reads the helper's source and fails unless it really reaches a base check of those kinds (directly, or through another listed helper). A route's call counts only when the helper is imported from that file. A function that merely borrows a guard's name is not trusted. That covers a same-file function at any depth, a method on another object, and an import of the same name from another module.

## Exceptions

`GUARD_EXCEPTIONS` in `lib/security/route-guards.ts` lists handlers exempt from their class's rule, keyed `<file>#<METHOD>` (or `#default` for a page), each with the reason and what protects it instead. `EXPECTED_EXCEPTIONS` in the test pins the count, so adding one changes two files in the same diff, where review sees it. An entry whose handler is gone, or which now passes on its own, fails the test until it is removed. Entries marked `TODO(S5)` are known gaps to close, not accepted designs.

## What the check does not prove

- That the guard's result is acted on. It proves the call is reached, not that a `false` leads to a 401. A call under a condition that never holds (`if (false) await auth()`) still counts.
- That a nested function passed to a call is really invoked. Any callback counts.
- Object-level authorisation (that member A cannot read member B's row). That is the S2 cross-tenant and IDOR generator's job.
- Guards in `proxy.ts`. Middleware is a second layer; pages and handlers must still guard themselves (deep review C-2, AUTH-1).
- Layouts and static metadata files (`icon.png`, `apple-icon.png`) are not listed. Layouts are not entry points, and static files run no code.

## Cross-tenant and IDOR suite (S2 → S4)

The route manifest says *who* may call a route. The IDOR suite checks *which records* a caller can reach through it: a signed-in tenant-A (Stellr) participant who names a tenant-B record must never get it back, and must never change it.

### What runs

- **Targets.** `lib/security/idor-targets.ts` takes every route handler in the manifest that a caller can point at a record: a dynamic path segment (`[id]`, `[slug]`, `[...path]`), or an id-like query parameter or body field. The fields come from `requestIdInputs()` in `lib/security/route-ast.ts`, which parses the file (`searchParams.get('teamId')`, `const { memberId } = await req.json()`, `body.event_slug`, `form.get('spaceId')`, the keys of a `z.object({…})` in a file that reads a body, and fields of a body array's elements such as `items[].variantId`). An input counts as an id when it names a record: an id, slug, token or number, a storage path (`storagePath`, `pdfPath`), a reference (`ref`, `objectRef`) or an email. On `dev` at `b620a113` (9 Nov 2026): 240 routes, 94 `stellr_only`, 68 `participant`, 35 `tenant_staff`, 32 `public`, 9 `platform_destined` and 2 `webhook` (`test/idor/idor-snapshot.json`, which wins over these numbers). Pages are not targets here; the tenant-host page checks are B10(c)'s, under `e2e/tenancy`.
- **Cases.** `test/idor/idor-routes.test.ts` emits one case per target and runs every exported method of the real handler. Each id input carries a **honeytoken**: a fake id or value of the canary tenant "Canary Academy" (AU/AUD), from `lib/testing/honeytokens.ts`. The other body fields the handler reads are filled with plausible values (`fillerFor()` in the harness), so request validation lets the id through. An id the route parses out of a larger string gets its format from `INPUT_FORMATS` (`ref=tr:<id>`).
- **Boundaries.** Auth and the database are mocked at the module boundary (`test/idor/mocks.ts`, `test/idor/harness.ts`): `@clerk/nextjs/server` answers as the tenant-A participant, `@supabase/supabase-js` returns `test/idor/honey-db.ts`, Stripe rejects, global `fetch` returns 503 and raw sockets refuse to connect. No network, no real database, no secrets. The whole suite takes a few seconds.
- **The honey database.** Every table holds one Canary row, plus the caller's own `members` row. The Canary row matches **every filter except one on an identity column** (an id, an owner such as `member_id` or `created_by`, an email, a slug, a token, `tenant_id`). So a query misses it only when it is scoped to the caller. A uuid column (`id`, `event_id`, `member_id`, `coach_id`, …) matches any Canary id, so `.eq('member_id', <the memberId the caller sent>)` finds the row too. When read, a uuid column shows the value the query pinned it to, and otherwise a distinct per-column Canary id (`honeyColumnId()`) that the caller never sent, so a response of bare ids, foreign keys and a status is still visibly tenant B's. Updates and deletes that match the row, inserts, `rpc()` calls and storage writes that carry a Canary id, slug, path or token (joining B's team, say), are recorded as honey writes. An inserted email the caller typed is not one. Writes made after the response count: `after()` callbacks run and stray promises settle before the case is judged.

### Outcomes and what fails

| Outcome | Meaning | Result |
|---|---|---|
| `leak` | the response holds a honeytoken the caller did not send | fails, unless the snapshot records a reviewed reason |
| `honey_write` | a write touched or referenced a Canary row, or an `rpc()` got a Canary value (its SQL is not modelled) | fails, unless the snapshot records a reviewed reason |
| `oracle` | a 2xx whose status or body changes when the Canary row is removed (a second, differential run): an existence oracle such as `{ exists: !!row }` | fails, unless the snapshot records a reviewed reason |
| `refused` | 4xx, a redirect, `notFound()` | passes |
| `unexercised` | 400, 405, 413, 415 or 422 and no Canary value ever reached the database: validation refused before the id was used, so the case proved nothing | pinned in the snapshot and capped (`MAX_UNEXERCISED`, 5 since wave 1, #528; lower it, never raise it) |
| `ok` | 2xx with none of tenant B's data, no honey write, and the same response without the Canary row | passes |
| `error` | 5xx, a throw, or no answer in 5 s (the harness could not model the path) | pinned in the snapshot and capped (`MAX_ERROR`, 3) |

On top of that, the **participant-refusal rule**, by class:

- a `stellr_only` or `platform_destined` route must refuse the participant with 401, 403 or 404, unless the snapshot records a reviewed reason. That holds by construction (the admin guard runs first), so a change here means a guard moved;
- a `tenant_staff` or `platform_admin` route must refuse the participant with 401, 403 or 404, and **may not accept any outcome**: no reviewed reason can excuse one;
- every `tenant_staff`, `platform_admin` and `platform_destined` handler, with or without an id, also runs the **staff personas**, strictly and with no accepted reason possible: on `tenant_staff`, a Stellr staff member, the canary tenant's admin and a Stellr event manager; on the two platform classes, the canary tenant's admin. A refusal that changes with the row or with a malformed id (a 4xx oracle) fails there (`test/idor/harness.ts`, `STAFF_PERSONAS_FOR`). For the other classes such a refusal is only reported, pinned by a count and hash in the snapshot;
- every outcome must equal the one in **`test/idor/idor-snapshot.json`**;
- the case count must equal the number of id-bearing routes, with a floor of 215, and the snapshot must list exactly those routes. **A new id-bearing route that is not in the snapshot fails the suite.**

### Adding or changing an id-bearing route

1. Run `npm run idor:snapshot`. It reruns the cases and rewrites the snapshot, keeping existing reasons.
2. Read the diff. A new `leak` or `honey_write` is written with `"accepted": "TODO: review"`, which fails. Either fix the route (scope the query to the caller or tenant), or replace the TODO with the reason it is safe, as review will read it.
3. Commit the snapshot with the route.

Five outcomes are accepted today, each with its reason in the snapshot: the view-as `DELETE` (it only clears the caller's cookie), the unsubscribe token (the token is the authority), two community notifications (community is Stellr-only and kept off tenant hosts in S5), and `members/me` writing references to the allergy and ethnicity catalogues. The two community entries are marked `TODO(S5)`.

**What the suite does not prove yet.** Values a route builds without a query (a signed URL from a stored path, say) count only when they carry a honeytoken. The `unexercised` cases (listed in the snapshot) stop at request validation or at a precondition the caller lacks, such as an existing licence row, so their id paths are untested. The `error` cases stop at an unconfigured integration (Stripe, a webhook secret) or a 5xx. Since C12 the harness also registers a fake `tenantDb` driver over the honey database (`test/idor/tenant-db-fake.ts`), but it is reached only by a case whose fixture turns `TENANT_DB_ENABLED` on, and no converted area has one yet. Use `IDOR_DEBUG=<part of a route path>` to print what each method of a route did.

**Tenant hosts.** `test/idor/tenant-host-routes.test.ts` runs an anonymous and a participant persona over the id-bearing routes tenant hosts serve, host A naming host B's records in both directions, Stellr included, and enforces the 4xx oracle there. Those routes start above 0, so `test/baselines/tenant-host-idor.json` holds a cap that only falls, to 0 failing by the S5 gate. A7 took it from 94 failing cases to 82.

### Canary fault injection

`scripts/idor-canary.mjs` (`npm run idor:canary`, and the **IDOR canary** workflow, `.github/workflows/idor-canary.yml`) proves the suites can fail. It runs them intact, then, one at a time in a temp copy under `node_modules/.cache/idor-canary/`, deletes one isolation guard and expects a failure caused by a `leak`, `honey_write` or `oracle`. "Caused by" is checked from a machine-readable results file (`IDOR_RESULTS_FILE`, one JSON line per case), not Vitest's text: the mutated case itself must record a failing outcome. A mutation that only crashes the handler (`error`) counts as survived.

- the five guard styles in `test/idor/fixtures/handlers.ts`, each line marked `CANARY:<name>`: owner filter, owner check after the read, admin guard, tenant filter, owner filter on an update. `test/idor/fixtures.test.ts` runs them through the same harness;
- one real route: the `member_id` filter of `DELETE /api/members/event-participations/[id]`, through `IDOR_ROUTE_OVERRIDE` in the generated suite.

The working tree is never changed. Exit 0: every mutation was caught. Exit 1: one survived, so the suite is blind to that guard. Exit 2: the canary itself is broken, for example a guard line it looks for has moved. The job needs no secrets and runs on pull requests that touch `app/api`, `lib` or the suite, and nightly. It is **non-blocking** until the repository variable `CANARY_ENFORCE` is set to `true` (owner action).

### Two-tenant seed

`scripts/seed-two-tenants.ts` writes the two-tenant fixture into the S3 tables, from the plan in `lib/testing/two-tenant-seed.ts`:

- `tenants`: Canary Academy (AU, AUD, a deliberately invalid ABN). Stellr's own row comes from migration `20261104100000` and is never rewritten.
- `tenant_domains`: `canary-academy.localhost` and `stellr.localhost`, for Playwright once S5 routes by host.
- `events`: one fixture event per tenant. The Canary event uses the honeytoken slug.
- With `--clerk`: three Clerk users (a Stellr participant, a Canary admin, a Canary participant) created through the Backend API on `+clerk_test@example.com` addresses with no password (sign in with a testing token), plus the Canary admin's `tenant_memberships` row. Their `members` rows come from the usual Clerk webhook and onboarding path.

```
npx tsx scripts/seed-two-tenants.ts                  # dry run (default)
npx tsx scripts/seed-two-tenants.ts --apply          # rows only
npx tsx scripts/seed-two-tenants.ts --apply --clerk  # rows + Clerk users + membership
```

It refuses, with no override, when `NEXT_PUBLIC_SUPABASE_URL` names the production project, and with `--clerk` when `CLERK_SECRET_KEY` is not an `sk_test_` key. It is idempotent. It needs the five S3 migrations on the target. Run it against a local or CI database, or dev with the owner's agreement. The S3 tables are read by nothing live, so the fixture cannot change a live flow.
