# Handover: `lint:pii`, a CI guard for personal data in docs (13 Oct 2026)

Tracker: `tracker/2026-10-13-lint-pii.md` (rows `lint-pii.1–7`).
Related: `HANDOVER-public-repo-personal-data-2026-10-13.md`, which wrote the rule this enforces.

## Context

`aussie-spaceman/stellr-web` is public. #409 added "People: the repo is public"
to the close-out skill: refer to people by role and `members.id`, never by name,
personal email, credential number or mailbox ID. It came with a manual pre-push
grep. David asked for the mechanical part to be enforced by CI. The spec:
- `scripts/lint-pii.mjs` and `npm run lint:pii`, styled like the existing lints;
- run in `verify`, so docs-only and code PRs are both gated;
- ADDED lines only in `docs/**`, `.claude/**` and root `*.md`, against the merge
  base with `origin/dev`, because existing files hold historical data whose
  redaction is a separate decision;
- four patterns, an email allowlist, a documented inline escape, a unit test,
  and no real person's data in tests.

## What changed

| PR | What | State |
|---|---|---|
| #414 → `dev` `066d6eb1` | `scripts/lint-pii.mjs` + test; `lint:pii` in `package.json`; a `verify` step before `npm ci`; `verify` checkout now `fetch-depth: 0` + `filter: blob:none`; docs in close-out ("People"), ship (rule 6 and Phase 3) and `CLAUDE.md` "Enforcement" | Merged |
| #415 → `dev` `f27868c8` | Review follow-up: moved lines excused, `%40` caught, linear email regex, git output pinned and run from the repo root, untracked-file line count | Merged |
| #416 `dev` → `main` | Promotion of both, plus #407 and #413 | **Open** at close-out (row `.3`) |

How it works:
- **Patterns:**
  - emails off the allowlist (`stellreducation.org`, `mail.stellreducation.org`, `example.com`, `example.org`, `users.noreply.github.com`, plus `noreply@anthropic.com`);
  - `STL-20NN-` + 8 characters, except `STL-20NN-E2E…` fixtures and the all-X placeholder;
  - `r-?[0-9]{15,}`;
  - `user_` + 20 or more alphanumerics.
- **Added lines only.** It diffs from the merge base with `origin/dev` to the
  working tree, and includes untracked files in scope, so it also works before
  a commit. A line the same diff removes elsewhere counts as moved, not new.
  `-M` keeps a renamed file to the lines that changed.
- **Escape:** a trailing `<!-- pii-ok: <reason> -->`. The reason is required.
- **Output** names `file:line:column` and the kind, never the value, because CI
  logs on a public repo are public too.
- **`--stdin`** runs the same patterns over commit messages and a PR body. The
  close-out pre-push check now uses it instead of a second copy of the regexes.
- **Not in `prebuild`.** Vercel builds from a shallow clone with no `origin/dev`.

## How it was verified

- **Canary in CI.** Commit `29b64294` added fictional values to a docs file.
  Run 38430897848 failed at the "PII lint" step, with exactly the 4 expected
  findings; the escaped line and the fixtures passed. The edited `CLAUDE.md` and
  skill files diffed clean, which shows lazy blob fetch works in the blobless
  checkout. The canary was reverted before merge.
- **PR runs.** #414 (38431111936) and #415 (38433659444): PII lint, unit tests,
  build and Playwright e2e each succeeded, checked by step outcome.
- **Locally:**
  - a historical row copied into a new file is flagged, but moved is not;
  - a planted address is caught under `diff.mnemonicPrefix`/`noprefix`/`relative`
    and from a subdirectory, where the #414 version reported 0 lines and passed;
  - the lint caught a fictional `%40` example in the #415 PR body before it was
    posted.
- **Independent review.** It found no blocking bugs and confirmed the merge-base
  logic on the event types: PR merge commits (also when `dev` has moved on),
  pushes to `dev` and `main`, and the promotion PR. Its four fixable findings
  are #415; the fifth is row `.4`.

## Not verified, and gaps

- **Not on `main` at close-out** (row `.3`). The guard already gates PRs into
  `dev`, and #416 carries it to `main`.
- **No organic docs PR has gone through the gate yet.** #407 and #413 ran CI
  before #414 merged. Before they were merged, this session ran the lint over
  their added lines, commit messages and bodies (all clean) and read them for
  names (staff only).
- **The `dev` push run on `066d6eb1` failed** on the `seal.test.ts` flake (row
  `.7`), not on this change. The `dev` push for `f27868c8` was still running at
  close-out.
- **Coverage limits** (row `.6`): names; commit messages; PR titles and bodies;
  code.
- **Auto mode would not merge other sessions' PRs.** It refused #407 and #413
  as "Merge Without Review" even after "merge everything on dev". David merged
  them.

## Open items

See the tracker file. In short:
1. `.3`: finish promotion #416.
2. `.4`: decide whether legacy 6-hex credential numbers are live.
3. `.5`: decide on allowlisting system and vendor role addresses.
4. `.6`: decide whether to also lint the PR title and body in CI.
5. `.7`: the `seal.test.ts` flake.
