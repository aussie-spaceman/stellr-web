# Handover — Apollo webhook outage, fix, and reconciliation safety net

**Date:** 10 September 2026
**Status:** Webhook repaired; reconciliation live and proven in production.
**PRs:** #42 (`4c2074d`) loud failures + daily reconcile · #48 (`f68c9ae`) test-connection fix
**Supersedes nothing** — extends `HANDOVER-apollo-hubspot-2026-09-04.md`.

---

## What happened

The integration **silently dropped every Apollo engagement for five days** — 8
events, including a live reply from a prospect. It was found only because David
noticed an email in his inbox that had never become a deal.

**Root cause: Apollo's "Send webhook" action was saved with an empty request
Body, and Apollo sends *only* what is in that Body.** Each delivery therefore
arrived as a zero-byte POST, `JSON.parse('')` threw, the route answered 400, and
no deal was created. Confirmed from production logs:

```
15:03  400  [apollo-webhook] Unparseable body (0 bytes): <empty>
```

The original design assumed Apollo's Send-webhook "posts the enrolled contact
record". **It does not.** It posts the Body you build, and the `{ }` beneath the
Body box is the dynamic-variable picker.

**The diagnostic that pinpointed it was 400 vs 401.** A wrong shared secret
returns 401; Apollo showed 400, which only the JSON parse produces — proving
auth passed and the URL was right. Both workflows were **Active**, so "Active"
proves nothing about delivery.

---

## Why it stayed invisible for five days

Three things each independently hid it, and all three are now fixed or recorded:

1. The route answered **200** for "no email in payload" and for an unrecognised
   `?event=`, so a broken workflow *passed* Apollo's own Test connection.
2. Nothing alerted. The design was fire-and-forget with no reconciliation.
3. **Vercel's runtime logs are retention-limited and its 7-day grouped counts
   are heavily sampled** (36 hits on `/api/img` in a week). Absence of logs is
   **not** evidence that a request never arrived — do not conclude that.

---

## Working configuration

Both Apollo workflows, trigger → action **Send webhook**:

| Field | Value |
| --- | --- |
| Method | POST |
| URL | `https://www.stellreducation.org/api/webhooks/apollo?event=clicked` (and `?event=replied`) |
| API Authentication | None |
| Header | `x-apollo-webhook-secret: $APOLLO_WEBHOOK_SECRET` |
| Body | `{"email":"{{contact.email}}","first_name":"{{contact.first_name}}","last_name":"{{contact.last_name}}"}` |

**Apollo's "Test connection" posts the Body VERBATIM and never resolves the
variables.** Verified in production — it sent `{"email":"{{contact.email}}"}`
literally. A Body referencing the contact therefore can never produce a green
test on its own merits, so the route now answers **200 + `test:true`** when the
payload still holds `{{...}}` tokens. A payload with **no email and no tokens**
is still 422, because that is a genuine fault.

---

## The safety net

`/api/cron/apollo-reconcile`, daily at 11:00 UTC. It asks Apollo what has
engaged, asks HubSpot what already has a deal, and closes the difference using
the same decision logic as the webhook. Idempotent by construction, so on a
healthy day it writes nothing. Anything it repairs is by definition something
the webhook missed, so a non-zero result emails an alert naming the records.

Script and cron share `lib/apollo-reconcile.ts` — one implementation, not two
that drift.

**It proved itself on its first production run**, catching two further clicks
the webhook had not delivered:

```
considered 48, created 2, advanced 0, skipped 46, companiesCreated 1, failed 0
```

---

## Current state (verified 10 Sept)

```
Participant Pipeline: 48 deals — 36 Initial Interest, 12 Initial Engagement
  deals with no company:  0
  deals UNOWNED:         48/48
  deals with no amount:  48/48
  companies:             33, all 33 named after their domain
```

---

## Open items

| # | Item | Why it matters |
| --- | --- | --- |
| 1 | **The webhook's real-event delivery is still unproven.** Every deal to date came from the backfill or the reconciler; production has never completed a create *from a live Apollo call*. | A green Test connection proves the plumbing but not that variables resolve on a real event. The next genuine click settles it. Harmless either way now — the reconciler covers it within a day. |
| 2 | **The `?event=replied` workflow was never independently verified.** Only the *clicked* workflow was ever seen. | If it carries `?event=clicked`, replies would file at Initial Interest. Self-healing — the reconciler advances them within a day, since replied outranks clicked — but the stage would be wrong until then. |
| 3 | **The alert lands in `hello@stellreducation.org`, and the first one went to Trash.** Production `CONTACT_EMAIL` is `hello@`, which differs from the value in `.env.local`. | Alerting demonstrably *sends*, but if nobody reads that mailbox the safety net is silent again — which is the exact failure this all exists to prevent. |
| 4 | **`MAX_PER_RUN = 200` slices the FIRST 200 every run** (`prospects.slice(0, limit)`). | Latent. Past 200 engaged contacts, anyone beyond index 200 is never reconciled — and it would fail silently. Currently 48, so not urgent, but it will bite. |
| 5 | **All 48 deals are unowned**, and carry no amount. | They sit in the pipeline in nobody's queue, and pipeline value reads zero. Neither the webhook nor the reconciler sets an owner. |
| 6 | **All 33 companies are named after their domain** (`ops.org`, not `Omaha Public Schools`). | Apollo's *message* payload carries no organisation — `account_id` on it is the sending mailbox. Apollo's People/Accounts API does carry it; that is the enrichment path. |
| 7 | **Unresolved-token leniency.** A *real* event arriving with unsubstituted tokens now returns 200. | Deliberate, and affordable only because the reconciler exists. It is logged at warn level and repaired within a day. |
| 8 | **`scripts/probe-apollo-engagement.ts` docblock is stale** — says replies are reachable only via `emailer_message_reply_classes`, which its own run disproved. | Cosmetic; carried over from the 4 Sept close-out and still not fixed. |

### Accepted — do not re-raise

Associating a deal makes HubSpot auto-advance the contact's lifecycle stage to
`opportunity`, and lifecycle cannot move backwards. Reviewed and explicitly
accepted 4 September 2026; now applies to all 48 contacts.

---

## Traps

**Apollo silently ignores an unrecognised filter value** and returns the
unfiltered set — mostly `status: scheduled`, i.e. queued mail never sent. The
reconciler asserts `status === 'completed'` on every message and aborts if over
half a batch fails. **Never remove that guard.**

**Use `emailer_message_stats:["replied"]`, not `emailer_message_reply_classes`** —
the latter returns only *classified* replies (8 of 11 here).

**Apollo returns no pagination and no totals.** Counting requires paging.

**A newly added Vercel env var is NOT seen by the running deployment** — it is
snapshotted at build. `npx vercel redeploy <prod-url>` is required. The cron
returned 503 until then.

**A hand-pasted API key can be silently wrong.** `APOLLO_API_KEY` in Vercel gave
Apollo 401 while the identical key in `.env.local` worked. Re-set it by piping
the local value rather than retyping — Apollo keys are only 22 characters.

**Other Claude sessions work in this repo concurrently.** One switched the
working tree to `dev` mid-task, so a `git rebase` and `git push --force-with-lease`
landed there instead of the feature branch (harmless fast-forward, nothing lost).
**Assert `git branch --show-current` immediately before every git write.**

---

## Health checks

```bash
npm run verify:apollo-hubspot   # scopes + stage constants vs the live portal
npm run probe:apollo            # Apollo reachable, filters still bite
npm run backfill:apollo         # dry run; should report all-skipped
```

To exercise the reconciler on demand (writes only if there is a gap):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://www.stellreducation.org/api/cron/apollo-reconcile
```
