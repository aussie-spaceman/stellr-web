# Handover: duplicate member cleanup, and member delete now removes the Clerk login (24 Sept 2026)

TRACKER: Session 16 (items 16.0–16.8).
Code: PR #192 → `dev` as `9741a3d`. Promotion follows in the same session (see the release record for 24 Sept).

## What was asked

1. The maintainer found three "Jack Campbell" members, all registered for CO SDC, and permanently deleted two of them in
   different orders:
   - chriscam2: member first, then removed from the event;
   - aasaldana: removed from the event first, then the member.

   The ask was to review the code and logs and confirm the deletes left no problems.
2. Later requests:
   - **Ignore the withdrawn registrations.** They stay in the member DB for future outreach.
   - Delete the two leftover Clerk users.
   - Change the delete process so Clerk logins are removed in future.
3. Ship, then close out and promote.

## Findings (read-only, production)

| Check | Result |
|---|---|
| `members` | Only `e021b94e-3082-4d01-bad2-114474223185` (adelita.campbell@uchealth.org) remains, active, Clerk linked. |
| Archive snapshots | `deletion_archive` holds four rows: members `962c8ae3…` (chriscam2) and `e926acca…` (aasaldana), plus participants `477cb706…` and `eb9096b2…`. |
| Delete order | Both orders behaved correctly. With the member deleted first, `participants.member_id` was already NULL when the participant was removed (the database sets it to NULL). |
| Registrations | `e26afd3a…` and `7c58fc28…` are individual registrations, withdrawn automatically (`individualRegToTidy`), with 0 participants. The only live Campbell registration is `9f72c6eb…` (confirmed, 1 participant). |
| Leftover references | Swept every uuid and `*_id` column in `public` for the 8 IDs. The only hits were `audit_log` (history) and two empty `mentoring_cohorts` group containers for the withdrawn registrations. The maintainer chose to keep those. |
| Survivor | On roster cohort `9f32fb28…` as an active participant. DocuSign envelope `49f70c40…` is completed. |
| Vercel logs, 21:23–21:25Z | Four `DELETE /api/admin/deletion` requests, all 200. No errors. One warning at 21:24:59: `[docusign-webhook] No envelope record for e790dae1-f168-8aed-8249-e3306f13f59a`. Most likely the void notice for a deleted participant's envelope, arriving after the row had cascaded away. Not confirmed (16.5). |

## Root cause of the Clerk gap

`executeDeletion` hard-deletes the `members` row, but nothing deleted the Clerk user. On the next sign-in there is no row with
that `clerk_user_id` and no row with that email. Onboarding (`app/api/members/onboarding/route.ts`) then inserts a brand-new
member, which is a duplicate of the purged one. Soft delete and Deactivate don't have this problem: the row keeps its email,
so onboarding's email match relinks the login to it.

## What shipped (#192)

| Piece | Where |
|---|---|
| `cleanupClerkForMember(memberId)`. Reads `clerk_user_id` before the row goes, then deletes the Clerk user. It skips (reported `ok:false`) when the login belongs to a staff account (`publicMetadata.role` is `admin` or `event_manager`) or another member row is linked to it. A 404 counts as done. Errors are reported and never stop the delete. | `lib/deletion/external.ts` |
| `'clerk'` added to `ExternalCleanupKind` and to the member entity's `external`. `runExternalCleanup(def, id, mode)` runs it only when `mode === 'hard'`. | `lib/deletion/types.ts`, `registry.ts`, `execute.ts` |
| On "Permanently delete" for a member, the dialog says the sign-in account is deleted too. | `components/admin/DeleteEntityButton.tsx` |
| 9 unit tests | `lib/deletion/external.test.ts` |

CI on #192: `verify` passed every step. The log shows `lib/deletion/external.test.ts (9 tests)` and 86/86 files. `e2e` passed.
No migration.

## Not done, or not proven

- **16.1** I declined to delete the two Clerk users, because permanently deleting accounts is for the maintainer to do.
  They are `user_3JCv5NpvMg0Uqy089QDVfKqW0gB` (chriscam2@gmail.com) and `user_3JCuVNFLz662M7ogxvvFCycIxal`
  (aasaldana@gmail.com). Deleting them is safe: `user.deleted` in `app/api/webhooks/clerk/route.ts` will match no row.
- **16.3** No real Clerk deletion has gone through the new path yet.
- **16.4** Earlier purges left logins behind. 54 member purges are archived (11 Jun to 24 Sept). 30 of them had a Clerk
  login when purged:
  - 2 are the Campbells (16.1);
  - 2 are the maintainer's own logins, re-linked to live members: `user_3Exea9xaLjGMtewubsfhr6obccp` →
    `abaf744b…` (david.michael.shaw@gmail.com) and `user_3ExgRb5mg9NtHXeDcCkcsx9k2U5` → `3bfe6a67…`
    (david.shaw@stellreducation.org). **Never delete these two.**
  - Up to 26 may still exist in Clerk with no member behind them.

  To list them:

  ```sql
  select a.entity_id, a.snapshot->'members'->0->>'clerk_user_id' as clerk_user_id,
         a.snapshot->'members'->0->>'email' as email, a.deleted_at
  from deletion_archive a
  where a.entity_type = 'member'
    and a.snapshot->'members'->0->>'clerk_user_id' is not null
    and not exists (select 1 from members m
                    where m.clerk_user_id = a.snapshot->'members'->0->>'clerk_user_id')
  order by a.deleted_at;
  ```

  Related: TRACKER 15.8 (count Clerk users against `members.clerk_user_id`).
- **Dialog wording** wasn't checked in a browser (the admin pages need a signed-in admin). Low risk: one conditional paragraph.
- **16.7** When the Clerk user is deleted, Clerk's `user.deleted` webhook can arrive before `archiveEntity` runs. It then
  soft-updates the row (clears `clerk_user_id`), so the archive snapshot records a NULL login. This is cosmetic, but it makes
  16.4-style audits miss future purges.

## Where to start next time

Read TRACKER Session 16. 16.1 and 16.4 are the ones that matter. Check both against Clerk before deleting anything.
