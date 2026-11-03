# RUNBOOK — Moving Supabase to publishable and secret API keys

**Applies to:** the owner, who holds the Supabase dashboard, both Vercel
projects and the GitHub repository settings. Supabase's legacy JWT keys
(`anon`, `service_role`) stop working at the end of 2026. Their replacements are
the publishable key (`sb_publishable_…`) and secret keys (`sb_secret_…`), which
are not JWTs. The code change came in S0, Nov 2026; this runbook covers the
switch itself. **No production step before the Nevada event (6 Nov) is over,
and that includes promoting this code to production:** it reaches dev when it
merges, and production with the first promotion after the event.

## What the code already does

- Every key reader goes through `lib/supabase-keys.ts`. It reads
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` first. When
  those are unset or empty it falls back to `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
  `SUPABASE_SERVICE_ROLE_KEY`, which is how every deployment runs today. Either
  key format works under either name.
- A publishable or secret key travels on the `apikey` header only, never on
  `Authorization: Bearer`. supabase-js clients get `supabaseFetch` for this;
  raw fetches use `supabaseApiHeaders`. A legacy key goes out exactly as before.
- A key in the wrong slot is refused, and the error names the variable, never
  the value. An elevated key (a secret key, or the legacy `service_role` JWT) in a
  `NEXT_PUBLIC_` variable fails the build (`next.config.mjs`). A low-privilege
  key (publishable, or the legacy `anon` JWT) in a secret variable throws
  `SupabaseKeySlotError` at runtime instead of quietly running as `anon`.
- `GET /api/admin/health/integrations` (admin only) returns `supabaseKeys`. That
  is the variable, `kind` and `role` of each slot, never the value. It is the
  only way to see what a deployment holds, because `vercel env pull` redacts
  secrets.

## Inventory: what holds or reads a key

| Where | Key | Notes |
|---|---|---|
| `lib/supabase.ts` `supabaseServer()` / `supabaseServerTyped()` | secret | Every API route, cron, webhook and server component |
| `lib/supabase.ts` `supabase()` | public | Server-side public reads |
| `lib/supabase-browser.ts` `createBrowserSupabase` | public | Realtime chat. The Clerk token goes on `Authorization` and as the Realtime channel `access_token`; signed out, neither carries a key |
| `lib/supabase-browser.ts` `createStorageUploadClient` | public | Signed uploads (`lib/upload-client.ts`): compliance documents, badge/certificate artwork, email editor, training resources |
| `lib/crawlers.ts` (from `proxy.ts`) | secret | Raw PostgREST insert, best-effort |
| `scripts/*`: every script that touches the database (e.g. `watermark-worker.ts`, `esign-*.ts`, `seed-*.ts`, `aeo-crawler-report.ts`) | secret | Through `lib/supabase-keys.ts` or `lib/supabase.ts`. `verify-deletion-registry.mjs` imports `lib/supabase-keys.ts` directly (Node 24 runs it) |
| `e2e/fixtures/{check-in,esign,esign-cli,survey-cli}.ts`, `e2e/core/{mentor,pd}-credentials.spec.ts` | secret | Dev project only |
| `.github/workflows/ci.yml` | both | verify job: placeholders under the legacy names only (today's Vercel config), then a check that the public key reached the browser bundle and the secret one did not. e2e job: `DEV_SUPABASE_PUBLISHABLE_KEY \|\| DEV_SUPABASE_ANON_KEY`, `DEV_SUPABASE_SECRET_KEY \|\| DEV_SUPABASE_SERVICE_ROLE_KEY` |

The following are not in the repo: `pg_net` / `net.http_post`, Database Webhooks
(`supabase_functions.http_request`), `pg_cron` HTTP calls, Edge Functions and
Auth hooks. No code verifies or depends on a key being a JWT.
`lib/supabase-keys.ts` and `next.config.mjs` read a legacy key's `role` claim,
without verification, only to catch swapped keys. **The repo cannot see
dashboard-only configuration.** Before disabling legacy keys, check Database →
Webhooks, any `cron` job that sends an `Authorization` header, Authentication →
Hooks, Edge Functions and Integrations in each project, and any outside tool
that was given the anon or service_role key. Any of these that send a key must
send a secret key on `apikey`.

Key holders outside the code: Vercel **prod** project, Vercel **dev** project
(`stellr-web-dev`), GitHub Actions secrets, each laptop's `.env.local` (dev keys
only), and the host running `scripts/watermark-worker.ts` if one is deployed
(`docs/WATERMARKING-HANDOVER.md`).

## Key plan: one secret key per consumer

Supabase recommends a separate secret key per backend component, so one leak
forces one rotation. Here a component means a **consumer**, meaning one place that
holds the key. Server routes, crons and webhooks share a key because they run
in one Vercel deployment with one environment: a leak of that environment
exposes every key in it, so splitting them would add rotations without
narrowing a leak. A separate cron/webhook key would also need code, because
every route reads the one `SUPABASE_SECRET_KEY`.

| Project | Publishable | Secret keys (name = consumer) |
|---|---|---|
| dev (`xvxlhbxtiwxpopoqjygm`) | `default` | `vercel_dev`, `github_ci`, `laptop_<machine>` (one each), `watermark_worker` if it runs on dev |
| prod (`hwtzpfrnksksxlwwabqz`) | `default` (already exists) | `vercel_prod`, `watermark_worker` if deployed. For a one-off prod script, a `script_<machine>` key in the shell environment, deleted afterwards. Never in `.env.local` (`docs/ENV-MATRIX.md`) |

Creating the new keys also makes a secret key named `default`. Give it to no
consumer, so every secret key in use has one named holder.

## Steps (dev first, prod last)

1. **Code on both.** This change must be deployed to dev now and to prod after
   6 Nov. On each, the health endpoint should show `legacy-jwt` with role
   `anon` (public) and `service_role` (secret). This proves that the deploy has
   the new code and that today's keys sit in the right slots. The health check
   covers the server only, so also send a chat message that arrives live in a
   second browser, and do one signed upload (on prod, one you can delete
   afterwards). Those are the browser paths this change touches.
2. **Create dev keys.** Dev project → Settings → API Keys → *Publishable and
   secret API keys*. Click *Create new API keys* if the button is there. Then add
   the named secret keys from the table. The legacy keys keep working.
3. **Vercel dev.** Add `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and
   `SUPABASE_SECRET_KEY` (the `vercel_dev` key, marked Sensitive) to every
   environment that currently has the legacy pair. Leave the legacy pair in
   place. Redeploy the newest READY deployment, because `NEXT_PUBLIC_` values
   only change on a rebuild.
4. **Verify dev.** The health endpoint should show `publishable`/`anon` from
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `secret`/`service_role` from
   `SUPABASE_SECRET_KEY`. Then exercise the following on dev: public pages; a
   registration; a **signed upload** (member compliance document, or admin badge
   artwork); **chat**, where a message arrives live in a second browser; a
   check-in desk lookup; issuing an e-sign agreement. Look in the runtime logs
   for 401, `Invalid API key` or `SupabaseKeySlotError`.
5. **GitHub Actions.** Add the repository secrets `DEV_SUPABASE_PUBLISHABLE_KEY`
   and `DEV_SUPABASE_SECRET_KEY` (the `github_ci` key). Let one CI run finish. To
   pass, the e2e job must have **run** its steps: read the *Check configuration*
   and test step outcomes, not the badge. A skipped job proves nothing.
6. **Laptops and worker.** Put the new pair in each `.env.local`, using that
   machine's own secret key, and delete the two legacy lines. Start
   `npm run dev` and run one read-only script. Set the worker host's
   `SUPABASE_SECRET_KEY` if a worker is deployed.
7. **Prod (after 6 Nov).** Repeat steps 2–4 on the prod project and the Vercel
   prod project (Production scope). The prod publishable key already exists;
   create only `vercel_prod`. Verify on `app.stellreducation.org`, using only
   the step 4 checks that are safe on live data (reads, chat, and a signed
   upload you delete afterwards).
8. **Soak.** Leave both pairs in place for at least a week. Check the
   `cron_runs` ledger: every cron should have run green at least once on the new
   keys, and the Vercel logs should show no new 5xx on `/api/cron/*` or
   `/api/webhooks/*`.
9. **Disable legacy on dev.** First confirm every dev consumer from the
   inventory, then use Settings → API Keys → *Legacy API keys* → disable. Re-run
   step 4 and a CI run. Keep the GitHub secrets `DEV_SUPABASE_ANON_KEY` /
   `DEV_SUPABASE_SERVICE_ROLE_KEY` and the legacy variables on Vercel dev: the
   new names win, so they go unused, and they are the rollback. Delete them
   after a week clean.
10. **Disable legacy on prod, last.** Do this only after dev has run clean
    without legacy keys for several days, and never inside an event freeze
    window. Keep the legacy variables on Vercel prod for a week, as in step 9,
    then delete them.
11. **Code follow-up.** Once no environment holds a legacy key, remove the
    fallback names from `lib/supabase-keys.ts`, `ci.yml` (the e2e fallbacks,
    and the verify job's placeholders, which use the legacy names until then),
    and `next.config.mjs`.

## Rollback

- **A new key misbehaves while the legacy keys are on:** unset the two new
  variables on that Vercel project and redeploy. The app falls back to the legacy
  pair, and tests pin that path. For CI, delete the two new `DEV_*` secrets.
- **Something breaks after legacy keys are disabled:** re-enable them in the same
  dashboard tab (Supabase makes this reversible). If the new keys are the
  problem, make sure the legacy variables are on that Vercel project (for CI,
  the two legacy `DEV_*` secrets) before you unset the new ones. If they were
  already deleted, copy the values from *Legacy API keys* back in first. Then
  redeploy. With neither pair set, every server route fails.
- **Build fails with "holds a Supabase secret key":** an elevated key is in a
  `NEXT_PUBLIC_` variable. Put the publishable key there. If that value ever
  reached a deployed build, treat the key as leaked.
- **A route throws `SupabaseKeySlotError`:** the message names the variable. Put
  the right key in it and redeploy.
- **A secret key leaks:** create a replacement, swap it in, verify, then delete
  the leaked key. Deleting a key cannot be undone.

## Gotchas

- Secret keys always get 401 from a browser (Supabase matches the User-Agent).
  No browser code here uses one.
- Public Realtime connections last at most 24 h unless user-authenticated. Chat
  joins with the Clerk token, so a signed-in member is unaffected. Without one
  it sends no token (never the key), and chat falls back to polling as before.
- The code trims a value pasted with a trailing newline. A missing GitHub
  secret arrives as `""` and counts as unset, so the legacy fallback still
  applies.
