# Handover — Space member roster, suspend/revoke, full-portal view-as (26 Aug 2026)

**Shipped:** `deee46e` (merge of `b05d361`, branch
`feat/space-roster-suspend-impersonation-2026-08-26`). Vercel
`dpl_DQpZixZnQuyWuap5d7AaE7NdKp58` READY and aliased. Migration **142** applied to prod
BEFORE the merge, by hand in the Supabase SQL editor.

96 files, +2614/−248. Typecheck, `npm run build` and 270 tests (22 new) all pass.

**Tick-off table:**
https://docs.google.com/document/d/1wI0PW53tgsPrGjqyEkyXb5mR8uxtbXRqN-b0mbNpgZc/edit

---

## 1. What the request was

1. On `/admin/community/spaces/[id]` — list all members of a Space, their role and
   permissions, and suspend or revoke their Space access.
2. On the individual member page — extend impersonation to the **entire** web app, not just
   their admin page.

Eight clarifying questions were answered before building. The decisions:

| Decision | Chosen |
|---|---|
| Revoke | Permanent negative override, beats tier/role/open/object until lifted |
| Suspend | Separate scope: cannot post, can still read |
| Permissions | Space role only + a read-only "how they got in" badge |
| Write surface | Space Members tab **only**; member record is read-only |
| Open spaces | "Everyone — N" + exceptions, with search |
| Impersonation | Signed cookie, **read only** |
| Person 360 open-space bug | Fixed as part of this work |

## 2. What shipped

**One resolver.** `resolveSpaceAudience(spaceId)` and `resolveMemberSpaces(memberId)` in
`lib/spaces.ts` back the admin roster, the member record and the Person 360.
`loadSpaceAdmin` no longer reads `community_space_members` directly.

A **third** resolver was found on the way: `getMemberAccessSummary` resolved spaces in three
queries and never handled `access_type='open'`, so the Person 360 under-reported every open
Space. It now shares the resolver.

`lib/spaces-audience.test.ts` asserts roster ⟺ audience ⟺ inverse agree. **That test is the
guard. If you add a fifth resolver, wire it in or the drift returns.**

**Migration 142 — `community_space_suspensions`** `(space_id, member_id, scope, reason,
created_by, created_at, expires_at)`, scope `access` | `posting`. Checked in
`resolveSpaceAccess` ahead of every positive grant except the platform-admin bypass, because
deleting a roster row only ever undoes a roster grant.

**Impersonation** — `lib/impersonation.ts`. HMAC ticket, 30-min TTL, admin claim re-checked
every request. `getCurrentMember()` is the seam (~102 call sites in one branch).
`assertNotImpersonating()` guards writes in **53 route files**; Stripe/DocuSign/checkout are
blocked outright.

## 2a. Follow-up pass, same day (`1383d20`)

Browser verification was completed by David: the Members tab, suspend, revoke and a
view-as session are confirmed functional. The three close-out findings below were then
fixed and deployed:

- **`/account` view-as** — `/account`, `/join` and `/account/onboarding` now resolve through
  `impersonatedMemberId()`. `/account` also resolves the viewed member's Clerk **avatar**;
  it previously used `currentUser()`, showing the right name over the admin's face.
- **`update-member-role`** — elevation upserts the roster row that carries the role;
  demotion deletes it only when `resolveDerivedGrant()` confirms the member still reaches
  the Space another way, and otherwise keeps the row so demotion cannot silently remove
  access. Five tests cover it.
- **Block expiry** — suspend and revoke both take an optional end date, and suspend gained a
  confirm step so it reads the same as revoke.
- **Migration 143** (written, NOT applied) — adds `community_space_sources.object_ref` to
  `event_slug_inventory()`.

The items below are what remains.

## 3. Open items — read this before touching the feature

### 3.1 DECISION — apply migration 143

`supabase/migrations/143_event_slug_inventory_space_sources.sql` is written and dry-run but
**not applied**. It is inert for the app: nothing in the running code calls
`event_slug_inventory()` — only `npm run audit:event-slugs` and `check:deploy-ready` do. All
6 Space→event links resolve cleanly today, so applying it does not change the audit's
verdict; it means a future rename cannot break one silently.

### 3.2 DECISION — the second slug blind spot, deliberately left open

`mentoring_cohorts.campaign_ref` holds a bare event slug when
`container_type = 'event_participation'` and is invisible to the audit for the same reason.
Adding it flags **16 rows across 5 slugs**:

| Slug | Rows | Reading |
|---|---|---|
| `nevada-space-design-challenge-2026` | 6 | legacy year-suffixed |
| `nevada-space-design-challenge-2027` | 4 | legacy; the known-dead slug |
| `minnesota-environmental-design-challenge-2026` | 3 | legacy year-suffixed |
| `space-design-campaign-fall-2027` | 2 | reads as a CAMPAIGN slug |
| `environmental-design-campaign` | 1 | reads as a CAMPAIGN slug |

The audit compares against Sanity documents of `_type == "event"` only, so the two campaign
refs would be permanent false positives unless they are recategorised. Sorting legacy rows
from miscategorised ones is a data decision — hence left out of 143.

### 3.3 MEDIUM — realtime under impersonation is unverified

Supabase realtime subscribes as the browser's own identity, so live chat in a Space may not
reach parity during view-as. Flagged before building and never checked.

### 3.4 MEDIUM — `resolveSpaceAudience` scalability

It loads every live member, every active membership and every global role on each call, and
now sits behind an interactive paginated endpoint. Fine at 6 members; not at 6,000. Needs a
cache or a SQL-side view before the member base grows.

### 3.5 LOW

- **Drop `community_space_members.muted`** once confident — kept readable for one release on
  purpose, so a code rollback cannot lose an active mute.
- **Retire `/admin/members/[id]/view-as`** (the old mirror, relinked as "Account summary")
  and its `readOnly` prop plumbing, which is a parallel implementation of the read-only rule.
- ~~Branch cleanup~~ — done, branch deleted locally and on origin.

`lib/object-roles.ts` was flagged at close-out as a possible impersonation gap. It is not:
it is imported only by two `/api/admin/access/**` routes, so it is an admin-manage check and
correctly resolves the real signed-in user.

## 4. Traps worth carrying forward

**The migration could not be applied by tooling.** Supabase MCP `apply_migration` was blocked
by the auto-mode classifier, and `supabase db push` cannot substitute: migrations 138–141 were
applied via MCP with **timestamp** versions (`20260821181103`…) matching no local numeric
filename, so the CLI demands a `migration repair` against prod first. The next migration hits
the same wall — plan for a human to run the SQL, or fix the history.

**Check PostgREST's schema cache after any new table.** Postgres having the table is not
enough; PostgREST 404s with `PGRST205` until it reloads, and `loadSpaceSuspensions()` throws
rather than failing open (deliberate — failing open would silently un-suspend everyone), which
would have 500'd the entire community section. Verify with:

```
curl -s "$SUPABASE_URL/rest/v1/<table>?select=*&limit=1" -H "apikey: <publishable>" -H "Authorization: Bearer <publishable>"
```

`200 []` = cached. `PGRST205` = not yet.

**Cheap proof new code is live:** curl a new admin route unauthenticated. `403` means deployed
and gated; `404` means it is not there.

**Revoked members must not be sold an upgrade.** A revoked member lands in the directory's
`restricted` bucket, which read "Requires Scholar · Upgrade" — a tier that cannot let them
back in. `SpaceSummary.revoked` now branches both `SpaceCard` and `LockedSpace`. Do not
regress this.

**`getCurrentMember()` must force `isAdmin: false` while impersonating**, or the admin's own
claims satisfy every gate and the portal shows an admin's view, not the member's.

**15 admin surfaces also called `getCurrentMember()`** for the acting admin's identity
(`created_by` / `resolved_by`). They now use `getSignedInMember()`. Without that, admin writes
during a view-as session are recorded against the person being viewed.

**Next.js 16 renamed `middleware.ts` → `proxy.ts`**, at the repo root. `find -name
middleware.ts` returns nothing and it is easy to conclude there is no route protection.
Note `/campaigns` and `/join` are not in its matcher (pre-existing).

## 5. Carried over, still unresolved from 25 Aug

- Every teacher can enter every state Challenge Space (all six grant the global `teacher`
  role). Raised twice, never answered.
- Channel structure for the four new event Spaces was chosen silently (one `general` each).
- `event_slug_inventory()` cannot see `community_space_sources.object_ref`, so Space→event
  links are invisible to `npm run audit:event-slugs` and `rename_event_slug()`.
- Two members with blank names now render as their **email** rather than the literal word
  "Member" — an incidental improvement from the new resolver, not a fix for the blank names.
