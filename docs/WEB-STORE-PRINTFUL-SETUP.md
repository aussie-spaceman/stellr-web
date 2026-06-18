# Web Store — Printful setup

How to connect Stellr's web store (PRD §12) to Printful (print-on-demand). This is
the ops runbook behind `scripts/verify-store.ts`; the data model and build phases
live in [WEB-STORE-PLAN.md](./WEB-STORE-PLAN.md).

> Initial setup completed and verified 17-Jun-2026. Keep this for re-runs and for
> rotating the API token before it expires.

## 1. Create the account and the right store type
1. Sign up / log in at **printful.com**.
2. Create a store of type **"Manual order platform / API"** (Dashboard → **Stores** →
   add store → manual/API option — *not* a Shopify/Etsy connection). This is the
   store type a custom API integration drives directly. Name it e.g. "Stellr Store".

No products are needed yet — those are created in Phase 1.

## 2. Generate a Private API token
In the **Developer Portal** (developers.printful.com):
1. Left nav → **Tokens**.
2. Under **Private Token** → **Create a token**.
3. Enter a **token name** and **contact email**.
4. **Access Level** → select the Stellr store. Binding the token to one store means
   `PRINTFUL_STORE_ID` is not required.
5. **Expiration** → max **2 years**. ⚠️ Set a calendar reminder to rotate before it
   expires, or checkout/fulfilment will start failing.
6. **Scopes** → select **all**.
7. **Create new token** → **copy it immediately** (shown once; not viewable later).

🔒 Treat the token like a password — set it directly in the env files, never paste it
into chat or anywhere shared.

## 3. Store ID (optional)
With a store-bound private token, leave `PRINTFUL_STORE_ID` blank. It is only needed
for an account-level token spanning multiple stores, in which case requests carry the
store via the `X-PF-Store-Id` header (the client in `lib/store/printful.ts` already
sends it when the var is set).

## 4. Generate the webhook secret
Printful v1 webhooks aren't HMAC-signed, so we embed a secret in the webhook URL and
verify it on receipt. Generate one:
```
openssl rand -hex 32
```
Keep it for `PRINTFUL_WEBHOOK_SECRET`. Registering the webhook endpoint in Printful
happens in Phase 2 (when `app/api/printful/webhook` exists).

## 5. Set the env vars — local and production
`.env.local` (repo root; documented in `.env.local.example`):
```
PRINTFUL_API_KEY=<token from step 2>
PRINTFUL_STORE_ID=            # blank with a store-bound private token
PRINTFUL_WEBHOOK_SECRET=<openssl output from step 4>
```
Vercel → project → **Settings → Environment Variables**: add the same three, then
redeploy so production picks them up. Stripe is already configured.

## 6. Verify
From the repo root:
```
npx tsx scripts/verify-store.ts
```
Success looks like:
```
✓ PRINTFUL_API_KEY
✓ PRINTFUL_WEBHOOK_SECRET
✓ STRIPE_SECRET_KEY (reused)
✓ Printful catalog reachable — 0 sync product(s)
```
`0 sync product(s)` is correct before Phase 1 — it proves the token + store are valid.
A `✗ Printful catalog reachable` line means the token is wrong, expired, or
under-scoped → regenerate (step 2).

## Safe testing
`createOrder` in `lib/store/printful.ts` accepts `confirm: false` to place **draft**
orders that are never fulfilled or charged — use that to exercise the flow before
going live.
