# esign clock flake and promotion 2026-11-11b — 2026-11-11

Slug: `esign-clock-flake`. Handover: `HANDOVER-esign-clock-flake-2026-11-11.md`. Doc snapshot: `146Y9Eo2iKZgvzBgAUWalpt1otkK_3KeLO096AUv8UAo`.
PR #631 → `dev` as `48a7573d`; promotion #633 open, not merged. Migration: none.

The esign "Stellr's signing mail is unchanged" test no longer flakes on a second boundary: it freezes `Date` at the send's `now`. Promotion #633 (no runtime change) waits on CI and the owner's yes.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| esign-clock-flake.1 | Fix the timing flake in `lib/esign/tenant-sender.test.ts` | #631 merged as `48a7573d`; 50/50 local runs; failure reproduced on purpose before the fix; CI `unit` green | | ☑ |
| esign-clock-flake.2 | Other `lib/esign/` tests comparing two link-bearing mails | None found; `outbox.test.ts` only matches recipient ids by regex | | ☑ |
| esign-clock-flake.3 | Promotion #633 (`dev` → `main`, no runtime change) | Open; CI on head `dee57fa3` queued at close-out; rollback target `dpl_FpFd3LNazBPczbwfgiAcT2Pn4oVv` in the body | Read CI step outcomes; check `git log origin/main..origin/dev` ends at `dee57fa3` (else close #633); owner's yes; merge with `--merge` | ☐ |
| esign-clock-flake.4 | Promote Steps 7–8 for #633 | Not started | After the merge: deployment status on the merge SHA, www/app/cron checks, then the record PR (`promote-2026-11-11b.md`) merged into `dev` with `--merge` | ☐ |
