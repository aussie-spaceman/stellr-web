# Legacy survey import: column mapping (for David's approval)

**Status:** proposed, 2 Oct 2026. Do not run `--apply` until David approves this mapping.
**Spec:** handover §9 (`docs/survey/HANDOVER-post-event-survey-2026-10-02.md`).
**Code:** the mapping as data is `lib/survey/legacy-mapping.ts`; the importer is `scripts/survey-import-legacy.ts`.

## How it imports

- One `survey_responses` row per sheet row: `source = 'legacy_import'`, `participant_id`/`member_id`/`invitation_id` null, `legacy_ref = '<spreadsheetId>:<tab>:<sheet row>'`. Rows whose `legacy_ref` already exists are skipped, so re-runs are safe.
- `submitted_at` is the form timestamp, read in the sheet's zone (both sheets: `America/Boise`, locale en_GB). `event_year` is that timestamp's year. `event_slug` is null.
- `definition_id` points to a published placeholder definition per sheet (`legacy_2024` / `legacy_2026`, v1). It records this mapping, and its hash is checked on every run.
- Every column below is written to its own key, and to `survey_question_catalog` with `source = legacy_2024 | legacy_2026` and the column header as the label.
- **No column maps to an app question key.** The near-matches are listed as *candidates* for you to decide on.
- Scale answers keep the original label in `value_text`. They are also scored in `value_numeric`, within that legacy scale only. "N/A" and "did not use" get no score.
- Free text is kept verbatim. Legacy responses have `quote_consent` null, and the quotes and analytics code read only `source = 'app'`, so legacy text is never offered for quoting.
- The import refuses a sheet that has a column not in this mapping, so nothing is dropped silently.

### Legacy scales

| Scale | Labels → score |
|---|---|
| `agree6` | Strongly Disagree 1, Moderately Disagree 2, Slightly Disagree 3, Slightly Agree 4, Moderately Agree 5, Strongly Agree 6 |
| `compare5` | Much Less 1, Less 2, Equal 3, Greater 4, Much Greater 5, N/A null |
| `helpful4` | Not at all helpful 1, A little helpful 2, Moderately helpful 3, Very Helpful 4, I did not use this resource null |
| `extent4_2026` | Not at all 1, Slightly 2, Somewhat 3, To a great extent 4 |

## 2024: "2024 Competitions - Post Event Survey Responses"

Drive `1d-_03xH-ylnywbZ67muiyZN3wQGhXKMmvYS_JH8ZQ2Q`, tab **ALL EVENTS** (38 responses, 5–11 Apr 2024). 52 columns. The tab has no role column and no name or email columns.

| Column header | Target key | Transform | Notes |
|---|---|---|---|
| Timestamp | `submitted_at`, `event_year` | serial/date → instant (America/Boise) | |
| Which Event Did You Attend This Year? | `legacy_2024.event_attended` | text | Values are region labels ("Central [Houston TX]", "East Coast + Canada [Virtual["), not event slugs |
| At this competition I experienced or felt [Bonding with others / Positive peer influence / High Expectations / Motivation to achieve / Engaged by the activity / Responsibility for my part / Importance of planning / Decision making / interpersonal skills / Cross-cultural awareness / Conflict resolution / A sense of purpose / A sense of competence / A positive outlook on the future] (14) | `legacy_2024.felt_` + `bonding, peer_influence, high_expectations, motivation, engaged, responsibility, planning, decision_making, interpersonal, cross_cultural, conflict_resolution, purpose, competence, positive_outlook` | label → `agree6` | |
| At this competition I felt challenged to develop and/or apply my: [Creativity / Communication skills / Knowledge of facts / Comprehension of ideas / Analysis (breakdown) of ideas / Synthesis (combining) of ideas / Application of ideas to real problems / Evaluation of ideas] (8) | `legacy_2024.challenged_` + `creativity, communication, knowledge, comprehension, analysis, synthesis, application, evaluation` | label → `agree6` | Candidates: creativity → `skill_creativity`, communication → `skill_oral_comm`. Not mapped because the scale (agree) and the question differ from `extent4` |
| Because of my experience at this competition I feel that I will be more likely to: [Choose major in science and/or engineering / Choose career path/science/engineering / Participate better with teams / Write better project proposals / Become a better manager of others / Experience more academic motivation / Display personal leadership qualities / Experience higher levels of success] (8) | `legacy_2024.likely_` + `stem_major, stem_career, teamwork, proposals, managing, academic_motivation, leadership, success` | label → `agree6` | Candidate for stem_major/stem_career: `stem_intent_after`. Not mapped: this is an agree scale about change, not `likely5` intent |
| Compared with other cognitive competitions, the values of Space Design Competition to me is ____ than the other programs listed below: (Choose N/A if you have no experience with the listed program.) [Academic Decathlon / Quiz Bowl / Destination Imagination / Speech and Debate / Model United Nations / State Science Fair / Chess tournaments / History Day Competition / Robotics Competition] (9) | `legacy_2024.vs_` + `academic_decathlon, quiz_bowl, destination_imagination, speech_debate, model_un, science_fair, chess, history_day, robotics` | label → `compare5` | |
| How helpful were the following resources during the competition? [CEOs + Volunteers / Access to the Customer (Anita) / Internet search engine access / The Program Book / Red Team Reviews / Pre-recorded Technical Sessions / The Request For Proposal (RFP) document] (7) | `legacy_2024.helpful_` + `ceos_volunteers, customer, internet, program_book, red_team, tech_sessions, rfp` | label → `helpful4` | |
| Please provide feedback or suggestions for us about the catering for meals and snacks | `legacy_2024.catering_feedback` | free text | |
| Do you have any feedback about the facilities (specific to your event location)? | `legacy_2024.facilities_feedback` | free text | The South West tab words it "(BioSphere2)" (alias) |
| If you competed in previous years, how did the 2024 experience compare? What things were better, or worse? | `legacy_2024.compare_previous_years` | free text | |
| Any other feedback? | `legacy_2024.other_feedback` | free text | Candidate `improve`. Not mapped: this asks for any feedback, not one change |

**Dropped (personal data):** none. The sheet has no name, email or other identifying columns.

## 2026: "2026 Post-Event Survey (Responses)"

Drive `1HRlNIeJY0zNEO_u7b38guJIVq1Ek9J9oLAJ19G15uEU`, tab **Form responses 1** (2 responses, Feb–Mar 2026). 42 columns. The headers were read directly from the sheet on 2 Oct 2026. The form's full option lists could not be read: the Google Forms API is disabled for the service account's project. The scales below are inferred from the 2 answers.

| Column header | Target key | Transform | Notes |
|---|---|---|---|
| Timestamp | `submitted_at`, `event_year` | serial → instant (America/Boise) | |
| In what way did you participate in the event? | `legacy_2026.participation` **and** `respondent_role` | text; role: "Student" → `student`, any other label → null | Only "Student" has been seen. Other labels are kept as text and listed by the dry run |
| Please indicate your current grade level in school. | `legacy_2026.grade_level` | free text | Candidate `demo_grade`. Not mapped: free text ("12th", "Gapyear…"), not the grade vocabulary |
| How would you rate your overall experience at the Design Competition you participated in? | `legacy_2026.overall_experience` | text | Candidate **`overall_rating`**. Only "Excellent" and "Good" seen. Map only if the form's options were exactly Poor / Fair / Good / Very good / Excellent |
| If there was a facility tour at your venue (i.e. Biosphere in AZ, Museum of Flight in WA), did it enhance your learning experience and interest in the event? | `legacy_2026.facility_tour` | text | |
| Do you feel this event helped you see yourself as a successful STEM student or professional? | `legacy_2026.stem_identity` | text (Yes/No) | |
| To what extent did participating in this event help: [Improve your written communication skills? / …oral communication skills (e.g., public speaking, active listening, giving presentations)? / …interpersonal communication skills (e.g. active listening, empathy, conflict resolution)?] (3) | `legacy_2026.help_` + `written_comm, oral_comm, interpersonal_comm` | label → `extent4_2026` | Candidate oral_comm → `skill_oral_comm` |
| Did you enjoy working with your team members on the Request For Proposal (RFP)? | `legacy_2026.enjoyed_team` | text (Yes/No) | |
| Briefly describe your experience with team members. | `legacy_2026.team_experience` | free text | |
| Do you feel your team effectively collaborated and divided responsibilities? | `legacy_2026.team_collaborated` | text (Yes/No) | |
| Briefly describe how your team collaborated and divided responsibilities. | `legacy_2026.team_collaboration` | free text | |
| To what extent did participating in this event help [Collaborate effectively with others on a team project? / Communicate effectively with teammates? / Resolve conflicts constructively in a team setting? / Interact with people from diverse backgrounds?] (4) | `legacy_2026.help_` + `collaborate, communicate_team, resolve_conflict, diverse_backgrounds` | label → `extent4_2026` | Candidate collaborate → `skill_teamwork` |
| How did the event challenge you to think critically about complex issues and develop solutions? | `legacy_2026.critical_thinking` | free text | |
| To what extent did participating in this event help: [Think creatively…? / Identify key issues…? / Evaluate evidence…? / Develop and implement creative solutions…? / Locating and accessing relevant information / Analyzing and using information from multiple sources / Citing and referencing information ethically / Bounce back from setbacks and disappointments? / Adapt to unexpected changes…? / Develop a stronger sense of self-efficacy…? / Maintain a positive outlook…? / Be more adaptable and flexible…? / Effectively prioritize tasks and improve your time management skills? / Manage distractions…? / Hold yourself accountable…?] (15) | `legacy_2026.help_` + `think_creatively, identify_issues, evaluate_evidence, creative_solutions, locate_information, analyze_sources, cite_ethically, bounce_back, adapt_change, self_efficacy, positive_outlook, adaptable, time_management, manage_distractions, accountability` | label → `extent4_2026` | Candidates: think_creatively → `skill_creativity`, identify_issues → `skill_problem_solving`, bounce_back → `skill_resilience`, self_efficacy → `skill_confidence`, time_management → `skill_time_mgmt` |
| Did the competition increase your interest in STEM fields? | `legacy_2026.stem_interest_increased` | text (Yes/No) | |
| Did the interactions with professionals (college, industry etc) increase your interest in pursuing a career in STEM? | `legacy_2026.pro_interactions_career` | text (Yes/No) | Not `first_stem_pro`: that question asks something different |
| Please explain. | `legacy_2026.pro_interactions_explain` | free text | Follows the question above |
| Did the competition provide you with valuable insights into different career paths within the STEM fields? | `legacy_2026.career_insights` | text (Yes/No) | |
| Please describe how this competition may have impacted your views on STEM careers and opportunities | `legacy_2026.career_views_impact` | free text | |
| How would you rate your overall experience at the Design Competition you attended? | `legacy_2026.overall_experience_attended` | text | A second overall-rating column with no answers yet. Same candidate and condition as above |
| What were the highlights of your experience at the event you attended? | `legacy_2026.highlights` | free text | Candidate `highlight` |
| What changes would you recommend to improve the competition for future participants? | `legacy_2026.recommended_changes` | free text | Candidate `improve` (which asks for "one thing") |
| Other comments or feedback about the competition? | `legacy_2026.other_comments` | free text | |

The `extent4_2026` grids are not mapped to the app's `skills` grid for two reasons. The top label differs ("To a great extent" vs "A great deal"), and the row wording differs.

**Dropped (personal data):** none. The sheet has no name, email or other identifying columns. `grade_level` is free text and can name a school (one answer does). It is kept as an answer; say if you want it dropped.

## Decisions for David

1. **Approve the mapping as is** (everything legacy, nothing compared with app keys). Or name which candidates to promote. The strongest candidates are 2026 `overall_experience` → `overall_rating`, but only if the form's options were the five rating5 labels, and 2026 `highlights` → `highlight`.
2. **2026 overall-rating options.** Please confirm the option list of "How would you rate your overall experience…" in the 2026 form (Drive form `1RnjnD_bE5cxGXyl5aGMfuSivP8MqRvXKH9jQrJI0ABY`). Alternatively, enable the Forms API for the service account so the importer can read it.
3. **2024 South West tab.** It holds 12 more responses (Jan 2024, BioSphere2) with the same questions and no event column. Handover §9 names only ALL EVENTS. Import it too (`--tab "South West"`)?
4. **2024 respondent role.** The 2024 form has no role question. Every question is written for competitors. Set `respondent_role = 'student'` for 2024, or leave it null (the current default)?
5. **Event slugs.** 2024 region labels and the 2026 sheet (which has no event column) give no reliable `event_slug`, so it stays null. Should the 2024 region map to specific events?
6. **2026 role labels** other than "Student" (none seen yet): confirm how to map Mentor, Parent, Teacher and the others, if the form offers them.
7. **Free text from minors** is imported verbatim. It is never quotable, because legacy rows have no quote consent. Confirm this is acceptable under the Minors Agreement for internal analysis.

## Dry run (2 Oct 2026, `--offline`, nothing written)

| Source | Rows with data | Importable | Answers | Keys used / mapped | Role | Unknown scale labels |
|---|---|---|---|---|---|---|
| 2024 ALL EVENTS (Google; same result from the local XLSX via CSV) | 38 | 38 | 1,860 | 51 / 51 | null ×38 | none |
| 2024 South West (Google, not yet approved) | 12 | 12 | 576 | 50 / 51 (no event column) | null ×12 | none |
| 2026 Form responses 1 (Google) | 2 | 2 | 74 | 39 / 41 | student ×2 | none |
