# Educator PD credentials — 2026-10-07

Slug: `educator-pd`. Handover: `HANDOVER-educator-pd-2026-10-07.md`. Doc snapshot: `1JR5UL9CsVMuqQyg7KyGLq2OdhYs5mzMQdu1X7RnPfBE`.
PR #320 → `dev`: **open** at close-out (squash auto-merge; CI re-running on `9314ed5`); **not promoted** (#318 `ee441ad` predates it). Migration: `20261007120000_pd_credentials.sql` — dev applied, prod not.

Admin-issued educator PD credentials (`credentials.source='pd'`): hours + NGSS/Common Core on a PD certificate and a LinkedIn-ready credential page, built for Maria Gordon (8 h, STEM School).

| # | Item | State | Next | Done |
|---|---|---|---|---|
| educator-pd.1 | #320 lands on `dev` | Open; first CI run failed (e2e "Event not found" — no Sanity in CI); fix `9314ed5` pushed, CI re-running, auto-merge on | `gh pr view 320 --json state` = MERGED; if CI fails again, read the e2e step log | ☐ |
| educator-pd.2 | Prod migration `20261007120000_pd_credentials` | Applied on dev only (ledger realigned) | David applies it in `promote` **before** the code merges; read back `credentials_source_check` includes `'pd'` | ☐ |
| educator-pd.3 | Promote #320 | Not in any promotion (#318 predates it) | Next `promote`; confirm the deployment by SHA | ☐ |
| educator-pd.4 | Issue Maria Gordon's credential | Not done: no member, no credential | Prod: Add member (teacher, STEM School, invite on) → Colorado event Settings → Educator PD → 8 h; confirm event slug in Sanity first | ☐ |
| educator-pd.5 | Cowork certificate artwork | Not uploaded; certificates use the plain fallback | Upload on the panel → Preview → tune `PD_LAYOUT` in `lib/pd-certificate.ts` | ☐ |
| educator-pd.6 | Admin-created teacher → onboarding → LinkedIn | Unproven end to end (same gap as 15.1) | Watch Maria's account: DOB set, page made public, Add to LinkedIn link shown | ☐ |
| educator-pd.7 | LinkedIn prefill + org ID 66274777 (tracker 11.2) | Unconfirmed | Maria's (or David's own test) first add-to-profile click names Stellr Education | ☐ |
| educator-pd.8 | Standards set | Confirmed by David 7 Oct (NGSS SEP 1/6, ETS1; CCSS MP1/MP4, CCRA.SL.1) — in `lib/pd-standards.ts` | — | ☑ |
| educator-pd.9 | Multi-day events | `activity_date` = Sanity `date` only; `endDate` ignored | Decide whether certificates show a range; if so snapshot `endDate` too | ☐ |
| educator-pd.10 | Dev test data | Member "Maria Gordon-PDTest" (david.michael.shaw+pdmaria@gmail.com) + one PD credential left on dev | Delete when no longer useful (member hard-delete tombstones the credential) | ☐ |
| educator-pd.11 | Two guardian replies in hello@ (6 Oct: Davidson; Lily Nylund's parent) "can't open the credential" | Unanswered; likely the pre-#312 family-link issue | Owned by `credential-family-link` — reply with the new link; not this session's code | ☐ |
