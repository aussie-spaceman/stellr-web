# Handover — Stripe refunds: next steps (session 12, 24 Sept 2026)

For a future session picking up after the refund work (#166, promoted #168).
What shipped and how it was verified: `HANDOVER-manual-stripe-refunds-2026-09-23.md`
and `.claude/releases/promote-2026-09-23.md`. Tracker: `TRACKER.md` Session 12.
Doc snapshot: `1vZW74d0TfmYKUfsLEVBWLwhbESEFoVk0rt_CWgHsqfI`.

## Where things stand
- Production has the Stripe check, "No refund — remove only", the `charge.refunded` handler, the
  roster line, and migration `20260923120000`.
- `charge.refunded` is subscribed in the production Stripe dashboard (24 Sept).
- Daksha Rayana was removed from Colorado on 24 Sept 15:26Z. One `event_refunds` row
  (`none`/`stripe_external`, 0 cents, `paid_cents 7500`) and no account credit.

## Code map
| Piece | File |
|---|---|
| Ask Stripe what was refunded | `lib/refunds/stripe-state.ts` (`stripeRefundState`, `isFullyRefunded`, `remainingCents`) |
| Preview for the dialog | `lib/refunds/preview.ts` (`externalRefund`) |
| Issue / skip the refund | `lib/refunds/execute.ts` (`'none'`, the external-full guard, the cap) |
| Webhook recorder | `lib/refunds/stripe-webhook.ts`, wired in `app/api/stripe/webhook/route.ts` |
| Dialog | `components/admin/DeleteEntityButton.tsx` |
| Route (400 if `'none'` has no reason) | `app/api/admin/deletion/route.ts` |
| Roster line | `lib/event-admin.ts` (`refund_detail`), `components/admin/EventRoster.tsx` |
| Tests | `lib/refunds/{execute,preview,stripe-webhook}.test.ts`, fake DB in `lib/refunds/fake-db.test-helper.ts` |

Conventions that must hold:
- Every refund the app creates in Stripe carries `metadata.source = 'stellr_app'`. The webhook skips
  those. **Any new `stripe.refunds.create` must set it**, or the webhook will also record the refund
  as an external one.
- `event_refunds.stripe_refund_id` is unique. The webhook upserts with `ignoreDuplicates`.
- "Already refunded" lookups use `.limit(1)`, never `.maybeSingle()`.

## Open items (ranked)
1. **12.2 Refund basis is the Stripe Price, not the charge.** Discounts, promotion codes and account
   credit are ignored, so credit refunds on discounted registrations are over-generous. Cash is capped
   by what Stripe has left. Fix: in `executeRefund`/`previewRefund`, when the payment is per-person,
   use `stripeState.amountCents` as `paidCents`. Keep the Price for group payments, where the charge
   covers several people.
2. **12.4 `entitlement_booking` auto-refund is unguarded** (`app/api/stripe/webhook/route.ts`, about
   L441). A retry after a successful refund hits `charge_already_refunded` → 500 → Stripe retries
   again. Wrap it, treat that error code as done, and add the `stellr_app` metadata.
3. **12.3 Approved member self-deletions issue no refund and write no audit row**
   (`app/api/admin/deletion-requests/[id]/route.ts`). This needs a policy decision from the
   maintainer first.
4. **12.1 The webhook has not been exercised live.** Resend a `charge.refunded` event from the Stripe
   dashboard, or wait for a real refund. Check the Vercel runtime logs for
   `[stripe/webhook] recorded … external refund(s)` and the roster line.
5. **12.5 Group delete asks for a refund choice even when nobody in the group paid.** Needs a
   group-level preview.
6. **12.6 A full external refund leaves the pill "paid".** This is by design; decide whether a
   "Refunded" state is wanted.
7. **12.8 No component test for the dialog.** Playwright mocking `/api/admin/refunds/preview`
   works, but needs a seed event that exists in Sanity. The seed event
   `seed-regional-challenge` 404s on the admin roster because Sanity has no document for it.
8. **12.7** The partial-refund and "No refund" paths have not been used live yet. Read the row the
   first time they are.

## Session notes
- **Production reads through the Supabase MCP:** denied by the auto-mode classifier on 23 Sept.
  Allowed on 24 Sept, for a narrow verification read after the user had acted. `apply_migration` on
  production ran after explicit in-session approval. `npm run db:status -- --prod` always works.
- **Playwright on a real event:** a run that mocked the delete API but pointed at the real Colorado
  roster was denied as modifying shared resources. Use a Sanity-backed seed event on dev.
- **`gh pr merge`** worked in this session for #166, #167, #168, #169 and #170, after the user asked
  to ship/promote.
