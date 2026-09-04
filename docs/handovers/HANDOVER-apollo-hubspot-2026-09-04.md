# Handover — Apollo → HubSpot deal + account integration

**Date:** 4 September 2026
**Status:** SHIPPED, DEPLOYED, PROD-VERIFIED. Backfill applied.
**PRs:** #25 (`eff94a7`) live webhook · #26 (`bc5b2d7`) companies + backfill

---

## What exists now

Apollo outbound engagement creates a HubSpot deal in the **Participant Pipeline**:

| Apollo trigger | Deal stage |
| --- | --- |
| Email clicked | Initial Interest (`1412578129`) |
| Email replied | Initial Engagement (`1431576456`) |

Pipeline id `922800968`. A company is resolved from the recipient's email domain
and associated to both the contact and the deal.

### Moving parts

| Piece | Where |
| --- | --- |
| Webhook receiver | `app/api/webhooks/apollo/route.ts` |
| Deal decision logic (pure, tested) | `lib/hubspot-deals.ts` |
| Company resolution | `lib/hubspot-companies.ts` |
| Apollo payload parsing | `lib/apollo-events.ts` |
| Scope + stage verifier | `npm run verify:apollo-hubspot` |
| Apollo API probe (read-only) | `npm run probe:apollo` |
| Historical backfill | `npm run backfill:apollo [-- --apply] [--limit N]` |

Two Apollo **Workflows** drive it (trigger → action "Send webhook"), each POSTing
to its own URL with header `x-apollo-webhook-secret`:

```
.../api/webhooks/apollo?event=clicked
.../api/webhooks/apollo?event=replied
```

**The `?event=` parameter is load-bearing.** Apollo's Send-webhook action posts
the enrolled *contact record*; which trigger fired is a property of the workflow,
not of the payload, so nothing in the body distinguishes a click from a reply.

### Credentials

- `HUBSPOT_ACCESS_TOKEN` — HubSpot **Service Key** `Stellr-Web-Lead-Capture`
  (id `48738803`), Development → Keys → Service Keys. Private apps are gone;
  Legacy Apps is empty. Scopes now include contacts, deals and companies R/W.
  **`crm.pipelines.deals.read` does not exist for service keys** —
  `crm.objects.deals.read` covers pipeline reads.
- `APOLLO_WEBHOOK_SECRET` — in `.env.local` **and Vercel production**.
- `APOLLO_API_KEY` — `.env.local` **only**. The running app never reads it; it is
  for the backfill scripts. Do not add it to Vercel.

---

## Result of the backfill (applied to production)

```
38 deals across 27 districts, 0 failures
   Initial Interest    27  (clicked)
   Initial Engagement  11  (replied)
38/38 deals have a company attached
```

Re-running the backfill is safe and idempotent — a verified re-run reports
`0 created, 0 advanced, 38 skipped`.

---

## Open items

| # | Item | Why it matters |
| --- | --- | --- |
| 1 | **All 38 deals are unowned** (`hubspot_owner_id` empty) | They sit in the pipeline in nobody's queue. Neither the webhook nor the backfill sets an owner. |
| 2 | **All 27 companies are named after their domain** (`ops.org`, not `Omaha Public Schools`) | Apollo's message payload carries no organisation at all — `account_id` on it is the *sending mailbox*. Cosmetic but immediately visible, and it degrades account reporting. |
| 3 | **The live create-with-company path has never run in production** | All 38 deals were written by the local backfill. Production has only ever exercised the dedupe no-op branch. The first real click is its first live exercise. |
| 4 | **The two Apollo workflows were never independently verified** | Confirmed built by the operator, not tested end to end. If one points at the wrong `?event=` value, replies file silently as Initial Interest. |
| 5 | **The backfill cannot repair an existing deal** | A deal created without a company (e.g. by the live webhook between the backfill and the #26 deploy) is skipped on re-run, so its company is never attached. There is no repair path. |
| 6 | **No alerting on failure** | A failed deal create logs `[apollo-webhook]` and returns `ok:false`; nothing notifies. Apollo sees 200 either way. |
| 7 | **Deals carry no amount** | Pipeline value reporting will read zero. |
| 8 | **`domainCache` in `lib/hubspot-companies.ts` is process-lived and never invalidated** | Low impact on short-lived serverless functions, but a stale id would survive a company merge. `resetCompanyCache()` exists as the seam. |
| 9 | **`scripts/probe-apollo-engagement.ts` docblock is stale** | It says replies "appear reachable only through `emailer_message_reply_classes`" — the probe itself disproved that. |

### Accepted, do not re-raise

Associating a deal makes HubSpot auto-advance the contact's lifecycle stage to
`opportunity`, overriding the `lead` we set, and lifecycle cannot move backwards.
Reviewed and explicitly accepted on 4 Sept 2026.

---

## Traps — read before touching this

**Apollo silently ignores an unrecognised filter value and returns the
UNFILTERED set** — which is mostly `status: "scheduled"`, i.e. queued mail never
sent. Proven: `emailer_message_stats:["totally_made_up"]` returned results
identical to no filter. A typo would invent a pipeline out of unsent email. The
backfill therefore asserts `status === 'completed'` on every message and aborts
if more than half a batch fails the check. **Never remove that guard.**

**Use `emailer_message_stats:["replied"]`, not `emailer_message_reply_classes`.**
reply_classes returns only replies that have been *classified* — 8 of 11 here.

**Apollo returns no pagination and no totals.** The envelope is
`{breadcrumbs, emailer_messages, emailer_steps, num_fetch_result}` and
`num_fetch_result` is `null`. Counting requires paging everything.

**Apollo's payload has `to_email` and a single `to_name`** (not first/last), a
`replied` boolean, and **no organisation**.

**A failed lookup must never read as "absent".** `findCompanyByDomain` originally
returned `null` both for "no such company" and "the request failed"; under write
load HubSpot rate-limited the search and duplicate companies were created. It now
returns `found | absent | error` and only `absent` authorises a create. Same
shape as a PostgREST select on a missing column reading as EMPTY.

**HubSpot's company search index lags writes (~45s).** Domains are memoised for
the life of the process so a run cannot race itself. Deals are read via the
**associations** API, never search, for the same reason.

**HubSpot company merge returns a NEW surviving id**, and both original ids stay
fetchable afterwards holding zero associations. That is the ID redirect, not a
leftover duplicate — verify a merge with the search endpoint, not by fetching
old ids.

**Vercel posted no check-run to the #26 merge commit.** Don't wait on CI to
confirm a deploy; probe the endpoint. A useful non-destructive probe: POST an
authenticated event for a contact who already has an open deal — the reply is
`action:"none"` but still carries `companyId`, proving the company code is live.
An unauthenticated POST returning **401 rather than 503** proves both that the
route is deployed and that `APOLLO_WEBHOOK_SECRET` is set in Vercel.

---

## Verify it still works

```bash
npm run verify:apollo-hubspot   # scopes + stage constants vs the live portal
npm run probe:apollo            # Apollo API reachable, filters still bite
npm run backfill:apollo         # dry run; should report all-skipped
```
