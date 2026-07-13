# Initial prompt for Claude Code

> Paste everything in the block below as your first message in Claude Code, run from the root of the `stellr-web` repo.

---

You are working in the `stellr-web` Next.js (App Router) monorepo. I want you to add a new **`interactive` lesson content type** to the Training portal so bespoke React tutorials render natively inside the `/community/training` course player — no iframe — gated and progress-tracked like any other lesson. The first tutorial to wire up already exists in the repo (the "Atmospheric Requirements" tutorial).

**Before writing any code, read these in order and confirm your plan back to me:**

1. `docs/handovers/interactive-lesson-type/01_SPEC.md` — what to build, acceptance criteria, edge cases.
2. `docs/handovers/interactive-lesson-type/02_IMPLEMENTATION_PLAN.md` — the exact files, migration, and code sketches. Treat this as the primary reference.
3. `docs/handovers/interactive-lesson-type/03_REPO_CONTEXT.md` — repo conventions, the design-system + lint gates you must keep green, verification gotchas, and where the tutorial currently lives.
4. `CLAUDE.md` and `VOICE.md` at the repo root — binding design-system and voice rules.

**Then:**

- Restate the plan as a short checklist and note anything in the plan you'd change and why. Wait for my go-ahead before editing.
- Work on a branch: `feat/interactive-lesson-type`.
- Follow the repo's design system — **tokens only**, components from `@stellr/web-ui`, no raw pre-V2 hex or old font names (`npm run lint:tokens` gates the build).
- Keep the change additive and backward-compatible: the four existing content types must be untouched, and the public "Atmospheric Requirements" page must still render identically after you refactor its components into the shared registry.

**Definition of done (all must pass):**

- Migration adds `'interactive'` to the `training_items_content_kind_check` constraint and an `interactive_key` column, and applies cleanly.
- An admin can create an interactive lesson in the Course Builder and pick "Atmospheric Requirements" from a dropdown of registered tutorials.
- A member sees the tutorial rendered natively at `/community/training/<moduleId>`, can complete it, and progress is tracked.
- The public page at `/curriculum/atmospheric-requirements` still works (now sourcing the same shared component).
- `npm run lint:tokens` passes; a scoped `tsc --noEmit` over the changed files passes (see `03_REPO_CONTEXT.md` for the full-repo tsc OOM workaround); any new unit test passes.

Start by reading the four documents and confirming the plan.

---
