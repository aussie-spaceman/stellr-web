# DocuSign usage review & in-house e-signature recommendation

**Date:** 7 Aug 2026
**Scope:** every DocuSign touchpoint in `stellr-web`, cost drivers at scale, and a staged plan for replacing it with an in-house build.

---

## 1. What DocuSign is actually doing for us

### 1.1 The integration surface is small and well-isolated

All DocuSign API access is confined to **one file**, [`lib/docusign.ts`](../lib/docusign.ts) (448 lines), exposing exactly **eight** functions:

| Function | Purpose |
|---|---|
| `createConsentEnvelope` | Minor parental consent (guardian + optional minor signer) |
| `createAdultAgreementEnvelope` | Adult participation agreement (1 signer) |
| `createMentorAgreementEnvelope` | Mentor agreement (mentor + optional Stellr counter-signer) |
| `createVolunteerAgreementEnvelope` | Volunteer agreement (volunteer + optional Stellr counter-signer) |
| `getEnvelopeSignerProgress` | Recount signers for the "partially complete" pill |
| `resendEnvelope` | Reminder / manual resend |
| `voidEnvelope` | Cancel in-flight envelope on record deletion |
| `getEnvelopeDocument` | Fetch the executed PDF |

Plus two pure helpers with no API dependency: `verifyConnectHmac`, `isMinor` / `classifyAgreement`.

Everything else in the codebase goes through [`lib/docusign-agreements.ts`](../lib/docusign-agreements.ts) → `dispatchAgreement()`, which owns the business logic (duplicate suppression, 3-year reuse, guardian-missing alerting, heads-up emails). **`dispatchAgreement` never calls the DocuSign API directly.**

This is the single most important finding for the build-vs-buy question: the vendor is already behind a narrow, stable seam. A provider swap does not require touching business logic.

### 1.2 Call sites (5 dispatch paths, 4 operational paths)

Envelope creation — all via `dispatchAgreement`:
- [`app/api/register/individual/route.ts:247`](../app/api/register/individual/route.ts)
- [`app/api/register/group/route.ts:640`](../app/api/register/group/route.ts)
- [`app/api/register/group-join/route.ts:320`](../app/api/register/group-join/route.ts)
- [`app/api/members/teams/[id]/participants/route.ts:147`](../app/api/members/teams/[id]/participants/route.ts)
- [`lib/sheet-participant-sync.ts:152`](../lib/sheet-participant-sync.ts)
- [`lib/volunteer.ts:157`](../lib/volunteer.ts)

Operational:
- Webhook: [`app/api/webhooks/docusign/route.ts`](../app/api/webhooks/docusign/route.ts) — HMAC-verified Connect receiver, maps 6 envelope events + `recipient-completed`
- Reminders: [`app/api/cron/docusign-reminders/route.ts`](../app/api/cron/docusign-reminders/route.ts) — daily, resends unsigned envelopes >7 days old
- Downloads: `/api/admin/docusigns/[id]/download`, `/api/members/docusigns/[id]/download`
- Void on delete: [`lib/deletion/external.ts`](../lib/deletion/external.ts)

Storage: one table, `docusign_envelopes` (migrations 010, 015, 031, 032, 048, 121).

### 1.3 What we are NOT using

This narrows a rebuild dramatically. Nothing in the codebase uses:

- **Sequential routing** — every recipient is `routingOrder: '1'` (parallel). No routing engine needed.
- **Embedded / focused-view signing** — all signing happens in DocuSign's hosted UI via emailed link.
- **Any identity assurance beyond email** — no access codes, SMS auth, KBA, or ID Verification. Authentication is *possession of the emailed link*, nothing more.
- **Payment tabs, bulk send, conditional field logic, SMS delivery, Web Forms, CLM, Navigator.**
- **Signer attachments, supplemental documents, or notary.**

We use, in effect, the cheapest tier of DocuSign's product: merge-field templates, an emailed signing link, signature capture, a sealed PDF, and status webhooks.

### 1.4 Templates are the hidden dependency

The four agreement templates live **only in the DocuSign console** — they are not in this repo, not version-controlled, and not owned by anyone in code. The only contract the codebase asserts is a set of tab labels:

```
MinorName, MinorDateOfBirth, MinorRelationship, EventTitle,
GuardianName, GuardianEmail, GuardianPhone, SchoolName, SchoolState,
TeacherName/Email/Phone, MentorName/Email/Phone, VolunteerName/Email/Phone
```

…plus role names `Guardian`, `Minor`, `Adult`, `Mentor`, `Volunteer`, `StellrRepresentative`.

If someone edits a template in the console and renames a field, prefill silently stops working — no error, blank fields on a legal document. The fallback plain-text consent form in `consentDocBase64()` is a stub, not the real legal text.

---

## 2. Cost model

### 2.1 Current volume (prod, as of today)

```
adult   completed    4
adult   sent         6
minor   completed    2   (+1 "on-file" coverage row — no envelope consumed)
minor   sent         1
────────────────────────
14 rows, 13 real envelopes ever issued
```

Against 15 participants / 38 members / 20 registrations. We are pre-scale — which is the good news: **migrating now costs almost nothing in historical-record migration.**

### 2.2 What drives cost at scale

DocuSign bills **per envelope**, not per signer or per page. So:

- A minor consent with guardian **and** minor signing = **1 envelope**, not 2.
- A mentor agreement with Stellr counter-signature = **1 envelope**.
- A reminder resend (`resendEnvelope`) = **0 additional envelopes**.
- An "on-file" coverage row (3-year reuse) = **0 envelopes**. This is already our biggest cost control.

So annual envelopes ≈ **new participants per year, minus those covered by 3-year reuse**.

Sensitivity (verify current rates with your DocuSign rep — plan pricing moves and volume discounts are negotiated, so treat these as a shape, not a quote):

| Participants/yr | Envelopes/yr after ~35% reuse | @ $0.50/env | @ $1.50/env | @ $3.00/env |
|---|---|---|---|---|
| 1,000 | ~650 | $325 | $975 | $1,950 |
| 5,000 | ~3,250 | $1,625 | $4,875 | $9,750 |
| 20,000 | ~13,000 | $6,500 | $19,500 | $39,000 |
| 50,000 | ~32,500 | $16,250 | $48,750 | $97,500 |

Low-volume API plans land at the expensive end of that range; only negotiated high-volume contracts reach the cheap end — and reaching them requires committing to annual volume up front.

### 2.3 The type that will dominate is also the highest-stakes one

Read [`classifyAgreement`](../lib/docusign.ts) carefully:

```ts
if (role === 'participant' || role === 'school_student_manager') return 'minor'
```

**Every student gets the minor parental-consent agreement regardless of age.** Today's prod mix (10 adult / 4 minor) reflects early adopters being teachers and mentors. At scale the mix inverts hard — students are the bulk of participants, so **minor parental consent will be the dominant envelope type**.

That matters because minor parental consent is simultaneously:
- the **largest cost line**, and
- the agreement where evidentiary strength matters most (a contested consent for a minor, a photo/video release dispute).

Any plan that only replaces the adult/mentor/volunteer agreements saves a small fraction of the bill. The decision that actually moves money is whether minor consent goes in-house.

### 2.4 Two cost levers that require no new build

**(a) Envelopes are issued before payment.** In [`app/api/register/individual/route.ts:247`](../app/api/register/individual/route.ts) (and the group paths), `dispatchAgreement` runs during the registration transaction — before payment confirmation. Every abandoned or unpaid registration burns a paid envelope. Gating dispatch on `status = 'paid'` (or on a confirmed free registration) would cut waste directly. Trade-off: paperwork starts later, so the signing window shortens — probably worth a config flag per event rather than a blanket change.

**(b) The 3-year validity window is already doing real work.** `AGREEMENT_VALIDITY_YEARS = 3` in `lib/docusign-agreements.ts`. Every returning participant inside that window costs $0. Worth confirming with counsel whether the window can be longer for adult/mentor/volunteer agreements (for minors it should stay short — guardianship and the participant's own minority status both change).

---

## 3. Risks in the current setup (independent of the cost question)

### 3.1 ⚠️ We do not hold our own signed documents

This is the most serious finding. Both download routes call `getEnvelopeDocument(envelopeId)` **live against the DocuSign API** on every request:

- [`app/api/members/docusigns/[id]/download/route.ts:48`](../app/api/members/docusigns/[id]/download/route.ts)
- [`app/api/admin/docusigns/[id]/download/route.ts:38`](../app/api/admin/docusigns/[id]/download/route.ts)

Consequences:
1. **If the DocuSign account lapses, we lose access to every executed parental consent form we hold.** These are records for minors that we likely have a retention obligation for.
2. It is a hard lock-in: we cannot leave without a bulk export project.
3. Every member portal download is an API round-trip and a latency/availability dependency.
4. There is no local copy of the Certificate of Completion (the audit trail that gives the signature its evidentiary weight).

Fix this **regardless** of the build-vs-buy decision. See Phase 0 below.

### 3.2 Templates unversioned (see §1.4)

### 3.3 Reminder logic sends exactly one reminder, ever

`reminder_sent_at` is set once and the cron filters `.is('reminder_sent_at', null)`. A guardian who ignores the 7-day reminder is never chased again. Not a cost issue, but it means unsigned paperwork silently rots — and each rotted envelope was still paid for.

### 3.4 `dispatchAgreement` swallows all errors

By design (`catch { console.error }`, non-fatal) so a DocuSign outage can't break registration. Correct choice — but it means a systematic failure (expired JWT key, revoked consent, template deleted) produces silent under-papering visible only in Vercel logs. Worth an admin alert on repeated failures.

---

## 4. What an in-house build has to replicate

Stripping out what we don't use, DocuSign is providing eight things:

| # | Capability | Difficulty in-house | Notes |
|---|---|---|---|
| 1 | Merge-field document generation | **Low** | `pdf-lib` is already a dependency and [`lib/certificate.ts`](../lib/certificate.ts) already overlays fields onto a template PDF using page-relative percentage positioning — that is precisely DocuSign's tab mechanic. Substantially solved. |
| 2 | Unique secure signing link by email | **Low** | Resend is already wired ([`lib/email.ts`](../lib/email.ts)). Token + expiry table. |
| 3 | Signature capture UI | **Medium** | Draw-on-canvas + type-to-adopt, mobile-first. Well-trodden; ~1 week including mobile polish. |
| 4 | ESIGN/UETA electronic-records consent | **Low** (build) / **needs counsel** (content) | An explicit disclosure + affirmative checkbox before signing, with a documented withdrawal path. |
| 5 | Multi-recipient (parallel only) | **Low** | We never use sequential routing. Per-recipient rows + "all complete → seal". |
| 6 | Tamper-evident seal + Certificate of Completion | **Medium–High** | Hash-and-store is easy. A cryptographically signed PDF (PAdES) needs `@signpdf/signpdf` plus a purchased signing certificate — doable, but this is the piece that carries the evidentiary weight. |
| 7 | Audit trail (IP, UA, timestamps, per-event) | **Low** | Append-only table. Cheap and the highest-value evidentiary component after the seal. |
| 8 | Status webhooks | **Trivial** | Becomes internal — our own signing route writes the status. The webhook disappears entirely. |

**Legal footing.** Under the federal ESIGN Act and state UETA, an electronic signature is valid without any particular vendor. The statutory requirements are: intent to sign, consent to transact electronically, association of the signature with the record, and retention in a form that accurately reproduces the record and is accessible to all parties. Nothing requires a certified provider. What DocuSign actually sells beyond that is **evidentiary convenience** — a third party attesting to the audit trail, which shifts the burden in a dispute. Whether that convenience is worth the money for a minor's parental consent is a question for counsel, not for this document.

---

## 5. Recommendation: staged replacement, not a rip-out

### Phase 0 — Do this now, ~2 days, independent of any build decision

1. **Archive executed PDFs locally.** On `envelope-completed` in the webhook, fetch the combined document *and* the Certificate of Completion, write both to a private Supabase Storage bucket (`signed-agreements`), store the path + SHA-256 on the envelope row. Change both download routes to serve from storage with a live-fetch fallback. Backfill the 6 completed envelopes we already have. **This removes the lock-in and the records-retention risk in a single afternoon.** Follow the existing private-bucket pattern in [`app/api/members/compliance/document/route.ts`](../app/api/members/compliance/document/route.ts).
2. **Export the 4 templates from the DocuSign console into the repo** — the PDF plus a JSON field map (tab label → page + position). This is the source material a rebuild needs, and it fixes the unversioned-template risk either way.
3. **Add an admin alert** when `dispatchAgreement` fails repeatedly.

Phase 0 alone converts DocuSign from a lock-in into a swappable vendor.

### Phase 1 — Provider abstraction, ~1 week, zero behaviour change

Rename `lib/docusign.ts` → `lib/esign/providers/docusign.ts`; define `lib/esign/provider.ts` with the eight-function interface already implied by the current exports. Add a `provider text NOT NULL DEFAULT 'docusign'` column to `docusign_envelopes`. Route by agreement type via env config:

```
ESIGN_PROVIDER_MINOR=docusign
ESIGN_PROVIDER_ADULT=native
ESIGN_PROVIDER_MENTOR=docusign
ESIGN_PROVIDER_VOLUNTEER=docusign
```

Ship this with everything still pointing at DocuSign. It costs a week, changes nothing user-visible, and makes every later phase reversible per-type with an env flag.

### Phase 2 — Build native, prove it on the adult agreement, ~3–4 weeks

Build the native provider end to end, then cut over **only** the adult participation agreement first: single signer, self-signed, lowest evidentiary stakes, and already 10 of our 13 issued envelopes so it gets real traffic immediately.

New tables:
```
agreement_templates       -- immutable versioned rows: body, field schema, content hash
signature_requests        -- the envelope: type, template_version, status, participant/member
signature_recipients      -- per signer: role, name, email, token_hash, expires_at, status
signature_events          -- append-only: viewed/consented/signed/declined, ts, ip, user_agent
```

New routes:
```
/sign/[token]                        -- public signing page (no auth; email possession = auth, same as DocuSign)
/api/sign/[token]/consent            -- record ESIGN disclosure acceptance
/api/sign/[token]/submit             -- capture signature, advance recipient, seal when all done
/api/sign/[token]/decline
```

The Connect webhook route stays live to service DocuSign-era envelopes; it does not need to change.

### Phase 3 — Mentor + volunteer, ~1 week

Two parallel signers, one of whom is our own representative. Low risk once Phase 2 is proven.

### Phase 4 — Minor parental consent — decide deliberately, in parallel with Phases 2–3

This is where the money is (§2.3) and where the evidentiary argument is strongest for keeping a third party. **Start the counsel conversation at the beginning of Phase 2, not after Phase 3** — the answer determines whether the whole programme pays for itself.

Three defensible outcomes:
- **Move it, with PAdES.** Add a real digital certificate to the sealing step so the PDF is cryptographically tamper-evident, plus the full audit trail. Captures the full saving.
- **Move it, hash-only.** Cheaper, relies on our own audit trail standing up. Acceptable if counsel judges dispute risk low.
- **Keep DocuSign for this type only.** Costs most of the bill but caps the legal exposure. If this is the outcome, Phases 2–3 are probably not worth doing on cost grounds alone — reassess.

---

## 6. Break-even

Rough build cost: **20–30 focused engineering days** across Phases 1–3 (Phase 4 adds ~5 for PAdES + counsel review), plus an ongoing maintenance load of perhaps 1–2 days per quarter. Marginal running cost in-house is effectively zero — Supabase Storage for PDFs is pennies, and the notification emails already go out via Resend today.

Against §2.2: the build pays back inside year one somewhere around **3,000–5,000 envelopes/year** at mid-range DocuSign pricing. Below roughly 1,000 envelopes/year, DocuSign is cheaper than the engineering and this is not worth doing on cost grounds — though Phase 0 remains worth doing on *risk* grounds regardless.

So the honest framing: **at current volume this is not yet a cost problem.** It becomes one at a few thousand participants a year. The right move today is Phase 0 (risk) and Phase 1 (optionality) — a week and a half of work that costs little and buys the ability to decide later, on real volume data, without a migration project.

---

## 7. Immediate next steps

1. Ship Phase 0 (archive PDFs, export templates, failure alerting) — ~2 days.
2. Get current DocuSign pricing and the volume-tier breakpoints from the rep; replace the sensitivity table in §2.2 with real numbers.
3. Gate `dispatchAgreement` on payment confirmation where the event allows it (§2.4a).
4. Put the minor-consent evidentiary question to counsel (§5, Phase 4).
5. Decide on Phase 1 once (2) and (4) are in hand.
