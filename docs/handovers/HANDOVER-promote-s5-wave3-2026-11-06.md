# Handover: promotion of S5 wave 3 — 2026-11-06

Tracker: `tracker/2026-11-06-promote-s5-wave3.md`. Record: `.claude/releases/promote-2026-11-06.md`. Promoted in #561 (`028bea6e`), record and sync #568 (`0e41ed15`).

## Context

The owner asked to promote everything on `dev`. It began with group invoices, the sign-in rule on the registration forms and Active CPU phase 2. `dev` moved twice while the promotion was open, adding S5 wave 3 Lanes A to D and #566. The owner chose to take it all rather than cut a separate branch.

## What changed on production

- **Code:** `028bea6e`, deployment `dpl_4wSe9VHvuNrFxXmFeW9gWGmQrW9i`. Rollback target: `dpl_8RciJSV8HTJ5fM6oYqvKqWYxtoKM` (`5386f5e7`). The migrations can stay under it.
- **Live for Stellr users, with no flag:**
  - An email or school address on file must sign in on the individual form and for a group's organiser. People an organiser enters are not asked.
  - A signed-in date of birth that differs from the account's is refused.
  - Roster changes wait 2 quiet minutes before an unpaid invoice is updated, and a refused revision replaces the invoice.
  - Prefetch is off on public pages, and public pages, Sanity reads and price caches refresh every 6 hours.
  - Links from registration pages to sign-in and member pages load the whole page (#567).
- **Live with no visible change while Stellr is the only tenant:** the Stellr-or-NULL filters, with new failure modes when their extra reads fail, listed in #563.
- **New cron:** `group-invoice-sync`, `45 9 * * *`.
- **Migrations:** `20261105190000_group_invoice_sync` before the merge. C0b `20261106070722`, `…724`, `…726`, `20261106074112` after it, about 22:05 UTC, when no query was running.
- **Stripe:** `price.created`, `price.updated`, `price.deleted` and `product.updated` added to the live endpoint.
- **`MINOR_SELF_SIGNUP_ENABLED`:** the owner read it: not set on either Vercel project, so off.

## Owner decisions in this session

- Did not waive the sign-in witnesses: asked the agent to run them.
- Added the Stripe events.
- Took Lanes A to D into the promotion.
- Merged the code first, then asked for C0b to be applied. The owner said to apply them without first reading the SQL, which was offered.
- The Nevada event no longer limits timing.

## What the witnesses found

**Signing in from a registration page crashed.** `app/(flow)/register/layout.tsx` sets `prefetchUI={false}`, and an in-app navigation keeps the same Clerk instance, so a `next/link` to any page rendering Clerk's UI threw, and "Try again" did not recover. It covered the new prompts, the join link and the links to `/account`. No test clicked these links, and CI was green throughout. The join link and `/account` links were already on `main`, so production was expected to have it before #561, though it was not clicked there. #567 made them plain `<a>`, and `test/register-links-to-clerk-ui.test.ts` holds that. It has already caught a link missed by hand.

Everything else passed by full page load: refusal with nothing written, return to the form, a different date of birth, the under-13 prompt, the scholarship link and its exemption, and the teacher's roster surviving a sign-in in another tab and a 90-second wait.

## What went wrong

- **The witness run wrote to `dev` when it was said not to.** The owner was told priced events stop before any write. That holds for the individual form, but the group invoice path carries on past a failed price lookup. It created a registration, member, Clerk user, agreements, Sheet and DocuSign demo envelopes. The database rows and Clerk user were removed and read back. See `.14`.
- **Blast radius was first stated before `dev` moved.** Each move was caught by re-reading, but the first read of CI covered a tree that no longer shipped.
- **`docs/TENANCY-S5.md` and the record said C0b was unapplied** for a short time after it landed. This close-out corrects both.

## Not verified

Rows `.3`, `.5` to `.8` and `.9` to `.12`. The first real registration, the first cron run and a typed sign-in have not happened yet, so the most important behaviour in this promotion is unproven on production.

## Witnessing mechanics

- Run on localhost against the dev project, with sessions from `@clerk/testing`. The register limiter is in-memory, so restarting the server clears it.
- Crons decline on `dev`, so `dev` proves nothing for B11 and B12.
- Use the group form's invoice path only with a plan to clean up.
