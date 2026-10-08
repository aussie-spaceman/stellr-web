# Educator PD credentials — 2026-10-07

Slug: `educator-pd`. Handover: `HANDOVER-educator-pd-2026-10-07.md`. Doc snapshot: `19I0xPHGAi58ZoeBSFRsqybKlyr3o01okjG-AKFjfDlo` (8 Oct evening; supersedes `1HA89-yb9-ota7aU8dGH_CCE52ojoYz2iYFSy452ANJQ` and `1JR5UL9CsVMuqQyg7KyGLq2OdhYs5mzMQdu1X7RnPfBE`).
PR #320 → `dev` as `8a5d818` (7 Oct); promoted in #326 (`6d71632`, 8 Oct 15:14Z, record #330), prod deployment `dpl_8EKudxtjb3rao3aBW16V2aogu4H2` READY. Migration: `20261007120000_pd_credentials.sql` — dev and prod applied (prod 7 Oct, ledger realigned). Two-page certificate: PR #341 → `dev` as `16793d5` (8 Oct 21:19Z); in open promotion #343 (another session) — **not live** at close-out.

Admin-issued educator PD credentials (`credentials.source='pd'`): hours + NGSS/Common Core on a PD certificate and a LinkedIn-ready credential page, built for Maria Gordon (8 h, STEM School).

| # | Item | State | Next | Done |
|---|---|---|---|---|
| educator-pd.1 | #320 lands on `dev` | Merged 7 Oct as `8a5d818` after CI green on `9314ed5` (e2e 75 passed, PD spec included) | — | ☑ |
| educator-pd.2 | Prod migration `20261007120000_pd_credentials` | Applied 7 Oct with David's approval (MCP + ledger realigned); read back: source CHECK has `'pd'`, `credentials_pd_shape` + `credentials_pd_once` + 5 columns present; `db:status --prod` shows it recorded | — | ☑ |
| educator-pd.3 | Promote #320 | Promoted in #326 (`6d71632`, 8 Oct); `list_deployments` by SHA: `dpl_8EKudxtjb3rao3aBW16V2aogu4H2` production READY; signed-out probes 8 Oct: `/api/admin/pd-certificate` 403, `/api/admin/events/x/pd-credentials` 401 (routes exist) | — | ☑ |
| educator-pd.4 | Issue Maria Gordon's credential | Half done (8 Oct read, prod): member created 20:38Z as teacher/adult, invite sent 20:38Z (email 1), Clerk login exists; not onboarded, no school linked; **0 PD credentials** | Admin: `colorado-space-design-challenge` → Settings → Educator PD → find Maria → 8 → Issue (email 2). Can be done before or after #343 and the re-upload: the PDF renders at download | ☐ |
| educator-pd.5 | Cowork certificate artwork | Prod has only the old one-page design at `pd-certificate/current` (8 Oct 20:41Z), which #341 no longer reads; dev has the mock-up (with green placeholders) at `pd-certificate/space/{front,back}` | After #343 is live: upload the Space front (no placeholders) + back on any Space event's panel → Position the fields → Save; then delete `pd-certificate/current` | ☐ |
| educator-pd.6 | Admin-created teacher → onboarding → LinkedIn | Unproven end to end (same gap as 15.1) | Watch Maria's account: DOB set, page made public, Add to LinkedIn link shown | ☐ |
| educator-pd.7 | LinkedIn prefill + org ID 66274777 (tracker 11.2) | Unconfirmed | Maria's (or David's own test) first add-to-profile click names Stellr Education | ☐ |
| educator-pd.8 | Standards set | **Replaced 8 Oct** by the 17 Common Core codes on the certificate back (#341; David: "keep the back as per the image provided"); `lib/pd-standards.ts` test pins the list; NGSS dropped | — (see .13 for the code spelling) | ☑ |
| educator-pd.9 | Multi-day events | `activity_date` = Sanity `date` only; `endDate` ignored | Decide whether certificates show a range; if so snapshot `endDate` too | ☐ |
| educator-pd.10 | Dev test data | Member "Maria Gordon-PDTest" (david.michael.shaw+pdmaria@gmail.com) + one PD credential left on dev | Delete when no longer useful (member hard-delete tombstones the credential) | ☐ |
| educator-pd.11 | Two guardian replies in hello@ (6 Oct: Davidson; Lily Nylund's parent) "can't open the credential" | Unanswered; likely the pre-#312 family-link issue | Owned by `credential-family-link` — reply with the new link; not this session's code | ☐ |
| educator-pd.12 | Two-page certificate + positioner + per-theme artwork (#341) | On `dev` (`16793d5`); CI green (e2e 74 passed, 1 unrelated survey flake); in open promotion #343 | Promotion #343 merges; confirm the production deployment by SHA | ☐ |
| educator-pd.13 | Back prints HSN-CED.A.3 / HSN-MG.A.3 | Official CCSS IDs are HSA-CED.A.3 / HSG-MG.A.3; app copies the back as printed | Ask the Cowork session; if the back changes, change `lib/pd-standards.ts` (and its test) in step | ☐ |
| educator-pd.14 | Positioner live preview in a real browser | Preview PDF verified by direct fetch (2 pages, fields on placeholders); the iframe was blank only in headless Chromium | David's first use of "Position the fields" on prod shows the preview | ☐ |
| educator-pd.15 | Maria's school link | Prod member has no `member_schools` row; teacher onboarding requires a school, so she adds it there | Nothing unless she never onboards; then link STEM School on her Person 360 | ☐ |
| educator-pd.16 | No e2e for artwork upload / positioner | Covered by unit tests + one manual dev run (8 Oct) | Add to `e2e/core/pd-credentials.spec.ts` if the panel changes again | ☐ |
