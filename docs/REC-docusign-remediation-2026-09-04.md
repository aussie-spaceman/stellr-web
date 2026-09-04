# DocuSign remediation plan — 4 Sept 2026

Triggered by a parent email ("we signed it, why does it say we haven't?") for the Colorado
Space Design Challenge. Investigating it surfaced three separate problems: production is
running on a DocuSign **demo/sandbox** account, our status reporting cannot say *who* is
outstanding, and the reminder cron is both misleading and single-shot.

Everything below is evidence-backed against the live DocuSign account and the prod DB on
4 Sept 2026.

> **Status:** the code for §1, §3 and the guardrails in §2 Phase D has shipped on
> `feat/docusign-remediation-2026-09-04` — see **§6 What shipped** at the end.
> §2 Phases A–C are console work that still has to be done by a human, in order.

---

## 0. What was found (evidence)

**DocuSign account in use by production**

| | |
|---|---|
| Base path | `https://demo.docusign.net/restapi` |
| OAuth | `https://account-d.docusign.com` |
| Account ID | `87718065-d86a-40a5-8e27-4e56289251ed` ("Stellr") |
| Plan | `DEVCENTER_DEMO_RESTRICTED_JUNE2025` |
| Connect config | `22193922` → `https://www.stellreducation.org/api/webhooks/docusign` |

The Connect webhook in the **demo** account posts to the **production** site. That is the
single fact that proves prod is wired to the sandbox, not a local dev leak.

Every page of an executed envelope carries, in red:

> DEMONSTRATION DOCUMENT ONLY — PROVIDED BY DOCUSIGN ONLINE SIGNING SERVICE

**Blast radius — small, which is the good news.** `docusign_envelopes` in prod holds
**2 rows total**. The demo account holds 11 envelopes since Jan 2026:

| Envelopes | Count | Disposition |
|---|---|---|
| Test / voided (David's own + `tim@smith.com`) | 8 | Ignore |
| Real staff — Bill Allen, Adult Participation Agreement, **completed** 6 Aug 2026 | 1 | Must be re-executed |
| Real families — Buk + Guggino minor consents, **1 of 2 signed**, in flight | 2 | Must be voided + re-issued |

**Templates** (account-scoped, will not exist in a prod account):
`92433f1d…` Minors · `c3e40b62…` Adults · `2af13604…` Mentors.
There is **no Volunteer template**, and `DOCUSIGN_VOLUNTEER_TEMPLATE_ID` is not set in
Vercel — `createVolunteerAgreementEnvelope()` throws today for every volunteer.

**This was already known.** `docs/GO-LIVE-CHECKLIST.md` §4 has said
"❌ STILL SANDBOX" since 10 June 2026 and carries a correct 9-step promotion runbook. It
was never actioned, and nothing stopped real registrations from flowing through it in the
meantime. That is the process failure to fix, not just the config.

---

## 1. Stop DocuSign status from being confusing

### Root cause

We persist an **envelope-level** status plus two integers (`signers_total`,
`signers_completed`). We never persist **who** each recipient is or **where each one
stands**. Every surface downstream is therefore guessing, and each guesses differently:

| Surface | Source | What a 1-of-2 envelope shows |
|---|---|---|
| Event roster (`components/admin/EventRoster.tsx`) | `docusign_pill` | `Partially Complete` — no count, no name |
| Admin → Consent forms (`components/admin/DocusignTable.tsx`) | raw `status` only — **does not even select the signer counts** | `Awaiting signature` — partial state invisible |
| Member portal (`components/member/DocusignsSection.tsx`) | counts | `Partially complete · 1 of 2 signed` — no name |
| Reminder email | none | "we haven't received a signed form from *{guardian}*" — asserted, never checked |

Three vocabularies, none of which answers the only question anyone asks: **who do I chase?**

Two further blind spots, both proven in the account:

- **Bounces are invisible.** The `tim@smith.com` envelope shows recipient status
  `autoresponded` — DocuSign told us the address bounced and we discarded it. A guardian
  whose email hard-bounces is indistinguishable from one who is merely slow.
- **"Opened" is lost.** DocuSign tracks `deliveredDateTime` per recipient. Tamara Buk has
  none — she has *never opened it* in 9 days, which is a completely different problem from
  "opened and hasn't got round to it". We collapse both into `sent`.

And structurally: **the guardian never hears from Stellr at all.** `dispatchAgreement()`
emails `ctx.email` (the participant); the guardian only ever receives the DocuSign email.
If it lands in spam, no human at Stellr and no one in the family is told.

### Fix

**1.1 — Persist recipient-level state (migration 148).**

```sql
create table docusign_envelope_recipients (
  id            uuid primary key default gen_random_uuid(),
  envelope_row  uuid not null references docusign_envelopes(id) on delete cascade,
  recipient_id  text not null,          -- DocuSign recipientId
  role_name     text,                   -- Guardian | Minor | Adult | Mentor | Volunteer | StellrRepresentative
  name          text not null,
  email         text not null,
  status        text not null,          -- created|sent|delivered|completed|declined|autoresponded
  delivered_at  timestamptz,            -- null = never opened the link
  signed_at     timestamptz,
  declined_at   timestamptz,
  last_synced_at timestamptz not null default now(),
  unique (envelope_row, recipient_id)
);
```

**1.2 — Sync it on every Connect event.** `app/api/webhooks/docusign/route.ts` already
calls the recipients API for `recipient-completed`. Widen that to every event and upsert
the full recipient list — the API call is already being made, we are just throwing 90% of
the response away. Add `recipient-autoresponded` and `recipient-delivered` to the Connect
config's event list.

**1.3 — One shared status vocabulary.** New `lib/docusign-status.ts`:

```ts
export function describeEnvelope(env, recipients): {
  pill: 'not_required'|'not_issued'|'issued'|'partial'|'declined'|'bounced'|'complete'
  label: string          // "Partially complete · 1 of 2 signed"
  waitingOn: Recipient[] // ← the answer to "who do I chase"
  bounced:   Recipient[]
  neverOpened: Recipient[]
}
```

Delete the three local mappings and have `EventRoster`, `DocusignTable` and
`DocusignsSection` all render from this. Roster pill becomes
`Partially Complete — awaiting Tamara Buk (guardian)`; the admin table gains a
`Waiting on` column and stops under-reporting partials.

**1.4 — Surface bounces as work.** A `bounced` recipient gets a red pill and fires
`notifyCommunityAdmins()` once, with the address. Today this is a silent dead end.

**1.5 — Email the guardian directly.** Add `docusignSentToGuardianEmail` /
`docusignReminderToGuardianEmail`, sent from Stellr to `guardianEmail` at issue and chase
time, saying plainly: a DocuSign email is coming from `dse@docusign.net`, check spam, here
is who to reply to. This alone would have prevented the Buk case.

**1.6 — Fix the one-inbox trap.** When `guardianEmail === participant email` (Guggino:
both recipients are `emilyguggino@gmail.com`), DocuSign sends two near-identical emails to
one inbox and signing one looks like finishing. Either collapse to a single signer when
the addresses match, or make the two subject lines unmistakably different
("**Parent/guardian** signature required" vs "**Student** signature required").

---

## 2. Sandbox → production DocuSign

The mechanical steps are already written and correct in `docs/GO-LIVE-CHECKLIST.md` §4a
(promotion → prod account → key + RSA → region base URI → re-grant JWT consent → recreate
templates → Connect + HMAC). Do not re-derive them; follow them. What that runbook does
**not** cover is the containment, the re-issue, and the guardrails.

### Phase A — contain (today)

- **Decision needed:** is there an existing paid Stellr DocuSign account, or does one need
  buying? The DocuSign account currently connected to Claude is `david.shaw@insimeducation.com`
  on `na4.docusign.net` — a *production* account, but under the wrong org. Promotion is
  blocked on this answer, so resolve it first.
- Hold the Buk and Guggino families with a human reply (see §4). Do not chase them into a
  demo envelope we are about to void.
- No other real envelopes are in flight, so no kill-switch is warranted.

### Phase B — promote and cut over

Follow §4a steps 1–9. Additional items that runbook misses:

- Create a **fourth** template, `Participant Agreement - Volunteers`, with roles
  `Volunteer` + `StellrRepresentative` and tabs `VolunteerName`, `VolunteerEmail`,
  `VolunteerPhone`, `EventTitle`. Set `DOCUSIGN_VOLUNTEER_TEMPLATE_ID` in Vercel.
- **Delete Connect config `22193922` from the demo account** after cutover. Left in place,
  the sandbox keeps posting to production forever.
- Re-run `npm run verify:prod` — it already prints `environment: PRODUCTION | SANDBOX / DEMO`
  and resolves each template ID. It correctly reported SANDBOX all along; nobody ran it.

### Phase C — re-issue what was signed in the sandbox

Sequence matters, because `dispatchAgreement()` will otherwise refuse to re-issue:

1. Void the 2 in-flight demo envelopes in DocuSign; the Connect webhook writes
   `status='voided'`, which clears the `hasOpenEnvelopeForEvent` block.
2. **Bill Allen's completed adult agreement is the trap.** `findValidAgreement()` treats a
   `completed` row as valid for 3 years, so a re-issue will be silently swallowed and
   replaced with an "already on file" email. Mark that row `voided` (or delete it) *before*
   re-issuing, and check for any `reused_from` coverage rows pointing at it.
3. Re-issue all three from the production account. Confirm the re-issued PDFs carry **no**
   demonstration watermark.

### Phase D — guardrails so it cannot recur

**D1 — Runtime guard (the important one).** Add to `lib/docusign.ts`, evaluated before any
envelope is created:

```ts
if (process.env.VERCEL_ENV === 'production' && ENV.basePath.includes('demo.docusign.net')) {
  throw new Error('Refusing to issue a DocuSign envelope: production is pointed at the demo account')
}
```

`dispatchAgreement()` already catches and logs non-fatally, so registration still succeeds —
but route the throw through `notifyCommunityAdmins()` so it is loud rather than a log line.

This must be a **runtime** check, not a script: `vercel env pull` redacts secret values, so
no local tool can audit what production actually holds. Only code running inside the
deployment can see it.

**D2 — Extend the pattern.** The same class of bug exists wherever a test/live pair of
credentials exists (Stripe `sk_test_`, Clerk `pk_test_`). One `lib/env-guards.ts` asserting
"production deployment must not hold sandbox credentials", called from each integration.

**D3 — Add a `/api/admin/health/integrations` route** returning the *environment* (never
the secret) of each integration, rendered on an admin page. Makes "are we live?" a
five-second check instead of a forensic exercise.

**D4 — Close the loop on the runbook.** `GO-LIVE-CHECKLIST.md` §4 carried an accurate ❌ for
three months while real families signed demo documents. A stale unchecked box in a doc is
not a control. D1 and D3 are the controls; the doc is the instructions.

---

## 3. The two smaller defects

### 3.1 — Reminder email asserts the wrong signer (`app/api/cron/docusign-reminders/route.ts`)

The cron selects on envelope status only and always sends `docusignReminderToMinorEmail`,
whose copy is hard-coded to *"We haven't received a signed consent form from
**{guardianName}**"*. It never checks who is actually outstanding. In the Buk case that
happened to be true; in the mirror case (guardian signed, student hasn't) it tells a family
their parent is the holdup when the parent has already signed.

**Fix:** once §1.1 lands, read `waitingOn` from `describeEnvelope()` and branch the copy —
guardian outstanding, student outstanding, or both. Send to the outstanding **recipient**
as well as the participant (§1.5), not only to the participant.

### 3.2 — Roster pill does not name the outstanding signer (`lib/event-admin.ts:166`)

`partial` is derived from two integers and rendered as a bare "Partially Complete", so
answering a parent required a DB query and a DocuSign API call.

**Fix:** render from `describeEnvelope()`. Pill text gains the name; the row gains a
"Chase" action that resends to the outstanding recipient only.

### 3.3 — Bonus defect found while reading the cron: chasing stops after one reminder

The cron filters `.is('reminder_sent_at', null)`, and both the cron *and* the admin resend
route set `reminder_sent_at`. So **every envelope is chased at most once, ever** — and an
admin manually resending permanently removes that envelope from automated chasing. The Buk
envelope was issued 26 Aug, reminded once on 3 Sep, and would never have been chased again.

**Fix:** replace the `is null` filter with `reminder_sent_at < now() - interval '7 days'`
(or `or(reminder_sent_at.is.null,...)`), add a `reminder_count` column, and cap the number
of chases rather than allowing exactly one. Have the admin resend write a separate
`last_manual_resend_at` so a human action does not disable the automation.

---

## 4. Immediate action for the two families

Independent of everything above:

- **Buk** — Tamara (`tamarabuk7@gmail.com`) has never opened the envelope in 9 days. Leon's
  student signature is done. Confirm that address is right and monitored before resending;
  if it is wrong, the envelope needs voiding and re-issuing with a corrected guardian email.
- **Guggino** — Emily has two DocuSign emails in one inbox and has signed the student one.
  Point her at the *other* email, the one whose signature block is headed
  "Parent / Legal Guardian".

Both will need re-signing after the production cutover, so it may be worth holding the
chase until Phase C and re-issuing once from the production account.

---

## Sequencing

| Order | Work | Depends on |
|---|---|---|
| P0 | §2 Phase A — decide which prod DocuSign account | — |
| P0 | §2 Phase D1 — runtime guard | — (ship immediately, independent of promotion) |
| P1 | §2 Phase B — promotion + cutover | Phase A |
| P1 | §2 Phase C — void + re-issue 3 real envelopes | Phase B |
| P1 | §1.1–1.3 — recipient table + shared status helper (migration 148) | — |
| P2 | §3.1, §3.2, §3.3 — reminder copy, roster pill, chase cadence | §1.1–1.3 |
| P2 | §1.4–1.6 — bounce alerts, guardian emails, one-inbox trap | §1.1 |
| P3 | §2 D2–D4 — env guards for Stripe/Clerk, health route | D1 |

Migration 147 is the highest applied in prod, so the recipient table is **148**.


---

## 6. What shipped (4 Sept 2026)

Branch `feat/docusign-remediation-2026-09-04`. `npx tsc --noEmit` clean; 483 tests pass
(22 new). **Migration 148 is written but NOT applied** — apply it before deploying, or
every query selecting `reminder_count` / `docusign_envelope_recipients` fails.

### Status clarity (§1)

| File | Change |
|---|---|
| `supabase/migrations/148_…sql` | `docusign_envelope_recipients` (one row per signer, with `delivered_at` and a `status` that includes `autoresponded`); `reminder_count` + `last_manual_resend_at` on `docusign_envelopes` |
| `lib/docusign.ts` | `getEnvelopeRecipients()` returns the full signer list the webhook was already fetching and discarding; role-specific DocuSign email subjects ("PARENT/GUARDIAN signature required" vs "STUDENT signature required") |
| `lib/docusign-status.ts` | **new** — `describeEnvelope()`, the one vocabulary. Returns pill, label, `waitingOn`, `bounced`, `neverOpened` |
| `lib/docusign-recipients.ts` | **new** — sync from DocuSign, bulk load, and a first-time bounce alert to admins |
| `app/api/webhooks/docusign/route.ts` | syncs recipients on **every** event, not just `recipient-completed` |
| `lib/event-admin.ts`, `components/admin/EventRoster.tsx`, `components/admin/DocusignTable.tsx`, `components/member/DocusignsSection.tsx` | all four now render from `describeEnvelope()`; their three private vocabularies are deleted. The admin table was not even selecting the signer counts — it is now |
| `lib/email.ts`, `lib/docusign-agreements.ts` | `docusignSentToGuardianEmail` — Stellr now writes to the guardian directly at issue and chase time, instead of leaving DocuSign as their only channel |

The roster pill now reads **"Partially Complete · 1 of 2"** with **"Awaiting Tamara Buk
(parent/guardian) — never opened"** underneath.

### Both defects, plus the third (§3)

- Reminder copy is driven by `waitingOn` and branches guardian / student / both. The
  hard-coded "we haven't received a signed consent form from *{guardian}*" is gone.
- The cron now chases every 7 days up to 4 times instead of exactly once, ever.
- Both manual resend routes (admin, and the teacher's team page) write
  `last_manual_resend_at` instead of `reminder_sent_at`, so a human nudge no longer
  switches off automated chasing.
- The cron skips envelopes whose address has bounced rather than burning a chase on an
  inbox that cannot receive mail.

### Guardrails (§2 Phase D)

- `lib/env-guards.ts` — a **production** deployment pointed at the DocuSign sandbox now
  refuses to issue an envelope. Same rule available for Stripe and Clerk. Note the guard
  treats a *missing* `DOCUSIGN_BASE_PATH` as sandbox, because `lib/docusign.ts` defaults
  to demo — that gap is exactly how this could have recurred.
- `/admin` dashboard gains an **Integration environments** card; `GET
  /api/admin/health/integrations` is the scriptable form. Environment only — never a key.
- `npm run verify:prod` now states what SANDBOX *means*, and checks the volunteer template.

### Cutover tooling (§2 Phases B–C)

- `npm run docusign:templates export` / `import --apply` — verified working against the
  demo account; exports all three templates with documents inlined and prints the new
  prod GUIDs on import.
- `npm run docusign:remediate void --apply` → switch env → `reissue --apply`. Dry-run by
  default; the dry run correctly finds exactly the two real family envelopes.

### Still requires a human

1. **Decide the production DocuSign account** — nothing else can start until this is settled.
2. Run the §4a promotion in the DocuSign console (≥20 API calls → Go-Live → prod account →
   RSA keypair → re-grant JWT consent).
3. Build the **volunteer** template, which has never existed.
4. Apply migration 148, cut the env over, run the two remediation steps in order.
5. Delete Connect config `22193922` from the demo account.
6. Re-collect Bill Allen's adult agreement — it completed in the sandbox but has **no
   row in the prod DB**, so no script will find it.
