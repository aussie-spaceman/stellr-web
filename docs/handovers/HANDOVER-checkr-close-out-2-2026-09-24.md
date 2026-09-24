# Handover — Checkr close-out (2), 24 September 2026

**Supersedes** `HANDOVER-checkr-close-out-2026-09-22.md` for the status of A1
and A2. Everything else in that document still stands; read it for the traps.

Tickable page:
<https://docs.google.com/document/d/1zCCJ5kuRpzX3jGLtBTZZwg4BdrrfMGvIbwbpbATVadc/edit>
(supersedes the 22 Sept page, `1Zqwhbbnsz…`, which shows A1/A2 as open).

## What closed

**A1 and A2 are done, and A1 earned its keep.** Running the invitation case the
certification run had skipped found a real defect: `DELETE /v1/invitations/{id}`
returned 200, **no `invitation.deleted` webhook arrived**, and the sync's
follow-up GET 404'd — which the adapter threw on. The row sat at `invited`
permanently, recoverable by neither path: precisely the failure the
reconciliation exists to prevent.

Fixed in #163 (a 404 on an invitation now maps as `invitation.deleted` does; a
404 on a *report* still throws), verified live once the deployment rate limit
cleared — Sync returned `{"scanned":2,"updated":1,"unchanged":1,"errors":[]}`,
the row moved `invited → cancelled`/`deleted`, audit tagged `source: "sync"` —
and promoted to production in `420eb46`.

That recovery is also the first real demonstration of reconciliation, so **A2
closed with it**.

**B1 closed too:** the results document had been written before the adjudication
and the reconciliation work and mentioned neither, which understated the
evidence for the submission. It now carries §3a (adjudication end to end) and
§3b (reconciliation, the defect, the recovery).

## What is still open

Unchanged from the first close-out: **A3** (event-roster surface), **B2** (the
`expires_at` precedence between adjudication and `report.engaged`, still
undefined and untested), **C1–C4** (the two unanswerable form fields and the two
undemonstrable candidates), **E1** (test data on dev).

New: **TRACKER 9.18** — a true `invitation.expired` has still never fired. It
cannot be forced through the API. Tom Brady's invitation
`f9cbddb0ed2b777b1998e96c`, issued 22 Sept, was left outstanding on purpose and
should expire around **29 September**. Do not submit his form and do not delete
his row; the E1 cleanup must wait for it.

## Two things about how this round ran

**The promotion was not this session's.** A parallel session opened #167/#168
while this one was at Step 3 of `promote`, had already applied the refunds
migration to production, and carried the Checkr fix along with its own
Stripe-refund work. This session stood down rather than open a competing PR —
two sessions both reaching Step 5 is how the #90/#94 collision happened. Check
open PRs before starting a promotion, not just `main..dev`.

What this session did contribute: `dev` was 1 behind `main` (the previous
promotion's merge commit), and syncing it (`a66ab25`) stopped that promotion
carrying a stale tree. It also checked that production `event_refunds` held no
duplicate `stripe_refund_id` before the new unique index went on — 34 rows, 3
non-null, all distinct, so it applied cleanly.

**A status line that looks like a failure and is not.** The production
deployment status for `420eb46` reads *"Canceled by Ignored Build Step"*. The
merge commit exists on both branches, so the production project receives two
webhooks and correctly skips the `dev`-ref one. The real deployment is
`dpl_DQdswuhxSe6qEbHgZaKKc8pKTrLY`, READY. Confirm through `list_deployments`
for the merge SHA, never the commit status line.
