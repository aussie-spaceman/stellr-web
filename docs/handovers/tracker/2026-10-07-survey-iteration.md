# Post-event survey iteration — 2026-10-07

Slug: `survey-iteration`. Handover: `HANDOVER-survey-iteration-2026-10-07.md`. Doc snapshot: `1JLtvjzGZugMMthX2OQlJK9Csy_bDT5lGrmc0M-IoqzQ`.
PRs #300 → `dev` as `b8e3313` and #301 as `fc5e69e`, both promoted in #305 (`8a8777f`). PRs #303 → `dev` as `b075bdb` and #308 as `7f610c4`, both promoted in #310 (`564cfc7`). Migration: `20261006182017_survey_minor_agreement_override`, applied to prod by David and in the ledger.

In production:
- **Admins can open a survey after an event**, with a per-event override that accepts minor agreements signed before V2.3. Answers given under the override are never quotable.
- **Question viewer and preview:** `/admin/surveys/questions`.
- **Member survey history.**
- **post_event v1.1 is published** (stored as version 2), and surveys that haven't started adopt the latest published version.

Colorado SDC opened 7 Oct 16:17Z on v1.1, and all 27 invitations were sent. All 7 scheduled surveys are on v1.1.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| survey-iteration.1 | A survey email seen in a real inbox | 27 CO invitations sent 7 Oct (Resend accepted all; `last_send_error` null). Nobody has looked at one. | Ask one CO mentor (or a parent) to forward theirs, or check `hello@` if any were addressed there. Check the layout and that the link opens the survey. | ☐ |
| survey-iteration.2 | First CO submission, end to end | 0 submitted as of 7 Oct 16:30Z. The admin answers page, the activity link and the account chip have never been seen with prod data. | When `submitted > 0`, open that member's admin page → Surveys → View answers. Check the activity entry links there, and that a `survey_access_log` row was written. | ☐ |
| survey-iteration.3 | CO mentors not recorded as event participants | Only 4 CO mentors have `event_participations` rows, so 4 were invited. In session I told David "29 volunteers", which was wrong (24 of those rows are the students). | David confirms who mentored at CO. Adding their `event_participations` rows (role volunteer) gets them invited at the next cron sweep, until 6 Nov. | ☐ |
| survey-iteration.4 | CO adults: none surveyed | The 28 CO registrations have no teacher email, so the adult path has 0 recipients. | Optional: if CO teachers or parents should be asked, add their emails to the registrations. They're invited at the next sweep. | ☐ |
| survey-iteration.5 | Signed-in prod check of the new admin pages | `/admin/surveys/questions`, the preview, the v1.1 labels and the member Surveys card were checked on dev (Playwright, admin). On prod, signed out only: 404 like all /admin routes. | Open `/admin/surveys/questions` and one member's admin page on prod, signed in. | ☐ |
| survey-iteration.6 | Override minors see the "may be quoted" tag | The tag shows on quotable questions for every respondent, and the student intro mentions quoting. The export excludes these answers (quote eligibility needs V2.3). | Optional: hide the tag when `quote_eligible_by_agreement` is false, in a later version. | ☐ |
| survey-iteration.7 | Late-linked `survey_submitted` can be written twice | Coalesced within one server process only. Needs two overlapping page loads for a response submitted before the account was linked. | If duplicates appear, add a unique partial index on `member_activity_log (member_id, (metadata->>'response_id')) where action = 'survey_submitted'`. | ☐ |
| survey-iteration.8 | v1 and v1.1 still carry `intro.status: "DRAFT - needs David's sign-off"` | v1.1 was copied from v1 unchanged apart from the requested edits. Not rendered anywhere. | Drop it in the next version. Same item as `post-event-survey.11`. | ☐ |
| survey-iteration.9 | Form builder (editable questions) | Not built. The viewer shows question keys, which must stay the same across versions so analytics compare. | When wanted: create draft v(n+1) from a published version, edit, validate with `normaliseDefinition`, publish. | ☐ |
| survey-iteration.10 | #300 PR body states "29 volunteers (mentor path)" | Wrong, see `.3`. The PR is merged; the body is history. | None. Recorded here and in the handover. | ☑ |
| survey-iteration.11 | Production foundation | Migration in prod ledger, columns checked. v1.1 published (`5aa8a001`, hash matches dev). #305 and #310 deployments READY, smoke checks in `.claude/releases/promote-2026-10-06c.md` and `-06d.md`. 7 `definition_upgraded` rows at 07:41Z on 7 Oct. CO `open_after_event` at 16:17Z with 27 sent. | — | ☑ |
| survey-iteration.12 | `pkill -f "next dev"` during cleanup, 6 Oct | Stopped every `next dev` on the Mac, not only this session's. | If another session's dev server died around 6 Oct 21:00Z, that's why. Restart it. | ☑ |

## Closes

None. `post-event-survey.2` (real inbox) and `.4` (budget) moved forward, but neither is closed. CO's 27 sends were under the 30/day budget and haven't been seen in an inbox. Nevada's size still needs checking.
