# Check-in desk: groups, scanning, offline — 2026-10-30

Slug: `check-in-desk`. Handover: `HANDOVER-check-in-desk-2026-10-30.md`. Doc snapshot: `1rGKRUybEigGLUD-xoVteQcy-mfAgbrpHc_RsLeKZxDI`.
PR #484 → `dev` as `2b6970f3`. Promoted in #485 (`185e3356`, production `dpl_BwZabiv7uEgRqQ7n1aWNhTFc5aHU`). Record PR #487. Migration: none.

No native iOS app (report: https://claude.ai/artifact/LkvVkPCdkUeEpVvduhEcXS). Instead, the web desk now:
- checks in a school group as a unit (untick who isn't here, Undo);
- scans signed participant and group codes with the camera;
- keeps working offline (queue and list on the device; a service worker for the page in desk mode);
- flags unsigned forms, unpaid, medical and dietary without blocking.

Codes go in new confirmation emails, on Your group and, optionally, on badges. Badges can print in school order. Live in production since 30 Oct.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| check-in-desk.1 | **HIGH** Real iPad before Nevada (6 Nov): scanner with a real camera | Only WebKit at iPad size with a fake camera (351 ms read). No real camera has scanned a code, on dev or production | On production, signed in as staff on an iPad: open Nevada → Check-in → Desk mode → Scan. Scan a code from the code page on a phone, then Undo | ☐ |
| check-in-desk.2 | **HIGH** Add to Home Screen and offline reload on iPad Safari | The service worker's offline reload was proven in Chromium (production build) only. The iOS install with the per-event manifest is untested | On that iPad: Share → Add to Home Screen, open it from the icon online, turn on airplane mode, reopen, check one person in, reconnect, confirm "waiting to send" clears | ☐ |
| check-in-desk.3 | A confirmation email with a code reaches an inbox | Templates are unit-tested; no real send since the promotion | When the next registration confirms, open the email and tap "Show my check-in code" (or "Show our check-in code" for a group) | ☐ |
| check-in-desk.4 | People registered before 30 Oct have no code by email (including Nevada's and Minnesota's registrants) | By design: codes are made at send time, and no catch-up email was sent | David's call. Print codes on the badges (Settings → Name badges → Add check-in QR codes), check groups in by Groups, or approve a one-off "your check-in code" email | ☐ |
| check-in-desk.5 | Real check-in timings from Nevada | The desk records `checked_in_at` and the method. A group check-in shares one timestamp | After 6 Nov, read Nevada's `checked_in_at` by method and minute (counts only) for the report's decision gate | ☐ |
| check-in-desk.6 | No "late" label for groups | Groups that haven't arrived show "Not here yet". The desk has no event start time or time zone | Only if wanted: pass the Sanity start time and the survey's time zone to the desk | ☐ |
| check-in-desk.7 | Badge QR placement with real artwork | The QR is fixed bottom-right on a white square, about 30% of the short side. It was rendered on plain badges only | Before printing Nevada badges with codes, download one sheet with codes ticked and check the corner is clear | ☐ |
| check-in-desk.8 | The service worker controls every `/admin/competitions/*` page | It serves only the desk page and hashed static files, and never the API. No problems seen | None unless an admin page misbehaves after a deploy: then unregister `check-in-desk-sw.js` in the browser and report it | ☐ |
| check-in-desk.9 | Promotion record and `main` → `dev` sync | #487 opened (docs only, `--merge`) | Merge #487 with `--merge` once `verify` passes | ☐ |

## Closes

- `event-check-in-v2.6` (no e2e for check-in): `e2e/core/check-in-desk.spec.ts` covers the desk. It runs in CI against a throwaway `e2e-checkin-*` event and passed on #484 and #485.
- `check-in-banner.1` (Colorado's check-in still open on production): already closed before this session. Production read on 30 Oct: `colorado-space-design-challenge` has `check_in_open = false` (updated 22 Oct), and `/check-in` returns 200.
