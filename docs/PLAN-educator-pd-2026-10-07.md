# PLAN — Educator PD certificates + LinkedIn credentials

**Date:** 7 Oct 2026 · **Status:** built 7 Oct 2026 on `feat/educator-pd-credentials` — see §7 · **Owner:** David Shaw

## Context

Teachers who support Stellr events need two things: a **PD certificate** that shows the hours they gave, mapped to standards, which they can submit as evidence for their own certification; and a **LinkedIn credential** for their profile. The first case is **Maria Gordon**: 8 hours at the STEM School event last weekend. She has no Stellr account yet.

The membership tiers already promise "PD certificate — 2/6/10 hrs" and standards alignment, but nothing in the schema records hours or standards. A separate Cowork session is designing the certificate artwork. This plan covers the system around it: how a certificate is created, issued and accessed.

Most of this already exists. The 21 Sept credentials build gives us:
- the `credentials` table
- the public page at `/credentials/[number]`
- the LinkedIn add-to-profile link
- the wallet, revoke and resend
- the issued email with its signed `?k=` link
- the owner-only PDF route

The 24 Sept admin invite gives us account creation without a password, plus the "complete your account" email. **So the PD credential becomes a fourth credential `source`.** It is not a parallel system.

### Decisions (taken 7 Oct)

| # | Decision |
|---|---|
| Q1 | **Recognition is manual only for now.** An admin adds each educator. There is no auto-detection. |
| Q2 | **The admin enters hours per person**, with no event default. |
| Q3 | **Standards are NGSS and Common Core.** |
| Q4 | **No survey gate.** `certificateGateFor` already gates only `source='event'`, so `'pd'` is ungated with no code change. |
| Q5 | **Two emails, exactly as today:** the existing account invite, then the existing credential-issued email. |
| Q6 | **Certificate = Cowork background artwork plus fields the app draws** (pdf-lib). There is one global template. |
| Q7 | **One LinkedIn credential per event**, with the hours in the title. |
| Q8 | **One fixed set of standards for all of Stellr.** It is copied onto each credential when issued. |

## Design

### 1. Data model: one migration, `supabase/migrations/2026100XHHMMSS_pd_credentials.sql`

Extend `credentials`. There are no new tables, because hours are entered and issued in one step, and a hours transcript later is just a SUM over these rows.

```sql
ALTER TABLE public.credentials DROP CONSTRAINT credentials_source_check;
ALTER TABLE public.credentials ADD CONSTRAINT credentials_source_check
  CHECK (source IN ('course','event','manual','pd'));
ALTER TABLE public.credentials
  ADD COLUMN pd_hours          numeric(4,1) CHECK (pd_hours IS NULL OR (pd_hours > 0 AND pd_hours <= 40)),
  ADD COLUMN standards         text[] NOT NULL DEFAULT '{}',   -- snapshot at issue
  ADD COLUMN activity_date     date,                           -- event day (snapshot)
  ADD COLUMN activity_location text;                           -- venue/city (snapshot)
ALTER TABLE public.credentials ADD CONSTRAINT credentials_pd_shape
  CHECK (source <> 'pd' OR (pd_hours IS NOT NULL AND member_id IS NOT NULL AND event_slug IS NOT NULL));
CREATE UNIQUE INDEX credentials_pd_once ON public.credentials (member_id, event_slug)
  WHERE source = 'pd' AND status = 'issued';
```

- Check the real name of the inline CHECK constraint before writing the DROP.
- Put the GRANTs next to the change, following the memory note on MCP migrations.
- **Order of rollout:** apply on dev through the MCP, then realign the ledger. On prod, David runs the migration during `promote`.
- **Fixing wrong hours:** revoke with a reason, then issue again. The partial index allows a new row once the old one is revoked. Hours are not edited in place, because the LinkedIn entry has already copied the title.

### 2. Core: `lib/credentials.ts` and `lib/credentials-core.ts`

- Add `'pd'` to `CredentialSource`.
- Add `pdHours`, `standards`, `activityDate` and `activityLocation` to `IssueInput`, and write them in `issueCredential`.
- In `findExisting`, add a `'pd'` branch matching `member_id` + `event_slug` + `status='issued'`.
- Add the new columns to `CREDENTIAL_COLUMNS` and `CredentialRow`.
- **New `lib/pd-standards.ts`:** a constant `PD_STANDARDS: { code, framework: 'NGSS'|'CCSS', label }[]` and a `pdCredentialTitle(eventTitle, hours)` helper. Default title: `Professional Development — <Event title> (<n> hours)`.
  - The exact codes are an input from David or the Cowork design (see Open inputs).
  - They are copied onto `credentials.standards` at issue, so changing the set later does not rewrite history.

### 3. Admin issue path, on the event's Settings tab

- **API: `app/api/admin/events/[slug]/pd-credentials/route.ts`.** Protected by `requireEventAccess`, the same as the sibling credentials route.
  - `GET` lists the event's PD credentials.
  - `POST {memberId, hours}`:
    1. Load the member.
    2. Read the event's title, date and venue from Sanity, the same way the existing credentials route reads the title.
    3. Call `issueCredential({source:'pd', roleLabel:'Educator', theme, standards: PD_STANDARDS codes, …})`.
    4. Call `sendCredentialIssuedEmail` (email 2).
    5. Write `activity_log`.
  - It is idempotent, so a second POST returns the existing credential.
- **Revoke and resend** reuse `app/api/admin/credentials/[id]/{revoke,resend}`. They already scope by `event_slug`.
- **UI: new `components/admin/EventEducatorPd.tsx`**, mounted beside `EventCredentials` in `app/(admin)/admin/competitions/[slug]/page.tsx`. It is built from `@stellr/web-ui` components and design tokens only.
  - **Add educator:** search by name or email through the existing `app/api/admin/members/search`, enter the hours, then Issue.
  - **No match:** a "Create member" link to `/admin/members/new?event_role=teacher&return=<event>`. The prefill and return parameters are small additions to `AdminAddMember.tsx`. The invite box stays ticked, so this is the mentor flow unchanged and sends email 1.
  - **Table:** name, hours, issued date, number, page link, Revoke, Resend.
- **Certificate artwork:** upload one global PNG on the same panel, stored at `community-resources/pd/certificate-<ts>.png` using the existing `lib/uploads.ts` signing.
  - Keep the current path in a single-row setting. Reuse `event_certificate_templates` with a sentinel `event_slug='_pd'` only if that is cleaner than a new setting. Decide while building, and prefer whatever needs no new table.
  - Add an inline preview like `certificate-templates/preview`.

### 4. Certificate PDF

- **New `lib/pd-certificate.ts`:** `renderPdCertificatePdf(fields, artwork | null)`, using pdf-lib and fontkit, the same stack as `lib/event-pdf.ts`.
  - **Fields:** recipient name, hours, event title, activity date, location, standards list, credential number, and the verify URL `stellreducation.org/credentials/<number>`.
  - Field positions are fractions of the page, kept in one `PD_LAYOUT` constant. They are tuned to the Cowork artwork, and long values shrink to fit as in `event-pdf.ts`.
  - **With no artwork uploaded yet**, it draws a plain fallback page, so Maria can be issued before the Cowork design lands.
- **`app/api/credentials/[number]/pdf/route.ts`:** add a `source === 'pd'` branch before the course fallback. It stays owner-only, and there is no survey gate.

### 5. What the educator sees

- **Credential page `app/(public)/credentials/[number]/page.tsx`:** when `source='pd'`, show the PD hours, activity date and location, plus the standards as `InfoPill`s under "Aligned to". Nothing else changes.
  - The page is private by default.
  - The `?k=` link in email 2 lets her view it before she signs in.
  - **LinkedIn buttons stay hidden until her date of birth exists.** `ageBlock` and `canUseLinkedIn` already do this. So completing onboarding is what unlocks LinkedIn, which reinforces "complete your info" without new code.
- **Wallet `/community/credentials`:** PD rows appear through `listMemberCredentials`. The community layout sends her through onboarding first.
  - Check that the wallet's per-slug `certificateGatesFor` lookup does not apply an event's gate to a `'pd'` row with the same slug. If it does, filter on `source`.
- **Email 2:** `credentialIssuedEmail` in `lib/email.ts` gets an optional `pdHours` line: "This records N hours of professional development you can submit towards your teaching licence renewal." The wording follows `VOICE.md`. There is no other change to email routing.

### 6. Maria, step by step (production, after promotion)

1. `/admin/members/new`: Maria Gordon, her email, adult, role **teacher**, school **STEM School**, invite ticked. This sends email 1, "Complete your account", which leads to `/account/onboarding`.
2. Open the event's Settings tab, then **Educator PD**: find Maria, enter **8**, click Issue. This sends email 2 with the credential link.
3. She signs in with an email code and completes onboarding. As a teacher she must give date of birth, gender, phone and school. Onboarding also sends her the membership agreement, which is the existing behaviour for every non-volunteer.
4. She downloads the PDF from the wallet and clicks **Add to LinkedIn**. That click is also the first real check of tracker 11.2 (LinkedIn prefill) and of org ID 66274777.

## Open inputs (not code)

- ~~The exact NGSS and Common Core codes~~ confirmed 7 Oct (see §7).
- **The Cowork deliverable:** a background PNG at Letter size (300 dpi), plus where each field sits. Hand the Cowork session the field list in §4.
- **The event slug and venue** for "STEM School last weekend". Confirm in Sanity at issue time.

## Explicitly later

- Auto-detecting candidates (volunteers, team teachers, event managers).
- An event-level default for hours.
- A cumulative PD transcript (a SUM over `source='pd'`).
- Tier-entitlement PD (Catalyst 2/6/10 hrs), which can reuse `source='pd'` with a null `event_slug` after relaxing `credentials_pd_shape`.
- A QR code on the certificate (B-17).
- A combined thank-you and invite email.
- Per-state teacher standards.

## Files

- **New:**
  - the migration
  - `lib/pd-standards.ts`
  - `lib/pd-certificate.ts` (+ `.test.ts`)
  - `app/api/admin/events/[slug]/pd-credentials/route.ts`
  - `components/admin/EventEducatorPd.tsx`
- **Edited:**
  - `lib/credentials.ts`
  - `lib/credentials-core.ts`
  - `lib/email.ts`
  - `lib/credentials-notify.ts` (pass the hours through)
  - `app/api/credentials/[number]/pdf/route.ts`
  - `app/(public)/credentials/[number]/page.tsx`
  - `app/(admin)/admin/competitions/[slug]/page.tsx`
  - `components/admin/AdminAddMember.tsx` (query prefill and return)
  - `docs/ENV-MATRIX.md` (no env change expected)
  - the privacy policy section 7.4, if the PD wording needs a line

## Verification

- **vitest:**
  - `issueCredential` for `'pd'`: idempotent, and a new number after a revoke
  - the `pdCredentialTitle` format
  - the `renderPdCertificatePdf` output, with and without artwork, as a page count plus extracted text containing the name, "8" and the number
  - the email line appears only when hours are set
  - LinkedIn URL `name` carries the hours
- **Playwright** (`e2e/core/credentials.spec.ts`, pin the host):
  1. As admin, create a member with role teacher and the invite on.
  2. Issue 8 hours on a seeded event.
  3. The row appears in the panel.
  4. The credential page shows "8" and the standards pills.
  5. The owner PDF returns 200 `application/pdf`.
  6. Revoke, then issue again, gives a new number.
  - Restore the shared fixtures in `afterEach`, following the E2E fixture memory note.
- **Builds:** `npm run lint:tokens` and `next build` (pdf code is verified through the build, not vitest).
- **On dev:** run Maria's flow against a `+pd` test address, read both emails in the real inbox, and click through onboarding to the LinkedIn link.
- **Production:** `ship`, then `promote`. That includes the prod migration run by David and checking the deployment by its SHA. Then issue Maria's credential for real.

## 7. What was built (7 Oct 2026) and what changed from the plan

- **Migration** `20261007120000_pd_credentials.sql`, applied to **dev** through the MCP, with the ledger realigned to the filename. **Not on prod** yet; `promote` applies it.
  - Added `activity_title` (the event as the certificate prints it). `title` holds the LinkedIn name, hours included, so it cannot double as the event name.
  - **`credentials_pd_shape` does not require `member_id`.** Erasure tombstones the row and the FK then nulls `member_id` (`ON DELETE SET NULL`). Requiring it would make deleting an educator fail.
- **Issuing is admin-only.** The panel's read-only list is open to the event's managers. Hours on a certificate a teacher submits to a licensing body are an attestation, and finding the teacher needs the admin-only member search.
- **Artwork** has no table. Staged uploads use purpose `pd-certificate-artwork` and are claimed and copied to the fixed path `community-resources/pd-certificate/current` by `PUT /api/admin/pd-certificate`. Preview is at `/api/admin/pd-certificate/preview`.
- **The certificate wraps a long standards list onto two lines** rather than shrinking it below 8pt. The first render printed the Common Core line at about 5pt.
- **Add member** takes `?return=/admin/…` so the panel's "Not a member yet? Add them first" link comes back to the event. Role already defaults to adult / teacher, and the invite is on by default.
- **Email:** `credentialIssuedEmail` gains `pdHours`, which adds the licence-renewal line and an "unfinished account" sharing line in place of "paperwork on file". Two emails, unchanged otherwise (decision Q5).
- **Standards:** `lib/pd-standards.ts`. The set is grade-neutral: NGSS SEP 1, SEP 6, ETS1, and CCSS MP1, MP4, CCRA.SL.1. **Confirmed by David on 7 Oct.**

**Verified on dev (localhost against the dev DB):**
- Add member flowed into the panel, then Issue 8 hours, then a second issue returned the existing credential.
- Both emails arrived: "complete your profile", then "credential issued", with the PD line.
- Owner page shows hours and standards. The owner PDF returned 200.
- The wallet lists the credential.
- Revoke then issue again gave a new number.
- The participation list excludes PD rows.

**Tests:**
- vitest: `pd-standards`, `pd-certificate`, issuance, email, LinkedIn. The full suite is green apart from one pre-existing e-sign timeout under load, which passes alone.
- Playwright: `e2e/core/pd-credentials.spec.ts`, with `credentials.spec.ts` still green.

**Open:**
1. **Cowork artwork.** Upload it, check the preview, and tune `PD_LAYOUT` in `lib/pd-certificate.ts` to it.
2. ~~Confirm the standards set.~~ Confirmed 7 Oct.
3. **Prod migration** during `promote` (David).
4. **Maria Gordon, in production:** create her (teacher, STEM School, invite on), then Educator PD on the Colorado event, 8 hours.
5. **Her first add-to-LinkedIn click** is the first real check of tracker 11.2 (prefill) and org ID 66274777.
6. **Onboarding to LinkedIn is unproven end to end** for an admin-created teacher. Nobody has signed in as one. Tracker 15.1 has the same gap.
