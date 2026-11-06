# Active CPU phase 2: prefetch, watermark, photo removal, 6 h caches — 2026-11-06

Slug: `active-cpu-phase-2`. Handover: `HANDOVER-active-cpu-phase-2-2026-11-06.md`. Doc snapshot: `1h_6aynkWOw5xlP2iAByHzOXb5LuXA7JNzJHLiIv9Bq4`.
PR #556 → `dev` as `e866125a`; not promoted. Migration: none.

Fluid Active CPU was 3h 8m of Hobby's 4 h on 5 Nov. #556 turns off prefetch across public pages, cuts the watermark's CPU, makes a removed photo deletable from the CDN, slows the check-in poll to 10 s, and moves public pages and their data caches to 6 hours. It was reviewed for security and minors first; the decisions that came out of that are in the handover.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| active-cpu-phase-2.1 | Stripe price events on the live endpoint | Read 5 Nov: `we_1TgRgFFHHVJXH5AbM4WxtVFE` has 4 events, none for prices. The permission system refused the write on 6 Nov. Without these a price change can take about 12 h to show | David adds `price.created`, `price.updated`, `price.deleted` and `product.updated`, then reads the list back. Carries `vercel-active-cpu.3` | ☐ |
| active-cpu-phase-2.2 | Sanity publish webhook delivers | `SANITY_REVALIDATE_SECRET` exists in production. Delivery unproven: the token lacks `sanity.project.webhooks/read`, and the request records showed no calls in 12 h on 5 Nov | David checks Sanity → API → Webhooks (path `/api/webhooks/sanity`; create, update, delete), publishes a small edit and sees it at once | ☐ |
| active-cpu-phase-2.3 | #553 and #556 in production | On `dev` only. The 6 h caching in #556 depends on `.1` and `.2` | Finish `.1` and `.2`, then run `promote`. To promote sooner, first set the windows back to 1 h | ☐ |
| active-cpu-phase-2.4 | Dev deployment and live headers | `dpl_CmSBCH9yqdWuvQ8vmoSsaeW3u8mt` was BUILDING at close-out, and CI on the dev push was pending. Headers are checked on localhost only | Read the deployment state, then the `/api/img` headers on it; a repeat request should be a CDN HIT | ☐ |
| active-cpu-phase-2.5 | Photo purge works | Runbook Part C written; `vercel cache dangerously-delete --tag` never run | Run Part C on a test image after deployment; the old URL must stop returning 200 | ☐ |
| active-cpu-phase-2.6 | The meter falls | 3h 8m of 4h on 5 Nov, function about 61%, middleware about 39%. Saving estimated at about 2 min/day, not measured | 2–3 days after `.3`, read Usage → Fluid Active CPU (daily bars, Type tab). The line is 8 min/day | ☐ |
| active-cpu-phase-2.7 | Production logs in an AI tool | 12 h of request records were saved to a session scratchpad, contrary to the information security program. They hold private-link tokens in `requestPath`. Only summaries were read, none showing a tokenised path, and the file is deleted | David decides whether to log it under the program | ☐ |
| active-cpu-phase-2.8 | Separate image project (fix 7) | Not built. Needs a proven purge first; about 0.3 min/day | Decide after `.5` and `.6` | ☐ |
| active-cpu-phase-2.9 | Worktree cleanup | `../stellr-web-active-cpu-2` and `.claude/worktrees/nervous-hellman-edabb9` remain; this session can't reach the main checkout | The next `ship`, `promote` or close-out from the main checkout sweeps the first. The second is an app session's | ☐ |

## Closes

- `vercel-active-cpu.1`: #454 promoted 22 Oct; the production deployment list shows `8a61c7fe` as `dpl_DWzaggcKRpvpVuBZDkPDi2u6Wwky`.
- `vercel-active-cpu.2`: re-measured 5 Nov. `/` fell from 56 renders per 12 h to 6, but the meter stayed near the limit, so this session took the next step.
- `vercel-active-cpu.3`: carried into `active-cpu-phase-2.1`.
- `vercel-active-cpu.11`: replaced by #556 and `active-cpu-phase-2.8`. Taking marketing pages out of the proxy is ruled out (handover, "Security and minors decisions").
