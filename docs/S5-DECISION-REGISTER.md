# S5 decision register

One list of the owner decisions that S5 wave 7 depends on, grouped by the gate each one blocks. Every entry has an id, the question in full, the safe default we recommend, the answer, and the date it was answered (or "open"). Owner questions cite these ids, and only ids that exist here.

This is a new file so that it never collides with `docs/TENANCY-S5.md`, which stays the plan of record. Decisions already written up elsewhere are linked, not copied (see [Settled elsewhere](#settled-elsewhere)). Open questions go to the owner about 5 at a time, each with its default. Tracker row `s5-programme.41` points here and stays open until batch 2 is answered.

Started 12 Nov 2026. People are named by role only: "the owner" is the programme's owner.

## How to read an entry

- **Id:** `W7-<n>`. `W7-1` to `W7-8` keep the numbers of the wave 7 plan's "Owner actions and decisions first" list, so either numbering can be cited.
- **Recommended default:** the answer we recommend. For an open entry that gates code (batch 2), it is also what each slice builds until the owner answers, and those defaults fail closed. For an entry that gates a hosted step (`W7-1` to `W7-8`, and `W7-14`), nothing happens until the owner answers: a "Yes" here is a recommendation, never a yes to act.
- **Answer:** "Approved as recommended", "Declined", or "Open", with the date.

## Gate: wave 6 on `dev` and A16 on the `dev` database

| Id | Question | Recommended default | Answer | Answered |
|---|---|---|---|---|
| W7-1 | **Wave 6 landing.** Merge the browser-install fix (#630), then the status PR (#626), Lane C (#624), Lane A (#625), then a docs PR for wave 6 Lane D. Each later PR re-syncs (update-branch, then regenerate its baselines), with no hand merges. Accept A16's migration (`20261110164339_tenant_guardian_consent`) as bundled in #625, and apply it to the `dev` database only, once #625's `db` job is green | Yes | Approved as recommended. **Done:** wave 6 landed on `dev` on 11 Nov 2026 (first the browser-install fix #630, `e5421e23`; order and commits in tracker `s5-programme.7`; Lane D as #637), and A16 was applied to the `dev` database the same day after #625's `db` job passed (`.13`). Since then, wave 6 was promoted to production in #643 (`5d18d321`) on 12 Nov 2026, with A16 applied to production first through the production migration Action (`.14`). The plan's follow-up, one check-in exercised on `dev` after the apply, is not recorded as done; it stays in wave 7's exit criteria | 11 Nov 2026 |

## Gate: any switch flip on `stellr-web-dev` (P0 to P12)

| Id | Question | Recommended default | Answer | Answered |
|---|---|---|---|---|
| W7-2 | **Dev watch-only wave.** Flip one switch at a time on `stellr-web-dev`, each with the owner's yes for that flip and a redeploy after it. Either re-grant the Vercel connector read access to the dev project only, or the owner reads and sets every dev variable personally | Yes, and re-grant access to the dev project only (production access is not needed) | Approved as recommended. The access half is tracker `s5-programme.17`, still open; until it closes, the owner reads and sets each dev variable. Each flip is logged in the tracker's "Wave 7 flip log" (row `.31`) | 11 Nov 2026 |
| W7-3 | **Event calendar.** List Stellr's event and check-in days for the next 6 weeks, each to become a 72-hour window with no dev flip and no merge on a live path | Send the dates now | **Declined.** The event calendar does not constrain wave 7, and no 72-hour no-flip or no-merge rule is to be added. Where the wave 7 plan says "not within 72 h of an event" (its preconditions, the dev switch rules, P0's blackout windows, and the gates of C20c, A10a, A10b, B22 and K4), that line does not apply | 11 Nov 2026 |
| W7-8 | **Code and CI yeses.** (a) Rate-limit problems are written to `app_errors` (O2, needed before P5). (b) The health page makes one database read to show the derivation mode (O1, needed before P3, P5 and P7). (c) `tenant-host-routing` becomes a required check inside `e2e` once it has had 3 green runs (B10r) | Yes to all three | Approved as recommended. Branch protection itself stays `verify` and `e2e`; B10r works through the `e2e` aggregator | 11 Nov 2026 |

## Gate: the canary tenant on `dev` (K3, K7a, K7b, K9)

| Id | Question | Recommended default | Answer | Answered |
|---|---|---|---|---|
| W7-4 | **Canary tenant on `dev`.** A fictitious US tenant, `dev-canary`, with synthetic people only, all of its mail going to the shared role inbox, a daily send cap, and its audit rows on `dev` accepted as permanent and disposable. Keep it on `dev` afterwards as a standing check | Yes | Approved as recommended. Whether it is kept or torn down after K9 is recorded again in D3 | 11 Nov 2026 |
| W7-5 | **Sanity development dataset (K2).** A separate `development` dataset for `dev`: the owner exports production and imports it keeping ids, points `dev` at it, adds a dev-only webhook, and confirms the production webhook fires only for production | Yes. Without it, the canary runs locally only | Approved as recommended | 11 Nov 2026 |

## Gate: the tenant database connection on `dev` (P6 to P9)

| Id | Question | Recommended default | Answer | Answered |
|---|---|---|---|---|
| W7-7 | **Pooler TLS.** The owner creates the `tenant_app_login` database login on `dev` and keeps its password, and stores the URL and the CA certificate the canary proves | Yes, using the provider's root CA if it verifies, and never a weaker `sslmode` | Approved as recommended. Which PEM is chosen is recorded in tracker `s5-programme.30` after P6. If no CA verifies, P7 to P9 stop and it comes back as a new owner decision | 11 Nov 2026 |

## Gate: guardian consent on `dev` (K0, K5, K7b, P12)

| Id | Question | Recommended default | Answer | Answered |
|---|---|---|---|---|
| W7-6 | **Consent on `dev`.** (a) Allow a document titled "DEV PLACEHOLDER – NOT A CONSENT FORM", approved on `dev` only. (b) Allow the expiry cron to run only its tenant-consent sub-job on `dev`, never the minor-account purge. (c) Let an agent age one canary consent row on the `dev` database so expiry can be tested | Yes to all three | Approved as recommended. Each hosted step still needs the owner's yes at the time it is taken (the B26a variable just before P12, the row ageing in K9). The production consent wording stays a legal item | 11 Nov 2026 |
| W7-14 | **Consent readiness and `LOADSCOPED_MODE` (tracker `s5-programme.20`).** Should the consent readiness check also require `LOADSCOPED_MODE=enforce` before `TENANT_GUARDIAN_CONSENT_ENABLED` goes on? | Yes | **Open.** What it means on `dev` in wave 7: the consent flag waits for `LOADSCOPED_MODE=enforce` by procedure (P12 runs only after P4 has soaked 72 hours). A readiness guard in code is wave 8 work, and comes before any production consent flip | open |

## Gate: A10a and A10b merging (batch 2)

Asked while A10a and A10b are in review. Until the owner answers, each slice builds the default.

| Id | Question | Recommended default | Answer | Answered |
|---|---|---|---|---|
| W7-9 | **Credential issuance for another tenant's event (A10a).** May a credential be issued for a non-Stellr event? | Refused until the tenant is the issuer | Open | open |
| W7-10 | **Wallet and public credential pages (A10a).** Which tenants' credentials may the public page, badge, preview image and wallet show? | Stellr's only | Open | open |
| W7-11 | **Held invites (A10a).** An invitation held back while a minor's guardian consent is pending: how is it released once consent is signed? | Released by a staff resend; nothing is sent automatically | Open | open |
| W7-12 | **Volunteer interest on a tenant's event (A10b).** May someone register volunteer interest on a non-Stellr event? | Refused | Open | open |
| W7-13 | **Held survey invitations (A10b).** A survey invitation held back for a consent-pending minor or their guardian: is it sent later? | Never sent for that event | Open | open |
| W7-15 | **A marketing opt-out on Stellr's host for someone another tenant also knows (A10b).** The opt-out link (`/api/email/unsubscribe?token=…`) leaves Stellr's own marketing list. A `members` row is an identity record with no tenant, and Stellr's campaigns reach every consenting member, so the route cannot tell another tenant's person from Stellr's. Since A10b, on another tenant's host the link acts on nothing. On Stellr's host, should a valid link still opt its holder out and name their address back, whoever else knows them? | Yes. The link is its holder's own, for Stellr's list. Refusing it would show "unsubscribed" while Stellr's mail kept coming, so here the closed answer is the unsafe one. With a yes, the two `stellr_to_canary` cases of `app/api/email/unsubscribe/route.ts POST` go into `TENANT_HOST_ACCEPTED` (`test/idor/tenant-host-accepted.ts`) with the owner's approval, and tenant-host leaks reach A11's 8 | Open. Until it is answered, the route keeps today's behaviour on Stellr's host, and the tenant-host baseline keeps those 2 cases as `leak`: 10 leaks, not 8 | open |

## Settled elsewhere

Linked, not copied. The wording that counts is at the link.

| Id | Decision | Where it is recorded | Answered |
|---|---|---|---|
| REF-1 | `TENANT_GUARDIAN_CONSENT_ENABLED` may go on in an environment only where Lane C's tenant-event refusals (#624) are live in that same environment | `docs/TENANCY-S5.md`, [Owner decisions for wave 7, settled 11 Nov 2026](TENANCY-S5.md#owner-decisions-for-wave-7-settled-11-nov-2026), and the A16 row of "Owner decisions wave 6 raised"; `docs/ENV-MATRIX.md`, the `TENANT_GUARDIAN_CONSENT_ENABLED` row; tracker `s5-programme.20` | 11 Nov 2026 |
| REF-2 | Threat-model rating TB3 E (age-gate bypass) moved from M to L | `docs/THREAT-MODEL.md`, TB3 E and the review log entry of 11 Nov 2026; tracker `s5-programme.19` | 11 Nov 2026 |

## Not in this register yet

- The decisions that gate a production consent flip, listed in `docs/TENANCY-S5.md` under "Owner decisions wave 6 raised" (the consent document's wording, guardian identity assurance, invitation caps, the consent window, the new wording, and the rest). They do not gate wave 7, which uses a placeholder document on `dev` only (W7-6).
- The decisions held in tracker `s5-programme.42` (B15, B5d, B20, the C0b composite foreign key, the C14 remainder), which wave 7 leaves out of scope.
- The rest of the 46 to 60 decisions across the earlier wave tables (`s5-programme.41`). Each is added here, under the gate it blocks, before it is brought to the owner.
