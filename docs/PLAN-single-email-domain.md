# Plan — Consolidate all email onto one domain (Resend downgrade)

**Date:** 12 Aug 2026
**Driver:** Cancelling the paid Resend subscription. The paid plan was bought for multi-domain sending; the Free plan allows **1 domain, 3,000 emails/month, 100 emails/day**.
**Status (12 Aug 2026):** Downgrade to Resend **Free** is DONE; `insimeducation.com` removed from the Resend account by the owner. **Tier 2 code cleanup is APPLIED** (uncommitted on `main` — typecheck clean, 151/151 tests pass, `lint:tokens` clean). Tier 1 verification items and the deploy remain — see "Manual steps still outstanding" at the foot of this doc.

---

## Headline finding

**The application already sends from a single domain.** No sender migration is required.

Every `from` address the app can produce resolves to `mail.stellreducation.org`:

| Sender | Value | Where |
|---|---|---|
| Transactional (default) | `Stellr Education <no-reply@mail.stellreducation.org>` | [lib/email.ts:9](lib/email.ts:9) |
| Marketing / campaigns | `Stellr Education <hello@mail.stellreducation.org>` | [lib/email.ts:22](lib/email.ts:22) |

Both are `process.env.X ?? '<default>'`, and **neither `TRANSACTIONAL_FROM` nor `MARKETING_FROM` is set in Vercel Production** — so production runs on the hardcoded defaults above. Confirmed via `npx vercel env ls production`: the only email-related vars in prod are `RESEND_API_KEY`, `CONTACT_EMAIL`, `DOCUSIGN_STELLR_REP_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`.

There is exactly one send path in the entire codebase — `sendEmail()` in [lib/email.ts:44](lib/email.ts:44), hitting `https://api.resend.com/emails`. No second provider (no SendGrid/Postmark/Mailgun/SES/nodemailer). Supabase SMTP is commented out in `supabase/config.toml`; auth is Clerk, which sends on its own infrastructure and is unaffected.

### The second domain is dormant

The Resend account has two verified domains:

| Domain | Verified | Used as a sender by this repo? |
|---|---|---|
| `mail.stellreducation.org` | 10 Jun 2026 | **Yes — everything** |
| `insimeducation.com` | 5 Jun 2026 | **No** |

Resend's retained send log (30-day window, 24 Jul – 11 Aug) shows **22 sends, 100% from `no-reply@mail.stellreducation.org`**. Zero from `insimeducation.com`.

**Conclusion:** dropping to the 1-domain Free plan requires deleting `insimeducation.com` from Resend and changes nothing about how the app sends mail.

---

## The actual risk is the daily cap, not the domain count

This is the part worth attention. Free tier imposes **100 emails/day**; the paid plan has no daily limit.

Current volume is far below it — 22 emails in ~3 weeks, peak day 12 (6 Aug). But three code paths loop over a recipient list and send serially with **no batching, no rate limiting, and no throttle-aware retry**:

| Path | File | Recipients |
|---|---|---|
| Campaign broadcast (admin composer) | [app/api/admin/campaigns/[slug]/email/route.ts:36](app/api/admin/campaigns/[slug]/email/route.ts:36) | every registered group's teacher |
| Event outstanding-item reminders | [app/api/admin/events/[slug]/remind/route.ts:53](app/api/admin/events/[slug]/remind/route.ts:53) | every participant w/ outstanding items, plus CCs |
| Marketing campaign dispatch (cron) | [lib/email-campaigns.ts:153](lib/email-campaigns.ts:153) | whole audience segment |

`sendEmail()` throws on any non-OK Resend response ([lib/email.ts:76-80](lib/email.ts:76)). Each loop catches per-recipient and counts a failure, so a mid-loop cap breach doesn't crash — but it **silently drops the remainder of the send** and reports them as generic failures. The campaign-dispatch loop does record `status: 'failed'` per member in the `email_campaign_sends` ledger and is idempotent on re-run, so it can recover; the two admin loops have no retry and would need a manual re-send.

**One broadcast to a list of 100+ will partially fail on the Free plan.** Decide whether that is acceptable before cancelling.

---

## Recommended changes

### Tier 1 — Required (Resend account, no code)

1. **Keep `mail.stellreducation.org`.** It is what 100% of live mail uses. Deleting it breaks all outbound email.
2. **Before deleting `insimeducation.com`, confirm nothing outside this repo sends from it.** The account has three API keys, **two of them recently active**:
   - `Stellr Registration` — last used 12 Aug 2026
   - `Stellr Production` — last used 11 Aug 2026
   - `Onboarding` — never used

   This repo uses a single `RESEND_API_KEY`, so a second key is being used by something else (or by Preview vs Production). Identify it before pulling the domain. Revoke the unused `Onboarding` key while you're in there.
3. **Delete `insimeducation.com` from Resend**, then downgrade the plan. The account must be at 1 domain or the downgrade will be blocked.
4. Optionally remove the now-unused DNS records for `insimeducation.com` (Resend's SPF/DKIM/DMARC entries) at the registrar.

### Tier 2 — Code changes ✅ APPLIED 12 Aug 2026

These are **not** required for the downgrade — `Reply-To` and recipient addresses do not need a Resend-verified domain — but the cancellation is the natural moment to close them. Today, members who follow the "Reply to this email" instruction that appears in ~15 templates land in an `insimeducation.com` mailbox.

| # | File | Current | Change to |
|---|---|---|---|
| 1 | [lib/email.ts:14-15](lib/email.ts:14) | `TRANSACTIONAL_REPLY_TO ?? 'david.shaw@insimeducation.com'` | `?? 'hello@stellreducation.org'` |
| 2 | [lib/sessions.ts:264](lib/sessions.ts:264) | `organizerEmail: 'david.shaw@insimeducation.com'` (hardcoded, embedded in every ICS calendar invite) | read from the same constant as #1 |
| 3 | [lib/coaching-requests.ts:28](lib/coaching-requests.ts:28) | `COACHING_TEAM_EMAIL ?? TRANSACTIONAL_REPLY_TO ?? 'david.shaw@insimeducation.com'` | drop the literal; inherit from #1 |
| 4 | [app/api/contact/route.ts:5](app/api/contact/route.ts:5), [join-network:5](app/api/join-network/route.ts:5), [scholarship:6](app/api/scholarship/route.ts:6), [host-event:6](app/api/host-event/route.ts:6) | `CONTACT_EMAIL ?? 'hello@stellreducation.org'` — already correct in code | **Verify the Vercel Production value.** Local `.env.local` sets it to `david.shaw@insimeducation.com`; prod value is hidden. |
| 5 | [lib/email.ts:17-21](lib/email.ts:17) | Comment describes a future plan to split marketing onto its own domain "once the apex is verified in Resend" | Rewrite — that plan is dead under a 1-domain tier. Prevents a future dev re-adding a second domain. |
| 6 | [.env.local.example](.env.local.example) | `CONTACT_EMAIL=david.shaw@insimeducation.com`; no `TRANSACTIONAL_REPLY_TO`/`MARKETING_FROM` entries | Update to the `stellreducation.org` addresses; document all three FROM/REPLY_TO vars and note the 1-domain constraint. |

Prerequisite for #1–#3: `hello@stellreducation.org` must be a real, monitored mailbox. It is already published as the public contact address across [contact](app/(public)/contact/page.tsx:55), [terms](app/(public)/terms/page.tsx:189), [donate](app/(public)/donate/page.tsx:142), [host-an-event](app/(public)/host-an-event/page.tsx:110) and [llms.txt](app/llms.txt/route.ts:55), so it should already exist — confirm it is actually received before pointing replies at it.

### Tier 3 — Deliberately leave alone

- **`GOOGLE_SHEET_OWNER_EMAIL`** ([lib/google-sheets.ts:3](lib/google-sheets.ts:3), [spreadsheet route:24](app/api/registrations/[id]/spreadsheet/route.ts:24)) — `david.shaw@insimeducation.com`. This is a **Google Drive account identity for sheet ownership/sharing**, not a mail sender. Changing it will break group-registration spreadsheets. Out of scope.
- **DocuSign** — sends on its own infrastructure, unaffected by Resend. Note however that `DOCUSIGN_STELLR_REP_EMAIL` is `hello@stellreducation.**com**` (`.com`, not `.org`) in `.env.local`. Likely a typo worth checking against the Production value, but it is a separate issue from this change.
- **Clerk** — sends its own auth/invite emails. If those still come from a Clerk-branded or third domain, that is a separate consolidation task.

### Tier 4 — Consider if bulk volume will grow

If broadcasts to large lists are expected, add before cancelling:
- A concurrency/rate limiter on the three bulk loops, and handling for Resend `429` responses (currently `sendEmail` throws on any non-OK and the loop just counts it failed).
- A pre-flight recipient count with a warning in the admin composer when a send would exceed the remaining daily quota.

---

## Rollout

1. Confirm `hello@stellreducation.org` is a monitored mailbox.
2. Identify the second active Resend API key; confirm no non-repo sender uses `insimeducation.com`.
3. Apply Tier 2 code changes on a branch; run `npm run lint`, `npm test`, `npm run check:deploy-ready`.
4. Verify the Vercel Production value of `CONTACT_EMAIL` (item #4) and correct it if needed.
5. Merge to `main` → auto-deploys to prod via Vercel git integration (~4 min).
6. **Post-deploy smoke test, before touching Resend:** submit the public contact form, and trigger one transactional send (e.g. a test registration). Check the received mail shows `From: no-reply@mail.stellreducation.org` and `Reply-To: hello@stellreducation.org`.
7. Only then: delete `insimeducation.com` in Resend, revoke the unused key, downgrade the plan.
8. Re-verify one send after the downgrade to confirm the Free-tier key still authorises.

**Rollback:** the sender defaults are env-overridable — setting `TRANSACTIONAL_FROM` / `MARKETING_FROM` / `TRANSACTIONAL_REPLY_TO` in Vercel restores any prior address without a deploy. Re-verifying a deleted domain in Resend requires re-adding DNS records, so step 7 is the only hard-to-reverse action; do it last.

---

---

## Manual steps still outstanding

### 1. BLOCKING — confirm `hello@stellreducation.org` receives mail

The code now defaults `TRANSACTIONAL_REPLY_TO` to `hello@stellreducation.org`, and **Vercel Production does not set that variable**, so the new default goes live the moment this deploys. It is now the Reply-To on every transactional email (~15 templates say "reply to this email"), the ICS calendar organizer on session invites, and the coaching-team notification address.

If that mailbox is not actually monitored, member replies disappear silently. Verify before deploying. If it isn't ready, set `TRANSACTIONAL_REPLY_TO` in Vercel to a mailbox that is — the env var overrides the default with no code change.

### 2. ~~Check `CONTACT_EMAIL` in Vercel Production~~ ✅ DONE

Updated to `david.shaw@stellreducation.org` by the owner, 12 Aug 2026. `.env.local` and `.env.local.example` now match.

### 3. Resend account hygiene

- Revoke the **`Onboarding`** API key — created 4 Jun 2026, **never used**.
- Two keys are both recently active (`Stellr Registration`, 12 Aug; `Stellr Production`, 11 Aug) but this repo uses only one `RESEND_API_KEY`. Identify what the second one belongs to (likely Preview vs Production, possibly another system) and retire it if it is dead.

### 4. DocuSign counter-signer typo — ⚠️ Vercel update still required

Confirmed a typo: `DOCUSIGN_STELLR_REP_EMAIL` was `hello@stellreducation.**com**` (`.com`). Corrected to `hello@stellreducation.org` in `.env.local` and `.env.local.example`.

**There is no code change and no code default** — [lib/docusign.ts:15](lib/docusign.ts:15) reads `process.env.DOCUSIGN_STELLR_REP_EMAIL ?? ''`. So the fix only takes effect once the **Vercel Production and Preview** values are updated by hand. Until then prod keeps using the `.com` address.

This is **not** a From address. It is the `StellrRepresentative` counter-signer role on mentor agreements ([lib/docusign.ts:283-287](lib/docusign.ts:283)) — a real person must open the envelope and sign, in parallel with the mentor at routing order 1. Two consequences:

- Any mentor agreement sent while the `.com` address was configured went to a mailbox that likely never received it, so those envelopes may be **sitting unsigned**. Worth auditing in the DocuSign console for pending `StellrRepresentative` envelopes.
- `hello@stellreducation.org` must be monitored by someone who will actually counter-sign, otherwise mentor agreements stall in the same way.

Also confirm `DOCUSIGN_STELLR_REP_NAME` while you are in there — `.env.local` has `David Shaw`, `.env.local.example` has `Stellr Education`, and the Production value is hidden.

### 5. Deploy and smoke-test

Changes are currently **uncommitted on `main`**. Commit on a branch, then merge — push to `main` auto-deploys prod via Vercel (~4 min). Run `npm run check:deploy-ready` first (it fails on a dirty tree or unpushed commits).

After deploy, send one real transactional email (submit the public contact form, or run a test registration) and confirm on the received message:
- `From: Stellr Education <no-reply@mail.stellreducation.org>`
- `Reply-To: hello@stellreducation.org`
- replying to it actually lands in the inbox

### 6. Decide on the 100/day cap

Now live. Current volume (~22 emails/3 weeks) is far below it, but the three bulk loops listed above will partially fail on any single send over 100 recipients, and two of them have no retry. Tier 4 above describes the fix if broadcasts are expected to grow.

---

## Resolved decisions

1. ~~Downgrade to Free, or leave Resend?~~ **Downgraded to Resend Free**, 12 Aug 2026.
2. ~~Do Tier 2 now or defer?~~ **Done**, 12 Aug 2026.
3. **Is the 100/day cap acceptable?** Still open — see step 6 above.
