# Implementation plan — `interactive` lesson type

File paths are repo-relative. Line numbers reflect the repo at handover time — re-verify before editing (the code moves).

---

## Step 1 — Database migration

Create `supabase/migrations/133_training_interactive_lessons.sql`. Follow the header-comment style of `045_training_live_lessons.sql`.

```sql
-- Migration 133: interactive lessons in Training.
--
-- Adds an 'interactive' content_kind so a training_item can render a bespoke
-- React component (registered in lib/interactive-lessons.tsx) natively inside the
-- course player, instead of a video/document/link/live resource. The component is
-- named by interactive_key, which must match a key in the code registry.

ALTER TABLE public.training_items
  DROP CONSTRAINT IF EXISTS training_items_content_kind_check;

ALTER TABLE public.training_items
  ADD CONSTRAINT training_items_content_kind_check
  CHECK (content_kind IN ('video', 'document', 'google_doc', 'link', 'live', 'interactive'));

ALTER TABLE public.training_items
  ADD COLUMN IF NOT EXISTS interactive_key text;
```

- The current constraint is set in `supabase/migrations/045_training_live_lessons.sql` (lines 17–21). This migration re-drops and re-adds it with the extra value.
- The original table is `017_community_phase4.sql` (line 113). No RLS change needed — items inherit module policies.
- Apply via the Supabase MCP `apply_migration` or the project's normal migration flow; confirm the constraint with a quick `select` against `information_schema` or by inserting a test row in a scratch branch.

## Step 2 — The component registry

Create `lib/interactive-lessons.tsx`:

```tsx
import type { ComponentType } from 'react'
import { AtmosphericRequirements } from '@/components/interactive/atmospheric-requirements'

// Code-defined registry: lessons reference a component by key, so an interactive
// lesson can never point at a component that doesn't exist. Add new tutorials here.
export const INTERACTIVE_LESSONS = {
  'atmospheric-requirements': {
    label: 'Atmospheric Requirements for Space Settlements',
    Component: AtmosphericRequirements,
  },
} satisfies Record<string, { label: string; Component: ComponentType }>

export type InteractiveKey = keyof typeof INTERACTIVE_LESSONS

export const INTERACTIVE_OPTIONS = Object.entries(INTERACTIVE_LESSONS).map(
  ([key, v]) => ({ key: key as InteractiveKey, label: v.label }),
)

export function isInteractiveKey(k: string | null | undefined): k is InteractiveKey {
  return !!k && k in INTERACTIVE_LESSONS
}
```

## Step 3 — Refactor the tutorial into a shared component

Today the interactive tutorial lives at `app/(public)/curriculum/atmospheric-requirements/`:

```
ContainerCalculator.tsx   PracticeCheck.tsx   PressureExplorer.tsx
WorkedExample.tsx         tutorial-data.ts    page.tsx   teachers/page.tsx
```

Move the reusable body into a shared component so both the public page and the player render the same thing:

1. Create `components/interactive/atmospheric-requirements/` and move `PressureExplorer.tsx`, `ContainerCalculator.tsx`, `PracticeCheck.tsx`, `WorkedExample.tsx`, `tutorial-data.ts` into it.
2. Add `components/interactive/atmospheric-requirements/index.tsx` — a `'use client'` component `AtmosphericRequirements` that renders the **lesson body** (objectives → Part 1–5 → practice → sources) currently inline in `app/(public)/curriculum/atmospheric-requirements/page.tsx`. Lift that JSX here, minus the `<Hero>` and `<CtaBand>` (those are page chrome, not lesson content). Keep it self-contained and token-only.
3. Rewrite `app/(public)/curriculum/atmospheric-requirements/page.tsx` to keep its `metadata`, `Hero`, and `CtaBand`, and render `<AtmosphericRequirements />` for the body. The teacher page (`teachers/page.tsx`) is unaffected but update its relative imports if it pulled from `../tutorial-data` (now `@/components/interactive/atmospheric-requirements/tutorial-data`).
4. Update import paths accordingly; run the scoped typecheck.

> Rationale: one source of truth for the tutorial. The player and the public page diverge only in chrome.

## Step 4 — Extend the media union and `getLesson`

In `lib/training.ts`:

- **Union** (around lines 342–351): add a variant
  ```ts
  | { type: 'interactive'; key: string }
  ```
- **`getLesson` media resolution** (around lines 449–468, the `switch`/`if` on `content_kind`): add a branch
  ```ts
  } else if (kind === 'interactive') {
    media = row.interactive_key
      ? { type: 'interactive', key: row.interactive_key as string }
      : { type: 'unavailable' }
  }
  ```
- Add `interactive_key` to the item `.select(...)` on the media-bearing query (around line 449, the `storage_path, external_url, body, content_kind, ...` select).

Also add `'interactive'` to the `content_kind` union in `lib/training-display.ts` (line ~65) so the types line up.

## Step 5 — Render it in the player

`components/training/LessonMedia.tsx` is a **server** component (no `'use client'`). Interactive tutorials are client components, so introduce a tiny client host:

Create `components/training/InteractiveLessonHost.tsx`:

```tsx
'use client'
import { INTERACTIVE_LESSONS, isInteractiveKey } from '@/lib/interactive-lessons'

export function InteractiveLessonHost({ lessonKey }: { lessonKey: string }) {
  if (!isInteractiveKey(lessonKey)) return null // caller renders the unavailable state
  const { Component } = INTERACTIVE_LESSONS[lessonKey]
  return (
    <div className="rounded-2xl border border-brand-border bg-white p-4 sm:p-6">
      <Component />
    </div>
  )
}
```

In `LessonMedia.tsx`, add a branch alongside the existing `media.type` checks (e.g. after the `embed` branch, ~line 70):

```tsx
if (media.type === 'interactive') {
  return <InteractiveLessonHost lessonKey={media.key} />
}
```

(If `isInteractiveKey` returns false the host returns `null`; either let that render empty or, cleaner, have `getLesson` already map an unknown key to `unavailable` — Step 4 maps only empty keys, so also guard here or in `getLesson` by checking `isInteractiveKey`.)

> Note: a server component rendering a client component is fine. Do **not** use `next/dynamic({ ssr: false })` here — it's invalid in a server component and unnecessary.

## Step 6 — Admin Course Builder

`components/admin/training/CourseBuilder.tsx` defines the lesson-type cards (array around lines 33–36: `{ key, label, Icon, input, title, desc, cta }`, where `input` is `'none' | 'url' | 'file'`).

1. Add an `'interactive'` entry with a new `input: 'select'`:
   ```ts
   { key: 'interactive', label: 'Interactive', Icon: Sparkles, input: 'select',
     title: 'Choose an interactive tutorial',
     desc: 'A built-in interactive lesson (e.g. a guided tutorial with calculators).',
     cta: 'Select tutorial' },
   ```
2. Where the editor renders the input by `input` type, add a `<select>` for `input === 'select'` populated from `INTERACTIVE_OPTIONS` (`lib/interactive-lessons`). On save, write `content_kind='interactive'` and `interactive_key=<selected key>` (persist through the same path that writes `external_url` for URL lessons).
3. Update the admin lesson type in `components/admin/community/TrainingManager.tsx` — `CONTENT_KINDS` (referenced at line ~86, `content_kind: (typeof CONTENT_KINDS)[number]`) must include `'interactive'`, and the `AdminLesson`/`AdminModule` shape should carry `interactive_key`.
4. Include `interactive_key` in the admin builder's module `.select(...)` in `app/(admin)/admin/academy/training/page.tsx` (the `training_items(... , body, external_url, ...)` projection, ~line 30) so the editor can preselect the current value.
5. The type icon helper in `CourseBuilder.tsx` (`typeIcon`, ~line 39) should return an icon for `'interactive'`.

## Step 7 — Verify

Run the gates in `03_REPO_CONTEXT.md`:

- `npm run lint:tokens` — must pass.
- Scoped `tsc --noEmit` over changed files (full-repo `tsc` OOMs — see context doc for the scoped-config trick).
- Add `lib/__tests__/interactive-lessons.test.ts`: registry has `atmospheric-requirements`, `isInteractiveKey` accepts it and rejects junk, every option label is non-empty. Run `npm test`.
- Manual: create a module + interactive lesson in admin (or seed via SQL on a branch), load `/community/training/<moduleId>`, confirm inline render + "Mark complete" + progress. Load `/curriculum/atmospheric-requirements`, confirm unchanged.

## Suggested commit sequence

1. `feat(training): interactive lesson migration + registry`
2. `refactor(tutorial): move Atmospheric Requirements into shared interactive component`
3. `feat(training): render interactive lessons in the course player`
4. `feat(admin): interactive lesson type in Course Builder`
5. `test(training): interactive registry`
