# Runbook: moving to Vercel Pro (G1)

Status: written 3 Nov 2026 (multi-tenancy plan S1). **Trigger: the first partner contract is signed.** Owner decision: stay on Hobby until then, and onboard no tenants and take no tenant fees on Hobby. Hobby is for non-commercial use, and tenant fees would make Stellr's use commercial.

The move should take **under a day**: §1 is done ahead of time, §2 on the day.

## 0. Until the move: Hobby guard rails

| Guard rail | How | Why |
|---|---|---|
| No tenant onboarding, no tenant fees | Owner decision; the S3+ tenant features stay behind flags | Hobby terms |
| Stay under 100 deployments a day | `vercel.json` `git.deploymentEnabled` builds only `main` and `dev`; `scripts/vercel-ignore-build.sh` skips docs-only commits; batch merges into `dev` rather than landing PRs one by one on busy days (`docs/REC-vercel-deployment-volume-2026-09-28.md`). A cancelled build still counts | Hobby deployment cap |
| Watch Active CPU and act at 70% | Hobby has no usage alert or API. Check Usage → Fluid Active CPU every Monday and before each event; at 70% of the rolling 30-day allowance, hold non-urgent deploys and keep dev crons off | At 100% Vercel **pauses every project** on the account, production included |
| Image transformations, Blob, bandwidth | As above, on the same Monday check | Same pause rule |

## 1. Before the day (prepare once, refresh the week before)

Fill this in as you go; it is the checklist for §2.

1. **Domains.** List every domain on both projects (Vercel → Project → Settings → Domains) and at the registrar: the apex, `www.` and `app.` on `stellreducation.org`, the `insimeducation.com` redirect (Vercel 308 plus the registrar's apex A record), and any dev hosts. Note which use Vercel nameservers and which use external DNS records, and lower the TTL of external records to 300 s two days before.
2. **Environment variables.** For the production and dev projects: `npx vercel env ls production`, `preview` and `development` (names only; never print values into a shared place). Keep the lists. A project transfer carries variables across, but check the counts match afterwards.
3. **Crons.** `vercel.json` defines 27 cron jobs, all daily or less often (the Hobby rule). Note which are disabled on the dev project (dev crons were turned off in Oct 2026 for CPU).
4. **Integrations and stores.** List marketplace integrations, Vercel Blob stores, Edge Config, log drains and deploy hooks. These are tied to the account and may need re-connecting after a transfer (to confirm per item in Vercel's transfer docs on the day).
5. **Webhooks pointing at Vercel URLs.** Stripe, Clerk, Resend, Sanity, Checkr and DocuSign webhooks should target the custom domains, not `*.vercel.app` URLs. Fix any that do not, before the move.
6. **Who.** Decide team seats: Pro is billed per member. Start with the owner only; the agent's machine account does not need a Vercel seat.
7. **Rollback target.** Note the production deployment ID serving `www` and `app` the day before (`list_deployments` or the dashboard).

## 2. The day (about 4 hours, quiet weekday, no event within 3 days)

1. **Create the Pro team** (Vercel → Add team → Pro), billing on the Stellr card.
2. **Spend management** (Team → Settings → Billing → Spend Management) **before** moving anything:
   - on-demand budget **$50 a month**;
   - email and in-app alerts at 50%, 75% and 100%;
   - **"Pause production deployments" when the budget is reached: OFF.** A paused production site is worse than a $50 overrun; the alerts give time to act.
3. **Transfer the projects** (Project → Settings → Advanced → Transfer) to the team: production first, then dev. Domains, environment variables and deployments move with the project (to confirm on the day against Vercel's current transfer docs).
4. **Check, for each project:**
   - Domains: every domain from §1.1 shows "Valid configuration"; `curl -sI https://www.stellreducation.org` and `https://app.stellreducation.org` return 200 or the expected redirect; the `insimeducation.com` redirect still returns 308.
   - Environment variables: counts per environment match §1.2.
   - Git: pushes to `dev` and `main` still build; the ignored-build step still runs.
   - Crons: all 27 listed under Settings → Cron Jobs and enabled on production. Decide whether to re-enable dev crons now that CPU is not a hard pause.
   - Integrations and Blob stores from §1.4 re-connected.
5. **Redeploy production** from the newest READY deployment (or push a docs-only change to trigger it), and confirm `list_deployments` shows the merge SHA READY on the team.
6. **Smoke test:** public home page, sign-in, a member page, an admin page, a Stripe test-mode checkout on dev, and `/api/health` if present.
7. **Next morning:** every cron has a fresh row in `cron_runs`; no Vercel error emails.

## 3. After the move

- Re-read `docs/REC-vercel-deployment-volume-2026-09-28.md` and relax what was only there for Hobby (deployment batching), but keep the ignored-build step: it still saves build minutes.
- Turn on usage alerts for Active CPU and Image Transformations at 70% (Pro has them).
- Consider Speed Insights and longer runtime-log retention. Longer logs help the incident plan (`docs/compliance/incident-response-plan.md` §6): Hobby keeps about an hour.
- Update `docs/compliance/information-security-program.md` §2 (Vercel row) and `docs/compliance/sub-processors-and-data-map.md`.
- Only now: tenant onboarding and tenant fees may start, subject to the rest of the plan's gates.

## 4. If it goes wrong

- A domain fails to verify: re-add it on the transferred project. If external DNS, check the record against the value Vercel shows; TTL was lowered in §1.1.
- Production is down after the transfer: promote the rollback deployment from §1.7 (Deployments → ⋯ → Promote), then debug.
- Billing or transfer blocked: stay on Hobby; nothing has changed for users until the transfer step.
