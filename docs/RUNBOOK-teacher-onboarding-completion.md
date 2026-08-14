# Runbook — finishing teacher onboarding

**As at 13 Aug 2026.** Migration 136 applied, PR #20 merged, commit `634c2af` live
in production.

Tasks 1 and 2 are now **done** — both were turned into repo scripts and run
against production. What remains is a review-and-arm step and the two personal
emails.

| | Task | State |
|---|---|---|
| 1 | Backfill `member_roles` | **Done** — 10 rows, 5 members, verified |
| 2 | Create the drip templates + campaigns | **Done** — 4 + 4 created as **drafts** |
| 2b | Test and activate the four campaigns | **You** — 10 min |
| 3 | Email Michelle and Janet | **You** |

---

## Why these became scripts

Two problems with the earlier hand-run instructions, both real:

- **The SQL-editor transaction didn't work.** Supabase's SQL Editor does not hold
  a transaction across separate runs, so a `BEGIN` in one execution and a
  `COMMIT` in another would not have done what the runbook claimed.
- **The row count was already stale.** The instructions said "expect 13 rows / 7
  members". By the time it ran, two of those members (`mark.shaw@neoshr.com.au`
  and `david.michael.shaw+rudi@gmail.com`) had been hard-deleted, so the correct
  answer was 10 rows / 5 members — and following the runbook would have meant
  rolling back a correct result.

Both are fixed by reading live state instead of freezing it, and by calling the
application's own code rather than reimplementing it in SQL.

`docs/backfill-member-roles-2026-08-13.sql` has been **deleted** — it carried the
stale count and duplicated the mapping. `scripts/backfill-member-roles.ts`
replaces it.

---

## Task 1 — backfill `member_roles` ✅ done

```bash
npm run backfill:member-roles            # dry run — prints, writes nothing
npm run backfill:member-roles -- --apply # writes
```

Calls the app's own `syncMemberClassificationRole`, so the rows written are
exactly the rows signup would have written, including the age-bracket filter.
Only members with **zero** role rows are touched, and the write is
insert-or-ignore, so re-running is safe.

**Result (applied 13 Aug):**

```
janetsplanetofficial@gmail.com         teacher      adult        → member, teacher
mmmatlock@wcpss.net                    teacher      adult        → member, teacher
bill.allen@stellreducation.org         teacher      adult        → member, teacher
david.michael.shaw+em@gmail.com        teacher      adult        → member, teacher
david.michael.shaw+william@gmail.com   participant  high_school  → member, participant
```

Independently verified: **0 active members now hold no roles**, and all three
real teachers read `member, teacher`. The Teachers' Room is open to them.

**To undo** (note: the sync writes `source = 'registration'`, not a backfill
marker, so target the members rather than the source):

```sql
DELETE FROM member_roles WHERE member_id IN (
  SELECT id FROM members WHERE email IN (
    'janetsplanetofficial@gmail.com', 'mmmatlock@wcpss.net',
    'bill.allen@stellreducation.org', 'david.michael.shaw+em@gmail.com',
    'david.michael.shaw+william@gmail.com'
  )
);
```

---

## Task 2 — create the drip ✅ done (as drafts)

```bash
npm run seed:teacher-drip                        # dry run — prints the plan
npm run seed:teacher-drip -- --apply             # create as drafts
npm run seed:teacher-drip -- --apply --activate  # create AND arm
```

Creates four templates and four campaigns on `member.created` at +2/+7/+14/+30
days, sequence `teacher-welcome`, audience scoped to the **Educator** tier
(active only, minors excluded). Idempotent — templates match by key, campaigns by
name, so re-running skips what exists.

Doing this in a script rather than the UI matters more than it looks:
`substituteTokens` **throws** on an unknown `{{token}}`, and it throws at *render*
time, not at save time. A single stray token typed into the editor would save
happily and then break every send for that campaign. In the script the bodies are
literal and the only token used is `{{firstName}}`.

**Result (applied 13 Aug):** all four created as **draft**. Drafts never fire —
`fireCampaignEvent` only matches `status = 'scheduled'`.

I also rendered all four through the real pipeline as a nameless member:

```
Teacher welcome — day 2    greeting "Hi there,"   link .../spaces   unresolved: none
Teacher welcome — day 7    greeting "Hi there,"   link .../events   unresolved: none
Teacher welcome — day 14   greeting "Hi there,"   link .../events   unresolved: none
Teacher welcome — day 30   greeting "Hi there,"   link .../spaces   unresolved: none
```

No unresolved tokens, real URLs, and the "there" fallback works for a member with
no stored first name.

### 2b — what you need to do (10 min)

At **app.stellreducation.org/admin/email**:

1. The four campaigns are listed as `Event: member.created +2d · teacher-welcome`
   (etc), status **draft**.
2. Click **Test** on each, send to yourself. It arrives with a `[TEST]` subject
   prefix. Read them — the copy is a starting point and is yours to change; edit
   the template in the UI if you want different wording.
3. When happy, click **Activate** on all four **together**. Status flips
   draft → **scheduled**, which for an event campaign means *armed*, not
   *sending now*.

Activating them at different times means a teacher registering in between gets a
partial sequence.

**After activation:** a teacher completing onboarding gets the confirmation
immediately and four queue rows in `email_campaign_queue`. The `campaign-drip`
cron runs **daily at 07:30 UTC**, so a "day 2" email lands 2–3 days out, not at
exactly 48 hours. Eligibility is re-checked at send time, so an unsubscribe in
week one stops the rest.

---

## Task 3 — email the two existing teachers

Activating the drip will **not** reach them: `member.created` fired at their
registration and there is no retro-send.

- **Michelle Matlock** — `mmmatlock@wcpss.net`, Wake STEM ECHS, registered 10 Aug
- **Janet Ivey-Duensing** — `janetsplanetofficial@gmail.com`, registered 13 Aug

> Michelle's member record has an **empty first and last name** — Clerk captured
> none at signup. Until it's set, her drip emails open "Hi there,". Set it on her
> Person 360: `/admin/members/2561d6c5-8d83-4379-bd16-87c059efc437`.

---

## Optional — verify end to end (15 min)

Register a throwaway teacher account in production, then check:

- Confirmation email arrives within a minute, naming the Educator tier
- Staff alert arrives at `CONTACT_EMAIL`
- `SELECT role FROM member_roles WHERE member_id = '<new id>';` → `member`, `teacher`
- `/spaces` as that account lists **Educator Tier Space** and **Teachers' Room**
  under *Your spaces*, not *Restricted*
- `email_campaign_queue` holds four rows with staggered `due_at` (only once the
  campaigns are activated)

To exercise the cron without waiting a day:

```sql
UPDATE email_campaign_queue SET due_at = now() - interval '1 hour'
WHERE member_id = '<new id>' AND due_at = (
  SELECT min(due_at) FROM email_campaign_queue WHERE member_id = '<new id>'
);
```

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://app.stellreducation.org/api/cron/campaign-drip
```

Expect `{"due":1,"sent":1,"skipped":0,"failed":0}`. Delete the throwaway member
afterwards, or the drip keeps mailing it for a month.

---

## Watch-outs

- **Resend free plan: 100 emails/day**, shared across transactional and
  marketing. ~6 emails per registration once the drip is armed. Fine now; revisit
  before any push that could bring dozens of teachers in a day.
- **`CONTACT_EMAIL` was changed a day ago.** Staff alerts follow it — confirm it
  points where you want, or set `REGISTRATION_ALERT_EMAIL` to pin them.
- **Deleting a template** a live campaign depends on makes the drip skip queued
  steps with `note = 'template missing or archived'` rather than fail loudly.
  Check `email_campaign_queue` for skipped rows if a sequence goes quiet.

## Still open — deferred

Tier-entitled members are not written to `community_space_members`, so the
Educator Tier Space shows `roster_active = 0` and its members are invisible to
admins and to each other. Access works; visibility doesn't. Decide whether to
materialise roster rows on tier grant, or to change the member count to include
tier-entitled members.
