# Spec — `interactive` lesson content type

## Problem

`/community/training` is a Supabase-backed LMS. A `training_item` (lesson) has a `content_kind` of `video | document | google_doc | link | live`, and one generic player (`components/training/LessonMedia.tsx`) renders each. There is no way to render a bespoke interactive React component as a lesson. We built a fully interactive tutorial ("Atmospheric Requirements") but it can only live as a public page or be shoehorned in via an iframe.

## Goal

Add a fifth-plus content type, **`interactive`**, that renders a registered React component natively inside the course player, keeping all existing LMS behaviour (tier gating, progress, resources, prev/next, deadlines).

## In scope

1. **Schema:** allow `content_kind = 'interactive'`; add `interactive_key text` to `training_items` to name which component to render.
2. **Registry:** a single source of truth mapping a stable key → a client component + a human label (for admin). Keys are code-defined (not free text) so lessons can't reference a component that doesn't exist.
3. **Player:** when a lesson's `content_kind = 'interactive'`, render the registered component in the player's media slot instead of `LessonMedia`'s video/iframe branches.
4. **Admin:** the Course Builder gets an "Interactive" lesson type whose input is a **dropdown of registered keys** (not a URL/file).
5. **Refactor the tutorial:** move the "Atmospheric Requirements" interactive pieces into a shared component registered under key `atmospheric-requirements`, and have both the public curriculum page and the training player render that one component (no duplicated logic).

## Out of scope

- Authoring interactive content through the admin UI (components stay code-defined).
- Per-question scoring or storing self-check answers server-side (the tutorial's checks stay client-only/formative).
- Changing gating, enrollment, drip, or certificate logic.
- Migrating the other content types.

## Acceptance criteria

- [ ] Migration `133_training_interactive_lessons.sql` adds `'interactive'` to `training_items_content_kind_check` and adds nullable `interactive_key text`. Applies cleanly; down-safe (documented).
- [ ] `lib/interactive-lessons.tsx` (registry) exports the key→{label, component} map and a typed `InteractiveKey`.
- [ ] `getLesson()` returns `{ type: 'interactive', key }` for interactive items; `LessonMedia` renders the registered component via a small client host; unknown/empty key falls back to the existing `unavailable` state.
- [ ] Course Builder shows an "Interactive" type; selecting it reveals a dropdown of registry labels; saving persists `content_kind='interactive'` + `interactive_key`.
- [ ] Admin can create a module + interactive lesson for "Atmospheric Requirements"; a member sees it inline at `/community/training/<moduleId>`, completes it, and progress updates ("1 of 1").
- [ ] `/curriculum/atmospheric-requirements` renders the same shared component and is visually unchanged.
- [ ] `npm run lint:tokens` passes; scoped `tsc --noEmit` over changed files passes; new registry unit test passes.

## Edge cases & decisions

- **Unknown key** (component removed but lesson still references it): render the `unavailable` media state; do not crash the player.
- **SSR:** the player pages are server components; the interactive components are `'use client'`. Render them through a small `'use client'` host so the server tree stays valid. Do **not** wrap in `next/dynamic({ ssr: false })` inside a server component.
- **Progress/completion:** unchanged — completion is the existing "Mark complete" action (`LessonActions`), independent of what the media slot renders.
- **Resources:** the downloadable lesson pack (`.docx` + `.pptx`) attaches to the lesson via the existing Resources mechanism — no work needed here.
- **Estimated minutes / eyebrow / outline:** all item-level, already handled.
- **Design system:** the tutorial components already use V2 tokens; keep them token-only so `lint:tokens` stays green.
