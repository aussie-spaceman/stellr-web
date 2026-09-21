# PLAN — Verifiable credentials + LinkedIn sharing

**Date:** 21 Sept 2026 · **Status:** built 21 Sept 2026 on `feat/credentials-linkedin` — see §9 · **Owner:** David Shaw

Replaces the need for a paid badge platform (VerifyEd / Accredible / Sertifier /
CertifyMe). Everything those platforms do for LinkedIn reduces to: a credential
record → a public credential page → two LinkedIn links. This plan builds that
loop in the app, on top of the certificate issuance that already exists.

Background research (platform feature comparison, LinkedIn mechanics) is in the
21 Sept session transcript; the conclusions are restated here so this document
stands alone.

---

## 0. What LinkedIn actually supports (constraints the design must respect)

- A profile entry under **Licenses & certifications** holds six fields: name,
  issuing organisation, issue date, expiry date, credential ID, credential URL.
  **No badge image appears on the profile.** The only image is the issuing
  organisation's LinkedIn Page logo. The badge graphic only shows in a *feed
  post*, as the link preview (OG image) of the credential page.
- Add-to-profile is free; requires only a LinkedIn Page; no approval
  ([LinkedIn Help a528030](https://www.linkedin.com/help/linkedin/answer/a528030)).
- Deep link used by every issuer:
  `https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME&name=…&organizationId=…&issueYear=…&issueMonth=…&certId=…&certUrl=…`
  `organizationId` (Stellr's numeric Page ID) is what attaches the logo and
  auto-tags the Page. `certUrl` becomes the "Show credential" button.
- **Unverified:** LinkedIn's help page says the button "will no longer autofill";
  third-party builders dated 2026 still document prefill working. Phase 0 tests
  this with a real account. The UI is built so either outcome works.
- LinkedIn minimum age is **16**. Grades 7–10 participants cannot hold accounts.
  LinkedIn buttons are hidden under 16; the credential page and PDF are still
  valuable to them (and to guardians).

## 1. Scope

### In (MVP)
B-01 auto-issue on course completion · B-02 per-person event credentials ·
B-03 per course/event credential config · B-05 revoke · B-07 issued email ·
B-08 guardian routing · B-10 public credential page · B-11 private by default,
earner opt-in · B-12 verifier sees Valid/Revoked/Expired · B-14 add to LinkedIn ·
B-15 share on LinkedIn · **B-16 (revised)** minor sharing consent captured in
the existing parental-consent DocuSign, never as a per-credential step ·
B-20 wallet · B-22 admin list/revoke/resend.

### Later
B-04 ad-hoc manual credentials · B-06 expiry · B-09 self-serve resend ·
B-13 lookup by number · B-17 PNG/PDF-with-QR download · B-18 embed / email
signature · B-21 pathway view · B-23 analytics dashboard · B-24 CSV export.

### Out
B-19 wallet passes and X/Facebook/WhatsApp buttons — **removed** (copy-link
covers it). B-25 Open Badges 3.0 / directory — only if a partner asks.
Blockchain, W3C VC, LMS integrations, custom domains — never.

## 2. Existing code this builds on

| Concern | Where | Reuse |
|---|---|---|
| Course certificate record | `training_certificates` (migration 068), issued in `lib/training-portal.ts` `issueCertificateIfComplete` | Migrates into the new `credentials` table |
| Certificate PDF | `lib/certificate.ts` `renderCertificatePdf` (+ course template overlay) | Keep; add QR later (B-17) |
| Event participation certs / lanyard badges | `app/api/admin/events/[slug]/{certificates,badges}/route.ts`, `lib/event-pdf.ts`, `event_settings.certificate_artwork_path` | Untouched — still the print path. Credentials are additive |
| Parental consent | `lib/docusign.ts` `createConsentEnvelope` (template `DOCUSIGN_TEMPLATE_ID`, roles Guardian/Minor, text tabs), `lib/docusign-agreements.ts` `dispatchAgreement` / `findValidAgreement` (3-year validity, coverage rows via `reused_from`), `app/api/webhooks/docusign/route.ts` | Add one checkbox tab to the template; read it on completion |
| Email | `lib/email.ts` + `lib/email-layout.ts`; `docusignSentToGuardianEmail` shows the minor/guardian split | New `credentialIssuedEmail` |
| OG image in code | `app/(public)/lp/[slug]/opengraph-image.tsx` (edge, tokens) | Same pattern for credential card and badge PNG |
| Capability tokens | `registrations.pay_token` (migration 20260917160000) | Same posture for credential numbers |
| Rate limiting | `lib/rate-limit.ts` `rateLimitGuard` | Public page + events endpoint |
| Erasure | `lib/deletion/*` registry | Register `credentials` tombstone |
| Env | `lib/env.ts` (`SITE_URL`), `lib/env-guards.ts` | `LINKEDIN_ORGANIZATION_ID` |
| Member nav | `components/layout/AppSidebar.tsx` | "Credentials" entry |
| Analytics | `lib/analytics.ts` `pushDataLayer` | Share-click events |
| Age | `participants.date_of_birth`, `members.date_of_birth`, `isMinor` in `lib/docusign.ts` | Consent + LinkedIn gating |
| Award | `participants.award` | Goes on event credentials |

## 3. Design

### 3.1 Data model

One table for every credential, regardless of source, so there is one wallet,
one page template, one share flow. Display fields are **snapshotted at issue**
(the existing `issuer` column already does this) so renaming a course later
does not rewrite history.

```sql
-- supabase/migrations/2026MMDDHHMMSS_credentials.sql
create table public.credentials (
  id               uuid primary key default gen_random_uuid(),
  number           text not null unique,            -- STL-2026-XXXXXXXX (see 3.2)
  source           text not null check (source in ('course','event','manual')),
  member_id        uuid references public.members(id) on delete set null,
  participant_id   uuid references public.participants(id) on delete set null,
  module_id        uuid references public.training_modules(id) on delete set null,
  event_slug       text,
  -- snapshot
  recipient_name   text not null,
  title            text not null,                   -- LinkedIn "Name"
  description      text,
  criteria         text,
  skills           text[] not null default '{}',
  issuer           text not null default 'Stellr Education',
  role_label       text,                            -- Student / Teacher / Mentor …
  award            text,                            -- participants.award
  theme            text,                            -- space | environmental | campaign (badge colour)
  badge_path       text,                            -- optional uploaded PNG override
  -- lifecycle
  issued_at        timestamptz not null default now(),
  expires_at       timestamptz,
  status           text not null default 'issued' check (status in ('issued','revoked')),
  revoked_at       timestamptz,
  revoked_reason   text,
  tombstoned_at    timestamptz,                     -- right-to-erasure; number still resolves
  -- sharing
  visibility       text not null default 'private' check (visibility in ('private','public')),
  is_minor         boolean not null,                -- at issue, from DOB
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index credentials_course_once on public.credentials (member_id, module_id)
  where source = 'course';
create unique index credentials_event_once  on public.credentials (participant_id, event_slug)
  where source = 'event';
create index credentials_member_idx on public.credentials (member_id);

create table public.credential_events (               -- B-23 later reads this
  id            bigserial primary key,
  credential_id uuid not null references public.credentials(id) on delete cascade,
  kind          text not null check (kind in ('view','linkedin_add','linkedin_share','copy_link','pdf')),
  created_at    timestamptz not null default now()
);

-- per-parent defaults used at issue time
alter table public.training_modules
  add column credential_title text, add column credential_description text,
  add column credential_criteria text, add column credential_skills text[] not null default '{}';
alter table public.event_settings
  add column credential_title text, add column credential_description text,
  add column credential_criteria text, add column credential_skills text[] not null default '{}';

-- minor sharing consent, captured from the DocuSign form (3.4)
alter table public.docusign_envelopes
  add column credential_sharing_consent boolean;      -- null = tab absent (pre-change template)
```

RLS: service role only (matches `training_certificates`). All reads go through
server code.

**Backfill:** insert one `credentials` row per `training_certificates` row
(`source='course'`, `number = cert_number`, snapshot from the module and
member). Then switch the two readers (`/api/community/training/certificates/[id]/pdf`,
training tab) to `credentials` and drop `training_certificates` in a follow-up
migration once prod has been verified.

### 3.2 Credential number

Existing format `STL-2026-XXXXXX` is 6 hex chars (24 bits) — enumerable. New
issues use 8 chars of Crockford base32 (40 bits): `STL-2026-7K3MQ8ZD`. Old
numbers stay valid. The number is the credential ID on LinkedIn, the URL path,
and what a verifier types, so it must be quotable by phone — hence base32
without I/L/O/U, not a UUID.

### 3.3 Issuance — `lib/credentials.ts`

```ts
issueCredential(db, input: {
  source, memberId?, participantId?, moduleId?, eventSlug?,
  recipient: { firstName, lastName, dateOfBirth },
  defaults: { title, description, criteria, skills, theme, issuer }, roleLabel?, award?
}): Promise<CredentialRow>          // idempotent on the partial unique indexes
revokeCredential(db, id, reason, actorMemberId)
setVisibility(db, id, 'public' | 'private')  // refuses unless canShare()
canShare(cred, consent): { ok: boolean; reason?: 'minor_no_consent' | 'revoked' | 'tombstoned' }
canUseLinkedIn(cred): boolean       // age ≥ 16 today, from DOB
```

- **Course:** `issueCertificateIfComplete` (training-portal.ts ~L335) calls
  `issueCredential` instead of inserting into `training_certificates`. Returns
  the number as today. Sends `credentialIssuedEmail`.
- **Event:** `POST /api/admin/events/[slug]/credentials` behind
  `requireEventAccess`. Iterates non-withdrawn registrations → participants;
  `roleLabel` from the existing `ROLE_LABELS` map in the badges route;
  `award` from `participants.award`. Idempotent; returns counts. Triggered by a
  button on `/admin/competitions/[slug]`. **Decision D2** (§6) governs whether
  this is all registered or checked-in only.
- **Email:** `credentialIssuedEmail({ firstName, title, url, isMinor })` via
  `emailLayout`. Adults → the earner. Minors → guardian (`ec_email` on members,
  `emergency_contact_email` on participants) as To, earner as Cc when an email
  exists — mirrors the DocuSign minor/guardian split. Copy per `VOICE.md`. No
  attachment; the link is the credential.

### 3.4 Minor sharing consent — B-16 revised (decided 21 Sept: opt-out)

Consent to publish a minor's name + achievement is part of the parental-consent
DocuSign every student signs at registration, and lasts as long as that form
(3 years, `AGREEMENT_VALIDITY_YEARS`). No per-credential prompt, ever.

**Model (D1, decided):** the form reads as the parent/guardian **automatically
opting their child in**, unless they specifically note otherwise on the form.
So in code, a minor's credential is shareable when a valid, completed minor
consent envelope exists for them and no opt-out was recorded on it.

- `docusign_envelopes.credential_sharing_opt_out boolean not null default false`.
- `consentForMinor(db, memberId | participantId)` in `lib/credentials.ts`:
  latest `completed` minor envelope within validity, following `reused_from`
  the same way `findValidAgreement` does. Result:
  `granted` (envelope found, no opt-out) · `declined` (opt-out recorded) ·
  `none` (no valid envelope → not shareable; wallet explains that a signed
  consent form is needed).
- Forms signed before the template change carry no opt-out and therefore
  grant — consistent with the decided model. Nothing to migrate.
- **Follow-on, not in this build:** updating the DocuSign template so the
  guardian can actually record the opt-out, and reading it back on completion.
  Tracked in `docs/handovers/FOLLOW-ON-docusign-minor-credential-optout.md`.
  Until that lands, the only way to record an opt-out is the admin setting it
  on the envelope (admin Consent forms table gets a checkbox), which is the
  correct fallback for a guardian who emails to say no.

### 3.5 Public credential page — `app/(public)/credentials/[number]/`

- `page.tsx` (server, Node): fetch by number →
  - not found → 404.
  - `tombstoned_at` → "This credential was withdrawn at the holder's request."
    (number shown, no name).
  - `visibility = private` and viewer is not the owner → "This credential is
    private." (200, `noindex`).
  - otherwise render. Owner (Clerk user ↔ `member_id`) additionally sees the
    action bar (3.7).
- Layout: `Hero` (midnight) with badge, `Eyebrow` "Verified credential",
  title, recipient name. Light body: status `Badge` (Valid / Revoked on date /
  Expired), issuer, issued date, credential number, description, criteria,
  skills as `InfoPill`s. `max-w-content`. Works without JS.
- `generateMetadata`: `robots: noindex` (all credentials, MVP — K-12 audience),
  `og:title` "Recipient — Title", `og:image` → the card below. LinkedIn's
  scraper ignores `noindex`, so previews still render.
- `opengraph-image.tsx` (edge, `ImageResponse`, tokens — copy the `lp` pattern):
  1200×630 card, theme colour by `theme`, badge glyph, title, recipient name,
  issuer, "stellreducation.org/credentials/<number>". For private/revoked/
  tombstoned credentials the card is generic (no name).
- `badge/route.tsx` (edge): 600×600 PNG badge for feed posts and the future
  PNG download. Generated from tokens; `badge_path` override if uploaded.
- Rate limit `/credentials/*` in `proxy.ts` (60/min/IP) and record a `view`
  event (fire-and-forget, not for the owner).

### 3.6 LinkedIn — `lib/linkedin.ts`

```ts
export function linkedInAddToProfileUrl(c: CredentialRow): string  // profile/add?startTask=…
export function linkedInShareUrl(url: string): string              // sharing/share-offsite/?url=
```
`organizationId` from `LINKEDIN_ORGANIZATION_ID` (server env; Stellr's Page
admin URL `linkedin.com/company/<id>/admin/`). `name = title`, `certId =
number`, `certUrl = ${SITE_URL}/credentials/${number}`, `issueYear/Month`
from `issued_at`, `expirationYear/Month` when `expires_at`. Unit-tested.

If `LINKEDIN_ORGANIZATION_ID` is unset the builder falls back to
`organizationName=Stellr Education` and logs once — never blocks the page.

### 3.7 Owner actions (on the credential page, owner-only) and wallet

Action bar shown only when the signed-in member owns the credential:
- **Visibility toggle** — enabled when `canShare()`; otherwise a one-line reason.
- **Add to LinkedIn profile** — `linkedInAddToProfileUrl`, `target=_blank`.
  Hidden when `!canUseLinkedIn()` or private.
- **Share on LinkedIn** — `linkedInShareUrl`. Same gating.
- **Copy details** panel (name, issuer, date, ID, URL) — always shown next to
  the LinkedIn buttons so the flow works whether or not prefill survives.
- **Copy link** · **Download PDF** (existing renderer).
- Clicks POST `/api/credentials/[number]/events` `{ kind }` and push a
  dataLayer event.

Wallet — `app/(member)/account/credentials/page.tsx`, sidebar entry
"Credentials" in both nav variants in `AppSidebar.tsx`. Lists the member's
credentials (course + event) with status, visibility, and a link to each page.
The training tab's per-course certificate link now points at the credential
page. Participants with no member account reach their page from the email
only (no wallet) — acceptable; `join_completed_at` shows most convert.

### 3.8 Admin

- `/admin/competitions/[slug]` → new **Credentials** card: "Issue participation
  credentials" (with D2 mode), table of issued credentials (name, role, status,
  visibility, page link), per-row **Revoke** (reason required) and **Resend
  email**.
- Course settings (existing training admin) → four credential fields.
- `POST /api/admin/credentials/[id]/revoke`, `POST …/resend`. Revoke emails the
  earner (guardian for minors) and writes `activity_log`.

### 3.9 Erasure

Register `credentials` in `lib/deletion/registry.ts`: member hard-delete →
`tombstoned_at = now()`, `recipient_name = ''`, `visibility = private`. Number
still resolves (§3.5). `participants` cascade already nulls `participant_id`.

### 3.10 Copy & policy

- All strings per `VOICE.md`; the credential page is public-facing, tone
  "Public site".
- Privacy policy: new "Credentials" section (what is published, that it is
  opt-in, how to make it private, minors need guardian consent, retention).
- Terms: nothing new.

## 4. Phases & estimate

| Phase | Work | Est. |
|---|---|---|
| **0 — Spikes** | Test the prefill URL with a real LinkedIn account · obtain Stellr's Page `organizationId` | ½ day |
| **1 — Model + course issuance** | Migration · `lib/credentials.ts` · number generator · refactor `issueCertificateIfComplete` · backfill · switch PDF route + training tab to `credentials` · `credentialIssuedEmail` with guardian routing · unit tests | 1 day |
| **2 — Public page** | `/credentials/[number]` page + states · OG card · badge PNG · `lib/linkedin.ts` · proxy rate limit · view events · e2e for the four states | 1–1.5 days |
| **3 — Consent + owner actions + wallet** | `credential_sharing_opt_out` column + admin toggle · `consentForMinor` · `canShare`/`canUseLinkedIn` · action bar · copy-details panel · wallet page + nav · tests | 1 day |
| **4 — Events + admin** | Event issue endpoint + admin card · revoke/resend endpoints · activity log · privacy copy · erasure registry | 1 day |
| **5 — Ship** | `ship` to dev · `LINKEDIN_ORGANIZATION_ID` on Vercel prod · `promote` · verify one real credential end-to-end on LinkedIn | ½ day |

**≈ 5 working days.** Phases 1–2 can ship to dev independently of 3–4; nothing
is user-visible until the wallet/nav entry lands (Phase 3), so partial
promotion is safe.

## 5. Tests

- **vitest:** number format/uniqueness; `linkedInAddToProfileUrl` encoding and
  fallback; `canShare` matrix (adult / minor+granted / minor+declined /
  minor+unknown / revoked / tombstoned); `canUseLinkedIn` boundary at 16;
  `consentForMinor` following `reused_from`; issuance idempotency; email
  routing for minor vs adult.
- **Playwright:** public page renders for a public credential; private shows
  the private state; revoked shows Revoked; owner sees the action bar and the
  LinkedIn `href` carries `certId`/`certUrl`; admin issue → wallet lists it.
  Per memory, pin the host and check the step outcome, not the badge.
- **Manual (Phase 0 and 5):** real LinkedIn account, real Page ID, Post
  Inspector on the credential URL.

## 6. Decisions (all taken 21 Sept 2026)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Consent mechanism in the DocuSign | **Decided 21 Sept: opt-out.** Guardian automatically opts the child in unless noted on the form. Template update is a follow-on (see §3.4). |
| D2 | Event credentials for all non-withdrawn participants, or checked-in only | **Decided: checked-in when the event used check-in, else all.** |
| D3 | Stellr's LinkedIn Page numeric ID | **Decided: from the Page admin URL.** Value still to be set as `LINKEDIN_ORGANIZATION_ID`; builder falls back to `organizationName` until then. |
| D4 | `noindex` on all credential pages (MVP) vs indexable for adults who opt in | **Decided: noindex for MVP.** |
| D5 | The Certifier-style `credentials-*` MCP connector attached to this workspace | **Decided: not used; disconnect once this ships.** |

## 7. Env & config additions

| Var | Where | Purpose |
|---|---|---|
| `LINKEDIN_ORGANIZATION_ID` | Vercel dev + prod, `.env.local`, `docs/ENV-MATRIX.md` | Page ID for `organizationId` |
| (none) | DocuSign | No change in this build; see the follow-on note. |

## 8. Risks

- **Prefill retired by LinkedIn** → copy-details panel is the flow; button
  still opens the form. No rework.
- **Opt-out not yet recordable on the form** → until the DocuSign follow-on
  lands, a guardian's opt-out is recorded by an admin on the envelope. Low
  volume; acceptable.
- **Enumeration of old 6-hex numbers** → private-by-default means a hit shows
  "private", not a name; rate limit in `proxy.ts`. Acceptable.
- **Edge OG route and Node PDF route share nothing** — by design (see the
  comment in `lp/[slug]/opengraph-image.tsx` on bundle size). Keep the badge
  renderer edge-only.

## 9. What shipped (21 Sept 2026) and what is left

Built and verified in one session — phases 1–4 of §4:

- Migration `20260921120000_credentials.sql` (applied to **dev** via the
  Supabase MCP; ledger realigned to the filename; explicit `service_role`
  grants added after the MCP path left the table unreadable). **Not yet on
  prod** — `promote` applies it.
- `lib/credentials-core.ts` (edge-safe helpers), `lib/credentials.ts`
  (issue / revoke / visibility / consent / reads / tombstone),
  `lib/credentials-notify.ts` (issued email + addressee), `lib/linkedin.ts`.
- `/credentials/[number]` page with the five states, edge OG card and badge
  PNG, owner action bar, `proxy.ts` rate limit and www-only routing.
- `/community/credentials` wallet + sidebar entry.
- Course auto-issue now writes `credentials`; PDF route moved to
  `/api/credentials/[number]/pdf`; course builder gains credential defaults.
- Event issuance (`POST /api/admin/events/[slug]/credentials`, D2 modes),
  admin panel on the competition Settings tab, revoke + re-send routes.
- Admin Consent forms table: guardian opt-out checkbox (D1) +
  `/api/admin/docusigns/[id]/credential-sharing`.
- Erasure: `lib/deletion/execute.ts` tombstones a person's credentials.
- Privacy policy 7.4; `LINKEDIN_ORGANIZATION_ID` in `.env.local.example` and
  `docs/ENV-MATRIX.md`.
- Tests: 24 unit (credentials, linkedin), 11 e2e (`e2e/core/credentials.spec.ts`)
  on the two seeded fixtures; full suites green (702 unit, 57 e2e); prod build OK.

Still open:

1. **Phase 0 spikes** — confirm LinkedIn prefill with a real account, and
   obtain the Page ID for `LINKEDIN_ORGANIZATION_ID` (D3). The UI works either
   way; this decides whether the "copy these details" panel is the primary or
   the fallback.
2. **Follow-on:** `docs/handovers/FOLLOW-ON-docusign-minor-credential-optout.md`.
3. `training_certificates` is still in place (read by nothing). Drop it in a
   later migration once prod has been verified.
4. Later stories: B-04, B-06, B-09, B-13, B-17 (PDF with QR, PNG download),
   B-18, B-21, B-23 (the `credential_events` rows are already being written),
   B-24.
5. D5: disconnect the Certifier-style connector.

