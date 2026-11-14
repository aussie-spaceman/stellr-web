# Handover: editable numbers on the artwork position sliders (13 Nov 2026)

Slug: `placement-number-field`. Tracker: `tracker/2026-11-13-placement-number-field.md`.

**On `dev`, not promoted.** PR #685 squash-merged to `dev` as `04d21fce`. The
owner will promote it from another session. No migration, no server change.

## What was asked

"On the position the name function for all certificates and name badges, the %
number needs to be an editable field, along with the slider."

Owner answers to the two questions asked:
- A typed number outside the slider's range **snaps to the slider's range**
  (not the wider server limits).
- **All** sliders get the typed field, including the pt size sliders.

## What changed

- New `components/admin/PlacementSlider.tsx`: label, range slider, and a number
  input in display units (`scale: 100` turns a 0–1 fraction into %), with a
  unit and suffix after it ("% down", "% of width", "pt").
  - Typing moves the slider live only while the number is in range, so a
    half-typed "6" on the way to "65" does not jump the slider.
  - Enter or blur snaps an out-of-range number to the nearest end and rounds to
    the shown precision (the slider step's decimals). Escape drops the edit; an
    empty field keeps the value.
  - Number input uses `text-input mouse:text-xs` so iOS does not zoom on focus.
- The three copies of the inline `slider()` helper now render it:
  `EventCertificates.tsx` (event certificate "Position the name"),
  `EventBadges.tsx` (badge "Position the name"), `PdCertificateArtwork.tsx`
  (PD certificate "Position the fields").
- Tests: `components/admin/PlacementSlider.test.tsx` (7).

All three editors live on `/admin/competitions/artwork` (default artwork) and
on an event's admin page (`/admin/competitions/<slug>`).

## How it was verified

- Full unit suite locally (638 files, 12,958 tests), typecheck, eslint,
  `lint:tokens`. CI on #685 all green, with `e2e-tests / Run npx playwright
  test` and `unit / Unit tests` both actually run.
- Local dev server as the e2e admin, Playwright-driven on
  `/admin/competitions/artwork`: badge Across 40% → slider 0.4, 5% snapped to
  20%, size 32 → 32; certificate height 62.5% → 0.625, 95% snapped to 80%; PD
  Across 48.6% → 0.486. Screenshots taken of each editor.

## Not verified

- The name moving on the rendered artwork: the PDF preview iframe is blank in
  headless Chromium, so only the controls were checked, not the preview.
- Phone width: the editor column is 16rem on desktop; narrow layout not looked at.
- The `dev` deployment after the merge, and production (not promoted yet).

## Open items

See the tracker file: `placement-number-field.1`–`.3`.
