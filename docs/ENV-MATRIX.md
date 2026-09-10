# Environment variable matrix

Which variable belongs to which environment, and where its value comes from.

Phase 2 of `REC-deploy-environments-2026-09-07.md` splits one environment into
two. Two Vercel projects means two variable namespaces, and the thing that keeps
them honest is this table — a variable set in the wrong place is how a dev
deployment mails a real teacher.

**Keep this current in the same PR that adds a variable.** A matrix that lags
the code is worse than none, because it is believed.

## The environments

| | Production | Dev |
|---|---|---|
| Vercel project | `stellr-web` (`prj_wMlZwzDocSUrQ5sFZMngrNBeoUvx`) | `stellr-web-dev` (`prj_Nd2kmpMj3bBuXbSjc6teUdwh9gPO`) |
| Tracked branch | `main` | `dev` |
| Domains | www / app / apex `.stellreducation.org` | TBD — `dev.` / `app-dev.` |
| Supabase | `hwtzpfrnksksxlwwabqz` "Stellr Registrations" | `xvxlhbxtiwxpopoqjygm` "stellr-web-dev" |
| Crons | run | **decline** — `guardCron()` sees `APP_ENV=dev` |

## 1. The variable that decides everything

| Variable | Production | Dev | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_APP_ENV` | `prod` | `dev` *(or unset)* | Read by `lib/env.ts`. Matches `'prod'` **exactly** — `'production'` or any typo reads as dev and silently skips all 12 crons at HTTP 200. Confirmed live in production 8 Sept. |

Everything below is safe to get wrong in only one direction: dev holding a
production credential is the dangerous case, never the reverse.

## 2. Must differ between environments

These are the ones that make dev a *different place*. A shared value here means
dev writes to production.

| Variable | Production | Dev | Where the dev value comes from |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | prod project | `https://xvxlhbxtiwxpopoqjygm.supabase.co` | Already known |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | prod anon | dev anon | Supabase dashboard → dev project → API keys |
| `SUPABASE_SERVICE_ROLE_KEY` | prod service role | dev service role | Same page. **The single most dangerous variable to share** — full write access, bypasses every check in server code |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_…` | `pk_test_…` | Clerk dashboard → Development instance |
| `CLERK_SECRET_KEY` | `sk_live_…` | `sk_test_…` | Same |
| `CLERK_WEBHOOK_SECRET` | prod endpoint | dev endpoint | New webhook on the dev instance pointing at the dev app URL |
| `STRIPE_SECRET_KEY` | `sk_live_…` | `sk_test_…` | Stripe → test mode |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_live_…` | `pk_test_…` | Same |
| `STRIPE_WEBHOOK_SECRET` | live endpoint | test endpoint | Separate webhook in test mode |
| `NEXT_PUBLIC_SITE_URL` | unset → falls back to `https://www.stellreducation.org` | dev www URL | **Must be set on dev.** `proxy.ts` redirects public-only routes here; unset means dev bounces users to production |
| `NEXT_PUBLIC_AUTH_APP_URL` | `https://app.stellreducation.org` | dev app URL | `APP_HOST` derives from this; it decides which host is the member app |
| `CRON_SECRET` | prod secret | a *different* secret | Generate fresh. Sharing it lets a dev URL trigger prod-shaped calls |

## 3. Sandbox already, or safe to share

| Variable | Note |
|---|---|
| `DOCUSIGN_*` (11 vars) | `.env.local.example` already defaults to demo (`account-d` / `demo.docusign.net`). `lib/env-guards.ts` refuses to issue from a production deployment on sandbox credentials; dev on sandbox is the intended state |
| `CHECKR_BASE_URL`, `CHECKR_API_KEY`, `CHECKR_PACKAGE_SLUG` | Already `checkr-staging` by default |
| `NEXT_PUBLIC_SANITY_*` | Same CMS content is fine in dev — it is read-mostly. `SANITY_API_TOKEN` (write) should be omitted from dev |
| `NEXT_PUBLIC_GTM_ID` | **Omit on dev.** Otherwise dev traffic lands in GA4 |
| `NEXT_PUBLIC_BOOKING_URL`, `NEXT_PUBLIC_DONATION_URL` | Plain links, safe |

## 4. No sandbox exists — dev must be inert

The hard cases. These services have no test environment on the current plans, so
dev safety comes from the code declining to call them, not from a sandbox.

| Variable | Dev handling |
|---|---|
| `HUBSPOT_ACCESS_TOKEN`, `HUBSPOT_FORM_*`, `HUBSPOT_PORTAL_ID` | **Omit entirely.** No sandbox portal exists on this plan (`POST-DEPLOY-landing-pages-2026-09-02.md`). Absent token → the route dead-letters to `lead_capture_failures` instead of writing. A `HUBSPOT_DRY_RUN=1` switch that logs the intended write would be better than relying on absence — not built yet |
| `RESEND_API_KEY` | **Safe to set as of 9 Sept.** `lib/email.ts` now redirects every recipient to `DEV_EMAIL_SAFELIST` (default `hello@stellreducation.org`) outside production, dropping cc and recording the intended addresses in the subject. Set `DEV_EMAIL_SAFELIST` alongside it; blank it to suppress non-production mail entirely |
| `GOOGLE_SERVICE_ACCOUNT_*`, `MOTION_CALENDAR_ID` | Omit. Reads a real calendar |
| `APOLLO_WEBHOOK_SECRET`, `MOTION_WEBHOOK_SECRET` | Omit. Inbound webhooks should only ever reach production |
| `PRINTFUL_*` | Omit. Real orders |
| `JAAS_*` | Omit — `lib/video-provider.ts` falls back to open `meet.jit.si` rooms with no token, which is correct for dev |

## 5. Still to do

Ordered by what blocks what.

1. ~~**Create the `stellr-web-dev` Vercel project.**~~ **Done 9 Sept** —
   `prj_Nd2kmpMj3bBuXbSjc6teUdwh9gPO`, linked to `aussie-spaceman/stellr-web`.
   Two traps for anyone repeating this: the API will not create it (a repo gets
   one project through `create_git_project`, and it silently reuses the existing
   one), and **Production Branch does not appear as a setting until a Git
   repository is connected** — it is a property of the Git link, not of the
   project, so a bare project has nowhere to set it.
2. **Seed the dev database.** 148 migrations, never replayed from zero, so this
   is also the first test of whether they are coherent:
   ```
   npx supabase link --project-ref xvxlhbxtiwxpopoqjygm
   npx supabase db push
   ```
   `link` prompts for the database password (Supabase dashboard → Settings →
   Database → reset if unknown). `db push` applies them in order **and creates
   the `supabase_migrations.schema_migrations` ledger** — the tracking §3.4 of
   the REC asks for, which production still lacks.
3. **Populate dev variables** per §2–4.
4. **Point `dev.` / `app-dev.` DNS** at the dev project.
5. ~~**Build the Resend recipient safelist**~~ **Done 9 Sept** — see §4.
   `lib/email.ts` is the only path to Resend (the waitlist script imports
   `sendEmail` rather than calling the API), so one guard covers every send.
