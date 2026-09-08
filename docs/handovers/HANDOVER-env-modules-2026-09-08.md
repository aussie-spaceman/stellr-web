# Handover — reconciling the two "which environment am I" modules (8 Sept 2026)

**Status:** shipped. PR #29 squash-merged to `main` as `09fca90`, CI (`verify`) green,
Vercel deployed. No migrations, no `vercel.json` change, no new outbound calls.
**No runtime behaviour changed** — this was a naming and organisation change.

---

## 1. The problem this closed

Two modules landed hours apart from parallel sessions, each answering a version of
the same question:

| Module | Function | Reads | Answers |
|---|---|---|---|
| `lib/env.ts` (PR #28) | `isProd()` | `NEXT_PUBLIC_APP_ENV` | "which environment is this deployment?" |
| `lib/env-guards.ts` (PR #27) | `isProductionDeployment()` | `VERCEL_ENV` | "which Vercel deployment *target* is this?" |

Both were correct for their own callers and wrong for the other's, and neither module
said so. The next person would reach for whichever they found first.

**The expensive direction is the cron guard.** The planned dev Vercel project
(`docs/REC-deploy-environments-2026-09-07.md` §2) tracks its own branch, so it will
report `VERCEL_ENV=production` while being, in every sense that matters, not
production. A cron guard keyed off that signal would let all twelve crons run there
and mail real members twice daily.

## 2. What shipped

- **`lib/env.ts` is now the single home for "where am I."** Both signals sit side by
  side under a header block that states where they diverge and which to reach for:
  - `appEnv()` / `isProd()` / `assertProd()` — use when deciding whether to do
    something to a real member. The only signal that stays correct once the dev
    project exists. Must be *set*; defaults to `dev`, so forgetting it makes a
    deployment go quiet rather than start mailing people.
  - `vercelTarget()` / `isProductionDeployment()` — use when deciding whether
    misconfiguration is a *defect*. Platform-set, so it cannot be forgotten.
- **`lib/env-guards.ts` keeps only integration-credential detection** — which
  environment each integration's credentials point at. It imports the
  deployment-target signal rather than defining it, and records why `VERCEL_ENV` is
  the right signal for that particular guard.
- **`vercelTarget()` replaced the two raw `process.env.VERCEL_ENV ?? 'development'`
  reads** in the admin health route and dashboard, so display and guard cannot drift.

Files: `lib/env.ts`, `lib/env-guards.ts`, `app/api/admin/health/integrations/route.ts`,
`app/(admin)/admin/page.tsx`, `lib/cron.test.ts`, `lib/env-guards.test.ts`.

### Deliberately NOT changed

`lib/docusign.ts` and `lib/docusign-agreements.ts` were named as importers to update
but needed no edit — they only ever imported `assertLiveCredentials` and
`SandboxCredentialsError`, both of which correctly stayed in `lib/env-guards.ts`.

### The one edge case

`vercelTarget()` returns a typed `'production' | 'preview' | 'development'`, so a
`VERCEL_ENV` set to some *other* value would now display as `development` in the admin
surfaces where it previously displayed verbatim. Vercel only ever sets those three, and
no guard ever treated anything but `production` as production — so no reachable
behaviour differs.

### Verification

`npx tsc --noEmit`, `npm run lint:tokens`, `npm run build` all clean. 496 tests pass
(492 before + 4 new): `vercelTarget()` across all three targets, and the divergence
case — `VERCEL_ENV=production` with `APP_ENV=dev` gives `isProductionDeployment() ===
true`, `isProd() === false`, and `guardCron` still declines.

---

## 3. Open items

### 3.1 `NEXT_PUBLIC_APP_ENV` on Production — CLOSED, value confirmed live

**Resolved in part, same day.** `npx vercel@latest env ls production` confirms the
variable exists in the **Production** scope, created ~21:50 UTC on 8 Sept, which
predates the production build from the PR #29 merge at 22:39 UTC — so it is baked into
the live build. Type `Config` (plaintext), Production-only, no Preview entry.

**Closed, same day, by exercising the guard in production** rather than by reading
the value. A cron called with the real secret returned its actual work, not a skip:

```
$ curl -s -H "authorization: Bearer $CRON_SECRET" \
    https://www.stellreducation.org/api/cron/lead-capture-failures
{"unresolved":0,"alerted":false}
```

`guardCron()` returns `{ skipped: true, ... }` before reaching any route body unless
`isProd()` is true, so a response carrying the route's own payload is proof that
`appEnv()` evaluated to exactly `prod` in the live runtime. (`lead-capture-failures`
is the safe probe: it sends nothing when the dead-letter queue is empty, so invoking
it has no side effect. It also incidentally confirms the local `CRON_SECRET` matches
Production.)

This is stronger evidence than reading the variable, because it tests the value
*through the code path that depends on it* — a `vercel env pull` would have shown the
string without proving `appEnv()` parses it as intended.

Why this matters: all 12 routes in `app/api/cron/` call `guardCron()`, all 12 are
scheduled in `vercel.json`, and `appEnv()` defaults to `dev`. A wrong value means every
cron returns `{ skipped: true, reason: 'APP_ENV=dev' }` at **HTTP 200** — deliberately,
so Vercel logs no daily failure — leaving all member mail (reminders, expiry, drip,
entitlements) silently idle while showing green. PR #28's body called this "the one
live risk."

Preview scope is deliberately unset, so preview crons fail safe to `dev`. Correct as-is.

**Tooling notes for whoever picks this up:** the Vercel CLI is *not* installed globally
on this Mac — use `npx vercel@latest`. The Vercel MCP server exposes projects,
deployments, logs and errors but **not** env-var configuration, and production
runtime-log retention here is roughly an hour, so neither can answer this question.

### 3.2 Doc references — addressed in PR #31

Closed by PR #31, but with a correction worth recording, because the first pass of this
handover overstated it. Only **one** of the three references was actually wrong:

- `docs/REC-deploy-environments-2026-09-07.md` §2.2 genuinely contradicted the code —
  it sketches `lib/env.ts` with *constants*, says crons return `204` where
  `guardCron()` returns `200` with a skip reason, and predates the second signal
  entirely. Left intact as a dated recommendation, with an **"As shipped"** note
  recording the three differences.
- `docs/GO-LIVE-CHECKLIST.md:82` and `docs/REC-docusign-remediation-2026-09-04.md:331`
  were **not wrong**. Both describe `lib/env-guards.ts` refusing to issue an envelope
  from a production deployment on sandbox credentials — which is still exactly what it
  does. The guard never moved; only the `isProductionDeployment()` test it calls did.
  Each gained a parenthetical pointing at `lib/env.ts`, so the trail is one hop rather
  than a hunt. No claim was corrected, because none was wrong.

### 3.3 `lib/env.ts` has no test file of its own

Its tests — `appEnv`, `isProd`, `assertProd`, and now `vercelTarget` and the divergence
case — all live in `lib/cron.test.ts`, a file named for a different module. Same
discoverability smell the PR set out to fix, one level up. Splitting out a
`lib/env.test.ts` is a pure move; `lib/cron.test.ts` keeps the `guardCron` cases.

### 3.4 Admin health surfaces the signal that does *not* gate the crons

`/api/admin/health/integrations` returns `{ deployment, environments, problems, ok }`
where `deployment` is `vercelTarget()`. The dashboard panel shows the same. Neither
reports `appEnv()` — the signal that actually decides whether the crons run. Adding it
would make 3.1 answerable in one authenticated call instead of a dashboard visit.

---

## 4. Context worth carrying forward

The distinction is real and must not be collapsed in a later "cleanup":

- `VERCEL_ENV` **cannot be forgotten** (platform-set) but is **wrong for the cron
  guard** — the dev project will report `production`.
- `NEXT_PUBLIC_APP_ENV` is **right for the cron guard** but **must be set**, and fails
  safe to `dev` when it is not.

That trade-off is why there are two functions and not one. The header of `lib/env.ts`
is the canonical explanation; `lib/cron.test.ts` pins the divergence as a regression
test.
