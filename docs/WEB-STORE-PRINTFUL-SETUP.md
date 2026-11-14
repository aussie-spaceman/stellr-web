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

## 4. Generate the webhook secret and send it in a header
Printful v1 webhooks aren't HMAC-signed, so each delivery must carry a shared secret.
`app/api/printful/webhook` accepts it **only** in the `x-printful-secret` request
header and compares it in constant time with `PRINTFUL_WEBHOOK_SECRET`. A secret in
the URL (`?secret=...`) is refused with 401, even when the value is right: a URL
secret ends up in request logs and in the provider's dashboard (threat model R4b).

1. Generate a secret:
   ```
   openssl rand -hex 32
   ```
   Keep it for `PRINTFUL_WEBHOOK_SECRET` (step 5).
2. Register the endpoint `https://www.stellreducation.org/api/printful/webhook`
   **without** any query string, and configure the delivery to send the header
   `x-printful-secret: <the secret>`.
3. Check before relying on it: confirm in Printful's current webhook documentation
   that the configuration can attach a custom header to each delivery. If Printful
   cannot send one, do not fall back to the URL form; deliveries will answer 401
   until the code is changed to a form Printful can sign or send.

### Rotating the secret
Do this whenever the secret may have been exposed, and once when moving off the old
URL form (where it sat in the webhook URL):
1. Generate a new secret (step 1 above).
2. Set the new value of `PRINTFUL_WEBHOOK_SECRET` in Vercel and redeploy.
3. Update the header in the Printful webhook configuration to the new value, and
   remove any `?secret=` from the registered URL.
4. Send a test event from Printful and check it answers 200. Between steps 2 and 3
   deliveries answer 401 and their shipment updates are lost, so keep the gap short.

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
