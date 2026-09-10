# HANDOVER — DocuSign: sandbox→production cutover and status overhaul

**Sessions:** 4 Sept – 9 Sept 2026 · **Status: shipped, deployed, and proven by real signing traffic**

Triggered by a parent emailing *"we signed the consent form last week, what do we have to do?"*
Answering it took a DB query plus a live DocuSign API call, and that exposed three separate
problems — one of them serious enough that none of the parental consents collected between June
and September 2026 was legally binding.

---

## 1. What was wrong

**Production was running on the DocuSign developer sandbox.** Account
`87718065-…` ("Stellr", plan `DEVCENTER_DEMO_RESTRICTED_JUNE2025`, `demo.docusign.net`). Every
executed page carried *"DEMONSTRATION DOCUMENT ONLY — PROVIDED BY DOCUSIGN ONLINE SIGNING
SERVICE"*, so no signature was binding. Proof it was production and not a dev leak: Connect config
`22193922` **inside the demo account** posted to `https://www.stellreducation.org/api/webhooks/docusign`.

`docs/GO-LIVE-CHECKLIST.md` §4 had said "❌ STILL SANDBOX" since 10 June, and
`npm run verify:prod` printed `environment: SANDBOX / DEMO` correctly the whole time. Nobody ran it.
**A stale checkbox in a doc is not a control.**

**Nothing could say *who* was outstanding.** We stored an envelope-level status plus two integers
and never recorded who each recipient was, so four surfaces each invented their own answer and
disagreed. The admin table did not even select the signer counts. None could name a person.

**Two signals were being discarded** by a recipients API call we were already making:
`autoresponded` (**the address bounced**) and the per-recipient delivered timestamp
(**never opened** vs opened-and-stalled).

**The chase was single-shot.** The cron filtered `reminder_sent_at IS NULL`, and both the cron *and*
the two manual resend routes wrote that column — so every envelope was chased **at most once, ever**,
and an admin pressing "Resend" permanently disabled automated chasing for that family.

---

## 2. Production DocuSign — current configuration

| | |
|---|---|
| Account | `743c7660-6507-4f72-9de0-239fedb50b17` (short id **254453255**), region **na4** |
| User | `76f1bab6-ba3b-4684-8350-3f971f647f17` (david.shaw@stellreducation.org) |
| Integration key | `781c3581-42e5-4084-a0ae-2e62c7922e3e` (same key as demo — go-live migrates it) |
| Templates | Minors `91c01c7d-…`, Adults `c1412e74-…`, Mentors `b3a965f6-…` |
| Connect | **`21769859`** → `https://www.stellreducation.org/api/webhooks/docusign`, JSON `restv2.1`, HMAC on, 8 events |
| Plan | Basic API Plan — **40 envelopes per MONTH**, 1 seat |

> ⚠️ **`DOCUSIGN_VOLUNTEER_TEMPLATE_ID` no longer exists — do not reintroduce it.** Volunteer is an
> event *role*; those people legally execute the **mentor** agreement.
> `createVolunteerAgreementEnvelope()` issues the mentor template with the `Mentor` role while still
> recording `envelope_type = 'volunteer'` (lib/volunteer.ts keys its in-flight check and admin panel
> off that type).

**Sandbox is fully disconnected.** Connect `22193922` was deleted on 9 Sept; the demo account has
zero configs and can no longer reach production.

---

## 3. Traps worth not rediscovering

**"Having a production account" ≠ "the integration key is promoted".** Two different things, both
called "going to prod". Worse here: the go-live *half-completed* — it ran 13 Aug 7:34pm PST, the app
showed "App is live", but the key never landed in the production account. Only DocuSign support
(case **17966611**) could finish it.

**The diagnostic that settled it.** A JWT with our key returned `no_valid_keys_or_signatures`;
**the same request with a made-up client_id returned `issuer_not_found`.** Different errors prove
the client *is* registered in production but has no RSA public key there. Use this to separate
"key missing" from "key present, keypair missing".

**RSA keypairs are per-environment and do not migrate.** The public key can be derived from the
private key already in `.env.local`:
```bash
node -e "require('dotenv').config({path:'.env.local'});const{createPublicKey}=require('crypto');console.log(createPublicKey((process.env.DOCUSIGN_PRIVATE_KEY||'').replace(/\\\\n/g,'\n')).export({type:'spki',format:'pem'}).toString())"
```
Uploading that avoids a new private key and leaves every env var untouched.

**DocuSign ACCEPTS an envelope whose `roleName` and tab labels match nothing.** It delivers the
document with the fields silently blank — no error, anywhere. This is why the volunteer tests assert
the outgoing HTTP body rather than any outcome, and why template copying beats retyping.

**The ESM/dotenv trap, again.** A static `import` of `lib/docusign` is hoisted above
`dotenv.config()`, so its module-level `ENV` captured an **empty private key**. Every DocuSign call
failed `No key provided to sign`, and the script's catch reported that as "expected for completed
envelopes" while marking DB rows voided anyway — **the DB said voided while the real envelopes were
still `sent` and signable.** Fixed with dynamic `await import()` after `dotenv.config()`.
*Always verify against DocuSign's own envelope status, never the script's own output.*

**A voided envelope used to be un-re-issuable.** `dispatchAgreement`'s duplicate-guard #1 matched
ANY row for the participant with no status filter, so once voided, no code path could replace it —
it returned early, silently. Now filters to `BLOCKING_ENVELOPE_STATUSES`.

**`vercel env pull` redacts secret values**, so no local script or CI step can audit what production
holds. Sandbox-vs-live guards must run *inside* the deployment. Run prod-targeted scripts by
prefixing env vars on the command line — `dotenv` does not override existing `process.env`, so
`.env.local` can stay pointed at the sandbox.

**Two Stellr DEMO accounts exist:** `48551704` (API `87718065-…`) is ours — app, templates,
envelopes. `49744624` (API `03c560e5-…`) is empty. Never point `.env.local` at the second.

---

## 4. What shipped

| PR | Commit | What |
|---|---|---|
| #27 | `9210339` | Recipient-level state (**migration 148**), one shared status vocabulary, guardian emails, bounce alerts, role-specific DocuSign subjects, chase cadence, sandbox guard, `/admin` health card |
| #35 | `8eb4df6` | A voided envelope must be re-issuable; remediation script's ESM/dotenv failure |
| #37 | `f6055b8` | Volunteers sign the mentor agreement; **any** failed issue alerts admins |

Key modules: `lib/docusign-status.ts` (`describeEnvelope()` — the single vocabulary),
`lib/docusign-recipients.ts` (sync + bounce alert), `lib/env-guards.ts` (sandbox refusal),
`scripts/docusign-templates.ts` (export/import), `scripts/docusign-remediate-sandbox.ts`
(void/reissue).

---

## 5. Proven end to end — with real signatures

The Buk family **fully signed the re-issued production consent form on 9 Sept**, and the whole stack
recorded it correctly:

- Envelope `completed`, `2/2` signers, `completed_at` populated
- Both recipient rows synced with per-recipient status **and delivered timestamps**
- Every field populated on the document: student name, DOB, school, state, guardian name,
  relationship, email, phone — and **no watermark**
- Connect `21769859` delivering, HMAC verifying, `recipient-completed` and `recipient-delivered`
  both flowing

The Guggino envelope is live proof of the distinction we built: Guardian **`delivered`** (opened
9 Sep 16:26, not signed), Minor **`sent` [never opened]**.

> ⚠️ Still unproven: the **registration path**. Both re-issues went through the remediation script,
> not `dispatchAgreement` from a registration route. The guardian emails, the roster pill in a
> browser, and issue-on-registration have not been exercised by a real sign-up.

---

## 6. Open items

| # | Item | Notes |
|---|---|---|
| 1 | **Guggino consent outstanding** | Guardian opened 9 Sep, never signed; student copy never opened. The cron will not chase until ~16 Sept (7 days from issue). A manual nudge is likely needed. |
| 2 | **Stripe/Clerk sandbox guards are NOT enforced** | `lib/env-guards.ts` detects all three and `/admin` reports all three, but `assertLiveCredentials()` is only *called* for DocuSign. A production deployment on `sk_test_` keys is visible but not blocked. PR #27's description over-claimed this. |
| 3 | **Bill Allen's adult agreement** | Completed in the sandbox 6 Aug with **no DB row** (issued from a dev server), so no script will find it. Must be re-collected by hand. Owner: David, offline. |
| 4 | **Sender name on parent emails** | Production account still reads "David Shaw". The "From" name comes from the **sending user's display name / branding**, not the account profile — check Admin → Users and Admin → Branding. |
| 5 | **Envelope quota headroom** | 40/month; 2 used in Sept. One 30-student group registration nearly exhausts it. Failures now alert, but there is no *proactive* threshold warning. |
| 6 | **Mentor/volunteer template has no `MentorEmail` or `EventTitle` tab** | The code sends both and DocuSign silently drops them. `MentorName` is covered by a built-in fullName tab. Content decision: does that document need the event title on it? |
| 7 | **Stale planning docs** | `docs/REC-docusign-remediation-2026-09-04.md` still reads as a forward-looking plan. A published Artifact ("DocuSign Production Cutover") is also stale — it states production cannot issue agreements, which is no longer true. |

---

## 7. If you pick this up

- `npm run verify:prod` — prints the environment and resolves every template.
- `/admin` → *Integration environments* — the only honest answer to "are we live?", because it runs
  inside the deployment.
- `npm run docusign:templates export|import --apply` — copies templates between accounts verbatim.
- `npm run docusign:remediate void|reissue --apply` — dry-run by default; void runs against the
  sandbox, reissue against production, **in that order**.
- Connect delivery logs live in DocuSign Admin → Settings → Connect → Logs, config `21769859`.
