# Route manifest and AST guard check

Stage 2 of the multi-tenant plan. Every route handler (`route.ts`/`route.tsx`) and every page (`page.tsx`) under `app/` is listed in **`lib/security/route-manifest.ts`** with one access class. **`test/route-manifest.test.ts`** fails when:

- a route or page file is not in the manifest, or an entry names a file that is gone (the 100% classification gate);
- a handler does not call the guard its class needs, found by parsing the file with the TypeScript compiler (`lib/security/route-ast.ts`), not by regex;
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
   - Admin check: `requireAdminPage`, `isAdminClaims`, `currentUserIsAdmin`, `currentUserHasScope`, `requireEventAccess`, `requireScholarshipAdmin`, `requireSurveyAdmin`, `canManageStoreCatalog`, or `….role === 'admin'`.
   - Session check: `auth()`, `currentUser()`, `getCurrentMember`, `getSignedInMember`, `getOnboardedMember`, `currentStoreMember`, `resolveRequestMember`, and the other helpers in `DELEGATE_GUARDS`.
   - Rate limit: `rateLimitGuard` or `checkRateLimit` (the e-sign routes use `throttle`).
   - Webhook: the provider's verifier (`constructEvent`, svix `verify`, `verifyConnectHmac`, …) or `timingSafeEqual`/`safeStrEqual` against the shared secret.
   - Cron: `const blocked = guardCron(req)` as the first line of `GET`.
4. Run the test again.

The full list of recognised calls is `BASE_GUARDS` and `DELEGATE_GUARDS` in **`lib/security/route-guards.ts`**.

## A new guard helper

Add it to `DELEGATE_GUARDS` with its file and the kinds it provides. The test reads the helper's source and fails unless it really reaches a base check of those kinds (directly, or through another listed helper). A same-file function that merely borrows a guard's name (`function getCurrentMember() {}` inside a route) is not trusted.

## Exceptions

`GUARD_EXCEPTIONS` in `lib/security/route-guards.ts` lists handlers exempt from their class's rule, keyed `<file>#<METHOD>` (or `#default` for a page), each with the reason and what protects it instead. `EXPECTED_EXCEPTIONS` in the test pins the count, so adding one changes two files in the same diff, where review sees it. An entry whose handler is gone, or which now passes on its own, fails the test until it is removed. Entries marked `TODO(S5)` are known gaps to close, not accepted designs.

## What the check does not prove

- That the guard's result is acted on. It proves the call is made, not that a `false` leads to a 401.
- Object-level authorisation (that member A cannot read member B's row). That is the S2 cross-tenant and IDOR generator's job.
- Guards in `proxy.ts`. Middleware is a second layer; pages and handlers must still guard themselves (deep review C-2, AUTH-1).
- Metadata routes (`robots.ts`, `sitemap.ts`, `manifest.ts`) and layouts are not listed: they are not route handlers or pages.
