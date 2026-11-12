# Admin folding sections and record links — 2026-11-12

Slug: `admin-collapse-links`. Handover: `HANDOVER-admin-collapse-links-2026-11-12.md`. Doc snapshot: `1JUXqX-T6hcQ5S_k4yAotmC1vxbpRcqCfj_lUZYVkg8s`.
PR #636 → `dev` as `a8fa2caa`; promoted alone in #639 (`587d2ff3`), `dev` synced by #641 (`e96851e0`). Migration: none.

Admin pages fold section by section, and registered groups fold to a summary line. For admins, member and school names link to their records in a new tab. This is live on production as deployment `dpl_EdHSFCw73qJHGHCDJt6nj1AKy2f1`.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| admin-collapse-links.1 | Admin pages signed in on production | Only the signed-out checks ran: www 200, app 307, cron 401, `/admin/competitions` 307 to sign-in | The owner opens a competition's Roster and Team profiles tabs and a member page, and confirms folds, Expand all / Collapse all, and links opening in a new tab | ☐ |
| admin-collapse-links.2 | A real group's folded header | The dev DB has no group registrations. Covered by `EventRoster.test.tsx` only. | On the first event with a group, check the header line (participants, unpaid, DocuSign, background) and the teacher and school links | ☐ |
| admin-collapse-links.3 | An event manager sees plain names on their event | Unit test passes. A dev check showed 0 links, but the e2e manager has no assigned event. | Sign in as a real event manager on their event and confirm no member or school links | ☐ |
| admin-collapse-links.4 | School link coverage | Unmeasured: typed names link only through a single current school or a unique exact name | If many stay plain, run a read-only count on production of `registrations.school_name` values with no unique `schools.name` match (the owner runs it), and decide whether to normalise names | ☐ |
| admin-collapse-links.5 | This session's worktree `../stellr-web-collapse-links` | Kept: the session was worktree-isolated | `npm run worktrees -- --apply` from the main checkout | ☐ |

## Closes

- `esign-clock-flake.3` and `esign-clock-flake.4`: promotion #633 was closed, not merged, on 12 Nov by the owner's decision, because it had come to carry S5 wave 6 runtime code and A16. `gh pr view 633` reads CLOSED, with a comment. Its contents, #631 and #630 among them, are still on `dev` only and reach `main` with the next full promotion, after A16.
