# Team profiles + balanced companies — handover (7 Oct 2026)

Replaces the per-event Google Form ("More Student Info") and hand-juggling of
students into companies.

## What was asked (David, 7 Oct 2026)

- A pre-event form every student participant receives automatically, with a
  resend button on the roster (admins + event managers), an "update your answers"
  email for returning students, and the student's answers (and how they changed)
  on their member page.
- An algorithm that builds evenly balanced companies from it.

Decisions (answers to the 16 clarifying questions):

| # | Decision |
|---|---|
| 1 | Groups of ≤ 6 stay together; larger groups split, never fewer than 3 in a company (7 → 4+3, 8 → 4+4) |
| 2 | Balance priority: age/grade > school mix > experience > skill spread > gender > leadership > ethnicity |
| 3 | Ethnicity used; admins and event managers can see it |
| 4, 6 | Every student (under-13s too), sent only once the permission form is complete |
| 5 | All competitions, no switch; student managers included |
| 7, 12 | First email, per-student resend, bulk resend, and an Email Reminders audience/template |
| 8 | Students without a submitted profile go to a pool for staff to place (with a suggestion) |
| 9 | "Previous participant" = an earlier Stellr registration in the app |
| 10 | One snapshot per event, editable until the event starts; history across events |
| 11 | Answers visible to admins and event managers |
| 13 | Hand-placed students stay put on re-run |
| 14 | Late registrants get a best-fit suggestion |
| 15 | Company membership only (no roles inside companies) |
| 16 | Emails come from David Shaw |

Questions: 10, in `lib/team-profile/questions.ts` (v1). David added teammate
requests (≤ 2 names) and STEM strengths / areas to work on (10 soft skills).

## Where it lives

- Migration `20261007213644_team_profiles.sql`: `team_profiles` (one row per
  participant: invitation + answers), `participants.company_locked`.
- `lib/team-profile/` — questions, tokens (HMAC, survey secret), store
  (eligibility, dispatch, resend, answers, member history), assign (planning,
  Auto-Assign, suggestions), vectors (answers → numbers, name matching), diff.
- `lib/company-assign.ts` — the algorithm (eta² per factor, weighted; greedy +
  local search). Tests: `lib/company-assign.test.ts`.
- Triggers: `lib/esign/completion.ts` (both signing engines),
  `lib/docusign-agreements.ts` (paperwork on file / none needed), daily cron
  `/api/cron/team-profiles` 09:45 UTC.
- UI: `/team-profile/<token>` (public, private route), roster tab
  "Team profiles" panel, account page "My Team Profiles", Email Reminders
  audience "Outstanding team profiles" + template, `{{team_profile_link}}`.

## Not done / unproven

1. **Migration: applied to dev only (8 Oct, David asked).** The ledger is
   realigned to `20261007213644`. Read back: 16 columns, RLS on, `service_role`
   read/write, 5 indexes, and `participants.company_locked` (default false).
   **Production still needs it before this code is promoted.**
2. **Exercised against the dev DB on 8 Oct**, with Nevada test students and a
   throwaway token secret local to the process; the test row was deleted
   afterwards. Results:
   - dispatch sent nothing while forms were incomplete (`waiting: 3`);
   - resend returned a 409 with the "permission form isn't complete" message;
   - no rows were created before the gate opened;
   - the minted link was stable;
   - the real `/team-profile/<token>` page showed the inline error for a
     missing answer, then submitted;
   - the row stored every answer exactly, and the planner showed `submitted`.

   **Not exercised:**
   - an actual email send: there's no `DEV_MAIL_SAFELIST` or token secret
     locally;
   - the signed-in admin panel and member page;
   - Auto-Assign writes (left alone to avoid disturbing the e2e seed event).
3. The local `.env.local` has no `SURVEY_TOKEN_SECRET` or `ESIGN_TOKEN_SECRET`,
   so links can't be minted locally without supplying one. Dev and prod on
   Vercel have them (`credential-family-link` uses `SURVEY_TOKEN_SECRET` in prod).
4. No real email seen in an inbox.
5. The copy (form, emails, template) is a draft for David's sign-off.
