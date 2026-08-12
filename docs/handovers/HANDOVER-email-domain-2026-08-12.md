# Handover — Email domain consolidation (Resend Free)

**Session date:** 12 Aug 2026
**Outcome:** Shipped. Merge `19e3c14` deployed to production.
**Plan/context doc:** [docs/PLAN-single-email-domain.md](../PLAN-single-email-domain.md)

---

## What this session did

The org cancelled the paid Resend subscription (bought for multi-domain sending) and moved to **Resend Free: 1 verified domain, 3,000 emails/month, 100 emails/day**.

**The premise turned out to be already satisfied.** The app was sending exclusively from `mail.stellreducation.org`; the second verified domain, `insimeducation.com`, was dormant (0 of the last 22 retained sends). So this was never a sender migration — it was account cleanup plus brand hygiene.

### Completed

| Item | Detail |
|---|---|
| Resend downgraded to Free | By owner |
| `insimeducation.com` removed from Resend | By owner |
| `Onboarding` API key revoked | By owner (created 4 Jun 2026, never used) |
| `hello@stellreducation.org` confirmed receiving | By owner |
| `CONTACT_EMAIL` → `david.shaw@stellreducation.org` | Vercel Production, confirmed updated (timestamp moved) |
| Code consolidation | Merge `19e3c14`, deployed |

### Code changes in `19e3c14`

- **[lib/email.ts](../../lib/email.ts)** — `DEFAULT_REPLY_TO` now defaults to `hello@stellreducation.org` and is **exported** as the single source of truth. Replaced the `MARKETING_FROM` comment that described splitting marketing onto a second domain (impossible on a 1-domain tier, and it invited re-adding one).
- **[lib/sessions.ts:264](../../lib/sessions.ts)** — ICS `organizerEmail` was a hardcoded `insimeducation.com` address embedded in every calendar invite; now reads `DEFAULT_REPLY_TO`.
- **[lib/coaching-requests.ts:27](../../lib/coaching-requests.ts)** — dropped duplicated env lookup and literal.
- **[.env.local.example](../../.env.local.example)** — corrected addresses, documented every `*_FROM`/`REPLY_TO` var and the Free-tier constraint.
- **[lib/google-sheets.ts](../../lib/google-sheets.ts)**, **[spreadsheet route](../../app/api/registrations/%5Bid%5D/spreadsheet/route.ts)** — `GOOGLE_SHEET_OWNER_EMAIL` **deliberately keeps** its `insimeducation.com` value; commented to say why.

---

## ⚠️ Critical facts for whoever picks this up

1. **Vercel Production sets NONE of `TRANSACTIONAL_FROM`, `MARKETING_FROM`, or `TRANSACTIONAL_REPLY_TO`.** Production therefore runs on the hardcoded defaults in `lib/email.ts`. Changing a default there **changes production behaviour on the next deploy, with no env change**. This is easy to miss.

2. **`mail.stellreducation.org` is the ONLY verified sender domain.** The apex `stellreducation.org` is *not* verified. Any `*_FROM` on another domain is rejected by Resend. Reply-To and recipient addresses need no verification, which is why they can use the apex freely.

3. **`GOOGLE_SHEET_OWNER_EMAIL` is not a mail sender.** It is a Google Drive ownership/sharing identity, still on `insimeducation.com` by design. Repointing it breaks group-registration spreadsheets. A future "stray domain" audit will want to change it — don't.

4. **`sendEmail()` in `lib/email.ts` is the only send path** in the codebase. No SendGrid/Postmark/Mailgun/SES/nodemailer. Supabase SMTP is commented out in `supabase/config.toml`. Clerk and DocuSign send on their own infrastructure and are outside Resend entirely.

---

## Open items

### 1. DocuSign counter-signer env vars — UNCONFIRMED (highest priority)

The owner reported setting, in Vercel:
- `DOCUSIGN_STELLR_REP_EMAIL` = `hello@stellreducation.org` (correcting a `.com` typo)
- `DOCUSIGN_STELLR_REP_NAME` = `David Shaw`

**Evidence suggests they did not save.** In `npx vercel env ls production`, both still showed a **63-day-old** timestamp, while `CONTACT_EMAIL` moved to 13 minutes after its edit — i.e. editing does reset the timestamp in this account. Both vars are marked Sensitive, so Vercel will not return their values and this could not be resolved either way.

**Why it matters:** this is not a From address. It is the `StellrRepresentative` **counter-signer** on mentor agreements ([lib/docusign.ts:283](../../lib/docusign.ts)) — a real person must open the DocuSign envelope and sign, in parallel with the mentor at routing order 1. `lib/docusign.ts:15` reads `process.env.DOCUSIGN_STELLR_REP_EMAIL ?? ''` with **no code default**, so only the Vercel value matters, and it needs a redeploy to take effect.

**Action:** confirm both values in the Vercel dashboard; redeploy if changed.

### 2. Mentor agreements possibly stalled in DocuSign

Any mentor agreement sent while the `.com` address was configured routed its counter-signer to a mailbox that almost certainly never received it. Those envelopes may be **sitting unsigned**.

**Action:** audit the DocuSign console for pending envelopes awaiting the `StellrRepresentative` role; void and re-send as needed.

### 3. Second active Resend API key — unidentified

The account had three keys. `Onboarding` is now revoked. But **two remain and both were recently active** — `Stellr Registration` (used 12 Aug) and `Stellr Production` (used 11 Aug) — while this repo reads a single `RESEND_API_KEY`. Something outside this codebase is sending, or Preview and Production use different keys.

**Action:** determine which key is in Vercel and what the other belongs to; retire it if dead. Relevant because Free-tier quota is **account-wide** — an unknown consumer eats the same 100/day.

### 4. Free-tier 100/day cap vs un-throttled bulk loops — unmitigated

Deliberately left alone pending a volume decision. Three paths loop over recipients and send serially with no batching, rate limiting, or 429 handling:

| Path | File |
|---|---|
| Admin campaign broadcast | [app/api/admin/campaigns/[slug]/email/route.ts:36](../../app/api/admin/campaigns/%5Bslug%5D/email/route.ts) |
| Event outstanding-item reminders | [app/api/admin/events/[slug]/remind/route.ts:53](../../app/api/admin/events/%5Bslug%5D/remind/route.ts) |
| Marketing campaign cron | [lib/email-campaigns.ts:153](../../lib/email-campaigns.ts) |

`sendEmail()` throws on any non-OK Resend response. Each loop catches per-recipient and counts a failure, so a cap breach mid-loop **silently drops the remainder** and reports generic failures. The cron loop is idempotent and recoverable via the `email_campaign_sends` ledger; **the two admin loops have no retry** and would need a manual re-send.

Current volume (~22 emails / 3 weeks, peak day 12) is far below the cap, so this is latent, not active.

**Action if broadcasts grow:** add a rate limiter and Resend `429` handling; add a pre-flight recipient count that warns in the admin composer when a send would exceed the remaining daily quota.

### 5. Minor — `DOCUSIGN_STELLR_REP_NAME` inconsistency

`.env.local` has `David Shaw`; `.env.local.example` has `Stellr Education`. Cosmetic (the example is illustrative), but worth aligning if the counter-signer identity is meant to read as the org rather than an individual.

---

## Verification commands

```bash
cd ~/Documents/GitHub/stellr-web
npx vercel env ls production | grep -iE "FROM|EMAIL|RESEND|REPLY"
curl -s -H "Authorization: Bearer $RESEND_API_KEY" https://api.resend.com/domains | python3 -m json.tool
```

Expected: exactly one verified domain, `mail.stellreducation.org`.
