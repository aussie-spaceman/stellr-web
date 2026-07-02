# QA Sandbox Setup — app.stellreducation.org

How to stand up a **safe preview/staging environment** for Phase-2 live QA so you can
exercise payment, e-sign, and email flows without charging cards, sending real
member email, or touching production data.

Key principle observed across the codebase: **test-vs-live for Stripe, Resend, and
DocuSign is chosen purely by env-var VALUE — there is no code branch.** Point the env
vars at sandbox and the whole app is in sandbox.

---

## 0. Where to run it

Use a **Vercel Preview deployment** (or a dedicated `staging` project) with its own
env vars, pointed at a **separate Supabase project** (a branch/clone of prod schema,
NOT prod). Never seed test accounts or fire test webhooks against the prod DB.

- Deploy: `npx vercel deploy --prod --yes` targets prod — for staging use a preview
  build or a second Vercel project with the sandbox env set below.
- The base `members` / `schools` / `member_schools` tables and their `*_type` enums
  are **not in tracked migrations** (they predate them). To spin up a staging DB,
  clone the prod schema (Supabase branching or a `pg_dump --schema-only`) rather than
  replaying `supabase/migrations`, which alone won't create `members`.

---

## 1. Stripe — TEST MODE

Stripe is instantiated inline as `new Stripe(process.env.STRIPE_SECRET_KEY, …)` in
`lib/coaching.ts`, `lib/mentoring.ts`, `lib/tier-pricing.ts`, `lib/store/orders.ts`,
`lib/refunds/stripe.ts`, `app/api/register/group/route.ts`, and the three
`app/api/stripe/*` routes. There is **no hardcoded price ID** — prices live in the DB
(`membership_tiers.stripe_price_id` / `stripe_price_id_monthly`) and public pricing is
read live from Stripe via `lib/tier-pricing.ts`.

**Set on the staging deploy:**

| Env var | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` (Stripe Dashboard → Developers → API keys, **Test mode** toggle ON) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_…` |
| `STRIPE_WEBHOOK_SECRET` | test-mode signing secret from the webhook you create below (⚠️ not in `.env.local.example` — add it) |
| `NEXT_PUBLIC_DONATION_URL` | a **test-mode** Payment Link |

**Webhook (`/api/stripe/webhook`):**
1. Stripe Dashboard (Test mode) → Developers → Webhooks → Add endpoint →
   `https://<staging-url>/api/stripe/webhook`.
2. Subscribe to at least: `checkout.session.completed`, `customer.subscription.*`,
   `invoice.paid`, `invoice.payment_failed`, `charge.refunded`.
3. Copy the endpoint's **Signing secret** → `STRIPE_WEBHOOK_SECRET`.
   - A mismatched secret silently breaks membership activation (known gotcha), so
     verify this first.
4. Local alternative: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
   and use the `whsec_…` it prints.

**Because prices come from the DB**, create test-mode Products/Prices in Stripe and put
their `price_…` ids into `membership_tiers.stripe_price_id(_monthly)` **in the staging
DB** (not prod). Otherwise checkout will reference live price ids that don't exist in
test mode.

**Test cards:** `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP.
Decline: `4000 0000 0000 0002`. 3-DS: `4000 0025 0000 3155`.

---

## 2. Email — Resend SANDBOX

Provider is **Resend** (`lib/email.ts`, REST `api.resend.com`). Crucial safety valve:

> **If `RESEND_API_KEY` is unset, `sendEmail()` no-ops and just `console.log`s
> "would have sent to…".** Nothing leaves the building.

So there are two safe modes:

**Mode A — no real sends (simplest, recommended for most QA):**
- Leave `RESEND_API_KEY` **blank** on staging. Every send is logged, not delivered.
- Read what *would* have been sent in the Vercel function logs / `preview_logs`.

**Mode B — real sends to a single test inbox (needed to click DocuSign / magic links):**

| Env var | Value |
|---|---|
| `RESEND_API_KEY` | a Resend key from a **test/sandbox** Resend project |
| `TRANSACTIONAL_FROM` | `Stellr QA <no-reply@mail.stellreducation.org>` (must be a Resend-**verified** domain) |
| `TRANSACTIONAL_REPLY_TO` | your inbox |
| `MARKETING_FROM` | `Stellr QA <hello@mail.stellreducation.org>` (read in code; add it) |
| `CONTACT_EMAIL` | your inbox |

- Resend's own **onboarding domain** (`onboarding@resend.dev`) can only send to the
  account owner's address — fine for one-tester QA and needs no DNS.
- To avoid mailing real members, seed test accounts with addresses you own (the seed
  script uses `qa+<role>@<your-domain>`; plus-addressing routes them all to one inbox).

Either way, **the send functions take an explicit `to`** — seeded test users only ever
receive at your controlled addresses, so no production member is contacted.

---

## 3. DocuSign — STAYS IN SANDBOX (demo)

Config is env-driven in `lib/docusign.ts`; **demo vs prod is chosen by the base-path
value**, no code toggle. Sandbox = the defaults:

| Env var | Sandbox value |
|---|---|
| `DOCUSIGN_OAUTH_URL` | `https://account-d.docusign.com` |
| `DOCUSIGN_BASE_PATH` | `https://demo.docusign.net/restapi` |
| `DOCUSIGN_ACCOUNT_ID` | your **demo** account id |
| `DOCUSIGN_INTEGRATION_KEY` | demo integration key |
| `DOCUSIGN_USER_ID` | demo user (impersonated via JWT grant) |
| `DOCUSIGN_PRIVATE_KEY` | RSA PEM (literal `\n` for newlines) |
| `DOCUSIGN_TEMPLATE_ID` | minor/guardian consent template (demo) |
| `DOCUSIGN_ADULT_TEMPLATE_ID` / `DOCUSIGN_MENTOR_TEMPLATE_ID` | demo templates |
| `DOCUSIGN_STELLR_REP_NAME` / `_EMAIL` | mentor counter-signer (demo) |
| `DOCUSIGN_CONNECT_HMAC_KEY` | HMAC for the Connect webhook |

**Confirm you're in sandbox:** `DOCUSIGN_BASE_PATH` contains `demo.docusign.net` and
`DOCUSIGN_OAUTH_URL` is `account-d`. (Auth is JWT grant, scope `signature
impersonation`; first use of a demo integration key needs one-time consent at
`account-d.docusign.com/oauth/auth?...`.)

**Connect webhook:** point the demo account's Connect config at
`https://<staging-url>/api/webhooks/docusign` (HMAC = `DOCUSIGN_CONNECT_HMAC_KEY`).
DocuSign demo emails are real — use your controlled test inbox as the signer.

---

## 4. Everything else on staging

| Service | Env | Sandbox note |
|---|---|---|
| **Clerk** | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`=`pk_test_…`, `CLERK_SECRET_KEY`=`sk_test_…`, `CLERK_WEBHOOK_SECRET`=`whsec_…` | Dev instance. Emails with `+clerk_test` auto-verify (code **424242**) — the seed script's `SEED_CLERK_TEST=1` uses this. Point the Clerk webhook at `/api/webhooks/clerk`. |
| **Checkr** (background checks) | `CHECKR_BASE_URL`=`https://api.checkr-staging.com/v1`, `CHECKR_API_KEY`, `CHECKR_WEBHOOK_SECRET`, `NEXT_PUBLIC_CHECKR_DASHBOARD_URL`=`https://dashboard.checkr-staging.com` | Already defaults to **staging**. |
| **Printful** (store) | `PRINTFUL_API_KEY`, `PRINTFUL_STORE_ID`, `PRINTFUL_WEBHOOK_SECRET` | Use a test store; reuses Stripe test mode for payment. |
| **JaaS / Jitsi** (video) | `VIDEO_PROVIDER`=`jaas`, `JAAS_APP_ID`, `JAAS_KID`, `JAAS_PRIVATE_KEY`, `JAAS_WEBHOOK_SECRET`, `RECORDING_WEBHOOK_SECRET` | JaaS dev app; webhook → `/api/webhooks/recording`. |
| **Google** | `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_PLACES_API_KEY` | Service account for Sheets/Calendar; Places (New) for school autofill. |
| **Cron** | `CRON_SECRET` | The 8 `/api/cron/*` routes are `Bearer ${CRON_SECRET}` — trigger manually in QA with the header. |

---

## 5. Seed the test accounts

Once staging env is set (Supabase + `sk_test` Clerk):

```bash
# in stellr-web/, with .env.local pointed at STAGING
export SEED_EMAIL_DOMAIN=yourdomain.com     # a domain/inbox you own
export SEED_EMAIL_LOCAL=qa                  # → qa+student@yourdomain.com …
export SEED_PASSWORD='Choose-A-Strong-Test-Pw'
export SEED_CLERK_TEST=1                     # dev Clerk auto-verifies +clerk_test emails

npx tsx scripts/seed-test-accounts.ts            # dry run — prints the plan
npx tsx scripts/seed-test-accounts.ts --apply    # create all 10 role accounts
```

Creates one login per role (subscriber, student [minor], student_manager, teacher,
parent, donor, mentor, coach, event_manager, admin). Guest = just browse signed-out.
Admin + event-manager must **sign out/in once** for their elevated access to appear
(Clerk claims refresh on the next token). See the script header for flags.

---

## 6. Pre-flight safety checklist

- [ ] `STRIPE_SECRET_KEY` starts with `sk_test_`
- [ ] `DOCUSIGN_BASE_PATH` contains `demo.docusign.net`
- [ ] `RESEND_API_KEY` blank (Mode A) **or** pointed at a test inbox you own (Mode B)
- [ ] Supabase URL is the **staging** project, not `hwtzpfrnksksxlwwabqz` (prod)
- [ ] `CLERK_SECRET_KEY` starts with `sk_test_`
- [ ] Seed emails resolve to an inbox you control (no real members)
- [ ] `CHECKR_BASE_URL` contains `checkr-staging.com`
