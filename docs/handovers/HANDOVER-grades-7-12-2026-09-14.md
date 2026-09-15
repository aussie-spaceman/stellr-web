# HANDOVER — per-event grade bands, Colorado SDC 7–12

**Session:** 10–14 Sept 2026 · **Status: shipped and live on production; six
items open, none blocking, listed in §3**

The ask was two lines: the Colorado Space Design Challenge page should say
grades 7–12 instead of 9–12, and the flyer should be replaced. Both are done and
verified on the live site. Getting there required a schema change, because the
copy was generated from a field that could not express 7–12, and a production
migration, because the member record could not store a seventh-grader's grade.
This records what shipped, what was found on the way, and what to pick up.

Tracker (manually updated "complete" column):
https://docs.google.com/document/d/1raMkvEQiIrGqZ7TgpZ1Y-t8KrxcUr0wVTmTBw8UlUuw/edit

---

## 1. What shipped

| PR | Landed | Contents |
|---|---|---|
| [#68](https://github.com/aussie-spaceman/stellr-web/pull/68) | `dev` 10 Sept, squash `fa7a87f` | the change |
| [#69](https://github.com/aussie-spaceman/stellr-web/pull/69) | `main` 14 Sept, merge `8de8504` | the promotion (held 3 days — see §2) |

Production deployment `dpl_2CyR3rDFHdYxrZTqW6WNUkj6xkY6`. Rollback target
recorded at promotion time: `dpl_4EYu9MooXv6Uri8WR8JfaryzavtX` (`febee5b`).

### The model

`lib/grade-band.ts` is the one source for everything derived from an event's
grade range: the eligibility sentence, the metadata audience, the card pill, the
`/events` filter match, and the Grade options in the registration forms.

- `gradeLevel` (`Middle School` / `High School` / `Both`) still exists and still
  drives the HubSpot demographic. It implies 6–8 / 9–12 / 6–12.
- A document may also set `gradeMin` + `gradeMax` in Sanity. Both set = that is
  the band. Either missing = derived from `gradeLevel`, byte-identical to before.
- The Colorado document is set to `gradeLevel=Both, gradeMin=7, gradeMax=12`.
  No other event has an override.

### Registration

All three forms (individual, group, group-join) receive the band from their page
and offer exactly those grades. `inferHighSchoolGrade` → `inferStudentGrade`,
clamping into the band rather than a hard 9–12. On a band reaching below 9 the
radio reads "School Student (Grades 7–12)" instead of "High School".

### Database (both environments)

| Migration | What |
|---|---|
| `20260910140426_grade_type_add_middle_school` | `ALTER TYPE grade_type ADD VALUE grade_6/7/8 BEFORE grade_9` |
| `20260910140427_promote_grades_from_middle_school` | `CREATE OR REPLACE promote_grades()` with 6→7→8→9 |

Why: `participants.grade` is text and always accepted `"7"`, but `members.grade`
is the enum and started at `grade_9`. `normalizeGrade('7')` returned NULL, so a
seventh-grader could register, pay, and appear on the roster with no grade on
their member profile. Grade 6 went in too because "Middle School" has always
meant 6–8 and becomes reachable the moment a form offers that band.

**This made ordering matter more than usual.** After the code change
`normalizeGrade('7')` returns `'grade_7'`, which a database without the value
*rejects* — a silent gap became a failed registration if code led schema. The
migrations were applied to dev before #68 merged and to production before #69
merged. Both verified against `pg_enum` and `pg_get_functiondef`.

### Also fixed on the way

- **`/events` grade filter** compared `gradeLevel` for exact equality, which hid
  every "Both" event from *both* chips. Now matches on band overlap.
- **Grade lists** in the admin/member dropdowns (`grade_6..8` values), the
  roster spreadsheet export and Google Sheets validation (`'6'..'8'`) — so a
  middle-schooler's grade survives everywhere it is displayed or exported.

### Content (Sanity, production dataset)

- Document `a4ca243d-fc90-4726-b0ab-76dc2897fec0` patched with `ifRevisionId`.
- Flyer replaced via `scripts/upload-event-flyers.ts --only=colorado-space-design-challenge --apply`.
  New asset `file-449704caec6e8723cdf169bad42738352ddb0a93-pdf`. Against the
  previous flyer it changes exactly two things: `GRADES 9-12 → 7-12` and
  `Centennial → Highlands Ranch`. The site already said Highlands Ranch.

### Verified

- Unit: 568/568 (new `grade-band.test.ts`, `member-enums.test.ts`, extended
  `grade-logic.test.ts`, `campaign-content.test.ts`).
- Playwright against a real server with the band forced: copy, pill, filter
  chip, Grade options, radio label.
- Production after promotion: www `200`, app `307 → /sign-in`, cron guard
  `{"error":"Unauthorized"}`.
- Live page after the content step: eligibility "grades 7–12", pill "Grades
  7–12", zero occurrences of "grades 9–12", flyer asset `449704caec…` serving
  the corrected PDF, event listed under `/events?grade=Middle+School`.

---

## 2. What was found and is worth knowing

- **Vercel rate-limited the production project** on 10 Sept ("retry in 24
  hours"). The promotion PR's `verify`/`e2e` were green and GitHub would have
  allowed the merge (only those two are required), but merging would have fired
  a production build that failed, leaving `main` ahead of what was serving.
  Held three days; the merge on 14 Sept built normally. Cause: every `dev` and
  feature-branch push also builds a preview on the *production* Vercel project,
  and that day had ~15 PRs. See §3.
- **MCP `apply_migration` records its own timestamp in the ledger**, not the
  repo filename. Dev rows: `20260910225505/22`. Prod rows: `20260910230533/0740`.
  `db:status` will report the files as pending and the rows as ledger-only until
  realigned. Both files are idempotent (`IF NOT EXISTS` / `CREATE OR REPLACE`),
  so a re-run is a no-op. `psql -f <file>` uses the filename; prefer it when
  `DEV_DATABASE_URL` / `PROD_DATABASE_URL` are set — they were not in this
  worktree, which is why the MCP was used.
- **Sanity edits reach the public event page via ISR (`revalidate = 3600`)**;
  there is no on-demand revalidation route or Sanity webhook. In practice the
  Colorado change appeared within a minute, but the guarantee is an hour.
- **The E2E harness refuses a production `E2E_BASE_URL` by design** —
  correct, and it means the "verify on production" step is curl, not
  Playwright.
- **`normalizeGrade`'s reverse map** (`denormalizeGrade`) also needed 6–8; the
  regex was `grade_(9|10|11|12)`. Found by the round-trip test.
- **Playwright with `PORT=<free>` is the reliable way to browser-verify a
  worktree** when the Browser pane's dev server is bound to another checkout.
  `playwright.config.ts` starts its own server on `PORT` and tears it down.

---

## 3. Open items

None block anything. In rough priority:

1. **Realign the migration ledger on dev and prod.** Cosmetic, but every
   `db:status` run until then reports two pending files and two ledger-only
   rows, which is the confusion `CONCURRENT-SESSIONS.md` §4 exists to prevent.
   The UPDATE was classifier-blocked from the session:
   ```sql
   update supabase_migrations.schema_migrations set version='20260910140426' where name='grade_type_add_middle_school';
   update supabase_migrations.schema_migrations set version='20260910140427' where name='promote_grades_from_middle_school';
   ```
   Run against each of `DEV_DATABASE_URL` and `PROD_DATABASE_URL`, then
   `npm run db:status` / `-- --prod` should read "nothing pending".
2. **Stop `dev`/feature pushes building on the production Vercel project.**
   Project → Settings → Git: either an Ignored Build Step that exits 0 unless
   `VERCEL_GIT_COMMIT_REF == main`, or restrict production-project deployments
   to `main`. `stellr-web-dev` already has its own quota. Without this the next
   busy day hits the same 24-hour wall at promotion time.
3. **Exercise one grade-7 registration end to end on dev** and confirm
   `members.grade = 'grade_7'` and the minor-consent envelope issues. The unit
   tests prove the pieces; nothing has yet run the full path with the new enum
   value. `seed:dev` + the individual form on the dev deployment is enough.
4. **Venue name.** Site `venue` field says "STEM Academy"; the flyer says "STEM
   School" (the school is STEM School Highlands Ranch). Not asked for; one
   Sanity field if wanted.
5. **Org-wide "grades 9–12" copy** now disagrees with an event that admits 7–12:
   `content/lp/shared.ts` ("Grades 9–12" stat), `content/lp/homeschool-students.ts`,
   `app/(public)/lp/[slug]/opengraph-image.tsx` (`Grades 9–12` in the OG image).
   Landing pages, not events — a copy decision for whoever owns them.
6. **`.claude/releases/` is not gitignored** despite the `promote` skill saying
   it is. The release doc for this promotion sits untracked in the worktree.
   Add the path to `.gitignore` (or decide releases should be committed).

Also: the worktree `../stellr-web-co-grades` was this session's cwd and could
not remove itself. `git worktree remove ../stellr-web-co-grades --force` from
the main checkout. The branch `feat/co-sdc-grades-7-12` is merged and deleted
on the remote.

---

## 4. Where things are

| Thing | Location |
|---|---|
| Band logic + tests | `lib/grade-band.ts`, `lib/grade-band.test.ts` |
| Inference | `lib/grade-logic.ts` (`inferStudentGrade`, `DEFAULT_GRADE_BAND`) |
| Enum lists | `lib/member-enums.ts` (`VALID_GRADES`), `lib/registration-constants.ts` (`SCHOOL_GRADES`) |
| Sanity fields | `sanity/schemas/event.ts` (`gradeMin`, `gradeMax`, after `gradeLevel`) |
| Flyer upload | `scripts/upload-event-flyers.ts` (filename→slug map; idempotent by label) |
| Migrations | `supabase/migrations/20260910140426_*`, `20260910140427_*` |
| Release record | `.claude/releases/promote-2026-09-10.md` (untracked, in the worktree) |
| Supabase | dev `xvxlhbxtiwxpopoqjygm` · prod `hwtzpfrnksksxlwwabqz` |
| Vercel | prod project `prj_wMlZwzDocSUrQ5sFZMngrNBeoUvx` · team `team_WECtIDwkfpZrcQTnQYJVH5U6` |
