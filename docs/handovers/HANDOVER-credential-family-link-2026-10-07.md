# Handover: credential family link (6–7 Oct 2026)

Tracker: `tracker/2026-10-07-credential-family-link.md` (rows `credential-family-link.1–8`).
Earlier credential work: `stellr-credentials-linkedin` (22 Sept), `HANDOVER-credentials-docusign-*` (24 Sept).

> **Rescued 13 Oct 2026.** Written at the 7 Oct close-out but never committed, so this never reached `dev`. It is landed as written and describes the state on 7 Oct. Its last bullet says the close-out PR carried the promotion record. It did not: that record was also uncommitted, and now lands as `.claude/releases/promote-2026-10-07-pr315.md`.

## Context

Two parents replied to the "credential issued" email on 6 Oct, saying the credential would not open:
- **Jess Nylund**, for Lily (Anita Gale Award for Creative Vision, CO SDC). Jess says it happens for all of Lily's awards.
- **LaResa Davidson**, for Brooks (2027 CO SDC Participant).

**Cause.** The email for a minor goes to the guardian (`ec_email` / `emergency_contact_email`). Its button linked to `/credentials/<number>`, but a private credential renders only for its owner, signed in. Everyone else gets "This credential is private … ask them to turn on sharing". Guardians have no Stellr account linked to the child (no guardian-member relation exists in the schema), so every guardian hit a dead end.
- Both students do have logins, and both credentials are private (prod read, 6 Oct).
- 35 of the 40 live credentials are private minor ones, all issued around 18:18Z on 6 Oct, so every one of those families got the same email.
- I did not open Jess's screenshot (the Gmail connector can't download attachments). The diagnosis comes from the code and the data.

**Decision.** David chose the signed link ("Build the signed-link fix and draft both replies"). He was told the trade-off: a forwarded email lets whoever receives it see the credential. That's no more than the email body already says, and nothing becomes public or indexed. He did not choose the alternative (attach the PDF instead).

## What shipped

| PR | What | State |
|---|---|---|
| #312 → `dev` `f6044df` | Family link, read-only family view, email and page copy | Promoted in #315 (`95a5cb5`), merged 7 Oct 16:50:44Z |
| #315 | Promotion, also carrying #313 and #314 (other sessions' handovers, docs only) | Merged. Production deployment `dpl_97SvPLwY1Qe72rdPdrcXtsuYjD1d`; see the tracker for its state |

**How it works** (`lib/credentials-link.ts`):
- The token is `base64url(HMAC-SHA256(secret, "stellr-credential|view|<credential id>"))`, passed as `?k=`. Nothing is stored.
- The secret is `CREDENTIAL_LINK_SECRET`, else `SURVEY_TOKEN_SECRET` (set in prod), else `ESIGN_TOKEN_SECRET` (CI). With none, the email gets the plain link.
- Changing whichever secret is in use breaks every family link already emailed. The plain page still works; a Resend issues a new link.
- Node only. The edge badge and share-card routes don't import it.

**Page** (`app/(public)/credentials/[number]/page.tsx`): a valid `k` on a private credential renders read-only, with:
- a note ("You can see it because you opened the link in Stellr's email…"),
- no Make public or LinkedIn controls,
- no `view` event recorded,
- `referrer: no-referrer` and `noindex`.

No `k`, or a wrong one: exactly as before. The private-state copy now says "If it's yours, sign in… If it's your child's, open it from the button in the email".

**Email** (`lib/email.ts` `credentialIssuedEmail`, new `viewUrl` param):
- The button carries the family link.
- Removed "Anyone with the link can check it is genuine at …", which was false while private.
- Now says the button opens it while private, asks the reader not to forward the email, tells the guardian the student can see it by signing in, and gives the plain address for checking once it's public.

**Tests:**
- `lib/credentials-link.test.ts` (6) and `lib/email-credential-templates.test.ts` (3).
- `e2e/core/credentials.spec.ts`: the family link opens read-only; a wrong token shows the private state. The spec mints the token itself, so it also pins the format.
- CI on #312: the Playwright report shows all 10 credential tests ran and passed.

## Not verified

- **Production with a real credential.** Not yet opened through a prod-minted family link. Prod is the only place that uses `SURVEY_TOKEN_SECRET` for this.
- **A family seeing the new email.** No issued email has gone out since the deploy.
- **The 35 families still have the old, dead-end email.** Nothing has been resent.

## Open items

See the tracker file. In short:
1. Prove the family link on prod.
2. Resend to the 35 families (per-credential Resend in admin event credentials, or a bulk action with a "new link" subject).
3. Send the two drafted replies once (1) holds.
4. Brooks can't make the credential public (the email took the `canShare: false` branch); the cause was not investigated.
5. The guardian copy for that branch ("covered by the consent form signed at registration — there is no separate step") is unchanged and probably misleading when consent isn't on file.

## Session notes

- Replies are drafted in Gmail on the original threads (not sent):
  - Nylund: draft `r-9016953501130390679`, cc Lily.
  - Davidson: draft `r5262293621355939756`.
  - Both promise new links "once that's live".
- I first wrote both drafts with gendered pronouns for the students, inferred from their names, then removed them. Use names, not guessed pronouns, in family emails.
- The session worktree (`.claude/worktrees/credential-family-link`, with a copied `.env.local`) and its branch were removed at close-out.
- **This close-out PR also lands the promotion record** (`.claude/releases/promote-2026-10-07.md`, promote Step 8). It branches from `main`'s merge commit and merges into `dev` with `--merge`, so one push to `dev` does both jobs.
