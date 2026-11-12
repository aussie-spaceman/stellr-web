# Handover: admin folding sections and record links, 11–12 Nov 2026

The owner asked for two admin usability changes on the competitions page, applied the same way across the admin portal:

1. Let every long section, and every registered group, fold down so the page is easier to scroll.
2. Make every student and school name a link to its member or school record.

The request also asked for at least five clarifying questions and a deploy. The owner answered seven:

| Question | Owner's answer |
|---|---|
| Folded header | A one-line summary with counts, plus Expand all / Collapse all |
| Default state | Remembered per browser and per event. Sections start open and groups start folded. |
| Who sees links | Admins only. Event managers keep plain names. |
| Which names | Every person (students, teachers, mentors, volunteers) and every school |
| School match | The member's current school, then a unique exact name match, else plain text |
| Link target | A new tab |
| Scope | All long admin pages, using one shared component |

## State

| Thing | State |
|---|---|
| `dev` | #636 squashed as `a8fa2caa`, plus `3d8262ed`'s contrast fix inside it. The dev deployment `stellr-web-igxy9g0sn` was Ready. |
| Production | #639 merged into `main` as `587d2ff3`. Deployment `dpl_EdHSFCw73qJHGHCDJt6nj1AKy2f1` serves www. Smoke checks passed. Record: `.claude/releases/promote-2026-11-12.md`. |
| `dev` ↔ `main` | #641 merged `main` back into `dev` (`e96851e0`). `dev` contains `587d2ff3`. |
| Migration | None |
| #633 | Closed on 12 Nov, the owner's call. See "Promotion" below. |

## What changed

- **`@stellr/web-ui` `Collapsible`, `CollapsibleGroup`, `CollapseAllControls`** (`packages/web-ui/src/Collapsible.tsx`, story `Primitives/Collapsible`).
  - The header is a button inside a heading, with `aria-expanded` and `aria-controls`.
  - A folded body is `hidden`, not unmounted, so filters and half-typed forms survive a fold.
  - The open or folded state is saved in localStorage as `stellr.collapse.<storageKey>:<id>`.
  - Summary text uses `content-muted` on white, and `content-body` on the `primary` and `muted` tones. `content-muted` measured 4.27:1 on `primary-soft` and 4.21:1 on `line-light` (hover), and Storybook's axe check failed it.
- **Where it is used:**
  - every competition event tab, each with Expand all / Collapse all
  - each registration on the Roster tab, folded to "Group: … · N participants · N unpaid · N DocuSign open …"
  - member detail, school detail, campaign detail, consent forms, surveys and the admin dashboard panels
- **Record links:** `components/admin/RecordLinks.tsx` holds `MemberLink`, `SchoolLink` and `RecordLinksProvider`. The admin layout enables them from the viewer's role, so event managers get plain text.
- **School ids:** `lib/school-ids.ts` (read-only) resolves free-text school names. It uses the member's single current `member_schools` row first, then an exact, case- and space-insensitive name match that is unique in `schools`. Otherwise it returns null, and the name stays plain. `%` and `_` are matched literally.
- **Roster school queries:** `getEventRoster(..., { resolveSchools })` runs the school queries only for the Roster tab. Check-in polling and exports don't run them.
- **Email history:** each send's history row now also stores the recipient's member id, so a name can link. Who receives mail is unchanged.
- **Left plain on purpose:**
  - the check-in desk, which is a kiosk
  - names inside checkbox labels, select options and buttons
  - guardians
  - rows with no member id
  - email history from before this change

## Promotion

`dev` carried S5 wave 6 Lanes A and C (#624, #625), and Lane A brings migration A16. A16 must reach production before its code, by the owner's route (`s5-programme.3`). Agents stay off the production database. So the owner chose to promote #636 alone:

1. Cherry-pick it onto `main` (PR #639). It applied without conflicts, and the dependencies were the same on both sides.
2. On that branch: `tsc`, `lint:tokens` and `eslint` are clean, and 11,971 unit tests pass.
3. CI passed in full.

GitHub's squash had added a co-author trailer carrying the account's email address. It was dropped from the cherry-picked commit message, because `lint-pii --stdin` flags it.

#633 was the earlier `dev` → `main` promotion. It follows `dev`'s head, so it now carried S5 runtime code and A16, against its own stated condition. It was closed with a comment. Everything else on `dev` since `ccf45694` waits for the next full promotion, after A16:
- #626–#635 (docs, the esign test fix #631, the CI Playwright fix #630)
- S5 wave 6 (#624, #625, #637, #638)
- #640

## Not verified

- **Admin pages signed in on production.** Only the signed-out checks ran. Row `.1`.
- **A real group registration.** The dev database has no groups, so the group header (folded summary, teacher and school links) is covered by `EventRoster.test.tsx` only. Row `.2`.
- **An event manager on an assigned event.** The e2e event manager has no dev event, so the plain-names behaviour is covered by the unit test, and by a dev check that showed 0 links on the pages they can open. Row `.3`.
- **School link coverage.** How many typed school names actually resolve is unmeasured. Row `.4`.

## Observed, not this session's

22 of the last 60 commits on `dev` carry a `Co-authored-by:` trailer with the account's email address. GitHub adds it on squash merges. The address is a staff one, but `lint-pii` flags it, and the repo is public. Whether to stop it, for example by squash-merge message settings or by committing with the noreply address, is the owner's call. It is not tracked here.

## Worktree

This session was isolated in `../stellr-web-collapse-links`, so it could not reach the main checkout. The worktree stays until the next `npm run worktrees -- --apply` from the main checkout.

Tracker: `tracker/2026-11-12-admin-collapse-links.md`.
