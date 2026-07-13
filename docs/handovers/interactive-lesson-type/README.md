# Handover — `interactive` lesson type for the Training portal

**Goal:** add a new lesson content type so bespoke, interactive React tutorials render **natively** inside the `/community/training` LMS player (no iframe), gated and progress-tracked like any other lesson.

**First tutorial to wire up:** *Atmospheric Requirements for Space Settlements* — already built in this repo as a public page. Its interactive pieces (`PressureExplorer`, `ContainerCalculator`, `PracticeCheck`, `WorkedExample`) become the first registered interactive lesson.

## What's in this package

| File | Purpose |
|---|---|
| `00_INITIAL_PROMPT.md` | Paste this into Claude Code to kick off the build. |
| `01_SPEC.md` | Feature spec — goals, non-goals, acceptance criteria, edge cases. |
| `02_IMPLEMENTATION_PLAN.md` | Step-by-step with exact files, line references, migration SQL, and code sketches. |
| `03_REPO_CONTEXT.md` | Conventions, design-system + lint gates, verification gotchas, and where the tutorial lives today. |

## How to use it

1. Open Claude Code in the `stellr-web` repo.
2. Paste `00_INITIAL_PROMPT.md` as the first message.
3. Claude Code should read `01`, `02`, and `03` before writing code (the prompt tells it to).
4. Work on a feature branch; the plan lists the verification gates to pass before opening a PR.

## Why this approach

The current `/community/training` is a Supabase-backed LMS. Lessons come in five content types (video / document / google_doc / link / live), all rendered by one generic player. There is **no** mechanism to render a custom React component per lesson today. Two lighter options were considered and rejected for this use case:

- **Embed via iframe** (allow-list the app host in `embedSrc`) — works, but wraps the tutorial in double LMS chrome and every future interactive lesson is an iframe.
- **Author natively as plain lessons** — zero code, but loses the calculators and self-check questions entirely.

The `interactive` type is the right long-term home once there will be more than one interactive tutorial. This package builds that.
