# Training recordings + lesson builder — 2026-11-04

Slug: `training-recording-builder`. Handover: `HANDOVER-training-recording-builder-2026-11-04.md`. Doc snapshot: `1S-Frnbu-VBflAHeVxpOT4zM_QXh4KBl6UwR6yDO0A9w`.
PR #519 → `dev` as `37cd2f7b`, #529 → `dev` as `a3f79845`; NOT promoted by this session, promotion #522 is open. Migration: `20261104500000_recording_offloads.sql`, on dev and production.

Recording status and retry, deleting recordings, resources on new lessons, and lesson drag-and-drop are on `dev`. Production still runs main `f64deb15` at the time of writing, and recordings over 50 MB cannot save until the storage plan changes.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| training-recording-builder.1 | Promote #522 | Open at `a3f79845`. verify, db and e2e passed (182 passed, 45 skipped, none flaky); osv-scanner red, report-only. Table on production, read back. The owner held the merge here; another session is promoting. | Re-read `origin/main..origin/dev`, update the PR body, get the owner's yes, merge. The PR body is also the promotion record draft. | ☐ |
| training-recording-builder.2 | Recordings over 50 MB, so the 30-minute goal | Cannot save: Supabase Free caps a file at 50 MB, and dev returned 413 at 60 MB with no bucket limit. After promotion they show a reason instead of vanishing. The owner has not decided. | Owner decides on Supabase Pro (recommended), then raise `community-resources.file_size_limit` on production, currently 50 MB. | ☐ |
| training-recording-builder.3 | The lost 4 Nov recording on lesson `93be8eae` | Six webhook attempts failed `EntityTooLarge`, 20:09–20:13 UTC 4 Nov, and the link was never stored. Only JaaS could still hold it, until about 20:09 UTC 5 Nov, and its docs mention no console re-download. Unknown whether the owner checked. | Owner checks the JaaS console before then, otherwise re-records. | ☐ |
| training-recording-builder.4 | **HIGH** A real JaaS session | Only signed test webhooks so far. The room timer, `stopRecording` and the status panel have never run against a real room. | Record one short lesson on production after promotion and read the status panel. | ☐ |
| training-recording-builder.5 | A file over 50 MB | Largest proven: 40 MB on dev, byte-exact, range request answered 206. The streamed copy is untested above that. | Record 30 minutes once .2 is done. | ☐ |
| training-recording-builder.6 | Failure alert email; Retry on a live link | Unit tested only. No email seen in an inbox. | Read the first real failure if one occurs. | ☐ |
| training-recording-builder.7 | Phone-width fix in the course builder | `min-w-0` added; overflow not re-measured. | Measure at 375 px. | ☐ |
| training-recording-builder.8 | Production watermark job | A `video_watermark_jobs` row for an earlier recording sat pending with 0 attempts. Not investigated, and it may mean the worker does not run. | Check whether the worker runs on production. | ☐ |
| training-recording-builder.9 | `survey.spec.ts:68` flake | Failed once and passed on retry on dev's run of `a3f79845`; clean on #522. Not investigated. | Read the failure if it repeats. | ☐ |
