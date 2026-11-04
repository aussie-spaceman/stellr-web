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
| `platform_admin` | Stellr platform staff, across tenants | an admin check |
| `tenant_staff` | a tenant's own staff, inside that tenant | an admin check (S5 adds the tenant-membership check) |
| `stellr_only` | Stellr's own admin portal and the `/api/admin` routes behind it | an admin check |
| `participant` | a signed-in member, on their own records | a session check (an admin check also counts) |
| `public` | anyone, no session | API: a rate limit, or an allow-listed reason. Pages: nothing |
| `webhook` | a third party calling in | a signature or shared-secret check |
| `cron` | Vercel Cron | `guardCron` in the **first statement** |

A capability token in the URL or a cookie (register, sign, survey, team profile, check-in) counts as **public**: the handler checks the token, and the class still requires a rate limit.

### The rule for today's admin surface

Every `/admin` page and every `/api/admin` route is **`stellr_only`**. None of them is tenant-scoped yet: they read and write Stellr's data by global id. When S5 converts one to `loadScoped`/`tenantDb`, it moves to `tenant_staff` (it acts inside one tenant) or `platform_admin` (it acts across tenants: staff roles, impersonation, integration health). The test asserts both of those classes are empty until then, so the first move is a deliberate diff to the test. The one exception is `app/api/admin/sanity/event-sync`, which Sanity calls with a shared secret and no admin session: it is a `webhook`.

Community routes are `participant`. That they must never be reachable on a tenant host is a separate rule (the S5 host allow-list), not an access class.

## Adding a route or page

1. Create the file. `npx vitest run test/route-manifest.test.ts` now fails with "add these to lib/security/route-manifest.ts".
2. Add one line to the right section of `ROUTE_MANIFEST`, choosing the class with the table above. Decide by **who calls it**, not by the folder it sits in: a route under `/api/members` that anyone can call is `public`.
3. Call the guard for that class in every exported handler (`GET`, `POST`, …), either directly or through a function in the same file. For a page, the default-exported component must call it.
   - Admin check: `requireAdminPage`, `isAdminClaims`, `currentUserIsAdmin`, `currentUserHasScope`, `requireEventAccess`, `requireScholarshipAdmin`, `requireSurveyAdmin`, `canManageStoreCatalog`, or an inline `role === 'admin'` where the role is read from `sessionClaims` and the handler calls Clerk's `auth()` or `currentUser()`. A role from the request body or a database row does not count.
   - Session check: `auth()`, `currentUser()`, `getCurrentMember`, `getSignedInMember`, `getOnboardedMember`, `currentStoreMember`, `resolveRequestMember`, and the other helpers in `DELEGATE_GUARDS`.
   - Rate limit: `rateLimitGuard` or `checkRateLimit` (the e-sign routes use `throttle`).
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

- **Targets.** `lib/security/idor-targets.ts` takes every route handler in the manifest that a caller can point at a record: a dynamic path segment (`[id]`, `[slug]`, `[...path]`), or an id-like query parameter or body field. The fields come from `requestIdInputs()` in `lib/security/route-ast.ts`, which parses the file (`searchParams.get('teamId')`, `const { memberId } = await req.json()`, `body.event_slug`, `form.get('spaceId')`, and the keys of a `z.object({…})` in a file that reads a body). On 4 Nov 2026: 211 routes (127 `stellr_only`, 60 `participant`, 22 `public`, 2 `webhook`). Pages are not targets yet; S5 adds a page pass with tenant hosts.
- **Cases.** `test/idor/idor-routes.test.ts` emits one case per target and runs every exported method of the real handler. Each id input carries a **honeytoken**: a fake id or value of the canary tenant "Canary Academy" (AU/AUD), from `lib/testing/honeytokens.ts`.
- **Boundaries.** Auth and the database are mocked at the module boundary (`test/idor/mocks.ts`, `test/idor/harness.ts`): `@clerk/nextjs/server` answers as the tenant-A participant, `@supabase/supabase-js` returns `test/idor/honey-db.ts`, Stripe rejects, global `fetch` returns 503 and raw sockets refuse to connect. No network, no real database, no secrets. The whole suite takes a few seconds.
- **The honey database.** Every table holds one Canary row, plus the caller's own `members` row. The Canary row matches **every filter except one on an identity column** (an id, an owner such as `member_id` or `created_by`, an email, a slug, a token, `tenant_id`). So a query misses it only when it is scoped to the caller. Updates and deletes that match it, and inserts or storage writes that carry a Canary value (joining B's team, say), are recorded as honey writes.

### Outcomes and what fails

| Outcome | Meaning | Result |
|---|---|---|
| `leak` | the response holds a honeytoken the caller did not send | fails, unless the snapshot records a reviewed reason |
| `honey_write` | a write touched or referenced a Canary row | fails, unless the snapshot records a reviewed reason |
| `refused` | 4xx, a redirect, `notFound()` | passes |
| `ok` | 2xx with none of tenant B's data and no honey write | passes |
| `error` | 5xx, a throw, or no answer in 5 s (the harness could not model the path) | pinned in the snapshot |

On top of that:

- a `stellr_only` route must refuse the participant with 401, 403 or 404. That holds by construction (its admin guard runs first), so a change here means a guard moved;
- every outcome must equal the one in **`test/idor/idor-snapshot.json`**;
- the case count must equal the number of id-bearing routes, with a floor of 200, and the snapshot must list exactly those routes. **A new id-bearing route that is not in the snapshot fails the suite.**

### Adding or changing an id-bearing route

1. Run `npm run idor:snapshot`. It reruns the cases and rewrites the snapshot, keeping existing reasons.
2. Read the diff. A new `leak` or `honey_write` is written with `"accepted": "TODO: review"`, which fails. Either fix the route (scope the query to the caller or tenant), or replace the TODO with the reason it is safe, as review will read it.
3. Commit the snapshot with the route.

Five outcomes are accepted today, each with its reason in the snapshot: the view-as `DELETE` (it only clears the caller's cookie), the unsubscribe token (the token is the authority), two community notifications (community is Stellr-only and kept off tenant hosts in S5), and `members/me` writing references to the allergy and ethnicity catalogues. The two community entries are marked `TODO(S5)`.

**What the suite does not prove yet.** Every route is Stellr-only today, so there is no tenant-staff caller to test. When S5 moves the first route to `tenant_staff` or `platform_admin`, the suite's first case fails on purpose; add a tenant-A admin persona for those routes then. Values a route builds without a query (a signed URL from a stored path, say) count only when they carry a honeytoken.

### Canary fault injection

`scripts/idor-canary.mjs` (`npm run idor:canary`, and the **IDOR canary** workflow, `.github/workflows/idor-canary.yml`) proves the suites can fail. It runs them intact, then, one at a time in a temp copy under `node_modules/.cache/idor-canary/`, deletes one isolation guard and expects a failure caused by a `leak` or `honey_write`:

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
