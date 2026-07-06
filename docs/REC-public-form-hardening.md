# REC: Public Form Hardening — Rate Limiting + Abuse Protection (F-17)

**Status:** Recommendation — no code changed. | **Date:** 2026-07-03

## What we have today (verified in code)

Nine public POST endpoints accept anonymous traffic with **no rate limiting, no captcha, and no honeypot**:

| Route | What it does on each request | Abuse cost |
|---|---|---|
| `app/api/subscribe/route.ts` | Currently a stub (logs email, TODO Loops wiring) | Low today, high once wired |
| `app/api/contact/route.ts` | Sends a Resend email to `CONTACT_EMAIL` | Inbox flooding; user input is interpolated into the email HTML unescaped |
| `app/api/scholarship/route.ts` | Resend email + HubSpot `upsertContact` | Inbox + CRM pollution |
| `app/api/host-event/route.ts` | Resend email + HubSpot `upsertContact` | Inbox + CRM pollution |
| `app/api/join-network/route.ts` | Resend email to `CONTACT_EMAIL` | Inbox flooding |
| `app/api/white-paper/route.ts` | HubSpot upsert + **emails the attacker-supplied address** | Email-bomb vector: burns Resend quota and sender reputation |
| `app/api/asset-request/route.ts` | Same pattern — HubSpot upsert + email to submitted address (5 gated PDFs) | Same email-bomb vector |
| `app/api/check-in/route.ts` | Token-gated, but 404-vs-success responses let a token holder enumerate registrant emails | Enumeration |
| `app/api/register/{individual,group,group-join}/route.ts` | Creates member rows, DocuSign envelopes, Stripe sessions, Clerk users | Most expensive per hit; DocuSign envelope quota is finite |

Validation everywhere is hand-rolled truthiness/regex checks (no zod at these route boundaries, though `zod` is in `package.json`). `proxy.ts` (Clerk middleware) matches `/api/(.*)` but only resolves auth — it adds no throttling.

**Key finding:** `lib/rate-limit.ts` **already exists** — a well-written in-memory fixed-window limiter (`checkRateLimit`) plus a `clientIp()` helper that reads `x-forwarded-for` (first hop) / `x-real-ip`, which is the correct way to get the caller IP on Vercel. It is used by exactly **one** route: `app/api/members/lookup/route.ts`. None of the nine routes above use it.

No rate-limit/captcha dependencies exist (`@upstash/ratelimit`, Turnstile, reCAPTCHA — all absent from `package.json`). Vercel **Hobby plan** means no WAF custom rules; Edge middleware and in-route checks are the available levers.

## Options

- **Option A — `@upstash/ratelimit` + Upstash Redis.** True distributed sliding window. Cost: new vendor, new SDK, 2 env vars, another external point of failure.
- **Option B (recommended) — extend the existing `lib/rate-limit.ts`.** Phase 1 wires the *existing* in-memory limiter into the 9 routes (zero new code beyond a 3-line guard each; its per-warm-instance limitation is acceptable — a spammer hammering one endpoint hits the same warm lambda). Phase 1b (optional hardening) adds a Supabase-backed sliding window using a small `rate_limit_hits` table — every route already holds a service-role Supabase client, so this is **zero new vendors**, at the cost of one extra DB round-trip per submission (fine for forms humans submit once).
- **Turnstile** (Cloudflare, free) on the outbound-email forms only (`white-paper`, `asset-request`, `contact`) — but **only if abuse is actually observed**. It adds a client dependency and friction to lead capture.

## Recommended implementation (Option B)

**Files that change:**
1. `lib/rate-limit.ts` — add `checkRateLimitDurable(db, key, {limit, windowMs})` backed by a `rate_limit_hits` table (insert hit, count rows in window, prune old rows opportunistically). Keep the existing in-memory function as the default.
2. One migration — `supabase/migrations/122_rate_limit_hits.sql` (next free number after 121): `rate_limit_hits(key text, hit_at timestamptz default now())` + index on `(key, hit_at)`; RLS enabled, no public policies (service-role only).
3. The 9 route files each get a ~3-line guard at the top of `POST`:
   ```ts
   const rl = checkRateLimit(`contact:${clientIp(req)}`, { limit: 3, windowMs: 60 * 60 * 1000 })
   if (!rl.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } })
   ```
4. (Phase 2 only) `components/` form components gain a Turnstile widget + routes verify the token server-side; env vars `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`.

**Suggested limits (per IP):**

| Route | Limit |
|---|---|
| subscribe | 5/hour |
| contact, scholarship, host-event, join-network | 3/hour |
| white-paper, asset-request | 3/hour (they send outbound email) |
| register/* | 10/hour (group flows legitimately retry) |
| check-in | 30/hour (whole classes check in from one venue Wi-Fi — do **not** set this low; also consider keying by `slug+ip`) |

## Phased rollout

- **Phase 1 — throttle only (ship now):** wire the existing in-memory limiter into all 9 routes; silent 429 with `Retry-After`. No UX change for real users. Optionally add the durable Supabase store for the email-sending routes.
- **Phase 2 — Turnstile, only if abuse observed:** add the widget to subscribe/contact/white-paper/asset-request forms.
- **Phase 3 — monitoring:** `console.warn('[rate-limit] 429', route, ip)` on every rejection so Vercel log drains / dashboard searches surface abuse patterns; review after 30 days to decide on Phase 2.

Also worth fixing while in `app/api/contact/route.ts`: HTML-escape `name/email/type/message` before interpolating into the notification email.

**Recommended next step:** Ship Phase 1 — add the 3-line guard (existing `lib/rate-limit.ts`) to the 9 public routes with the limits above, plus 429 logging. **Effort: S** (a couple of hours; no migration, no new deps). The optional durable Supabase store + migration is a further **S–M**.
