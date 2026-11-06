# Lighthouse URL list — 2026-11-05

Slug: `lighthouse-url-list`. Handover: `HANDOVER-lighthouse-url-list-2026-11-05.md`. Doc snapshot: `1jkh_-4GwZDsMfGPdF8cFP77WKJOFHPh4u0dJb_oBTkU`.
PR #539 → `dev` as `6a655b3c`; not promoted (promotion happens separately). Migration: none.

CI's `lighthouse` job now finishes and reports scores. It has the public Sanity project ID, picks its event at run time, checks each URL first, and prints scores in a `Lighthouse scores` step. Still report-only.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| lighthouse-url-list.1 | Job finishes and reports scores | Verified from the step log of run 42091473547 on `dev` (`bed84259`): 5 pages measured, `Done running autorun.`, scores printed | None | ☑ |
| lighthouse-url-list.2 | Clerk handshake token in the public report | The register page report in PR run 42043258512 held one dev-instance `__clerk_handshake` JWT: empty `__session`, anonymous `__clerk_db_jwt` valid for a year. Left in place. Reports upload on every run, kept 14 days | Owner: accept it, or take the register page's report out of the upload | ☐ |
| lighthouse-url-list.3 | Baseline before any gate | Two runs, one sample per page. All 5 pages over the 2.5 s LCP budget. Register page includes a Clerk dev redirect (about 1.7 s by Lighthouse's estimate). `_vercel/*` failures lower Best practices | Read several more `dev` runs; decide on a gate only after allowing for those two effects | ☐ |
| lighthouse-url-list.4 | Warning paths unproven in CI | Dropped-URL path seen only in a local dry run. The no-report warning in `scripts/lighthouse-summary.ts` has never run | Check the warning appears the first time a URL drops or lhci aborts | ☐ |
| lighthouse-url-list.5 | `osv-scanner` red on `dev` | 3 Medium advisories: `deepmerge` (dev, no fix), `glob` (dev), `minimatch`. Not caused by #539, which does not touch the lockfile. Not triaged here | Upgrade `glob` and `minimatch`; decide on `deepmerge` | ☐ |
