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
