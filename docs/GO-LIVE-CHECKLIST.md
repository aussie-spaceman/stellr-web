# Stellr Go-Live Runbook

One-pass checklist to take stellr-web from the current dev/test setup to production on
`www.stellreducation.org` (public) + `app.stellreducation.org` (member app) — one Next.js
deployment, two subdomains. Work top to bottom; Section 1 (auth) unblocks the seamless
www↔app experience and is the critical path.

> Convention: all production secrets live in **Vercel → Settings → Environment Variables
> (Production scope)**, never committed. Local `.env.local` keeps the dev/test values.

---

## 0. Pre-flight

- [ ] Confirm `www.stellreducation.org` and `app.stellreducation.org` both point at the same Vercel project/deployment.
- [x] `npx tsc --noEmit` is clean (verified with a fresh build cache; the earlier `lib/training.ts` error was stale `tsconfig.tsbuildinfo` noise, not a real error).
- [ ] Latest `main` builds successfully on Vercel.

---

## 1. Clerk → Production (auth, critical path)

- [x] DNS: 5 Clerk CNAMEs added at GoDaddy and **verified green** in Clerk (`accounts`, `clerk`, `clk._domainkey`, `clk2._domainkey`, `clkmail`).
- [ ] Copy production API keys (Clerk Dashboard, Production instance → API Keys): `pk_live_…`, `sk_live_…`.
- [ ] Create production webhook → URL `https://app.stellreducation.org/api/webhooks/clerk`, events **`user.created`, `user.updated`, `user.deleted`** only. Copy the new `whsec_…` signing secret.
- [ ] If using social login: configure **own** OAuth credentials per provider (dev shared creds don't work in prod).
- [ ] Set in Vercel (Production):
  - [ ] `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_…`
  - [ ] `CLERK_SECRET_KEY=sk_live_…`
  - [ ] `CLERK_WEBHOOK_SECRET=whsec_…` (the **new** production one)
  - [ ] Verify carried over: `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`, `…SIGN_UP_URL=/sign-up`, `…AFTER_SIGN_IN_URL=/account`, `…AFTER_SIGN_UP_URL=/account/onboarding`
  - [ ] `NEXT_PUBLIC_AUTH_APP_URL=https://app.stellreducation.org`
- [ ] Redeploy so env changes take effect.
- [ ] **Test:** sign up at `app.../sign-up` → webhook 200 in Clerk logs → `members` row gets `clerk_user_id` in Supabase → `www` utility bar shows **My Account** while signed in → reverts to **Log In/Join Free** after sign-out.

> Note: production Clerk starts with an **empty user store**; dev/test accounts do not migrate.
> Member records created via event registration re-link by email on first prod sign-up (webhook email match).

---

## 2. Database (Supabase) — migrations & data integrity

- [ ] Production Supabase env in Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- [ ] All migrations `001`–`021` applied to the production DB in filename order (applied manually — no `supabase/config.toml` migration tracking). The earlier `019_` collision is **resolved**: `community_automation` was renumbered `019_`→`021_`, leaving the training pair intact (`019_training_sections` → `020_training_player`, which depends on it).
- [ ] Confirm the recently-added migrations are applied: `014` (emergency-contact relationship), `015` (Adult/Mentor DocuSign agreements), `016` (member enum values).
- [ ] **Member enum drift / backfill** (known open item):
  - [ ] Apply migration `016` (run the 3 `ALTER TYPE … ADD VALUE` statements **individually** — they can't run in a transaction) so enums match what `lib/member-enums.ts` sends.
  - [ ] Run the backfill for members dropped before the fix: `npx tsx scripts/backfill-members.ts` (dry run) → review output → `npx tsx scripts/backfill-members.ts --apply`. It finds `participants` with `member_id IS NULL`, creates the missing members (skipping any that already exist), and relinks them. **Requires migration 016 applied first**, and `.env.local` pointed at the prod DB.
- [ ] RLS / tier-gating: community access is enforced in server code (not RLS) — spot-check that gated routes reject non-members in production.

---

> Run `npm run verify:prod` ([scripts/verify-prod-services.ts](../scripts/verify-prod-services.ts)) any time for a read-only check of Stripe (key mode + every DB price ID resolves live) and DocuSign (sandbox vs prod + templates exist).

## 3. Payments (Stripe) — ✅ VERIFIED LIVE (2026-06-10)

- [x] Live key valid (account Insimeducation) and **all 8 membership price IDs resolve live + active** under it (verified via `npm run verify:prod`). No test-price trap.
- [ ] Swap to **live** keys in Vercel: `STRIPE_SECRET_KEY` (sk_live), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (pk_live).
- [ ] Create the **live** Stripe webhook → endpoint `https://app.stellreducation.org/api/stripe/webhook`; set its live signing secret in Vercel.
- [ ] `NEXT_PUBLIC_DONATION_URL` set to the live donation/payment link.
- [ ] Test a live membership purchase end-to-end (small amount / real card) and confirm the membership state updates.

---

## 4. E-signature (DocuSign) — ❌ STILL SANDBOX (2026-06-10)

> Verified `account-d.docusign.com` + `demo.docusign.net` — envelopes are non-binding demo envelopes. **Production requires the DocuSign Go-Live promotion** (≈20 successful demo API calls → promote the integration key in DocuSign admin), then a prod account ID + **re-granted JWT consent** + the **3 templates recreated in the prod account** (the demo template GUIDs change). Also confirm Vercel's `DOCUSIGN_*` vars aren't still demo.

### 4a. Go-Live promotion — step by step

DocuSign requires promoting the JWT integration key from demo to production; it is **not** just an env swap. Order matters.

1. **Hit the API-call threshold in demo.** DocuSign won't let you promote until the integration key has logged **≥ 20 successful API calls** in the demo environment (with an acceptable success rate). You already have some from real demo registrations; `npm run verify:prod` adds a few per run (1 auth + 3 template reads). Check progress in **DocuSign Admin (demo) → Integrations → Apps and Keys → your app → API request logging** (enable logging if off, then accrue calls).
2. **Start the promotion.** In the demo account, **Apps and Keys → your integration key → Actions → "Start" / "Go-Live"**. DocuSign runs an automated review of the logged calls. Most JWT integrations are approved automatically within minutes; if flagged, address the listed issues and resubmit.
3. **Get a production DocuSign account** (the org's real, paid account) if you don't have one. Promotion makes the *app* eligible for prod, but the account itself is separate.
4. **Add the integration key to the production account.** In **Apps and Keys** on the *production* account, the promoted integration key (client ID) appears or is added. **Add your RSA keypair** there (you can reuse the same public key as demo, or generate a fresh prod keypair — if fresh, that becomes the new `DOCUSIGN_PRIVATE_KEY`). Set the redirect URI.
5. **Find the production account ID + base URI (region-specific).** After auth, call `GET https://account.docusign.com/oauth/userinfo` — the response's `accounts[]` gives the prod `account_id` and `base_uri` (e.g. `https://na3.docusign.net`, `na4`, `eu`, `au`, `ca`). The base path env is that `base_uri` + `/restapi`. Using the wrong region's base path is a common cause of 401/404s.
6. **Re-grant JWT consent on production.** Consent is per-environment. Have the impersonated user (`DOCUSIGN_USER_ID`) open: `https://account.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=<PROD_INTEGRATION_KEY>&redirect_uri=<your_redirect>` and approve.
7. **Recreate the 3 templates in the production account.** Templates are account-scoped — the demo GUIDs (`92433f1d…`, `c3e40b62…`, `2af13604…`) do **not** exist in prod. Either download each from demo and upload to prod, or rebuild them. **Then update all three `DOCUSIGN_*_TEMPLATE_ID` envs** with the new prod GUIDs.
8. **Re-confirm tab labels + roles match exactly** in the prod templates (a mismatch silently leaves fields blank):
   - minor/guardian: `MinorName`, `MinorDateOfBirth`, `EventTitle`, `GuardianName`, `GuardianEmail`, `GuardianPhone`, `MinorRelationship`, `SchoolName`, `SchoolState`
   - adult (role `Adult`): `TeacherName`, `TeacherEmail`, `TeacherPhone`, `EventTitle`, `SchoolName`, `SchoolState`
   - mentor (+ `StellrRepresentative` role at routing order 1): `MentorName`, `MentorEmail`, `MentorPhone`, `EventTitle`
9. **Set prod Connect webhook + HMAC** (see below), then **re-run `npm run verify:prod`** — it should now print `environment: PRODUCTION` and resolve all three prod templates.

Then complete the env + webhook items below.

- [ ] Switch from sandbox to production endpoints in Vercel:
  - [ ] `DOCUSIGN_OAUTH_URL=https://account.docusign.com`
  - [ ] `DOCUSIGN_BASE_PATH=https://<your-prod-base>.docusign.net/restapi`
- [ ] Production `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_USER_ID`, `DOCUSIGN_PRIVATE_KEY` (JWT consent granted on the prod account).
- [ ] Template IDs for the prod account: `DOCUSIGN_TEMPLATE_ID` (minor/guardian consent), `DOCUSIGN_ADULT_TEMPLATE_ID`, `DOCUSIGN_MENTOR_TEMPLATE_ID`.
- [ ] Mentor counter-signer: `DOCUSIGN_STELLR_REP_NAME`, `DOCUSIGN_STELLR_REP_EMAIL`; template must define `StellrRepresentative` role at routing order 1.
- [ ] Verify DocuSign template **tab labels** match the app's tabs (e.g. `TeacherPhone`, `MentorPhone`, the emergency-contact relationship tab from migration 014).
- [ ] DocuSign Connect (webhook): point to `https://app.stellreducation.org/api/webhooks/docusign`; set `DOCUSIGN_CONNECT_HMAC_KEY` to match the Connect config.
- [ ] Test each agreement type sends and the signed-status webhook returns 200.

---

## 5. Email & integrations

- [ ] Resend: production `RESEND_API_KEY`; verify the sending domain in Resend; `CONTACT_EMAIL` correct.
- [ ] Google Sheets (group registration): `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`; share the production spreadsheet with the service account.
- [ ] Cron: `CRON_SECRET` set in Vercel; confirm the `docusign-reminders` cron (09:00 daily, see `vercel.json`) runs against prod.

---

## 6. CMS & site config

- [ ] Sanity production: `NEXT_PUBLIC_SANITY_PROJECT_ID`, `NEXT_PUBLIC_SANITY_DATASET=production`, `SANITY_API_TOKEN` (write token).
- [ ] `NEXT_PUBLIC_SITE_URL=https://www.stellreducation.org`.
- [ ] Marketing pixels (if launching analytics): `NEXT_PUBLIC_GA_MEASUREMENT_ID`, `NEXT_PUBLIC_META_PIXEL_ID`, `NEXT_PUBLIC_LINKEDIN_PARTNER_ID`.

---

## 7. Compliance gates (must clear before public launch)

- [ ] **FERPA / School DPA**: group (school) registration must capture school DPA / School Official agreement acceptance before going live (migration `011_school_dpa.sql`). Confirm the flow blocks completion without it.
- [ ] Privacy policy live at `/privacy` and linked from footer.

---

## 8. UI unification follow-ups (the "seamless" polish)

- [x] Shared `SiteHeader` wired into both `(public)` and `(member)` layouts.
- [x] **Community double-header resolved**: `app/(member)/community/layout.tsx` no longer renders its own header — it keeps only the section sub-nav (+ NotificationBell) beneath the shared `SiteHeader`.
- [ ] Confirm member content area styling (width/footer/brand tokens) reads as the same product as the public site.
- [ ] Visually verify the community sub-nav in a signed-in session (auth-gated — not coverable by an anonymous preview).

---

## 9. Final smoke test (production)

- [ ] Public pages render with brand header/footer on `www`.
- [ ] Sign up → onboarding → `/account` works on `app`.
- [ ] Signed-in `My Account` appears on `www` (cross-subdomain session).
- [ ] One full registration with a DocuSign agreement completes and reflects in the DB.
- [ ] One live membership payment completes and reflects in the DB.
- [ ] Confirmation emails deliver.
