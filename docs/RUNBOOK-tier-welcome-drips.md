# Runbook — membership welcome emails, all tier families

**As at 14 Aug 2026.** Extends the teacher welcome sequence to the High School and
College tier families. Branch `feat/tier-welcome-drips-2026-08-14`, stacked on
`feat/teacher-onboarding-2026-08-13` (which is **not merged**).

Every new member now gets the same four-email shape, with copy written for their
tier family:

| # | Email | Type | Timing | Where it lives |
|---|---|---|---|---|
| 1 | Membership is active | **Transactional** | immediate | `lib/registration-notify.ts` (code) |
| 2 | How Competitions work | Marketing | +5 days | `email_templates` row, seeded |
| 3 | The Community | Marketing | +14 days | `email_templates` row, seeded |
| 4 | The Academy / upgrading | Marketing | +23 days | `email_templates` row, seeded |

Three families, from `lib/tiers.ts` `TIER_GROUPS`:

| Family | Tiers | Sequence key |
|---|---|---|
| Teacher | Educator, Catalyst, Innovator, Trailblazer | `teacher-welcome` |
| High School | Explorer, Pathfinder, Scholar | `high-school-welcome` |
| College | Alumni, Contributor, Counselor | `college-welcome` |

---

## Two things to decide before anything is armed

### 1. Do we market to under-18s? ⚠️ Blocking for the High School family

`lib/email-campaigns.ts` carries an explicit design decision:

```ts
const MINOR_AGE_BRACKET = 'high_school' // school students are minors — never marketed to
```

Every existing campaign sets `excludeMinors: true`, which drops anyone whose
`age_bracket` is `high_school`. A High School marketing drip cannot exist under
that rule: the audience resolves to **zero recipients and sends nothing, with no
error**. So `scripts/seed-welcome-drips.ts` sets `excludeMinors: false` for that
family and only that family, and the script prints a warning when it does.

That flip reverses a deliberate policy, so it is yours to confirm, not mine.
Relevant facts as they actually stand in the system:

- The High School tiers are 9th–12th grade, so **COPPA (under 13) does not
  normally apply** — but nothing in the schema enforces a floor. `date_of_birth`
  exists on `members` but there is no minimum-age check on the drip.
- **There is no parent/guardian email on the `members` table.** `ec_email` is an
  emergency contact, not a marketing consent contact. Routing the High School
  drip to a guardian instead of the student is *not* possible today; it would
  need a schema change and a capture point at registration.
- `marketing_consent` defaults to **true** at registration (migration 022), so
  a student is opted in unless they unsubscribe. That default was set before
  minors were ever in a marketing audience.
- Emails 2 and 3 sell nothing. **Email 4 mentions money** (Academy sessions,
  upgrading to Pathfinder/Scholar) — the draft tells the reader to check with a
  parent or guardian first and points at the scholarship, but if the answer is
  "no commercial messaging to minors at all", email 4 is the one to cut.

Options, briefly: arm all three emails as drafted; arm 2 and 3 and drop 4; or hold
the whole High School family until a guardian-email capture exists. The Teacher
and College families are unaffected either way and can be armed on their own with
`--family=teacher` / `--family=college`.

### 2. The teacher sequence in production is stale

Production currently holds **four** teacher campaigns at +2/+7/+14/+30 days, all
`draft`, carrying superseded copy. The current repo has **three** at +5/+14/+23
with your revised wording. Running the seed script updates the three and
**archives the four stale ones**, which is the intended outcome — but it is a
write to production campaigns, so know it is coming.

---

## Deploy

1. **Merge the stack.** `feat/teacher-onboarding-2026-08-13` first, then this
   branch. Migration 136 is already applied in production; nothing new is needed.
2. **Deploy** — push to `main` auto-deploys via Vercel (~4 min). Email 1's new
   per-family copy ships with the deploy; it needs no seeding.
3. **Seed emails 2–4:**

```bash
npm run seed:welcome-drips                       # dry run — prints the plan
npm run seed:welcome-drips -- --apply            # create/update as drafts
```

Idempotent: templates match by `key`, campaigns by `name`, so re-running while
iterating on copy is safe. Everything is created **draft**; drafts never fire.

4. **Test and arm** at `app.stellreducation.org/admin/email`. Click **Test** on
   each of the nine, send to yourself, read them. Then **Activate a family's
   three together** — activating them apart means a member registering in the gap
   gets a partial sequence.

To arm one family from the script instead:

```bash
npm run seed:welcome-drips -- --family=college --apply --activate
```

To see the nine rendered without touching the database:

```bash
npm run seed:welcome-drips -- --preview   # writes HTML to /tmp/stellr-drip-preview
```

---

## What happens on a registration once armed

`member.created` fires, and `fireCampaignEvent` enqueues a row in
`email_campaign_queue` for **every** delayed campaign — all nine, regardless of
family. That is by design: the audience is deliberately *not* resolved at enqueue
time, so consent and eligibility are re-checked when the row comes due. The six
rows belonging to the wrong family drain to `status = 'skipped'` with
`note = 'no longer in audience'`. Wasteful in rows, correct in sends.

The `campaign-drip` cron runs **daily at 07:30 UTC**, so "day 5" lands 5–6 days
out, not at exactly 120 hours.

A member who unsubscribes in week one stops receiving the rest — eligibility is
re-evaluated per step, not frozen at the trigger.

### Why one sequence per family, not per tier

Audience is resolved against the member's **current** tier at send time. A
per-tier sequence would break on any upgrade mid-drip: the member drops out of
the tier they started on, and picks up a half-finished sequence for the new one.
Family scoping makes an in-family upgrade a non-event. V1 is deliberately three
sequences; splitting further later means adding a `Family` entry to the script
and re-running, not a rewrite.

---

## Verify end to end (15 min)

Register a throwaway account in production for each family you armed, then check:

- Confirmation email arrives within a minute, naming the right tier **and
  carrying that family's body copy** (High School reads "Competition briefs,
  self-paced training courses"; College reads "STEM Power Skills"; Teacher reads
  "lesson plans, student worksheets")
- `email_campaign_queue` holds nine rows for the member, three of them in that
  member's family sequence

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

Expect `{"due":1,"sent":1,...}` if that row is in the member's own family, or
`{"due":1,"skipped":1,...}` if it belongs to another family — both are correct.
Delete the throwaway member afterwards, or the drip keeps mailing it for a month.

---

## Watch-outs

- **Resend free plan: 100 emails/day**, shared across transactional and
  marketing. With three families armed, a registration still costs ~6 emails
  (2 immediate + 3 drip over a month + skips cost nothing). Fine at current
  volume; revisit before any push that could bring dozens of members in a day.
- **`substituteTokens` throws on an unknown `{{token}}` at render time, not at
  save time.** A stray token typed into the admin editor saves cleanly and then
  breaks every send for that campaign. The seeded bodies use only
  `{{firstName}}`. `{{tier}}` is avoided deliberately — `tier_name` is
  best-effort in `resolveAudience` and renders as "Your  membership" when null.
- **Deleting a template** a live campaign depends on makes the drip skip queued
  steps with `note = 'template missing or archived'` rather than fail loudly.
  Check `email_campaign_queue` for skipped rows if a sequence goes quiet.
- **Email 1 has no admin Test button** — it is code, not a DB template. Changing
  its copy is a deploy. `lib/registration-notify.test.ts` covers the tier→family
  routing and HTML/text parity.
