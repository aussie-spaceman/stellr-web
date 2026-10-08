# Educator PD credentials — 2026-10-07

Slug: `educator-pd`. Handover: `HANDOVER-educator-pd-2026-10-07.md`. Doc snapshot: `1HA89-yb9-ota7aU8dGH_CCE52ojoYz2iYFSy452ANJQ` (8 Oct; supersedes `1JR5UL9CsVMuqQyg7KyGLq2OdhYs5mzMQdu1X7RnPfBE`).
PR #320 → `dev` as `8a5d818` (7 Oct); promoted in #326 (`6d71632`, 8 Oct 15:14Z, record #330), prod deployment `dpl_8EKudxtjb3rao3aBW16V2aogu4H2` READY. Migration: `20261007120000_pd_credentials.sql` — dev and prod applied (prod 7 Oct, ledger realigned).

Admin-issued educator PD credentials (`credentials.source='pd'`): hours + NGSS/Common Core on a PD certificate and a LinkedIn-ready credential page, built for Maria Gordon (8 h, STEM School).

| # | Item | State | Next | Done |
|---|---|---|---|---|
| educator-pd.1 | #320 lands on `dev` | Merged 7 Oct as `8a5d818` after CI green on `9314ed5` (e2e 75 passed, PD spec included) | — | ☑ |
| educator-pd.2 | Prod migration `20261007120000_pd_credentials` | Applied 7 Oct with David's approval (MCP + ledger realigned); read back: source CHECK has `'pd'`, `credentials_pd_shape` + `credentials_pd_once` + 5 columns present; `db:status --prod` shows it recorded | — | ☑ |
| educator-pd.3 | Promote #320 | Promoted in #326 (`6d71632`, 8 Oct); `list_deployments` by SHA: `dpl_8EKudxtjb3rao3aBW16V2aogu4H2` production READY; signed-out probes 8 Oct: `/api/admin/pd-certificate` 403, `/api/admin/events/x/pd-credentials` 401 (routes exist) | — | ☑ |
| educator-pd.4 | Issue Maria Gordon's credential | Not done (8 Oct read: prod has 0 PD credentials, no Maria Gordon member). Event confirmed in Sanity: `colorado-space-design-challenge`, 3 Oct 2026, STEM School, Highlands Ranch, Colorado (single day) | Signed in as admin: `/admin/members/new?return=/admin/competitions/colorado-space-design-challenge?tab=settings` → Maria, her email, teacher, STEM School, invite on → Educator PD → 8 → Issue | ☐ |
| educator-pd.5 | Cowork certificate artwork | Not uploaded (8 Oct: no `pd-certificate/*` object in prod storage); certificates use the plain fallback | Upload on the panel → Preview → tune `PD_LAYOUT` in `lib/pd-certificate.ts`. Issuing Maria first is fine: the PDF renders at download time, so her certificate picks up the artwork once it is uploaded | ☐ |
| educator-pd.6 | Admin-created teacher → onboarding → LinkedIn | Unproven end to end (same gap as 15.1) | Watch Maria's account: DOB set, page made public, Add to LinkedIn link shown | ☐ |
| educator-pd.7 | LinkedIn prefill + org ID 66274777 (tracker 11.2) | Unconfirmed | Maria's (or David's own test) first add-to-profile click names Stellr Education | ☐ |
| educator-pd.8 | Standards set | Confirmed by David 7 Oct (NGSS SEP 1/6, ETS1; CCSS MP1/MP4, CCRA.SL.1) — in `lib/pd-standards.ts` | — | ☑ |
| educator-pd.9 | Multi-day events | `activity_date` = Sanity `date` only; `endDate` ignored | Decide whether certificates show a range; if so snapshot `endDate` too | ☐ |
| educator-pd.10 | Dev test data | Member "Maria Gordon-PDTest" (david.michael.shaw+pdmaria@gmail.com) + one PD credential left on dev | Delete when no longer useful (member hard-delete tombstones the credential) | ☐ |
| educator-pd.11 | Two guardian replies in hello@ (6 Oct: Davidson; Lily Nylund's parent) "can't open the credential" | Unanswered; likely the pre-#312 family-link issue | Owned by `credential-family-link` — reply with the new link; not this session's code | ☐ |
