# Deploy process — environments, E2E, and session isolation

**Date:** 7 Sep 2026 · **Status:** recommendation, nothing implemented

Everything below was checked against the live Vercel project, the live Supabase
org, and git history rather than assumed. Evidence is cited inline.

---

## 1. What the process actually is today

| | Today |
|---|---|
| Environments | **One.** `stellr-web` on Vercel, `main` → production, serving www + app + apex |
| Testing environment | None. Preview deploys exist but share production's backing services |
| Database | **One** Supabase project (`hwtzpfrnksksxlwwabqz`, "Stellr Registrations"). 148 migrations, applied by hand |
| CI | **None.** No `.github/workflows`. Every gate is local and skippable |
| E2E tests | **None.** Vitest only — ~25 pure-logic unit files |
| Session isolation | Worktrees (3 live), but shared port, shared DB, shared everything else |

### The five findings that matter

**1.1 — Most deploys go straight to production.** Of the last 20 Vercel
deployments, 13 were `target: production` from `main`. PRs #25–27 exist, so the
branch discipline is there sometimes; it is not the norm.

**1.2 — One production deploy came off a dirty working tree, from an agent.**
Deployment `dpl_BGzA7PPJ7QvD2dzBpWYKAjFouFQU` carries `"gitDirty": "1"` and
`"actor": "claude-code_2-1-258_agent"` — a `vercel --prod` from an unclean tree,
bypassing git entirely. This is the exact failure `scripts/check-deploy-ready.mjs`
was written to prevent, and it happened anyway, because the script only runs if
someone chooses to run it. **A guard that lives inside the thing being guarded is
not a guard.**

**1.3 — Preview deployments already write to production systems.** Commit
`c560fdc` records the audit: six of seven `HUBSPOT_FORM_*` GUIDs are set on
Preview, and `HUBSPOT_ACCESS_TOKEN` is on both scopes — so a preview deployment
writes real contacts into the live portal. Preview also shares the single
Supabase project and the single Clerk instance. **There is currently no
deployment of this app that is safe to test against.**

**1.4 — Sequential migrations are a collision waiting to happen.** Migrations run
`001_` … `148_`. Two concurrent sessions both write `149_` and one silently
loses. This has already happened once: `GO-LIVE-CHECKLIST.md` records a `019_`
collision that had to be renumbered.

**1.5 — Nothing in the codebase knows what environment it is in.** There is no
`lib/env.ts`; the only `NODE_ENV` checks in the whole app are a cookie `secure`
flag and one media-manifest branch. Every integration — Resend, HubSpot,
DocuSign, Checkr, Stripe, the 12 crons in `vercel.json` — decides what to do
purely from which credentials happen to be present. That is why three months of
consent forms went out on DocuSign *demo* credentials without anyone noticing
(the guard added in `d4bebb0` fixes that one case, one integration at a time).

---

## 2. Target topology

```
session/<slug>  →  preview deploy (dev project)  →  dev  →  main
   worktree           auto per push                staging   production
   own port           own URL per branch          dev.stellr…  www.stellr…
   own DB branch      dev Supabase + sandboxes    dev Supabase  prod Supabase
```

**Recommendation: a second Vercel project, `stellr-web-dev`, tracking a long-lived
`dev` branch**, rather than Vercel's Custom Environments feature.

Reasoning: custom environments require Pro, and your own commit `0d05cc8`
establishes you are on Hobby limits ("Hobby accounts are limited to daily cron
jobs"). A second project works on any plan and — the actual point — gives a
**completely separate environment-variable namespace**. Sandbox keys cannot leak
into production and production keys cannot leak into dev, because they live in
different projects. With custom environments they share one namespace and one
mis-scoped variable is all it takes.

The cost is keeping two projects' variables in step. Mitigate with a checked-in
`docs/ENV-MATRIX.md` listing every variable and which of the two projects it
belongs to, kept current as part of any PR that adds one.

If you move to Pro later for other reasons, revisit — custom environments are
tidier once the isolation discipline exists.

### 2.1 Blocker: the middleware hard-codes production domains

`proxy.ts:26` and `:30`:

```ts
const WWW = 'https://www.stellreducation.org'
const isAppSubdomain = host === 'app.stellreducation.org'
```

A dev deployment would redirect its own users to production the moment they hit
any public-only route. **This must be fixed before a dev environment can exist at
all.** Pages are fine — they already read `NEXT_PUBLIC_SITE_URL` /
`NEXT_PUBLIC_AUTH_APP_URL` with production fallbacks — it is only the middleware.

### 2.2 The environment module

Introduce `lib/env.ts` as the single place that answers "where am I":

```ts
export const APP_ENV = (process.env.NEXT_PUBLIC_APP_ENV ?? 'dev') as 'dev' | 'prod'
export const isProd = APP_ENV === 'prod'

/** Throw unless running in production. For anything that touches a real person. */
export function assertProd(what: string) {
  if (!isProd) throw new Error(`${what} is production-only (APP_ENV=${APP_ENV})`)
}
```

Note the default is `dev`, not `prod`: an unset variable must fail safe toward
"don't send it", never toward "send it to a real teacher."

Then make it load-bearing in three places:

- **Crons.** Vercel runs crons on a project's *production* deployment — and the
  dev project's `dev` branch **is** a production deployment for that project, so
  all 12 crons in `vercel.json` would fire there and email real people daily.
  Every route under `app/api/cron/` returns `204` unless `isProd`.
- **Outbound mail.** In dev, redirect every recipient to a single safelist
  address rather than trusting that dev data contains no real addresses. It will.
- **CRM / e-sign / background checks.** HubSpot has no sandbox portal on your
  plan (recorded in `POST-DEPLOY-landing-pages-2026-09-02.md`), so dev must run
  with an explicit `HUBSPOT_DRY_RUN=1` that logs the intended write. Relying on
  the token being absent is what produced the current half-writing preview
  behaviour.

### 2.3 Service matrix

| Service | Production | Dev | Notes |
|---|---|---|---|
| Supabase | `hwtzpfrnksksxlwwabqz` | new `stellr-web-dev` | `stellr-entitlements-dev` exists but is INACTIVE since June — revive or replace |
| Clerk | production instance | development instance | Separate user store; test users live here |
| Stripe | live keys | test keys | `verify:prod` already checks key mode |
| HubSpot | live portal | **dry-run** | No sandbox available on plan |
| DocuSign | production account | demo | Guard from `d4bebb0` already refuses sandbox in prod — add the converse |
| Checkr | `api.checkr.com` | `api.checkr-staging.com` | Already the `.env.local.example` default |
| Resend | live sender | live sender, **safelisted recipients** | One verified domain only; recipient guard is the control |
| Crons | on | **off** via `isProd` | See 2.2 |

**Cost:** a second Supabase project is free if it fits the two-project free tier
(you currently have two, one INACTIVE). Vercel stays on Hobby. Realistically $0
unless the dev DB outgrows free tier.

---

## 3. Session isolation

The clashes are four separate collisions; fix each at its own layer.

**3.1 Branch.** One branch per session, `session/<yyyy-mm-dd>-<slug>`, cut from
`dev`. **Enable branch protection on `main` and `dev`** — no direct pushes, PR
required. This is the structural fix: today "don't push to main" is a request an
agent can forget at 11pm, and the deployment record shows it does. Protection
makes it impossible rather than discouraged.

**3.2 Port.** `.claude/launch.json` hard-codes port 3000, so the second worktree's
dev server dies or, worse, silently attaches to the first one's. Compute a free
port per worktree and write it into that worktree's `.env.local`. The pattern
worth copying is in `~/Downloads/skills/farmshare-worktree/compute-context.sh`:
it scans *sibling worktrees' env files* for claimed ports rather than probing
live listeners, because a probe cannot see a dev server that has not started yet
and will hand two idle worktrees the same "free" port.

**3.3 Database.** Each session points at the dev Supabase project. For work that
changes schema, use a Supabase **branch** per session (the org supports it; only
`main` exists today) so a migration in one session cannot break another's
running app.

**3.4 Migrations.** Switch new migrations from sequential integers to timestamps:

```
20260907T142530_recipient_status.sql
```

Two sessions can then never collide, and it still sorts correctly after the
existing `001_`–`148_` files. Pair it with a `schema_migrations` ledger table and
a `npm run db:status` that diffs the directory against what is actually applied
per environment. Right now "which migrations are applied where" is tribal
knowledge held in prose in `GO-LIVE-CHECKLIST.md`, and that is how main and prod
diverged before.

---

## 4. End-to-end testing with Playwright

**Ordering note: E2E depends on the dev environment, not the other way round.**
Authenticated tests need a Clerk instance whose users you can create and delete,
and a database you can write to and sweep. Neither exists today. Building the
suite against production would mean either testing only logged-out pages or
creating real members — so sections 2 and 3 come first.

### 4.1 Shape

```
e2e/
  smoke/          unauthenticated public pages — every PR
  core/           authenticated member + admin flows — every PR to dev
  full/           long-tail, third-party round-trips — nightly
  pages/          page objects; no selector ever appears in a spec
  fixtures/       auth storageState, console guard, data sweeper
playwright.config.ts
```

Adopt the conventions in `~/Downloads/skills/playwright-write-test/references/conventions.md`
close to verbatim — they are good and hard-won. The four that will matter most here:

1. **No selectors in specs.** Every locator lives in a page object. With a design
   system whose Tailwind classes are regenerated from tokens, any class-based
   selector is guaranteed to rot — `getByRole` and `getByLabel` survive a token
   change, `.bg-primary` does not.
2. **No `waitForTimeout`, ever.** Web-first assertions only.
3. **Never make a test pass by weakening it.** A failing spec is a finding.
4. **Console-error guard** as a fixture, with a documented allowlist.

### 4.2 Auth

Clerk dev instance + a `storageState` fixture per role (member, admin, teacher).
Generate it once in `globalSetup`, never commit it, never hard-code credentials
in a spec.

### 4.3 What to cover first

Priority driven by where your own handover docs record real defects, not by
coverage percentage:

1. **Registration → consent (DocuSign)** — the flow that produced the "we signed
   it last week, what now?" incident. Highest user impact, most moving parts.
2. **Membership tier gating** — access control is enforced in server code, not
   RLS (`GO-LIVE-CHECKLIST.md` §2), so nothing but a test proves a gated route
   actually rejects a non-member.
3. **Lead-capture forms** (`/lp/*`, contact, scholarship) — with HubSpot in
   dry-run, assert the route's response contract, not the CRM write.
4. **Admin roster and event pages** — the surfaces most often changed.
5. **Design-system smoke** — every page renders with no console error, at mobile
   and desktop widths. The landing-page handover records a page that was never
   checked below 1280px.

### 4.4 Where it runs

- Locally against the session's own port, during development.
- In CI against the **Vercel preview URL** for the branch (`E2E_BASE_URL`) — this
  is what makes the test meaningful, because it exercises the real deployment
  with real env wiring.
- Smoke only, read-only, against production after a promotion.

---

## 5. CI — the missing foundation

There is no `.github/workflows` directory. This is the highest value-per-hour
item on the list, and it is a precondition for the rest: every gate in any deploy
skill is advisory until something outside the session enforces it.

Minimum workflow on every PR:

```
tsc --noEmit → lint:tokens → vitest → next build → playwright smoke (vs preview URL)
```

With branch protection requiring those checks, §1.1 and §1.2 stop being possible
rather than stopping being frequent.

---

## 6. Changes to the deploy skill

Reviewed: `.claude/skills/ship/SKILL.md`. It sequences the right *phases* —
contract → preflight → E2E → spec review → PR → verify — and the spec-alignment
table is worth keeping. But it was written for the world in §1, and needs
restructuring for the one in §2.

**6.1 Split it in two.** One skill cannot cover both hops, because they have
different risk profiles and different gates.

- **`/ship`** — session branch → `dev`. Runs often, fully automatic once green,
  no confirmation needed to deploy to dev. Speed matters here.
- **`/promote`** — `dev` → `main`. Runs deliberately, always confirmed, includes
  release notes and a rollback plan. Model it on
  `~/Downloads/skills/cut-release/SKILL.md`.

**6.2 Add a session-setup phase to `/ship`.** Create the worktree, cut the branch
from `dev`, allocate the port, seed `.env.local` from the dev template, and record
the session in a gitignored registry. Today the skill assumes the branch already
exists and the environment is already right.

**6.3 Move the gates to CI.** Once §5 exists, the skill should push and read the
check results rather than running `tsc`/`vitest`/`build` locally. Faster, and it
cannot be talked out of the result.

**6.4 Add the migration phase — the skill has none, and half of what you deploy
is database.** Encode the rule you already follow but have never written down,
from commit `8nBeD8P`: *apply the migration to production before merging the code
that needs it* — old code against new schema is the safe direction, new code
against old schema is an outage. The phase should: apply to dev, verify, get
explicit approval, apply to prod, verify, and only then merge.

**6.5 Ban CLI deploys outright.** The skill must state that deployment happens
only by git push, and that `vercel --prod`, `vercel deploy`, `--force`, and
`--no-verify` are never to be run. §1.2 is a session doing exactly this.

**6.6 Record a rollback target before merging.** Capture the current production
deployment id (the Vercel API marks `isRollbackCandidate`) and put it in the PR
body, so rolling back is one command and not an archaeology exercise.

**6.7 Make it resumable.** A promotion spans DocuSign console steps, HubSpot
propagation, and cron windows — hours, not minutes. `cut-release`'s per-release
progress doc pattern (`.claude/releases/release-<date>.md`, gitignored, updated
after every step, terminal states `Tagged`/`Abandoned`) solves exactly this and
should be lifted wholesale.

**6.8 Add a blast-radius section.** Before promoting, name what this change
touches: migrations, `vercel.json` crons, webhook contracts, new env vars,
outbound email volume. Your handover docs already do this well in prose — the
skill should make it a required field rather than a good habit.

---

## 7. Sequence

Ordered by dependency, not by appeal.

| Phase | Work | Unblocks |
|---|---|---|
| **1** | Branch protection on `main`; CI workflow; `lib/env.ts`; cron `isProd` guard; env-drive `proxy.ts` | Everything. No new infrastructure, no cost |
| **2** | Create `dev` branch + `stellr-web-dev` Vercel project + dev Supabase; sandbox credentials; `ENV-MATRIX.md` | A place to test |
| **3** | Per-worktree ports; timestamped migrations; `schema_migrations` ledger + `db:status` | Concurrent sessions |
| **4** | Playwright: config, smoke tier, CI wiring | Real E2E |
| **5** | Playwright core tier with Clerk auth fixtures | Coverage of the flows that break |
| **6** | Split the skill into `/ship` + `/promote` with §6 changes | The whole loop |

Phase 1 alone removes both failure modes in §1.1 and §1.2, and costs nothing but
an afternoon. If only one phase gets done, make it that one.
