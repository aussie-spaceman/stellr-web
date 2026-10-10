# Handover: Privacy Policy + Terms for the credential family link, 9 Oct 2026

Slug: `legal-credential-family-link`. Prepared in claude.ai (chat), not in a Claude Code session.
Patch: `legal-credential-family-link.patch` (delivered with this file; cut from `main` at `88fb830`).
Migration: none. Env change: none.

## Why

#312 (`f6044df`, 7 Oct, promoted) changed who can see a **private** credential. The "credential issued"
email now carries `/credentials/<number>?k=<HMAC>` (`lib/credentials-link.ts`). Anyone holding that link
can open the page read-only while it is private. For a minor the email goes to the guardian, with the
student Cc'd. Adults get it directly.

The live legal pages (Last Updated 02-Oct-2026) still describe "private" as visible only to the holder:

- Privacy §7.4: "Every credential page is private by default ... Once a page is public, anyone with the link can view it."
- Privacy §2 (under 13): "A child's credential pages always stay private while the child is under 13."
- Privacy §2 (13+): "Credential pages stay private unless the student chooses to make each one public."
- Terms §5.1: "Private until you choose."

A privacy notice that misstates who can see a child's information is the FTC/COPPA exposure, so the
text has to match the product. A related email-copy defect was found during the review (below).

## What the patch changes

### Legal pages (text only)
- **Privacy Policy** (`app/(public)/privacy/page.tsx`)
  - Last Updated → 09-Oct-2026. New "Recent update (09-Oct-2026)" banner; the 02-Oct banner becomes "Earlier update".
  - §2 under-13 bullet: private = the child signed in, plus their parent or legal guardian via the emailed link.
  - §2 "Students' own choices": a Minor's parent or legal guardian can always open their credential pages via the emailed link.
  - §3.11: opens from the emailed link are not counted.
  - §5 table: credential row now covers emailing the link, and adds the holder's or guardian's email to "Data Used".
  - §7.4: new paragraph **"Who can see a private credential page"** (holder signed in, Stellr staff, anyone with the emailed link; read-only; not listed or indexed; does not expire; don't forward; contact privacy@).
  - §7.4 Minors paragraph: a parent or guardian can always open their child's private pages from the email.
  - §12 parents: "your child under 18" → "your child who is a Minor", plus the emailed-link note.
- **Terms of Use** (`app/(public)/terms/page.tsx`)
  - Last Updated → 09-Oct-2026. New "Recent update (09-Oct-2026)" banner; the 02-Oct banner becomes "Earlier update".
  - §5.1: "For participants under 18" → "For a Minor" (matches the §4 definition). New bullet **"The link in our email"**: don't forward it or share the link; to share, make it public.

### Guardian email copy (`lib/email.ts`, `lib/credentials-notify.ts`)
For a minor whose page cannot go public, the issued email said: *"Making it public is covered by the Stellr
consent form signed at registration — there is no separate step."* That implies the page will go public.
That is false for a child under 13 (never public, per Privacy §7.4) and for a guardian who declined.

`credentialIssuedEmail` now takes `shareBlock` (from `canShare(...).reason`) and says:

| `shareBlock` | Guardian line |
|---|---|
| `under_13` | It stays private. Credential pages of children under 13 are never made public, but you and {name} can always open it. |
| `minor_declined` | It stays private, as you asked on the Stellr consent form. |
| `minor_no_consent` | It stays private for now. {name} can make it public once a parent or legal guardian has signed the Stellr consent form. |
| anything else | It stays private for now. |

Three new cases in `lib/email-credential-templates.test.ts`.

**Verified before handover (on a clone at `88fb830`):** `vitest` on `email-credential-templates`, `credentials`,
`credentials-link`: 52/52 pass. `tsc --noEmit` on the whole project is clean. **Not run:** `next build`, `lint:tokens`, e2e.

## Truthfulness gate — confirm each before merging

The new wording asserts these. Each was read from code at `88fb830`; re-check, because other sessions are active.

| # | Claim in the new text | Where to check | If false |
|---|---|---|---|
| G1 | For a **Minor**, the email goes to the parent or legal guardian | **FAILS at `88fb830`.** `lib/credentials.ts:186` sets `is_minor: isMinorOn(input.recipient.dateOfBirth)` with no `state`, so `lib/age.ts` falls back to 18. The policy's "Minor" uses the state age of majority (19 in AL and NE, 21 in MS) or a ward (Privacy §2, Terms §4). An 18-year-old Nebraska student is a Minor in the policy, but gets the email directly and is treated as an adult for public-page consent. Nebraska is an event state. Check `shareConsentFor` / `ageGate` for the same fallback. | **Preferred:** pass the recipient's state into `isMinorOn` at issue and in the live consent check, with tests for NE/AL at 18 and MS at 20, and ship it in the same promote. **Interim, if the code fix can't ship with this:** change "a Minor" to "a student under 18" in the new §7.4 and Terms §5.1 sentences only. Ask David which. |
| G2 | The student gets a copy "when we have the student's email address" | `cc: toGuardian && to.email ? [to.email] : undefined` | Edit the §7.4 sentence. |
| G3 | Read-only: no sharing controls, not indexed, no view count | `credentials/[number]/page.tsx`: `familyView` hides `CredentialActions`; `robots` noindex; `recordCredentialEvent` skipped for `familyView` | Edit §7.4 / §3.11. |
| G4 | The link does not expire | `credentialViewToken` is a bare HMAC of the credential id, with no timestamp | If expiry or per-credential revocation is added, update §7.4. |
| G5 | Stellr staff can open a private page | Admin view-as (#317), admin credential tools | — |
| G6 | Under-13 pages are never public | `canShare` → `under_13` | Must hold. Stop if not. |
| G7 | A withdrawn credential is not revealed by the link | The page returns the withdrawn shell before the `familyView` check | — |

## Steps

1. Branch from `dev`: `docs/legal-credential-family-link`. `git apply legal-credential-family-link.patch`. If it doesn't apply cleanly (someone edited the legal pages after `88fb830`), re-apply by hand from the diff, keeping their changes.
2. Run the gate (G1–G7). G1 is the only one likely to need a decision.
3. `npm run lint:tokens`, `tsc`, the three vitest files above, `next build`.
4. PR → `dev` → promote with the normal promote skill. **Publish the legal pages and the email fix in the same promote.**
5. On prod after deploy:
   - `/privacy` and `/terms` show **Last Updated: 09-Oct-2026** and the new banners. If the publish date is later, change both dates and both banners to the actual date (DD-Mon-YYYY).
   - §7.4 "Who can see a private credential page" renders, including the privacy@ link.
   - On dev, issue a credential to the under-13 seed fixture and check the email reads "never made public".
6. Add a tracker file `docs/handovers/tracker/2026-10-09-legal-credential-family-link.md`, with rows for G1 and the open items below.

## Open items — David decides, not in this patch

- **Participation Agreement V2.3 §2.5** says pages are "Private by default" and doesn't mention the emailed link. It is not contradicted for minors: the signer is the guardian who receives the link. For the next agreement revision, add one sentence matching Privacy §7.4. Do not change the signed V2.3.
- **No per-credential revocation.** A forwarded link works until the secret changes, and changing the secret breaks every link already sent. Options: add a per-credential nonce (DB column) so one link can be killed, or accept it as is. The policy text is written for the current behavior.
- **Secret coupling.** Prod signs family links with `SURVEY_TOKEN_SECRET` (`CREDENTIAL_LINK_SECRET` is unset). Rotating the survey secret silently breaks every credential link. Setting `CREDENTIAL_LINK_SECRET` now would also break every link already emailed. Recommendation: leave it, and record the coupling in `docs/ENV-MATRIX.md`.
- The two guardian emails from 6 Oct (Davidson; Lily Nylund's parent) are still unanswered. See tracker `educator-pd.11`.
- Counsel review is still outstanding for the 02-Oct legal changes. This update should go to counsel in the same review.

🤖 Prepared with Claude (claude.ai)

## Gate result (9 Oct 2026, Claude Code session)

Patch applied cleanly to `dev` at `afadc348` (includes #351). G2–G7 hold. **G1 failed**, and more widely
than stated above: the policy's "Minor" also includes anyone still enrolled in high school, so passing
the state alone would not have made it true. The patch also changed Terms §5.1 from "under 18" (true to
the code) to "a Minor". **David chose the code fix in the same promote:**

- `lib/minor-policy.ts`: the policy's definition (`isMinorPerPolicy`), moved out of `lib/survey/minor`
  so credentials can use it without the Sanity client; survey code re-exports it unchanged.
- `lib/credentials.ts`: `holderMinorFacts` (DOB, grade, age bracket, school state; member first, then
  participant) and `holderIsMinor`. Used at issue (`is_minor`), in `shareConsentFor` (fails closed on a
  read error), and for addressing the issued and revoked emails, so resends reach the guardian too.
- Tests: NE/AL at 18, MS at 20/21, an 18-year-old 12th grader, the registration state, read errors.

Open rows are in `tracker/2026-10-09-legal-credential-family-link.md`.

## Close-out (9 Oct 2026, evening)

**Shipped.** #358 squash-merged to `dev` as `b970384d` (20:20Z) and was promoted with the rest of batch 2 in
#360 (`602cf589`, 20:36Z) by another session; the legal pages and the email fix went out together, as the
handover required. CI on #358 succeeded by step: verify (typecheck, design-system lint, unit, build) and
e2e (77 passed, 1 skipped).

**Verified on prod** (22:03Z, fetched from www): `/privacy` and `/terms` both 200 with Last Updated
09-Oct-2026, both banners, the §7.4 "Who can see a private credential page" paragraph with the privacy@
link inside it, and the Terms §5.1 "The link in our email" bullet. Publish date is 9 Oct, so no date change.
The promotion record (`.claude/releases/promote-2026-10-09b.md`) checked only www/app/cron, not these pages.

**Not verified.**
- The G1 code has not been exercised on prod: no credential issued or published since, by an 18+ holder
  who is a Minor under the new rule (tracker `.1`).
- The under-13 guardian email ("never made public") was never sent, even on dev (tracker `.3`).
- `next build` was not run locally; CI's build step stands in for it.

**Biggest open item:** tracker `.4` (HIGH). A page made public before 9 Oct by someone who is a Minor only
under the new rule stays public without a guardian's consent. It needs a prod read and David's decision.

Rows: `docs/handovers/tracker/2026-10-09-legal-credential-family-link.md` (`legal-credential-family-link.1`–`.11`).
