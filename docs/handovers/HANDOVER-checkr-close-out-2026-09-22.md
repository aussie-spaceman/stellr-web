# Handover — Checkr session close-out, 22 September 2026

**For:** the next session that touches Checkr, background checks or compliance.
**Read first:** `HANDOVER-checkr-certification-2026-09-22.md` (what was run and
what went wrong) and `docs/CHECKR-CERTIFICATION-RESULTS-2026-09-22.md` (the
evidence). This document is only the **unfinished** part, written at close-out
after reviewing the whole session.

Tabulated, tickable version:
<https://docs.google.com/document/d/1ZqwhbbnszK9mpAasFPxt2-jguD4zonPyN7HoBUmemvM/edit>

## 1. Directly asked for, not delivered

**A1 — the invitation-expiry case was never run.** I put it in the
certification plan as step 5 and assigned it to myself, then never came back to
it. `docs/CHECKR-TESTING-RUNBOOK.md` §5 lists it under the REQUIRED lifecycle
cases, and it is **absent from the results document**, so the submission
neither demonstrates nor discloses it. This is the one gap that could matter to
Checkr's reviewer.

To close it: `DELETE /v1/invitations/{id}` on a pending invitation fires
`invitation.deleted` → our `cancelled`. True `expired` needs a pending invite
to reach Checkr's 7-day expiry, so it cannot be forced today. Either way, add
the result to the results doc.

**A2 — missed-webhook recovery was never demonstrated.** `fetchStatus` polling
was exercised live on both branches (invitation and report), but every run
returned `unchanged` because the row already matched Checkr. A real "webhook
missed → Sync recovered a terminal status" (`updated: 1`) was never shown,
though I said I would drive it. Disable the staging webhook, order and complete
a candidate, press **Sync with Checkr**, and confirm both the row and an audit
line with `metadata.source = "sync"`.

**A3 — the four-surface comparison is three.** The event roster was never
checked, because the seeded candidates have no event participation and that
column derives from a participant's role for a specific event, not the member
record. Disclosed in the results doc; still not done.

## 2. Assumed done, but not

**B1 — the results document is now stale.** It was written before the video and
before adjudication existed. It does not record that a real flagged check was
adjudicated end to end: **Judge Judy, 22 Sept 19:10:34Z, `cleared`, by David
Shaw, "No issues found"**, expiry stamped to 2029-09-22. That is the strongest
evidence in the whole run and the document currently understates it.

**B2 — two writers set `expires_at`, and nobody designed that.** Judy was
adjudicated at 19:10:34 (expiry computed from `completed_at` + 3 years), and
Checkr's `report.engaged` webhook arrived at **19:10:36** — two seconds later —
setting `status = passed` and a *fresh* `expires_at` from `now` + 3 years.

Each path is individually correct. Their interaction was never considered: an
adjudication and an engagement both mean "cleared", they race, and the last
writer wins. It was harmless here because the two timestamps were seconds
apart, but a reviewer asking "which is authoritative?" has no answer in the
code. Decide the precedence, make it explicit, and add a test for
adjudicate-then-engaged.

This also explains something that looks wrong in the data: Judy's row reads
`status: passed` with `result: consider`. That is not a mapping bug — it is
Checkr's engage event, correctly mapped.

**B3 — #156 is on `dev`, not production.** The field-by-field form answers are
docs-only and ride the next promotion. `dev` is 2 ahead of `main` (#155, #156).

## 3. Blocking the submission

Both are outside the repo and neither is a code problem:

- **Account Contacts Configured** asks about the **production** Checkr
  dashboard, which has never existed for Stellr. Tell Checkr it is not
  provisioned, or provision it and set all five contacts.
- **Package Selection Logic** offers three options that all describe showing a
  package picker to a user. Stellr has none — one `CHECKR_PACKAGE_SLUG`, always.
  Ticking any option asserts something false. If Checkr treats package selection
  as required rather than descriptive, **that is a code change**, and it is the
  same single-slug limitation that made Alex Taylor's case impossible.

## 4. Things that will bite the next session

- **Mock results are not all deterministic.** Roll Tide and Samuel Adams both
  returned Clear despite being listed Consider *and* carrying the sheet's `**`
  "deterministic" marker. **Judge Judy is the only confirmed Consider.** Never
  plan a demo or narration around an unverified expected result.
- **Vito's mock SSN suspends his report ~29 seconds in**, and after that
  `POST /reports/{id}/complete` half-applies with no error: `includes_canceled`
  flips true, `status` stays `pending` for ever. Three attempts died this way.
- **The staging API key exists only in the Checkr dashboard.** Removing the
  stale vars from the prod project deleted the last stored copy.
- **Never symlink `node_modules` into a worktree.** `.gitignore` said
  `node_modules/` (directory only), so a symlink of that name was committed to
  `dev` and broke `git pull` for every existing checkout. Fixed in #147; the
  rule is now `node_modules`. Use `npm ci`, or skip it for docs-only work.
- **`dashboard.checkr-staging.com` resolves but serves a Cloudflare 530.** The
  real host is `dashboard.checkrhq-staging.net`. The wrong one was documented in
  three repo files and went into Vercel from there.

## 5. State at close

- **Production** `main` @ `5e2a021`; adjudication code and migration live;
  Checkr `unconfigured` by design.
- **Dev** has all six Checkr vars, webhook `73453daec8e3fea222337f26`, and 13
  `CHECKR TEST` members (5 with completed checks). Cleanup block is at the
  bottom of `docs/checkr-test-seed.sql` — run it **after** the submission is
  accepted, not before.
- TRACKER session 9: 9.1–9.6, 9.9, 9.10, 9.13–9.15 closed; **9.7, 9.8, 9.11,
  9.12, 9.16 open**, plus A1/A2/A3 and B1/B2 above.
