---
name: ship
description: Ship work from a Claude Code session — verify against the session's spec/PRD, run unit + Playwright E2E, open a PR, and land it. Use when the user says ship it, deploy, raise a PR, merge this, or asks to get the session's work into GitHub/production.
---

# Ship

Takes work built during a session from working tree → reviewed → tested → PR →
merged → verified on Vercel. Runs in phases; **stop at every gate marked ⛔ and
get an explicit yes from the user** before continuing. Never skip a phase
silently — if you cannot run one, say so and say why.

## Phase 0 — Establish the contract

You cannot review "alignment with the spec" without naming the spec. Collect,
in this order, and write the result into `/tmp` scratch as `ship-contract.md`:

1. **Session requirements** — scroll the conversation for what the user
   actually asked for, including mid-session corrections and things they
   explicitly declined. Corrections outrank the original ask.
2. **Repo docs** — `ls docs/` for a matching `PLAN-*.md`, `*-HANDOVER.md`,
   `*-HANDOFF.md`, `REC-*.md`, or `RUNBOOK-*.md`. These are this repo's PRDs.
3. **Project rules** — `CLAUDE.md` (Design System V2, tokens, `@stellr/web-ui`,
   no raw hex/fonts) and `VOICE.md` (all user-facing copy).

Produce a numbered **requirement checklist**. Each line must be checkable
against the diff. If the session had no stated spec, say so and derive the
checklist from the user's messages — do not invent scope.

⛔ Show the checklist and ask: "Is this the full scope, or is anything missing?"

## Phase 1 — Preflight

```bash
git status --short && git branch --show-current
```

- If on `main`, create a branch: `git checkout -b <type>/<short-slug>`
  (`feat/`, `fix/`, `chore/` — match recent history: `git log --oneline -10`).
- Stage and review your own diff before anything else: `git diff --stat` then
  read the full `git diff` for debug code, stray `console.log`, secrets,
  `.env*` files, and unrelated churn.

Run the gates (in one background command, then read the output once):

```bash
npx tsc --noEmit && npm run lint:tokens && npm run test && npm run build
```

`npm run build` runs `prebuild` (token build, DS lint, watermark check) — a
green build is the real gate. Fix failures before moving on; do not proceed
with a red gate and a promise to fix it later.

## Phase 2 — End-to-end tests (Playwright)

**This repo has no Playwright yet.** On first run, read
`references/playwright-bootstrap.md` and set it up — that is a real change to
the repo, so ⛔ ask first. Once it exists:

```bash
npx playwright test --reporter=line
```

- Playwright starts its own dev server via `webServer` in the config. Don't
  start one with Bash; if you need to look at the app yourself, use the Browser
  pane (`preview_start` with `{name: "stellr-web"}`).
- Cover the flows this change actually touches, plus the smoke path
  (home → events → sign-in gate). Add a spec for each behaviour named in the
  Phase 0 checklist that a user can observe in a browser.
- On failure: read the trace (`npx playwright show-trace`), fix the **source**,
  re-run. Never weaken an assertion or add a bare `waitForTimeout` to make a
  test pass — if a test is genuinely wrong, say so explicitly and explain why.
- Attach failures the user should see with `SendUserFile` (screenshots live in
  `test-results/`).

## Phase 3 — Spec-alignment review

Now check the diff against the Phase 0 checklist. This is a **review, not a
summary** — you are looking for the gap between what was asked and what was
built.

For each requirement, one row:

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | … | Met / Partial / Not met / Out of scope | `app/foo/page.tsx:42`, test name, or "not implemented" |

Then, separately, flag anything **built but not asked for** (scope creep) and
anything in the diff that violates `CLAUDE.md` — hard-coded hex, off-scale
spacing, re-implemented components instead of `@stellr/web-ui`, raw SVG instead
of `@stellr/icons`, Norwester/Aileron in site UI, copy that ignores `VOICE.md`.

Optionally run `/code-review high` for a correctness pass on top of this — it
hunts bugs, this phase hunts spec drift. They are not substitutes.

⛔ Show the table. Anything **Partial** or **Not met** is a decision for the
user: fix now, or ship and track it. Do not decide for them.

## Phase 4 — Open the PR

```bash
npm run check:deploy-ready
```

Guardrail against prod running uncommitted code (especially
`supabase/migrations/`). Must pass.

Commit in coherent units — do not squash unrelated work into one commit:

```bash
git add <paths> && git commit -m "$(cat <<'EOF'
<type>: <imperative summary>

<what changed and why; reference the docs/ plan if there is one>

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

⛔ **Pushing and opening a PR is outward-facing — confirm before you push.**

```bash
git push -u origin HEAD
gh pr create --base main --title "<title>" --body "$(cat <<'EOF'
## What
<one paragraph>

## Spec
Implements `docs/<PLAN>.md` / the session requirements below.

## Requirement coverage
<the Phase 3 table>

## Testing
- `npx tsc --noEmit` ✅
- `npm run lint:tokens` ✅
- `npm run test` ✅ (<n> tests)
- `npx playwright test` ✅ (<n> tests)
- `npm run build` ✅

## Known gaps
<anything Partial / Not met, or "none">

## Risk
<migrations, cron changes in vercel.json, env vars needed, external services touched>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Call out in the PR body, every time they appear in the diff: new
`supabase/migrations/`, changes to `vercel.json` crons, new env vars, and
anything touching Clerk, Sanity, HubSpot, or DocuSign.

## Phase 5 — Land and verify

⛔ **Merging deploys to production. Confirm explicitly — every time.**

```bash
gh pr checks --watch
gh pr merge --squash --delete-branch
```

After merge:

```bash
git checkout main && git pull
```

- Watch the Vercel deployment (Vercel MCP tools: `list_deployments`,
  `get_deployment_build_logs`, `get_runtime_errors`).
- If the change touched services, run `npm run verify:prod`.
- If it included a migration, confirm it actually applied — the repo has been
  burned by prod/main divergence before.
- Smoke the deployed URL in the Browser pane and screenshot the changed
  surface for the user.
- Report plainly: what shipped, what deployed, what is still open. If anything
  failed, say so with the output — do not round a partial success up to done.

## Never

- Merge, push, or deploy without the user saying yes in this session.
- Report a phase as passing that you did not run.
- `--force`, `--no-verify`, or `--admin` to get past a gate.
- Deploy with a dirty tree — `check:deploy-ready` exists because that has
  already caused a prod incident here.
