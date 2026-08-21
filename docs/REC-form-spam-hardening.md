# REC: Public Form Spam Hardening — Honeypot + Turnstile (F-17 Phase 2)

**Status:** Recommendation — no code changed. | **Date:** 2026-08-17
**Supersedes the open half of:** `docs/REC-public-form-hardening.md` (2026-07-03), whose Phase 1 has since shipped.

## TL;DR

Rate limiting **is already live** on every public form route. It is not the missing piece, and adding more of it will not fix the spam being seen — per-IP fixed windows stop *one machine hammering one endpoint*, and modern form spam is a distributed botnet posting **once per residential IP**. The layers that actually catch that key on **behaviour**, not IP: a honeypot + timing trap first (zero friction, zero deps), then Cloudflare Turnstile on the forms that cost money.

Three findings surfaced while reviewing that are worth fixing in the same pass, one of which is more urgent than the spam itself:

- **Resend Free is capped at ~100 emails/day across the whole org**, shared by registration confirmations, DocuSign notifications and campaign drips. Two public forms email an **attacker-supplied address**. A single spam run can burn the day's allowance overnight and silently stop registration email for real families. `lib/email.ts` has no daily guard. → **§7, do this first.**
- **`scholarship`, `host-event` and `join-network` interpolate raw user input into notification-email HTML.** Only `contact` escapes. A spammer can deliver clickable markup into the team inbox. → **§6.**
- **Server routes do hand-rolled truthiness checks, not zod.** Client-side zod (4 of 8 forms) is bypassed entirely by a bot POSTing JSON at the API. No length caps anywhere. → **§5.**

---

## 1. What is actually in place today (verified in code, 17 Aug 2026)

`lib/rate-limit.ts` exports `rateLimitGuard()` and **every public form route calls it**:

| Route | Current limit |
|---|---|
| `app/api/subscribe/route.ts` | 30 / hour |
| `app/api/contact/route.ts` | 3 / hour |
| `app/api/scholarship/route.ts` | 3 / hour |
| `app/api/host-event/route.ts` | 3 / hour |
| `app/api/join-network/route.ts` | 3 / hour |
| `app/api/white-paper/route.ts` | 3 / hour |
| `app/api/asset-request/route.ts` | 3 / hour |
| `app/api/check-in/route.ts` | 60 / hour, keyed `slug + ip` |

Plus dual-window limits on `members/lookup` and `members/exists`. Rejections already log `[rate-limit] 429`.

**What does not exist anywhere:** honeypot fields, submission-timing checks, captcha of any kind, server-side schema validation, content heuristics. `package.json` has no `turnstile` / `recaptcha` / `hcaptcha` / `botid` / `@upstash` dependency.

### Why the existing limiter isn't stopping this

Three structural limits, all documented honestly in the file's own header comment:

1. **State is per-warm-lambda in-memory.** The effective cap is `limit × number of warm instances`, and it resets on every cold start and deploy.
2. **It keys on IP.** A botnet renting residential proxies submits once per IP and never touches a window.
3. **The limits must stay generous anyway.** A school computer lab or a venue's Wi-Fi is one NAT'd IP — that's exactly why `subscribe` was raised to 30/hr and `check-in` to 60/hr. Tightening them hurts real users before it hurts bots.

None of this means Phase 1 was wrong — it removed the trivially cheap attacks. It just isn't the layer that catches what's arriving now.

---

## 2. Scope — the eight public submission forms

Registration (`/api/register/*`) is **excluded per instruction**. Auth-gated surfaces (`/api/community/*`, store, member, admin) sit behind Clerk and are out of scope.

| # | Component | Page | Endpoint | What a spam hit costs |
|---|---|---|---|---|
| 1 | `components/forms/SubscribeForm.tsx` | footer (site-wide) + `/news/[slug]` | `/api/subscribe` | HubSpot contact pollution |
| 2 | `components/sections/EventCtas.tsx` (notify modal) | `/events/[slug]` | `/api/subscribe` | HubSpot pollution, skews event-notify taxonomy |
| 3 | `components/forms/ContactForm.tsx` | `/contact` | `/api/contact` | Inbox flood **+ Resend quota** |
| 4 | `components/forms/ScholarshipForm.tsx` | `/scholarship` | `/api/scholarship` | Inbox **+ Resend + HubSpot** |
| 5 | `components/forms/HostEventForm.tsx` | `/host-an-event` | `/api/host-event` | Inbox **+ Resend + HubSpot** |
| 6 | `components/forms/JoinNetworkForm.tsx` | `/network` | `/api/join-network` | Inbox **+ Resend** |
| 7 | `components/sections/WhitePaperGate.tsx` | `/impact` | `/api/white-paper` | **Emails an attacker-supplied address** + HubSpot |
| 8 | `components/sections/AssetGate.tsx` (6 gated assets) | `/curriculum`, `/network`, `/why-stellr`, `/educators`, `/events` | `/api/asset-request` | **Emails an attacker-supplied address** + HubSpot |

**Adjacent, deliberately treated differently:**

- `CheckInForm` → `/api/check-in` — the QR token *is* the gate, and traffic is a queue of people on phones on bad venue Wi-Fi. Add the honeypot (free), but **do not put Turnstile here** — a challenge at the door is a worse failure than a spam check-in.
- `MemberIdLookup` → `GET /api/members/lookup` and `/api/members/exists` — already dual-window limited, GET-only, no side effects. No change.

Note forms 7 and 8 are the sharpest: they take an email address from an anonymous caller and *send mail to it*. That is an email-bomb primitive pointed at a 100/day shared quota (§6).

---

## 3. Layer 1 — Honeypot + timing trap *(recommended first; ~half a day, no dependencies, invisible to users)*

Catches the large share of spam that comes from generic form-fillers which parse the DOM and fill every input they find.

**New file — `components/forms/useSpamGuard.ts` (client).** A hook returning `{ fields, values }`, because 6 of the 8 forms build their JSON body by hand and only 4 use react-hook-form. Callers spread `values` into the request body and render `<SpamGuardFields {...fields} />`.

Details that decide whether this works:

- **Field name `website`.** Verified: no existing public form has a `website` field, so there is no collision (`join-network` uses `companyName`, `host-event` uses `companySchool`). It is also a name bots *want* to fill.
- **Hide it off-screen, not with `display:none`.** Use `absolute left-[-9999px] w-px h-px overflow-hidden`. Better-written bots deliberately skip `display:none` and `hidden` fields precisely because they read as traps.
- **`tabIndex={-1}`, `autoComplete="off"`, `aria-hidden="true"`** on the input so keyboard users never tab into it, password managers never autofill it, and screen readers never announce it. Skipping this turns an anti-spam measure into an accessibility defect — and a real user's autofill would then look like a bot.
- **Second hidden field `renderedAt`**, set at mount. Server rejects `elapsed < 3000ms` (bots submit instantly) or `elapsed > 6h` (stale/replayed page).
- **On a trip, return `200 {ok:true}` — a silent accept.** Returning 400 teaches the bot to retry with the field cleared. Log `console.warn('[spam] honeypot', route, ip)` so volume is visible in the Vercel logs.

**Honest limitation:** `renderedAt` is client-generated and therefore forgeable, and a bot tuned against *these specific forms* will clear a known honeypot. This layer is cheap volume reduction, not a wall. Layer 2 is what handles the tuned case — which is why the plan has both.

**New file — `lib/spam-guard.ts` (server).** Mirrors the shape of the existing `rateLimitGuard` so routes stay two lines:

```ts
const limited = rateLimitGuard(req, 'contact', { limit: 3, windowMs: HOUR_MS })
if (limited) return limited

const body = await req.json()
const spam = await checkSpamSignals(body, req, 'contact', { turnstile: true })
if (spam) return spam        // silent 200 for traps; 400 for a failed challenge
```

`checkSpamSignals` bundles honeypot, timing, content heuristics (§8) and Turnstile verification (§4) behind one call, returning `null | Response`.

---

## 4. Layer 2 — Cloudflare Turnstile *(~half a day; add only if Layer 1 logs still show spam landing)*

**Recommended over reCAPTCHA:** free and unmetered, "Managed" mode is invisible for almost all visitors, and it carries no Google data-sharing disclosure — which matters for a site whose audience includes minors and whose privacy policy is already published.

Apply to the six forms that cost money or sender reputation: **contact, scholarship, host-event, join-network, white-paper, asset-request.**

**Skip `subscribe` initially** — it is a single email field in the footer, the lowest-value target and the highest friction cost per conversion. Honeypot only; revisit if the logs say otherwise.

- Env: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` in Vercel (all three environments).
- Server verify: POST the token plus `remoteip` (reuse `clientIp()` from `lib/rate-limit.ts`) to `https://challenges.cloudflare.com/turnstile/v0/siteverify`.
- **Fail open, loudly.** If Cloudflare's verify endpoint is unreachable, accept the submission and `console.error`. Losing a real scholarship application to a third-party outage is worse than accepting one spam message. This is a deliberate trade — state it in the code comment so it does not get "fixed" later.

**Alternative worth one line:** Vercel **BotID Basic** is free on all plans, invisible, needs no client widget, and you are already on Vercel. It is less battle-tested and its Deep Analysis tier requires Pro. Turnstile is the safer primary; BotID is a reasonable swap if you would rather not add a Cloudflare account.

---

## 5. Layer 3 — Server-side zod validation *(~2h — this is a genuine hole, independent of spam)*

`ContactForm`, `ScholarshipForm`, `HostEventForm` and `JoinNetworkForm` validate with zod **in the browser**. The routes they post to do hand-rolled truthiness checks. A bot posting JSON straight at `/api/contact` bypasses every client rule, so today:

- no field has a maximum length (a 50 KB "message" is accepted and emailed);
- `type` on `/api/contact` accepts any string, not the six-value enum the UI offers;
- several routes never format-check the email address.

zod is already a dependency. Add one schema per route at the boundary, with `.max()` on every string and enums where the UI has a fixed list. Where a client schema already exists, extract the shared shape rather than writing it twice.

---

## 6. Layer 4 — Escape user input in notification emails *(~30 min, P1)*

`app/api/contact/route.ts` defines an `esc()` helper and uses it 5×. **`scholarship`, `host-event` and `join-network` have zero occurrences** — they interpolate `email`, `brief`, `whatYouDo`, `reason` and every other submitted field raw into the email HTML, including inside an `href`:

```ts
['Email', `<a href="mailto:${email}">${email}</a>`]   // scholarship, unescaped
```

A spammer submitting markup gets a clickable link delivered into the team's inbox from a sender staff already trust. Move `esc()` into `lib/email.ts` (or a small `lib/html.ts`) and use it in all four routes.

---

## 7. Layer 5 — Protect the Resend quota *(the blast-radius fix — arguably do this before any anti-spam work)*

This is not spam prevention, but it is why the spam matters.

`lib/email.ts` documents that the account is on **Resend Free — exactly one verified domain**, with both `TRANSACTIONAL_FROM` and `MARKETING_FROM` sharing `mail.stellreducation.org`. The Free plan's **~100 sends/day is a single pool** covering registration confirmations, DocuSign notifications, campaign drips and every one of these public forms. **`lib/email.ts` has no daily counter and no reserve.**

So: a spam run against `/api/white-paper` or `/api/asset-request` — both of which mail an attacker-supplied address — can exhaust the day's allowance before morning, and the first visible symptom is that **real families stop receiving registration email**, silently.

Recommended:

- Track the day's send count (count `email_send_log` rows for the current UTC day, or a small counter table).
- When remaining budget drops below a reserve (~25), refuse **marketing-class** sends (`from === MARKETING_FROM`) while letting transactional through. Return a clear error the caller already treats as best-effort.
- Alert on crossing the reserve, reusing the existing lead-capture-failure alert path.

Independent of which anti-bot layer you pick, and the highest-value item on this page.

---

## 8. Layer 6 — Content heuristics *(optional, ~1h)*

Cheap and high-yield against the SEO-link-spam pattern. Inside `checkSpamSignals`, silent-accept (as with the honeypot) when:

- a free-text field contains **≥ 2 URLs**, or any `[url=` / `[link=` BBCode;
- the `name` field contains `http`;
- the body contains no ASCII letters at all.

Keep the list short and log every trip so it can be tuned from real data rather than guesswork. Resist growing this into a keyword blocklist — it produces false positives on legitimate messages ("here's our school's site…") faster than it catches anything new.

---

## 9. Files that change

**New**
- `components/forms/useSpamGuard.ts` — hook + `SpamGuardFields` component
- `lib/spam-guard.ts` — `checkSpamSignals()` (honeypot, timing, heuristics, Turnstile)
- `lib/spam-guard.test.ts`

**Modified — routes** (2 added lines each, plus a zod schema)
`subscribe`, `contact`, `scholarship`, `host-event`, `join-network`, `white-paper`, `asset-request`, `check-in` (honeypot only)

**Modified — components** (render `SpamGuardFields`, spread `values` into the body)
`SubscribeForm`, `EventCtas`, `ContactForm`, `ScholarshipForm`, `HostEventForm`, `JoinNetworkForm`, `WhitePaperGate`, `AssetGate`, `CheckInForm`

**Modified — other**
- `lib/email.ts` — export `esc()`; add the daily-quota guard (§7)
- `.env.example` + Vercel env — `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` (Phase 2 only)

**Testing:** follow `app/api/subscribe/route.test.ts`, which already mocks `@/lib/rate-limit` — mock `@/lib/spam-guard` identically, and unit-test the guard itself directly.

---

## 10. Sequencing

| Phase | Contents | Effort | User-visible? |
|---|---|---|---|
| **1a** | Resend daily-quota guard + alert (§7) | S (~2h) | No |
| **1b** | Honeypot + timing (§3), `esc()` fix (§6), server zod (§5), link heuristic (§8) | S–M (~half a day) | **No** |
| **2** | Turnstile on the 6 money/reputation forms (§4) | S–M (~half a day) | Minimal (invisible for most) |
| **3** | Review `[spam]` / `[rate-limit]` log volume after ~2 weeks; tune limits, decide on `subscribe` | XS | No |

Ship 1a + 1b together and measure before committing to Phase 2 — the logs from 1b tell you whether Turnstile is needed at all, and Phase 2 is the only phase that adds a third-party dependency and any user friction.

**Do not tighten the existing per-IP rate limits as a response to this spam.** They are already at the point where shared-NAT school traffic is the binding constraint, and the traffic in question isn't repeating per IP anyway.
