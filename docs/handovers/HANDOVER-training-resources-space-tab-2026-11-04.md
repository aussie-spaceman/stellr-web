# Handover: Training Resource lessons + Space tab, 2026-11-04

Everything is in production: #530 went to `dev` as `d6f0ee69` and shipped in #522 as `c2817859`, deployment `dpl_3h276Wpetw1DC1p87kYugu2yp7Nu`. The rollback target is `dpl_E6FUXHVS1MJmeFcK9SjxK6i2y2u5` (main `f64deb15`). The promotion record is `.claude/releases/promote-2026-11-04c.md`.

Tracker: `tracker/2026-11-04-training-resources-space-tab.md`.

## What was asked
1. An existing Resource could not be saved to a lesson ("Choose a file to upload.").
2. Viewing a mentor course as a mentor, two lessons the owner believed deleted showed under "More lessons", and 5 of 6 lessons showed in the one section.
3. The Nevada Space said no training was assigned.

## Where each one stands
- **1, fixed.** Proven on production by data: the owner saved lesson `a50f743d` as a Resource with no file and one attached resource.
- **2, fixed by the owner's data clean-up.** No code change could fix those rows. The two lessons had never been deleted: they were published with no section, and the production builder did not list lessons with no section until #519 shipped. The sixth was a draft with no section. Read back: 6 published lessons in the section and no strays.
- **3, fixed in code, partly open.** The tab read only courses linked to the Space itself, so event assignments never appeared. It now shows them. One of the two Nevada volunteers still cannot see this course, because the assignment reaches only the Alumni tier (`.4`). That is a data decision for the owner, with the event on 6 Nov.

Unknown: how `a50f743d` and the two strays lost their section. Deleting a section leaves its lessons in place and visible, which fits but is not proven. The builder now warns about that before deleting.

## What changed
- `components/admin/training/CourseBuilder.tsx`: an attached resource satisfies the file check on a Resource lesson; section delete confirmation; new lessons order after the highest `display_order`.
- `components/admin/training/LessonResources.tsx`: `onCountChange`.
- `app/api/admin/community/training/items/route.ts`: POST requires a file only for video; PATCH to `document` with no upload, no stored file and no resources is refused.
- `lib/training.ts`, `app/(member)/community/training/[moduleId]/page.tsx`: a Resource lesson with no file but with resources shows them, with no player.
- `lib/space-training.ts` (`coursesForSpace`), `app/(member)/community/[spaceSlug]/training/page.tsx`, `lib/training-portal.ts`: the Space tab merges direct links and event or cohort assignments.
- Tests: `lib/space-training.test.ts`, `e2e/core/training-space-tab.spec.ts`, additions to the builder unit and e2e specs.

## Not verified
- The signed-in member view on production (`.3`). CI covers the flows on dev only.
- Everything #522 listed as not verified still stands, including #520's DocuSign re-send against a real envelope and a real JaaS session. Those rows belong to `member-merge-school-email` and `training-recording-builder`.

## Found along the way
- **Membership revoke fails (`.5`).** Seen in runtime errors minutes after the deploy. Not caused by this release.
- **A green `e2e` can hide a flake.** #530's first passing run had one flaky test, visible only in the log. Read the totals, not the badge.
- **`e2e` can be cancelled before it starts.** GitHub keeps one pending job per concurrency group, so a run queued behind another can be displaced with zero steps run. The fix is to re-run it. #525 is open on the e2e lock.

## Mistakes in this session
- My new spec collided with itself. The suite is `fullyParallel`, and all three tests rostered the same member on the same event container, so inserts hit the primary key and one test's clean-up could remove another's row. It now runs serially.
- My first check of that fix used `--repeat-each` under parallel workers, which recreates the collision. I discarded it and ran the real shape.
- I reported "no runtime errors" minutes after the deploy. That was true then, and I said the window was short, but `.5` appeared soon after. Read the errors again at close-out.
