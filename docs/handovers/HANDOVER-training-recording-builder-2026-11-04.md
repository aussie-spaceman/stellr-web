# Handover: Training recordings + lesson builder, 2026-11-04

**This session did not promote anything.** The code is on `dev` (#519 `37cd2f7b`, #529 `a3f79845`). Promotion #522 is open and passed CI; the owner held the merge here and is promoting from another session. Only the migration has reached production.

Tracker: `tracker/2026-11-04-training-recording-builder.md`.

## What was asked
1. Delete recordings in Edit Lesson.
2. Attached Resources available when creating a lesson.
3. Fix recording saving: a roughly 5-minute video on lesson `93be8eae` vanished after "recording processing". Show the status, support recordings up to 30 minutes, and advise whether that video is recoverable.
4. Drag and drop lessons within and between Sections.

## Where each one stands
- **1, 2 and 4:** built, on `dev`, covered by `e2e/core/training-builder.spec.ts`.
- **3, status:** built. Exercised with signed test webhooks, not a real room (`.4`).
- **3, 30 minutes: not delivered.** The timeout is gone, because the webhook acknowledges first and streams the copy in `after()`. The Supabase Free plan still refuses any file over 50 MB, so a 30-minute recording will fail with a reason shown. It needs the owner's plan decision (`.2`).
- **3, recovery:** probably not recoverable from our side (`.3`).

## Why the video was lost
JaaS sent the webhook six times between 20:09 and 20:13 UTC on 4 Nov. Every upload failed with `EntityTooLarge`, and the old route stored the link only after a successful copy, so nothing recorded that a recording existed. The route now saves the link first, so a failed copy can be retried until the link expires (24 hours).

## What changed
- `recording_offloads` table, service role only: phase, source link and expiry, error, attempts.
- `lib/recording-offload.ts`: accept, streamed copy, one transient retry, failure alert. An older recording stays playable if a new one fails.
- `lib/recording-view.ts`: phase and message, with stale timeouts (saving 6 min, processing 30 min, recording 6 h).
- `app/api/webhooks/recording/route.ts`: saves the link, acknowledges, `after(runOffload)`. Answers 500 if the link cannot be saved.
- `app/api/admin/community/training/recording/route.ts`: GET status, POST started/ended/retry, DELETE.
- `components/admin/training/`: `RecordSession` status panel, `LessonResources` draft mode, `CourseBuilder` lesson drag and arrows across Sections.
- Signed URLs for recordings and lesson videos last 4 hours instead of 120 seconds, for members too.

## For whoever promotes
- The migration is already on production with the ledger realigned, so do not re-apply it. It must stay: the new webhook answers 500 without that table.
- #522's body is the promotion record draft. It covers #519, #520, #521 and #529 only, and carries the rollback target `dpl_E6FUXHVS1MJmeFcK9SjxK6i2y2u5` (main `f64deb15`). This handover's PR will join what ships, and so will anything else that lands on `dev`.
- #520 came from another session and has limited verification, with Nevada on 6 Nov. See that session's handover.
- `db:status --prod` lists `20260910140426` and `20260910140427` as pending. Both were applied on 10 Sept under other timestamps; this session left them alone.

## Mistakes in this session
- #522's e2e caught a real bug of mine: the drop line took up space, so a drop at a row's top edge landed at the end of the Section. Fixed in #529.
- My first drag spec flaked because the admin header grows 8 px after load. The spec now waits for layout to settle.
- `pkill -f "next dev" -P 1` was too broad during local checks and may have stopped another session's orphaned dev server. Later kills targeted the port only.

## Open items
See the tracker: `.1` promote, `.2` storage decision, `.3` lost video, `.4` real JaaS session (HIGH), `.5`–`.9` smaller unproven paths.
