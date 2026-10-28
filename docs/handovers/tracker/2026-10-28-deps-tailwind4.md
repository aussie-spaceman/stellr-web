# Dependency upgrade, Tailwind 4, e2e hardening, promotion — 2026-10-28

Slug: `deps-tailwind4`. Handover: `HANDOVER-deps-tailwind4-2026-10-28.md`. Doc snapshot: `1fYOaQem5D6S122A8z-ywsCEsApJ9v-i2F52XFIiPIVY`.
PRs #463, #464, #465, #466 → `dev` as `5681fce1`, `2948ac1a`, `aa3c0749`, `c12aa021`; promoted in #467 (`10f85e98`), record and sync #469 (`6e66985e`). Migration: none.

Every dependency is current (`npm audit` 0, dev included), with next 16.4.2, React 19.3, Stripe SDK 23 (API `2026-09-30.endive`) and zod 4. Tailwind 4.3.3 replaces 3.4, with no visible change. The home page offers the 2027 flyer. CI no longer cancels `dev`'s running suite, and three e2e checks survive leaked survey events and streamed pages. All of it is on production as `dpl_F79QZT4vgdbYGb6zUTXHQ2XqumCN`.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| deps-tailwind4.1 | First real production Checkout on Stripe API `2026-09-30.endive` | Test mode only: payment and subscription Checkout and a Payment Link were accepted with `custom_text` (28 Oct). No production Checkout yet since `10f85e98`. The text's rendering is `website-iteration.3`. | After the first production purchase, check the session is paid in Stripe and the app marked it paid (`checkout.session.completed` handled, no runtime error). | ☐ |
| deps-tailwind4.2 | First production refund under the 45-day rule | Test mode only: an `executeRefund`-shaped refund succeeded, idempotent, `metadata.source=stellr_app`. The admin flow is `website-iteration.4`. | On the first admin cancellation with a refund, check the Stripe refund carries `source=stellr_app` and the `charge.refunded` webhook didn't double-handle it. | ☐ |
| deps-tailwind4.3 | `verify:prod` against production | Not run: `.env.local` holds test and dev credentials. | Run `npm run verify:prod` with production Stripe and DocuSign credentials (the maintainer). | ☐ |
| deps-tailwind4.4 | Signed-in pages on production under Tailwind 4 and React 19.3 | Pixel-identical on dev (member home, account, community; admin dashboard, members, surveys). Not viewed on production. | Open `app` signed in as a member and as an admin; check those six pages render with no console errors. | ☐ |
| deps-tailwind4.5 | CI no-cancel rule under load (TRACKER 13.5) | `ci.yml` merged in #466. `dev` run 40724385210 on `c12aa021` completed, but no merge has yet landed while `dev`'s suite was running. | The next time two merges into `dev` land close together, check the first push run's e2e ran to the end (`gh run view <id> --json jobs`). | ☐ |
| deps-tailwind4.6 | A newer push to an open PR can still leave an `e2e-survey-*` event | The workflow still cancels a PR's superseded run mid-suite. The DocuSign spec no longer cares. | Optional: have `e2e/global-setup.ts` remove `e2e-survey-*` events older than an hour, or remove by hand with `survey-cli.ts remove <slug>`. | ☐ |
| deps-tailwind4.7 | Local test-user password stale | `auth.setup.ts` fails locally with "Password is incorrect"; CI's secret works. | Update the test password in the main checkout's `.env.local` from where CI's value lives (the maintainer). | ☐ |
| deps-tailwind4.8 | `@anthropic-ai/sdk` 1.x | Eligible under the 7-day rule from 28 Oct. A session card was proposed (`task_1d22d7d4`). | Start the card, or upgrade pinned with `--before`. | ☐ |
| deps-tailwind4.9 | `@hookform/resolvers` 6 | 6.0.0 fails to install; 6.0.1 is eligible from about 3 Nov. | Upgrade to 6.0.1 pinned after 3 Nov. | ☐ |
| deps-tailwind4.10 | TypeScript 7 | Held: typescript-eslint's peer range is `<6.1`. | Upgrade when typescript-eslint supports it. | ☐ |
| deps-tailwind4.11 | Tailwind checks not repeated after the merge | The mobile axe baseline (20 public routes) and the cookie-banner check come from the first comparison (27 Oct), before `dev` was merged into the branch. CI's Storybook axe checks passed after the merge. | Run the mobile axe baseline against production, and open the cookie banner on a first visit. | ☐ |

## Closes

- `13.5` (TRACKER.md, "Per-ref cancel kills a running e2e on `dev`"): #466 (`c12aa021`) makes the workflow cancel only `pull_request` runs. The row was marked ☑ in `TRACKER.md` itself by #466, against the close-out rule; it is listed here as the rule asks. Behaviour under a concurrent merge is still to be seen (`.5`).
