# Check-in banner — 2026-10-15

Slug: `check-in-banner`. Handover: `HANDOVER-check-in-banner-2026-10-15.md`. Doc snapshot: `1g56Cjv7TdGf7do4DfiNe10jonUCJ1CSdIKTsOhHJxkw`.
PR #422 → `dev` as `e93281b6`; promoted in #423 (`4545b3a7`). Migration: none.

One reusable banner for every in-person event. `/check-in` redirects (307, no-store) to the in-person event whose check-in is open. With none open, it says check-in isn't open yet. Opening one in-person event's check-in closes the others. Admin → Competitions → Check-in banner has the SVG/PNG QR files. Live in production since 15 Oct.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| check-in-banner.1 | **HIGH** Colorado's check-in still open on prod | Prod `event_settings` read 15 Oct: `colorado-space-design-challenge` has `check_in_open = true`. Prod `/check-in` 307s to Colorado's form, which also hands its code to any visitor | Competitions → Colorado → Check-in → **Close check-in**. Then `curl -sI https://www.stellreducation.org/check-in` returns 200 | ☐ |
| check-in-banner.2 | **HIGH** Banner artwork from the live QR files, proof scanned | No prod download yet. Encoding is proven only for the local URL (byte-identical PNG) | Signed in on prod, open the banner page and download the SVG; confirm the page shows no dev warning. Brief the designer, then scan a proof with an iPhone and an Android phone before Nevada (6 Nov) | ☐ |
| check-in-banner.3 | First real banner use (Nevada SDC, 6 Nov) | Flow proven on dev data only. Overlaps `event-check-in-v2.1`, which stays that session's row | On the day: open Nevada on prod, scan the banner, check in one staff member by name + DOB, confirm the console shows "The check-in banner points here" | ☐ |
| check-in-banner.4 | Event-manager path | Tested as admin only. An event manager opening their event closes any other in-person event, including one they don't manage. The banner page allows any event manager | Sign in on dev as an assigned event manager: open the banner page; open check-in on their event while another is open | ☐ |
| check-in-banner.5 | No e2e for the banner | CI e2e passed, but no spec requests `/check-in` | Add a smoke spec: with nothing open, `/check-in` is 200 with "isn’t open yet". With a Sanity-backed dev event opened through the admin API, it is a 307 to `/check-in/<slug>?t=`. Restore the row in afterEach | ☐ |
| check-in-banner.6 | Re-decide the DOB-guess limit | `event-check-in-v2.8` was framed as "token-gated, at the venue". With a public banner URL, the token is one redirect away while check-in is open. The limiter is still per warm instance | David's call: accept, or move the per-name limit to a shared store | ☐ |
| check-in-banner.7 | Local leftovers | Worktree `../stellr-web-check-in-banner` holds the close-out branch and an untracked `AGENTS.md` written by `next dev`. Local `feat/check-in-banner` (tip `608247b1` = #422 head) remains | From the main checkout, after the close-out PR merges: delete `AGENTS.md` in the worktree, `git worktree remove ../stellr-web-check-in-banner`, `git branch -D feat/check-in-banner docs/close-out-check-in-banner` | ☐ |
