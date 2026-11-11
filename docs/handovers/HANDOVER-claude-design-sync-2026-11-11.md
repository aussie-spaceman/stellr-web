# Handover: Claude Design sync of the design system (10–11 Nov 2026)

Slug: `claude-design-sync`. Tracker: `tracker/2026-11-11-claude-design-sync.md`.

## Context
The session ran `/design-sync` to import Stellr Design System V2 (`@stellr/web-ui`)
into Claude Design, so its design agent builds with our real components instead of
generic ones. It was a first-time, high-fidelity import into a new Claude Design
project, "Stellr Design System". The project ID is in `.design-sync/config.json`.

## What changed
- **Claude Design project (live):** 29 components, each with a preview card,
  `.d.ts`, `.prompt.md` and the shared bundle, CSS and fonts, plus a README with a
  conventions header for the design agent. Every story was graded `match` against
  the reference Storybook render. The final driver receipt was `ok`, with all 29
  carried forward, and the full render check was 29/29 clean. The project's
  `_ds_sync.json` anchor is uploaded, so the next sync only re-verifies what changed.
- **#615 → `dev` as `7bfeb941`** (not yet on `main`; a separate session is promoting):
  - web-ui stories split to one file per component, with `<Group>/<ExportName>`
    titles, because Claude Design makes one component per Storybook title.
    The JSX was moved unchanged.
  - New stories for CtaBand, InfoPill, Input, Select, Textarea, Choice and
    Fieldset. ConfirmDialog is split out of `Overlays/Dialog`.
  - Story IDs changed (e.g. `primitives--buttons` → `primitives-button--buttons`).
    Nothing on `dev` referenced the old IDs.
  - `.design-sync/`: config, `NOTES.md`, `conventions.md`, bundle entries (media
    sections, a `process.env` shim for `lib/media-helpers.ts`, the next/font
    variables), brand `@font-face` CSS, and a screenshot tool.
    `.gitignore` covers the build and verification state.
- **#616 → `dev` as `65418f18`:** `node-forge` 1.4.2 → 1.4.3, from a card this
  session proposed after `osv-scanner` went red on four new advisories. Another
  session landed the same bump as #617, so `dev` has it twice. The result is the
  same and nothing needs undoing.

## Decisions (owner's)
- Full sync scope, not web-ui only.
- Split the repo's family story files, rather than keeping sync-only stories or
  syncing just 7 components.
- App screens (AppSidebar, EventTeamProfiles, TeamProfileForm) stay out of the
  design system.

## Not verified
- **Hero breakpoints:** its Desktop, Tablet and Mobile stories set a Storybook
  viewport that neither capture applies, so all three were compared at 900px
  (`claude-design-sync.2`).
- **The design agent itself:** no design was built in Claude Design to check
  that the conventions header steers it to on-brand output (`claude-design-sync.3`).
- **Tall stories:** ThemeCard, PathwayCard, BracketShadeKey and ProofStrip Four Up
  clip at the 700px preview capture. They were graded on the visible area.

## How to re-sync
Run `/design-sync` from the main checkout. It reads `.design-sync/config.json` and
`NOTES.md`, and takes the atomic upload path. Before that:
- Rebuild `.design-sync/sb-reference` after any story, token or Tailwind change.
  The design system's CSS is scraped from it.
- Give any new web-ui component its own story titled `<Group>/<ExportName>`, or it
  gets no card.
- Read the "Re-sync risks" section of `.design-sync/NOTES.md`. It covers the
  hard-coded media Blob URL in `entries/process-env.ts`, the pinned gstatic font
  URLs, and the font variable names mirrored from `lib/fonts.ts`.

## Open items
See the tracker file. The most important is `claude-design-sync.4`: standalone
Claude Design closes by 14 Dec 2026 and moves into Claude. Once the project has
moved, the sync tool refuses uploads to it.
