# HANDOVER — Verifiable credentials + LinkedIn sharing

**Date:** 22 Sept 2026 · **Status:** live in production · **Plan:** `docs/PLAN-credentials-linkedin-2026-09-21.md` (§9 = what shipped)

Close-out tracker (tick items off there):
https://docs.google.com/document/d/14Pk3_D68tXxnSlhytlaFUyJW8oFCrJr1FcWP9ztk8ck/edit

## What exists now

A verifiable credential system that removes the need for a paid badge platform
(VerifyEd / Accredible / Sertifier / CertifyMe). Everything those do *for
LinkedIn* reduces to: a credential record → a public credential page → two
LinkedIn links. All three are built.

Shipped across four promotions: `3ea4d59` (the feature), `b9418ad`, `16d0eae`,
`5e2a021`.

### The model

`credentials` — one row per achievement (`source` = course | event | manual),
with every display field **snapshotted at issue**, so renaming a course later
never rewrites what someone already put on LinkedIn. Private by default.
`credential_events` — view/share telemetry, written but not yet read.

Key columns: `number` (STL-YYYY-XXXXXXXX, Crockford base32), `visibility`,
`status` + `revoked_*`, `tombstoned_at` (erasure), `is_minor` (captured at
issue).

### The code

| Concern | Where |
|---|---|
| Pure helpers, edge-safe | `lib/credentials-core.ts` — state, age gates, `canShare`, number parsing |
| DB side | `lib/credentials.ts` — issue / revoke / visibility / consent / reads / tombstone |
| Issued email | `lib/credentials-notify.ts` (guardian routing for minors) |
| LinkedIn URLs | `lib/linkedin.ts` — add-to-profile, share, manual details |
| Public page | `app/(public)/credentials/[number]/` — page, `opengraph-image.tsx`, `badge/route.tsx`, `badge/glyph.tsx` |
| Owner actions | `components/credentials/CredentialActions.tsx` |
| Wallet | `app/(member)/community/credentials/page.tsx` |
| Event issuance + admin | `app/api/admin/events/[slug]/credentials/route.ts`, `components/admin/EventCredentials.tsx` |
| Revoke / resend | `app/api/admin/credentials/[id]/{revoke,resend}/route.ts` |
| Minor opt-out | `app/api/admin/docusigns/[id]/credential-sharing/route.ts` + column on `docusign_envelopes` |
| Tests | `lib/credentials.test.ts`, `lib/linkedin.test.ts`, `e2e/core/credentials.spec.ts` |

### Decisions already taken — do not re-litigate

- **Minor consent is opt-OUT** (21 Sept): a valid parental consent envelope
  grants sharing unless `credential_sharing_opt_out` is set. Never a
  per-credential prompt.
- **LinkedIn buttons are hidden under 16** regardless of consent — LinkedIn's
  own minimum age.
- **B-19 removed** (wallet passes, X/Facebook/WhatsApp). Copy-link covers it.
- **No Open Badges 3.0 / W3C VC / blockchain / LMS / custom domains.**
- **Event credentials:** checked-in when the event used check-in, else all.
- **noindex** on every credential page.

## Open items, highest value first

### 1. Confirm the LinkedIn org ID is actually Stellr's Page ⚠️

`LINKEDIN_ORGANIZATION_ID=66274777` is set on Vercel **Production** and live in
the running build. It has **never been confirmed**. The builder validates only
that the value is numeric, so a wrong ID fails silently — and `Stellr`, `STELR`
and `Stellar Education` are all separate LinkedIn pages.

**Check:** open a credential page as its owner → "Add to LinkedIn profile" →
the form must name **Stellr Education** as the issuing organisation. Needs a
LinkedIn login. If wrong: change the variable, redeploy, and tell anyone who
already added an entry — **theirs will not update**.

### 2. The Phase 0 prefill spike, same sitting

Does LinkedIn still pre-fill the Licenses & certifications form? Its help page
says prefill was retired; third-party builders dated 2026 say it works. The UI
ships a "copy these details" panel either way, so nothing is broken — but if
prefill is gone, that panel should become the primary affordance in the copy.

### 3. First real event issuance

`POST /api/admin/events/[slug]/credentials` has never run against real
participants. Shares the course path and is unit-tested for idempotency.
Run it on one small event with someone watching the outbound mail.

### 4. Erasure is wired but unproven

`tombstoneCredentialsFor()` is called from `lib/deletion/execute.ts` for member
and participant deletes. Only the *reading* of `tombstoned_at` is unit-tested;
the write has no test and has never run. It is a privacy feature — add a test,
then delete a throwaway dev member holding a credential and confirm the page
shows "withdrawn" with no name.

### 5. DocuSign template follow-on

`docs/handovers/FOLLOW-ON-docusign-minor-credential-optout.md`. Until it lands,
a guardian's "no" can only be recorded by an admin checkbox on the Consent
forms table.

### 6. Housekeeping

- `training_certificates` still exists on production, read by nothing. Safe to
  drop now.
- Two credentials exist in production, backfilled from August course
  completions, private, both adults. **Their holders were never emailed** — the
  backfill was a SQL insert and the issued-email only fires on a fresh issue.
  Decide whether to re-send.
- `LINKEDIN_ORGANIZATION_ID` deliberately **not** on `stellr-web-dev`, so dev
  exercises the `organizationName` fallback.

## Gotchas a future session will otherwise rediscover

- **MCP-applied migrations get no role grants.** The `credentials` table was
  unreadable even to `service_role` until explicit `GRANT`s were added. Put
  GRANT lines beside the RLS policy in any migration that might be applied that
  way. Symptom: `permission denied for table` from a server route.
- **The edge/Node split is deliberate.** `opengraph-image.tsx` and
  `badge/route.tsx` run on the edge and must not import `lib/credentials.ts`
  (Node crypto, DocuSign). That is why `lib/credentials-core.ts` exists.
  Satori has no `inset` shorthand — spell out top/right/bottom/left.
- **Dates of birth are date-only strings.** `new Date('2010-09-21')` is UTC
  midnight, i.e. the previous evening in every US timezone. `ageOn()` parses the
  parts and compares in UTC for that reason; do not "simplify" it.
- **Revoking does not flip visibility.** A credential that was public when
  revoked must keep answering "Revoked" at the URL already on someone's
  LinkedIn; making it private would answer "private" instead.
- **The Training dashboard "certificates" stat now counts all credentials**
  (course + event), not only course certificates, since the count was repointed
  at the new table. Filter to `source='course'` if the narrower meaning is
  wanted.
- **Course certificate PDF moved** to `/api/credentials/[number]/pdf`. No UI
  referenced the old path, but a bookmarked link would 404.

## Verifying a change to this feature

```bash
npx vitest run lib/credentials.test.ts lib/linkedin.test.ts
E2E_BASE_URL=http://localhost:<port> npx playwright test e2e/core/credentials.spec.ts --project=core
```

The e2e spec leans on two seeded fixtures in `supabase/seed.sql`:
`STL-2026-E2EGRACE` (adult, shareable) and `STL-2026-E2EADA01` (16, consent
outstanding, must stay private). Each owner test restores visibility so the
suite can run in any order.

To preview a worktree in the Browser pane, `npm run dev` in the background then
`preview_start { url }` — `preview_start { name }` reads the **main** checkout's
`launch.json`. `PORT` in `.env.local` must be unquoted or `scripts/dev.mjs`
ignores the claim.
