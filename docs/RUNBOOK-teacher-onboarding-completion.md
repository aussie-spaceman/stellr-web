# Runbook — finishing teacher onboarding

**As at 13 Aug 2026.** Migration 136 is applied, PR #20 is merged, and deployment
`dpl_BGvaMotdDoEc5EWmuuJY8zPqQhW1` (commit `634c2af`) is live in production.

Three tasks remain, all outside the repo. Roughly 45 minutes total.

## Already verified — no action needed

| Check | State |
|---|---|
| `email_campaigns.delay_days`, `.sequence_key` | present |
| `email_campaign_queue` table | present, 0 rows |
| Production deploy of `634c2af` | READY |
| `CRON_SECRET` | set — `campaign-drip` will authenticate |
| `CONTACT_EMAIL` | set — staff alerts land here |
| `RESEND_API_KEY` | set |
| `NEXT_PUBLIC_APP_URL` | unset → falls back to `https://app.stellreducation.org` (correct) |
| `REGISTRATION_ALERT_EMAIL` | unset → falls back to `CONTACT_EMAIL` (fine; set it only if alerts should go elsewhere) |

**From now on, every new teacher who registers automatically gets** the account
confirmation, the `teacher` role (so the Teachers' Room opens), the Educator
tier, and a staff alert to `CONTACT_EMAIL`. The three tasks below repair the
members who registered *before* the deploy, and switch on the drip.

---

## Task 1 — backfill `member_roles` (5 min)

Seven members registered before the fix and hold no role rows, so the Teachers'
Room is currently shut to them. Source: `docs/backfill-member-roles-2026-08-13.sql`.

**Where:** Supabase dashboard → project **Stellr Registrations**
(`hwtzpfrnksksxlwwabqz`) → SQL Editor → New query.

Paste and run this as one block. It commits only if the count is right.

```sql
BEGIN;

WITH implied AS (
  SELECT m.id AS member_id, m.age_bracket, r.role
  FROM members m
  CROSS JOIN LATERAL (
    SELECT unnest(
      ARRAY['member']::text[] || CASE m.event_role::text
        WHEN 'teacher'                THEN ARRAY['teacher']
        WHEN 'participant'            THEN ARRAY['participant']
        WHEN 'school_student_manager' THEN ARRAY['student_manager','participant']
        WHEN 'mentor'                 THEN ARRAY['mentor']
        WHEN 'parent'                 THEN ARRAY['parent']
        WHEN 'volunteer'              THEN ARRAY['volunteer']
        WHEN 'donor'                  THEN ARRAY['donor_sponsor']
        ELSE ARRAY[]::text[]
      END
    ) AS role
  ) r
  WHERE m.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM member_roles mr WHERE mr.member_id = m.id)
),
allowed AS (
  SELECT DISTINCT member_id, role FROM implied
  WHERE role = ANY(CASE age_bracket::text
    WHEN 'high_school' THEN ARRAY['member','participant','student_manager']
    WHEN 'college'     THEN ARRAY['member','participant','volunteer','student_manager','mentor']
    WHEN 'adult'       THEN ARRAY['staff','coach','mentor','moderator','teacher','volunteer','donor_sponsor','parent','member']
    ELSE ARRAY['member']
  END)
)
INSERT INTO member_roles (member_id, role, scope, source)
SELECT member_id, role::member_role_type, 'global', 'backfill-2026-08-13'
FROM allowed;

SELECT count(*) AS rows_inserted, count(DISTINCT member_id) AS members
FROM member_roles WHERE source = 'backfill-2026-08-13';
```

**Expected: `rows_inserted = 13`, `members = 7`.**

- Correct → run `COMMIT;`
- Anything else → run `ROLLBACK;` and stop

Then confirm the two teachers:

```sql
SELECT m.email, string_agg(r.role::text, ', ' ORDER BY r.role::text) AS roles
FROM members m JOIN member_roles r ON r.member_id = m.id
WHERE m.email IN ('mmmatlock@wcpss.net', 'janetsplanetofficial@gmail.com')
GROUP BY m.email;
```

Both should read `member, teacher`.

**To undo:** `DELETE FROM member_roles WHERE source = 'backfill-2026-08-13';`

---

## Task 2 — build the drip in `/admin/email` (30 min)

Copy for all four emails is in `docs/teacher-drip-copy-2026-08-13.md`.
Go to **https://app.stellreducation.org/admin/email**.

### 2a. Create four templates

For each of days 2, 7, 14 and 30, use **New template**:

| Field | What to enter |
|---|---|
| **Name** | `Teacher welcome — day 2` (etc). The URL key auto-slugs from this |
| **Subject** | the subject line from the copy doc |
| **Body** | the body, in the rich-text editor |

Two things to get right in the body:

- `{{firstName}}` is a real merge field and resolves per recipient. It falls back
  to "there", so a member with no stored first name still reads correctly.
- **`{{appUrl}}` in the copy doc is NOT a merge field** — the engine will not
  resolve it and it would send literally. Replace each one with the real link:
  - `{{appUrl}}/spaces` → `https://app.stellreducation.org/spaces`
  - `{{appUrl}}/events` → `https://app.stellreducation.org/events`

### 2b. Create four campaigns

For each template, use **New campaign**:

| Field | Value |
|---|---|
| **Name** | `Teacher welcome — day 2` (etc) |
| **Template** | the matching template |
| **Trigger** | **Event-triggered** |
| **Event** | **New member joins** — `member.created` |
| **Send after** | `2`, `7`, `14`, `30` respectively |
| **Sequence** | `teacher-welcome` (same on all four) |
| **Audience** | tick **Active members only** and **Exclude minors**; select the **Educator** tier chip |

Selecting the Educator tier is what keeps the sequence off students and parents.
Leaving no tier selected sends to *everyone* who triggers `member.created`.

Before saving each, click **Preview recipients** — it shows the count after
consent suppression, so an unexpectedly large number means the tier filter did
not take.

### 2c. Test, then activate

Campaigns are created as **draft** and drafts never fire.

1. Click **Test** on each of the four and send to your own address. It arrives
   with a `[TEST]` subject prefix. Check the merge fields resolved and no
   `{{appUrl}}` survived.
2. Once all four look right, click **Activate** on all four **together**. The
   status flips draft → **scheduled**, which for an event campaign means *armed*,
   not *queued to send now*.

Activating them at different times means a teacher registering in between gets a
partial sequence.

### What then happens

A teacher completing onboarding gets the confirmation immediately, and their four
drip steps are written to `email_campaign_queue`. The `campaign-drip` cron runs
**daily at 07:30 UTC**, so each step lands at the first 07:30 UTC after its delay
elapses — a day-2 email arrives 2–3 days later, not exactly 48 hours.

Eligibility is re-checked at send time, so someone who unsubscribes in week one
stops receiving the rest.

---

## Task 3 — email the two existing teachers (10 min)

Activating the drip will **not** reach them: `member.created` fired at their
registration and the send ledger has no record to replay. There is no retro-send.

- **Michelle Matlock** — `mmmatlock@wcpss.net`, Wake STEM ECHS, registered 10 Aug
- **Janet Ivey-Duensing** — `janetsplanetofficial@gmail.com`, registered 13 Aug

Send these from your own mailbox, not the admin console. A first-teacher welcome
that is visibly a broadcast is worse than a late one. Suggested:

> Subject: Welcome to Stellr — and a question
>
> Hi Michelle,
>
> You're our first teacher to register through the new member site, which we're
> quietly pleased about. Your Educator membership is active, so the Educator Tier
> Space and the Teachers' Room are both open to you —
> https://app.stellreducation.org/spaces has the lesson plans, student worksheets
> and slide decks.
>
> One thing I should own: a gap on our side meant you never got a confirmation
> email when you signed up. That's fixed now, but you were owed one and it didn't
> arrive.
>
> If you have ten minutes, I'd genuinely like to know how the signup felt and
> what you were hoping to find. You're the first person through it, so anything
> that was confusing is worth more to us from you than from anyone else.
>
> David

**Also worth knowing:** Michelle's member record has an empty first and last name
— Clerk didn't capture one at signup. Ask for it in the reply, or set it on her
Person 360 at `/admin/members/2561d6c5-8d83-4379-bd16-87c059efc437`. Until then
her drip emails will open "Hi there," rather than "Hi Michelle,".

---

## Verification — prove it end to end (15 min, optional but recommended)

Register a throwaway teacher account in production, then check:

1. **Confirmation email** arrives within a minute, naming the Educator tier
2. **Staff alert** arrives at `CONTACT_EMAIL` with name, school, role and tier
3. **Roles** — `SELECT role FROM member_roles WHERE member_id = '<new id>';`
   returns `member` and `teacher`
4. **Spaces** — signed in as that account, `/spaces` lists **Educator Tier Space**
   and **Teachers' Room** under *Your spaces*, not *Restricted*
5. **Drip queued** — `SELECT campaign_id, due_at FROM email_campaign_queue WHERE
   member_id = '<new id>';` returns four rows with staggered dates

To test the cron without waiting a day, pull a queued row's `due_at` into the past
and invoke it:

```sql
UPDATE email_campaign_queue SET due_at = now() - interval '1 hour'
WHERE member_id = '<new id>' AND due_at = (
  SELECT min(due_at) FROM email_campaign_queue WHERE member_id = '<new id>'
);
```

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://app.stellreducation.org/api/cron/campaign-drip
```

Expect `{"due":1,"sent":1,"skipped":0,"failed":0}` and the email to arrive.

Delete the throwaway member afterwards, or the drip keeps mailing it for a month.

---

## Watch-outs

- **Resend free plan: 100 emails/day**, shared across transactional and marketing.
  Four drip steps per teacher plus a confirmation plus a staff alert is ~6 emails
  per registration. Fine at current volume; worth revisiting before any push that
  could bring in dozens of teachers in a day.
- **`CONTACT_EMAIL` was changed a day ago.** Staff alerts follow it — confirm it
  still points where you want, or set `REGISTRATION_ALERT_EMAIL` to pin them.
- **Deleting a template** a live campaign depends on makes the drip skip queued
  steps with `note = 'template missing or archived'` rather than fail loudly.
  Check `email_campaign_queue` for skipped rows if a sequence goes quiet.

## Still open (deferred, from the plan doc §3)

Tier-entitled members are not written to `community_space_members`, so the
Educator Tier Space shows `roster_active = 0` and its members are invisible to
admins and to each other. Access works; visibility doesn't. Decide whether to
materialise roster rows on tier grant or to change the member count to include
tier-entitled members.
