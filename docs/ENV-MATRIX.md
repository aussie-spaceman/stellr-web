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
| Tracked branch | `main` | `dev` (since 15 Sept 2026 — see note below) |
| Domains | www / app / apex `.stellreducation.org` | TBD — `dev.` / `app-dev.` |
| Supabase | `hwtzpfrnksksxlwwabqz` "Stellr Registrations" | `xvxlhbxtiwxpopoqjygm` "stellr-web-dev" |
| Crons | run | **decline** — `guardCron()` sees `APP_ENV=dev`. The dev project's crons are enabled in Vercel (re-enabled 15 Sept) precisely so that guard is exercised on every schedule. The one exception is the two steps `CRON_NON_PROD_JOBS` can name (S5 wave 7, B26a; unset, section 6) |

**Dev project branch tracking.** `stellr-web-dev`'s Production Branch was
`main` until 15 Sept 2026, deliberately: switching it makes `dev` pushes a
*Production* deployment, which reads the project's **Production** scope, and
that scope was empty. On 15 Sept every variable's target was extended to
Preview + Production (via `vercel api`, values untouched), then the branch was
switched to `dev` (Settings → Environments → Production → Branch Tracking) and
the project's crons re-enabled. `dev` pushes now deploy as Production on this
project at `stellr-web-dev-stellreducation.vercel.app` (the
`…-git-dev-…` alias still resolves). Preview scope is kept in step with
Production.

**Which pushes build (since 15 Sept 2026).** `vercel.json` sets
`ignoreCommand: bash scripts/vercel-ignore-build.sh`, which overrides the
dashboard Ignored Build Step on both projects and keys on `VERCEL_PROJECT_ID`:
`stellr-web` builds **`main` only**; `stellr-web-dev` builds **`dev` only**.
Feature-branch pushes build nowhere — CI is the gate, and the `dev` alias is
the place to look after a merge. Before this, every push to every branch built
in both projects (six deployments per PR) and Function Storage reached 75% of
the Hobby limit; see `docs/handovers/HANDOVER-vercel-function-storage-2026-09-15.md`.
The older dashboard command on `stellr-web-dev` is now inert and can stay.

That fixed Function Storage; **Deployment Storage** (build output + static
assets, a separate 10 GB meter) hit 100% on 21 Sept because every build still
shipped 515 MB of `/public` media. The media now lives in Vercel Blob — see
`NEXT_PUBLIC_MEDIA_BASE_URL` in §3 and
`docs/handovers/HANDOVER-vercel-deployment-storage-2026-09-21.md`.

**Function Storage again (6 Oct 2026).** Builds are retained for days, not
"3 per project": both projects had `deploymentExpiration` at 30 days with
`deploymentsToKeep: 10`, and the dev project had piled up 146 builds (~42 MB
of functions each) by the time Function Storage hit 75%. Three changes followed:
- Old builds were purged, leaving 10 on prod and 5 on dev.
- `stellr-web-dev` retention was set to 1 week (cancelled builds: 1 day). This
  was done via `PATCH /v9/projects/<id>/deployment-expiration` with
  `{"expiration":"1w","expirationProduction":"1w","expirationCanceled":"1d","expirationErrored":"1w"}`.
  Hobby accepts it. Prod stays at 30 days for rollback depth.
- `vercel-ignore-build.sh` skips **docs-only `dev` pushes** on the dev project:
  only `docs/`, `.claude/` or root `*.md` changed since the last successful dev
  build. Put `[build]` in a commit message to force one. Docs-only `main` pushes
  still build, because that is how a missing production deployment gets
  re-triggered.

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
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | prod `sb_publishable_…` | dev `sb_publishable_…` | Supabase dashboard → dev project → Settings → API Keys → *Publishable and secret API keys*. The only public Supabase key the app reads |
| `SUPABASE_SECRET_KEY` | prod `sb_secret_…` named `vercel_prod` | dev `sb_secret_…` named `vercel_dev` | Same page. One named secret key per consumer (each Vercel project, CI, each laptop, the watermark worker): `docs/RUNBOOK-supabase-api-keys.md`. The only elevated Supabase key the app reads. **The single most dangerous variable to share** — full write access, bypasses every check in server code |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_…` | `pk_test_…` | Clerk dashboard → Development instance |
| `CLERK_SECRET_KEY` | `sk_live_…` | `sk_test_…` | Same |
| `CLERK_WEBHOOK_SECRET` | prod endpoint | dev endpoint | New webhook on the dev instance pointing at the dev app URL |
| `STRIPE_SECRET_KEY` | `sk_live_…` | `sk_test_…` | Stripe → test mode |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_live_…` | `pk_test_…` | Same |
| `STRIPE_WEBHOOK_SECRET` | live endpoint | test endpoint | Separate webhook in test mode |
| `NEXT_PUBLIC_SITE_URL` | unset → falls back to `https://www.stellreducation.org` | dev www URL | **Must be set on dev.** `proxy.ts` redirects public-only routes here; unset means dev bounces users to production |
| `NEXT_PUBLIC_AUTH_APP_URL` | `https://app.stellreducation.org` | dev app URL | `APP_HOST` derives from this; it decides which host is the member app |
| `CRON_SECRET` | prod secret | a *different* secret | Generate fresh. Sharing it lets a dev URL trigger prod-shaped calls |

The legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` were a
fallback until **3 Nov 2026**, when the code stopped reading them (runbook step
11). The legacy JWT keys are disabled on both Supabase projects: dev at 23:27 UTC
and production at 23:31 UTC on 3 Nov 2026, both confirmed refused at the
gateway (runbook steps 9–10). Where either variable is still set (Vercel, GitHub
secrets, an old `.env.local`), it is ignored and can be deleted.

## 3. Sandbox already, or safe to share

| Variable | Note |
|---|---|
| `DOCUSIGN_*` (11 vars) | `.env.local.example` already defaults to demo (`account-d` / `demo.docusign.net`). `lib/env-guards.ts` refuses to issue from a production deployment on sandbox credentials; dev on sandbox is the intended state |
| `CHECKR_BASE_URL`, `CHECKR_API_KEY`, `CHECKR_PACKAGE_SLUG`, `CHECKR_WORK_LOCATION_STATE`, `NEXT_PUBLIC_CHECKR_DASHBOARD_URL` | **Dev:** staging key + `stellr_crimid` (defaults are already `checkr-staging`). **Prod (live since 24 Sept 2026, Production scope only):** production key, `CHECKR_BASE_URL=https://api.checkr.com/v1`, `CHECKR_PACKAGE_SLUG=checkrdirect_basic_plus_criminal`, `NEXT_PUBLIC_CHECKR_DASHBOARD_URL=https://dashboard.checkr.com`; `CHECKR_WORK_LOCATION_STATE` deliberately unset (no assumed state). `lib/env-guards.ts` treats a key with the staging host as a defect on a production deployment and the order route refuses (503). `CHECKR_WEBHOOK_SECRET` stays unset everywhere (Checkr signs with the API key) |
| `NEXT_PUBLIC_SANITY_*` | Same CMS content is fine in dev — it is read-mostly. `SANITY_API_TOKEN` (write) should be omitted from dev. **Pending (S5 wave 7, K2; owner decision `W7-5`, approved 11 Nov 2026):** a separate `development` dataset for dev, imported from production with ids kept, then `NEXT_PUBLIC_SANITY_DATASET=development` on `stellr-web-dev` only, with a dev-only event-sync webhook. Not done as of 12 Nov 2026 |
| `NEXT_PUBLIC_GTM_ID` | **Omit on dev.** Otherwise dev traffic lands in GA4 |
| `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`, `NEXT_PUBLIC_BING_SITE_VERIFICATION`, `INDEXNOW_KEY` | **Production only.** Search Console / Bing Webmaster ownership tokens and the IndexNow key (added 24 Sept 2026, AEO phase 1). On dev they would claim or ping the production property from a non-production host. Unset = no meta tag, `/indexnow-key.txt` 404s and `scripts/indexnow-submit.ts` refuses |
| `NEXT_PUBLIC_BOOKING_URL`, `NEXT_PUBLIC_INTRO_CALL_URL`, `NEXT_PUBLIC_DONATION_URL` | Plain links, safe |
| `LINKEDIN_ORGANIZATION_ID` | Numeric ID of Stellr's LinkedIn Page (from `linkedin.com/company/<id>/admin/`). Public knowledge, same value everywhere. `lib/linkedin.ts` falls back to `organizationName` when unset, so dev works without it; set on prod so profile entries link to the Page |
| `NEXT_PUBLIC_MEDIA_BASE_URL` | **Same value everywhere, and required** (since 21 Sept 2026): `https://l3zabozgfpz3vahd.public.blob.vercel-storage.com`, the `stellr-media` public Blob store. Marketing media is not environment-specific; an empty value 404s every testimonial video, photo and gated PDF because they no longer ship in `/public`. Baked in at build time (`NEXT_PUBLIC_`), so set it before the build, not after. `BLOB_READ_WRITE_TOKEN` is local-only (`scripts/upload-media.ts`) and belongs on no deployment. See `docs/handovers/HANDOVER-vercel-deployment-storage-2026-09-21.md` |

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

## 6. Tenancy flags (S5)

The switches for the multi-tenancy conversion. **Unset is correct on both
projects today:** each default leaves Stellr as it is. Nothing in the S5 PRs sets
one. A flip is the owner's, on dev first, each followed by a redeploy of the newest
READY deployment (`docs/TENANCY-S5.md`, Owner gates), because a running deployment
does not pick up a new value. Since S5 wave 7 (O1, #654, on dev),
`GET /api/admin/health/integrations` (admin only) reports every switch below as it
resolved, under `tenancy`, never a raw value: `unrecognised` names a variable whose
value fell back to its default, and `invalidCombinations` a switch set without what it
needs. Read it after each redeploy to see that a flip took effect.

| Variable | Unset means | Other values | Read by | Before setting it |
|---|---|---|---|---|
| `AUTHZ_SOURCE` | `clerk`: the Clerk claim decides, as today | `shadow`, `postgres`. Anything unrecognised means `clerk`, and leaves an `app_errors` row | `lib/authz.ts` | `docs/AUTHZ.md`, "What must hold before a flip". Converted routes now decide through `lib/authz`, so `shadow` compares real decisions; health reports it as `tenancy.authzSource` |
| `LOADSCOPED_MODE` | `off` | `shadow`, `enforce`. Anything unrecognised means `off`, and is reported once per instance | `lib/tenancy/load-scoped.ts` | Section D of `tenancy_cutover_checks` at 0 NULL (`docs/TENANCY-S5.md`, Owner gates). Order and rollback: `docs/TENANCY-S5-data.md` |
| `TENANT_DB_ENABLED` | `tenantDb` refuses to run, and every area reads through the service path | Exactly `true` turns it on | `lib/tenancy/db.ts`, `lib/tenancy/area-switch.ts` | The `tenant_app_login` role, `TENANT_DATABASE_URL` and `TENANT_DATABASE_CA_CERT` (owner gate). Its first caller is C18's `events-config` area (#624, on production since #643 on 12 Nov 2026), reached only for an area `TENANT_DB_AREAS` lists. `docs/TENANCY-S5-data.md` |
| `TENANT_DB_AREAS` | Every area reads through the service path | Comma-separated `<area>:shadow`, `<area>:shadow:<rate>` or `<area>:tenant`. Only `events-config` exists. A malformed, unknown or repeated entry is ignored and reported by count once per instance | `lib/tenancy/area-switch.ts` | `TENANT_DB_ENABLED`, and C18's caller. Shadow at a low rate first: `docs/TENANCY-S5-data.md` |
| `TENANT_DATABASE_URL` | With `TENANT_DB_ENABLED` on, `tenantDb` throws: there is no fallback connection | A **server-only secret**: the `tenant_app_login` pooler URL, transaction mode. Refused unless its user is `tenant_app_login` (or `tenant_app_login.<ref>`), if it carries any query parameter except `sslmode` or gives `sslmode` twice, and, for any host but `localhost` or `127.0.0.1`, unless its `sslmode` is `verify-full` (C11t, wave 6) | `lib/tenancy/driver.ts`, loaded only with the flag on | The owner creates the login: `docs/TENANCY-S5-data.md`, "Owner steps". Never `NEXT_PUBLIC_`. Different per project |
| `TENANT_DATABASE_CA_CERT` | With `TENANT_DB_ENABLED` on and a host other than `localhost` or `127.0.0.1`, `tenantDb` throws before any pool exists. Not read for a local host | A **server-only secret**: the PEM of the root CA that signs the database's certificate. One or more CA certificates and nothing else; a server certificate is refused. A value stored with literal `\n` escapes is read as newlines | `lib/tenancy/driver.ts` alone (`lib/tenancy/driver-wiring.test.ts`), only with the flag on | `TENANT_DATABASE_URL`, and a PASS from the pooler TLS canary on `dev` (`scripts/tenant-db-canary.ts`, O3; `docs/TENANCY-S5-data.md`, "Owner steps"). **Which PEM is pending** that run (P6). Never `NEXT_PUBLIC_`. A changed value gets a new pool after a redeploy. With `TENANT_DB_ENABLED` on, health shows `tenancy.tenantDb.config` {`url`, `ca`}, each `ok` or a fixed reason, and a refusal writes one `TENANTDB config` row to `app_errors` per instance |
| `PLATFORM_AUDIT_ENABLED` | Audit writes nothing and reads no session | Exactly `true` turns it on | `lib/audit/platform.ts`, `lib/audit/route.ts` | The `platform_audit_webhook_actor` migration. Watch `platform_audit_events` against Supabase Free's 500 MB. Read `docs/PLATFORM-AUDIT.md`, then the decisions in `docs/TENANCY-S5-data.md` before production |
| `TENANT_EVENT_MAIL_ENABLED` | Another tenant's event and signing mail is held: the `event-emails` and `docusign-reminders` crons leave its rows for a later run and count them as `tenantHeld`, `sendEventEmail` and `sendCatchUp` answer 503 to a tenant row with no sender, and the signing engine holds a tenant envelope's invitations in the outbox and sends none of its reminders, completion emails, or bounce notices to its signers and organisers (staff notices are unchanged). Stellr's mail never reads it | Exactly `true` turns it on: a tenant's event mail, and its Stellr-signing (native) envelope mail, go from its own sender ("`<Tenant>` via Stellr", its Reply-To). A tenant with no usable sender sends nothing. A tenant's DocuSign envelopes stay held whatever it says, because DocuSign sends as Stellr | `lib/event-emails/tenant-mail.ts`, the `event-emails` and `docusign-reminders` crons, `lib/esign/outbox.ts`, `lib/esign/providers/native.ts`, `lib/esign/completion.ts`, `lib/esign/bounce-notices.ts`, `lib/event-emails/tenant-signing.ts` | The tenant's Reply-To in `tenants.branding.reply_to`, and its events resolvable through the events facade. Mail counts on the one shared daily budget (owner decision, 9 Nov 2026): `docs/S5-CRONS-LIMITS-SMMA.md`. Arrived with B14 in wave 5; wave 6's B14b (#610) extended it to the signing engine |
| `TENANT_GUARDIAN_CONSENT_ENABLED` | Every 14-17-year-old is refused at another tenant's event with the approved under-age copy, and nothing is written; the daily consent sweep does not run. Stellr's own events and minors never read it | Exactly `true` turns it on | `lib/registration/eligibility.ts`, `lib/registration/tenant-guardian-consent.ts`, `lib/registration/individual/gate.ts`, the `membership-expiry` cron (the sweep) | It gates guardian consent on a tenant's event (S5 wave 6, A16): `POST /api/register/individual` admits a 14-17-year-old consent-pending, the guardian is sent the platform-locked consent form, and the sweep expires, removes and voids. Before setting it: the `20261110164339_tenant_guardian_consent` migration applied and its pgTAP passed in CI's `db` job; the `tenant_guardian_consent` document published on the signing engine and `ESIGN_TOKEN_SECRET` set; `TENANT_EVENT_MAIL_ENABLED` on and the tenant's sender set. **Lane C's tenant-event refusals (`refuseUnlessStellrEvent`, #624: the `remind`, `docusign-reissue`, guardian, `offerings` and `merch/commit` routes under `app/api/admin/events/[slug]` refusing another tenant's event) must be live in the same environment first** (owner decision, 11 Nov 2026: on `dev` they are, since #624; on production too, since #643 on 12 Nov 2026), and `LOADSCOPED_MODE` decided by the owner (whether `enforce` is also required). The credentials, team-profile and survey paths leave out consent-pending tenant minors since S5 wave 7 (A10a #655, A10b #660, on dev only, not promoted) |
| `RATE_LIMIT_STORE` | `memory`, today's per-instance limiter | `shadow`, `postgres`. Anything unrecognised means `memory` | `lib/rate-limit-store.ts` | The `rate_limit` migration and `RATE_LIMIT_KEY_SECRET`. A9's participant routes use the store; B15's are not built, so production waits for it. Shadow first, and flip outside events: `docs/S5-CRONS-LIMITS-SMMA.md`. Since S5 wave 7 (O2, on dev) a shadow disagreement or a store problem leaves a `RATELIMIT` row in `app_errors`; health shows `tenancy.rateLimitStore` {`mode`, `secretUsable`} |
| `RATE_LIMIT_KEY_SECRET` | The limiter sends nothing to Postgres and uses memory | A secret of 32+ characters. **Different per project.** Changing it restarts every open window | `lib/rate-limit-store.ts` | Create it before any non-memory mode |
| `TENANT_ROUTING_ENABLED` | Every host is Stellr, with one string comparison per request | Exactly `true` turns it on | `proxy.ts`, `lib/tenancy/host.ts`, `lib/tenancy/request-tenant.ts` | `docs/TENANCY-S5-routing.md`, "Turning it on". **Never attach a zone before this and the suffix are live and confirmed** |
| `TENANT_HOST_SUFFIX` | No zone. With routing on, known Stellr hosts work and any other host answers 503 | The tenant zone as a suffix. Refused if it could swallow Stellr's hosts, or if it is a dev zone on production | `lib/tenancy/host.ts`. Reported by `GET /api/admin/health/integrations` as `tenantRouting.suffixError`, never the value | Same |

`TENANT_DATABASE_URL` (C11), `TENANT_DB_AREAS` (C12) and `TENANT_EVENT_MAIL_ENABLED`
(B14) arrived in wave 5, and `TENANT_GUARDIAN_CONSENT_ENABLED` (A16) and `TENANT_DATABASE_CA_CERT` (C11t) in wave 6. CI's `tenant-db` job sets its own `TENANT_DB_TEST_URL` and
`TENANT_DB_TEST_ADMIN_URL` on the runner, for a login it creates there; neither belongs
on a Vercel project.

### Wave 7: dev-only and operator variables (S5)

For the dev watch-only wave and the canary tenant. **None of them belongs on the
production project.** The first is the only one set on a Vercel project, and only on
`stellr-web-dev`; the rest live in the operator's own shell for one run and go nowhere
else, never in `.env.local`, a commit or chat.

| Variable | Where | Unset means | Values | Notes |
|---|---|---|---|---|
| `CRON_NON_PROD_JOBS` | `stellr-web-dev` only, and only around P12 | Every cron declines on dev, as before | Comma-separated, from exactly two: `email-outbox` and `membership-expiry:tenant-consent`. Anything else is ignored | B26a (#651), `lib/cron-dev-opt-in.ts`. Read only when `NEXT_PUBLIC_APP_ENV` is exactly `dev` and `VERCEL_ENV` is `production`, so never on a preview, a local run or production. The consent value runs `membership-expiry`'s consent sweep alone, never the minor-account purge. Vercel's schedules run what it names too. The owner sets it (or an agent with the owner's yes) just before P12 and clears it after: `docs/S5-CRONS-LIMITS-SMMA.md`, "The dev opt-in" |
| `TENANT_DB_CANARY_URL` | The owner's shell, for one run of `scripts/tenant-db-canary.ts` (O3, P6) | The canary fails before connecting (`URL_REFUSED`, reason `missing`) | The pooler URL, ending `?sslmode=verify-full`: the value `TENANT_DATABASE_URL` will hold. Checked by the driver's own URL rules, so its user is `tenant_app_login` or the pooler's `tenant_app_login.<ref>` | Read with `read -rs` so it is never echoed, then `unset`. Never on the command line. The canary refuses the production project and prints no URL, host, password or PEM. The CA comes from `--ca <file>`, not a variable |
| `CANARY_SESSION_ID_<HANDLE>` | The operator's shell, for one K9 window | That persona's steps are skipped, which is never green | A Clerk session id (`sess_…`) on the **dev** instance, for `CANARY_MANAGER`, `CANARY_ADMIN` or `STELLR_PROBE_ADMIN` | K8 (#659), `scripts/canary-tenant-flow.ts`. The runner mints a fresh token for it just before each use, with `.env.local`'s `CLERK_SECRET_KEY`, which must be `sk_test_`. Sign the sessions out after the window |
| `CANARY_SESSION_<HANDLE>` | The operator's shell, for a short check | As above | A session token copied by hand. It lives about a minute | Checked before each use: an expired token, or one not from a `*.clerk.accounts.dev` instance, is not used |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | The operator's shell, optional | Requests to a protected `stellr-web-dev` deployment are refused by Vercel | The dev project's protection bypass | Sent by the K8 tools only on a request to a `stellr-web-dev` deployment |
