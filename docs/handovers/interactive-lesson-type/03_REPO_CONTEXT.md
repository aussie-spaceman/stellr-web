# Repo context & gotchas

## The tutorial being wired up

"Atmospheric Requirements for Space Settlements" — an interactive tutorial already built in this repo.

- **Public page:** `app/(public)/curriculum/atmospheric-requirements/page.tsx` (student) + `teachers/page.tsx` (teacher companion).
- **Interactive pieces** (all `'use client'`): `PressureExplorer.tsx` (sliders → % oxygen + comfort/fire read-outs), `ContainerCalculator.tsx` (Dalton → Amagat → expansion-ratio → containers), `PracticeCheck.tsx` (auto-checked questions), `WorkedExample.tsx` (reveal-able solutions), with static content in `tutorial-data.ts`.
- **Downloadable lesson pack** (attach as lesson Resources): delivered in the "Teacher Support Material" project folder — `Atmospheric Requirements — Lesson Plan.docx` and `Atmospheric Requirements — Slides.pptx`.

These components are the payload for the first `interactive` lesson (registry key `atmospheric-requirements`).

## Architecture recap (why the plan looks the way it does)

- **App Router, host-split.** One Next app; `proxy.ts` gates by host and route. `/community(.*)` is a member route (Clerk) — unauthenticated hits bounce to `/sign-up`. `/curriculum/...` is public. Both build from the same app.
- **Training is DB-driven.** `lib/training.ts` reads Supabase (`training_modules`, `training_sections`, `training_items`, `training_progress`, `training_enrollments`, `training_assignments`). The course player is `app/(member)/community/training/[moduleId]/page.tsx`; the index is `.../training/page.tsx`.
- **One generic player.** `components/training/LessonMedia.tsx` switches on a `LessonMedia` union (`lib/training.ts` ~342). `content_kind` is constrained in SQL (`045_training_live_lessons.sql`). This is exactly the seam the new type extends.
- **Admin authoring** is `app/(admin)/admin/academy/training/page.tsx` + `components/admin/training/CourseBuilder.tsx` (+ `components/admin/community/TrainingManager.tsx` for shared admin types).

## Design system — non-negotiable

Read `CLAUDE.md` and `VOICE.md` at the repo root.

- **Design System V2 is the default.** Tokens are the single source of truth (`design/tokens.json` → `styles/tokens.css` + `lib/tokens.ts`). Use Tailwind token utilities (`bg-primary`, `text-ink`, `rounded-ds-card`, `max-w-content`, …). The interactive components already follow this.
- **Shared UI** from `@stellr/web-ui`; icons from `@stellr/icons` (lucide-react is also used freely in pages).
- **`npm run lint:tokens`** (`scripts/ds-lint.mjs`) fails the build on pre-V2 brand hex (a specific retired-hex list) and old font names (`Norwester`, `Aileron`, …) anywhere in `app/**` (excl. `app/api`), `components/**`, `packages/**`. It runs in `prebuild`. Keep it green.
  - Note: the existing training components use legacy `brand-*` token aliases and some V2 hex literals (e.g. `#3C6DF6`); those are **not** on the banned list, so they pass. New code should prefer semantic V2 utilities, but matching the surrounding `brand-*` classes inside `components/training/*` is acceptable for consistency.

## Verification gotchas

- **Full-repo `tsc` OOMs / times out.** `npx tsc --noEmit -p tsconfig.json` exhausts the heap on this project. Typecheck the changed files with a scoped config instead:

  ```jsonc
  // tsc.scope.json at repo root (delete after)
  {
    "extends": "./tsconfig.json",
    "compilerOptions": { "noEmit": true, "skipLibCheck": true },
    "include": [
      "lib/interactive-lessons.tsx",
      "lib/training.ts",
      "components/interactive/**/*.ts",
      "components/interactive/**/*.tsx",
      "components/training/InteractiveLessonHost.tsx",
      "app/(public)/curriculum/atmospheric-requirements/**/*.tsx"
    ]
  }
  ```

  ```bash
  npx tsc -p tsc.scope.json    # then remove tsc.scope.json
  ```

- **`as const` + `useState` pitfall.** `tutorial-data.ts` uses `as const`, which narrows numbers to literal types. `useState(CONTAINER_PROBLEM.volume)` then infers the literal type and rejects later numeric updates — annotate `useState<number>(...)`. (Already handled in the current `ContainerCalculator.tsx`; keep it when moving the file.)
- **No test/typecheck npm alias.** `npm test` = vitest. TypeScript is otherwise only checked by `next build`. Use the scoped config above for a fast check.
- **Workspaces:** `@stellr/web-ui` and `@stellr/icons` are workspace packages shipped as TS source and transpiled by Next — no build step to run.

## Definition of done (mirror of the spec)

1. Migration applies; constraint includes `'interactive'`; `interactive_key` column exists.
2. Registry + types compile; `getLesson` returns the interactive media variant.
3. Player renders the component inline; unknown/empty key → `unavailable` (no crash).
4. Admin Course Builder can create an interactive lesson via a dropdown; value persists.
5. Member sees it at `/community/training/<moduleId>`, completes it, progress updates.
6. Public `/curriculum/atmospheric-requirements` unchanged, now sourced from the shared component.
7. `lint:tokens` + scoped `tsc` + new unit test all pass.
