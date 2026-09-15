# Handover — member delete blocked by coaching/mentoring sessions (13 Aug 2026)

**Branch:** `fix/member-delete-session-blockers` (`bb67fc6`, branched off `main` @ `d7ad474`)
**Status:** pushed to origin, **PR not opened, not merged, NOT DEPLOYED**
**Migration:** none

---

## 1. What was reported

Deleting member `david.shaw@insimeducation.com`
(`8891d25e-1373-4aa6-acee-69fb89e1f6b0`) via the admin member page showed:

> This can't be deleted yet. Remove the following linked items first:
> coaching/mentoring sessions (as host) — 2

…and no amount of deleting sessions cleared it.

## 2. Root cause — three stacked defects

1. **A soft-deleted child still counted as a blocker.** `lib/deletion/registry.ts`
   soft-deletes a `session` to `status='cancelled'` — the row stays. The member's
   dependent count in `lib/deletion/preflight.ts` counted *every* session row
   regardless of status, so deleting a session could never clear the blocker. The
   member was permanently undeletable. `registrations` carries the same latent
   defect (soft-delete = `'withdrawn'`).
2. **No admin affordance to delete a session exists anywhere.** `DeleteEntityButton`
   was wired to schools, courses, events, registrations and participants — never to
   sessions. The only session-delete path was a member-initiated deletion request
   (`app/api/members/deletion-requests/route.ts`). An admin could not clear the
   blocker even in principle.
3. **Orphaned sessions are invisible.** `sessions.cohort_id` is `ON DELETE SET NULL`,
   and the admin mentoring calendar queries `mentoring_cohorts!inner(...)`
   (`lib/mentoring.ts:747`). A mentoring session whose cohort was purged therefore
   renders nowhere while still blocking the delete. Both of this member's sessions
   were in exactly that state.

**Key insight:** `sessions.host_member_id` and `registrations.teacher_member_id` are
both `ON DELETE SET NULL`. These blockers are advisory (blast-radius warnings), not
integrity requirements — cancelled/declined/completed sessions and withdrawn
registrations are history the delete can safely leave behind. Only *live* links
should block.

## 3. What changed

| File | Change |
|---|---|
| `lib/deletion/types.ts` | New `Dependent.inactiveValues` — child states that must never block |
| `lib/deletion/preflight.ts` | Applies it as `.or('<col>.is.null,<col>.not.in.(...)')` |
| `lib/deletion/registry.ts` | Exported `TERMINAL_SESSION_STATUSES`; applied to `member→registrations` (`withdrawn`, `cancelled`), `member→sessions` and `mentoring_cohort→sessions` (`cancelled`, `declined`, `completed`) |
| `app/(admin)/admin/members/[id]/page.tsx` | Loads sessions hosted by the member, flattens the cohort embed, marks orphans |
| `components/admin/AdminMemberDetail.tsx` | New "Coaching & Mentoring (as host)" panel — per-session `DeleteEntityButton`, status pill showing which sessions block, orphan warning |

### Traps encoded in the fix — do not regress

* **PostgREST `not.in` over a NULL column evaluates to NULL**, which silently drops
  the row from a `count`. Always pair it with `<col>.is.null` inside `.or(...)`, the
  way the pre-existing `activeJoin` code does. An unset status means "still live",
  not "already deleted".
* **Any registry dependent whose child has a soft-delete state needs
  `inactiveValues`**, or soft-deleting the child locks the parent for ever. Check
  this whenever adding a dependent to `ENTITIES`.
* `TERMINAL_SESSION_STATUSES` is imported by the client component on purpose, so the
  "blocks deletion" hint cannot drift from what preflight actually counts.
  `registry.ts` has only type-only imports, so it is safe in the client bundle.

## 4. Verification performed

* `npm run build` and `npx tsc --noEmit` pass.
* Ran the real `deletionPreflight` against **live prod data** (via `npx tsx` with
  `.env.local`):
  * reported member: blockers `2 → 1` after the code fix, then `[]` /
    `canDelete: true` after the stale session was cancelled;
  * a member holding one `confirmed` teacher registration: still blocked,
    `count: 1` — the filter suppresses only terminal states, not live ones.
* **Prod data change made:** session `ef7a3343-cd29-4db0-bc3f-f3eff54bcc33`
  ("Cohort-DS Live Mentoring", 19 Jun 2026, 0 participants, orphaned) was updated
  `status: 'scheduled' → 'cancelled'`, `updated_at = now()`. Nothing was deleted.

### NOT verified

* The new admin panel has **never been rendered in a browser** — no Clerk-authed
  local session was available. Compile + typecheck only.
* The per-session delete button has **not been exercised end to end**. It posts to
  the same `/api/admin/deletion` endpoint already used by schools/courses/participants,
  and `session` hard-delete is safe (`session_participants` and `session_actions`
  are `ON DELETE CASCADE`; `coaching_requests.session_id` is `SET NULL`).
* The member itself has **not been deleted** — that was the user's original goal and
  it cannot happen until this branch is deployed.

## 5. Outstanding work for the next session

1. **Open the PR and merge to main** (auto-deploys via Vercel, ~4 min). The branch is
   pushed; `gh` CLI is not installed on this machine and no GitHub token was in the
   environment, which is why the PR was not opened. PR title/body draft lives in the
   session scratchpad and is reproduced in the branch commit message.
   `brew install gh && gh auth login` would let a future session do it directly.
2. **After deploy:** open the member page for `8891d25e-…`, confirm the new
   "Coaching & Mentoring (as host)" panel renders (2 rows, both `cancelled`, both
   flagged orphaned), then complete the delete that started all this.
3. **Check the panel at mobile/tablet widths** — it was never viewed at any width.
   Note the standing trap: the browser pane can silently stay ~685px after
   `resize_window`; assert `window.innerWidth`.
4. **Consider surfacing orphaned sessions in the mentoring admin UI itself** — the
   member page is now the only place they appear, which is fine for unblocking a
   delete but not for finding orphans in general. A left-join variant of the
   calendar query, or an "unassigned sessions" bucket, would close it.
5. **Audit the rest of `ENTITIES` for the same defect class.** `community_space →
   community_posts` already uses `activeFilter`; the remaining dependents
   (`event → registrations`, `event → event_participations`,
   `email_template → email_campaigns`, `school → member_schools`) should each be
   checked for whether their child has a soft-delete state that would lock the parent.

## 6. Correction to note

An earlier statement in this session claimed prod had "14 withdrawn registrations
silently blocking other members". That is wrong: all 14 have a NULL
`teacher_member_id`, so none blocks anyone today. The registrations half of the fix
is **preventive** — the single `confirmed` registration does carry a
`teacher_member_id`, and withdrawing it would have locked that member permanently.
