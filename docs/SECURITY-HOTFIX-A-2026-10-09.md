# Security hotfix A — 9 Oct 2026

Fixes the three Critical findings from the 8–9 Oct deep review that were live in
production. Finding detail lives in the local-only `code-review-report.md` (kept
out of git because this repo is public); this doc describes the fixes and the
one operational step for `promote`.

Branch: `fix/security-hotfix-a` → `dev`. No production change happens here.

## What changed

### C-1 — registration must not sign an anonymous caller in as someone else
`lib/clerk-provisioning.ts`: `ensureClerkUserAndSignInToken` now takes
`{ memberIsNew }` and returns a sign-in token **only when this request created
both the Clerk user and the member row**. Otherwise it returns `signInToken:
null`, and the three public registration routes
(`app/api/register/{individual,group,group-join}`) now also skip the eager
`clerk_user_id` link unless a token was minted. The legitimate returning-member
sign-in still works through Clerk's normal email flow; the `user.created`
webhook still links by email. Each route captures whether the member row
pre-existed *before* its upsert.

### C-2 — admin pages gated in middleware, not just the layout
`proxy.ts`: `/admin(.*)` is now authorised in middleware. A `redirect()` thrown
in `app/(admin)/layout.tsx` does not stop the page segment beneath it from
rendering and serialising its data to a direct RSC request, so the check has to
run before the render. Non-admins are redirected to `/account`; event managers
are still confined to `/admin/competitions(.*)`. This gates the admin **pages**
only — `/api/admin/*` routes keep their own per-handler guards and are not
matched by `isAdminRoute`.

### C-6 — revoke public access to the `entitlements` schema
`supabase/migrations/20261009162158_revoke_entitlements_public_execute.sql`:
revokes `EXECUTE` on every `entitlements` function from `public`/`anon`/
`authenticated`, revokes schema `USAGE` from `anon`/`authenticated`, and stops
future functions there being auto-granted to `PUBLIC`. The app reaches this
schema only through the service-role key, which is unaffected.

## Migration status — READ BEFORE PROMOTE

- **dev:** applied 9 Oct and verified — `anon`/`authenticated` now hold EXECUTE
  on **0 of 15** `entitlements` SECURITY DEFINER functions; `service_role` keeps
  all 15. The ledger version is `20261009162158`, matching the filename.
- **production:** **NOT applied.** C-6 is still open in prod until this runs.
  During `promote`, apply this migration to production **before** the code
  merges (promote skill Step 3), with explicit approval, then re-run
  `db:status -- --prod`. Verify afterwards with (read-only):
  ```sql
  select count(*) filter (where has_function_privilege('anon', p.oid, 'execute'))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'entitlements' and p.prosecdef;   -- expect 0
  ```

## Tests

- `lib/clerk-provisioning.test.ts` (new, 4 cases): a token is minted only when
  both the Clerk user and the member row are new; refused for an existing Clerk
  account, and for a new Clerk user bound to an existing member row. Mutation-
  checked (3 of 4 fail without the guard).
- `e2e/core/access-control.spec.ts` (new case): a member's direct RSC request to
  `/admin/members` must not contain other members' data. Mutation-checked
  (fails against the pre-fix `proxy.ts`).
- Full local gate green: `tsc`, `lint:tokens`, `lint:migrations`, 1,528 unit
  tests, `next build`, and the access-control e2e on a local production build.

## Still open (not in this PR)

Next batches from the review, to ship separately:
- **B:** C-3 (anonymous routes overwrite existing members) and C-5 (one child's
  consent reused for a sibling via email-only identity).
- **C–E:** the High findings (safeguarding, privacy, email, payments incl.
  PAY-3 renewals on the `dahlia` webhook version).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
