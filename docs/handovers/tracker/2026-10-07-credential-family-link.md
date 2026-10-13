# Credential family link — 2026-10-07

Slug: `credential-family-link`. Handover: `HANDOVER-credential-family-link-2026-10-07.md`. Doc snapshot: none (never made).
PR #312 → `dev` as `f6044df`; promoted in #315 (`95a5cb5`). Migration: none.

> **Rescued 13 Oct 2026.** This file and its handover were written at the 7 Oct close-out but never committed, and sat untracked in `.claude/worktrees/close-out-credential-family-link` until a worktree audit found them. They are landed as written. The States are as of 7 Oct and have not been re-checked. For row .1, the #318 promotion record (`.claude/releases/promote-2026-10-07.md`) lists `dpl_97SvPLwY1Qe72rdPdrcXtsuYjD1d` as READY and the production deployment at that time.

The "credential issued" email now links guardians to `/credentials/<number>?k=<token>`, which opens a private credential read-only for someone with no Stellr login. Before this fix, every guardian saw "This credential is private" (2 families wrote in on 6 Oct; 35 of 40 live credentials are private minor ones).

| # | Item | State | Next | Done |
|---|---|---|---|---|
| credential-family-link.1 | Family link works on prod | Production deployment `dpl_97SvPLwY1Qe72rdPdrcXtsuYjD1d` for `95a5cb5`: see the close-out report for its state. Not yet opened with a prod-minted link. Prod keys it off `SURVEY_TOKEN_SECRET`. | Resend one credential to an address you control (admin → event credentials → Resend on a test or staff credential), open the button signed out, and confirm the read-only view. | ☐ |
| credential-family-link.2 | 35 families hold the old dead-end email | Nothing resent. The per-credential Resend in admin event credentials sends the new link, under the same subject as the first email. | After .1: resend the 35 (all CO SDC, issued 6 Oct ~18:18Z), or have a bulk "resend family links" action built with a "here is a working link" subject. | ☐ |
| credential-family-link.3 | Reply to Jess Nylund (Lily) | Drafted in Gmail on the thread, cc Lily (draft `r-9016953501130390679`). Not sent. Promises new links "once that's live". | After .1 and .2 for Lily's credentials: send. | ☐ |
| credential-family-link.4 | Reply to LaResa Davidson (Brooks) | Drafted in Gmail (draft `r5262293621355939756`). Not sent. | After .1 and .2 for Brooks: send. | ☐ |
| credential-family-link.5 | Brooks's credential cannot be made public | The issued email took the `canShare: false` branch: under 13, no valid minor consent, or opted out. Not investigated. | Read `shareConsentFor` inputs for STL-2026-MNA6Z77B on prod (DOB, latest minor agreement, opt-out). If consent is simply missing, decide whether the family should be told. | ☐ |
| credential-family-link.6 | Guardian copy when sharing is blocked | Unchanged: "Making it public is covered by the Stellr consent form signed at registration — there is no separate step." This reads as reassurance when the real cause is usually missing consent. | Reword per `VOICE.md` by reason (under 13, consent missing, opted out). `canShare` already returns the reason. | ☐ |
| credential-family-link.7 | Jess's screenshot never viewed | Diagnosis inferred from the code and prod data. The Gmail connector can't download attachments. | Optional: open the attachment and confirm it shows "This credential is private". | ☐ |
| credential-family-link.8 | Session worktree cleanup | Removed 7 Oct: `git worktree remove --force` (its `.env.local` with dev keys went with it), and branch `fix/credential-family-link` deleted. `git worktree list` now shows only the close-out worktree. | — | ☑ |
