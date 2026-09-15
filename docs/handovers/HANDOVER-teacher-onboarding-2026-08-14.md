# Handover — teacher onboarding & welcome emails (13–14 Aug 2026)

For a future Claude Code session. Written at close-out of the session that
reviewed teacher onboarding after the first real registration.

---

## 1. The one thing that matters most

**David's revised email copy is NOT in the production database.**

Production still holds the **first-draft** copy at the **superseded** cadence:

| Campaign | Status | Delay | Template subject (stale) |
|---|---|---|---|
| Teacher welcome — day 2 | draft | +2d | "What your Educator membership already opens" |
| Teacher welcome — day 7 | draft | +7d | "Our competition calendar, and how teachers usually start" |
| Teacher welcome — day 14 | draft | +14d | "Registering a group takes about ten minutes" |
| Teacher welcome — day 30 | draft | +30d | "The people behind the resources" |

All four `email_templates` rows have `updated_at = 2026-08-13` — they have never
been re-seeded. The current copy (David's rewrite, at +5/+14/+23) lives only in
`scripts/seed-welcome-drips.ts` on `main`.

**Fix:** `npm run seed:welcome-drips -- --apply`. It updates templates in place,
creates the new steps, and archives the four superseded campaigns above. Nothing
sends — everything lands as draft, and drafts never fire (`fireCampaignEvent`
matches `status = 'scheduled'` only).

This is safe but not zero-risk: it is the first `--apply` run of the *renamed,
multi-family* script, which also seeds the High School and College families.
Read §2 before running it.

---

## 2. Blocking policy decision inherited from the parallel session

`scripts/seed-welcome-drips.ts` sets **`excludeMinors: false`** for the High
School family. It has to: every other campaign sets `excludeMinors: true`, which
drops anyone whose `age_bracket = 'high_school'`, so a High School drip with the
normal setting resolves to **zero recipients and sends nothing, silently**.

That means arming the High School sequence **will mail under-18s**. That is a
policy reversal, not a code detail, and it is David's to make. The script warns
on it at dry-run. Do not `--activate` the High School family without an explicit
decision. Detail in
[RUNBOOK-tier-welcome-drips.md](../RUNBOOK-tier-welcome-drips.md).

The teacher family is unaffected — Educator-tier adults only.

---

## 3. What shipped and is live

All merged to `main` and deployed (PRs #20, #21, #24; migration 136 applied).

| Change | Where |
|---|---|
| Transactional account confirmation, bypasses the marketing-consent filter | `lib/registration-notify.ts` |
| Staff alert on every registration (`REGISTRATION_ALERT_EMAIL` → `CONTACT_EMAIL`) | `lib/registration-notify.ts` |
| `member_roles` seeded from the declared role at onboarding | `app/api/members/onboarding/route.ts` |
| Same sync on the Clerk webhook's **link** branch | `app/api/webhooks/clerk/route.ts` |
| Drip engine: `delay_days`, `email_campaign_queue`, claim-before-send | migration 136, `lib/email-campaigns.ts` |
| Drip cron, daily 07:30 UTC | `app/api/cron/campaign-drip/route.ts` |
| Admin delay + sequence fields | `components/admin/email/*` |
| Directory/space-page access agreement | `lib/spaces.ts:171` |
| House email template (all emails) | `lib/email-layout.ts` |
| Welcome copy from David's Word doc | `lib/registration-notify.ts` |

`member_roles` backfill applied to production: **10 rows, 5 members**;
0 active members now hold no roles.

---

## 4. Root cause, for context

A teacher held the Educator **tier** (so the Educator Tier Space opened, since
`resolveSpaceAccess` grants from a tier match at read time with no roster row)
but not the `teacher` **role**, so the role-granted Teachers' Room stayed shut.

Two halves: `syncMemberClassificationRole` was called only on the Clerk webhook's
*create* branch, but the onboarding POST usually creates the member row first —
so the common path was the *link* branch, which skipped it. And the onboarding
route, the only place that knows the declared `event_role`, never called it.

Both now sync. Do not "fix" the empty Space roster: tier access is computed at
read time and writes no `community_space_members` row. That is by design, and it
is why the Educator Tier Space reports `roster_active = 0`.

---

## 5. Open items

### Needs David
- **Sender address.** The brief specifies `hello@stellrcommunity.org`. Only
  `mail.stellreducation.org` is verified in Resend, and the free plan allows one
  domain — sending from the other returns 403. David said "leave it", so all mail
  currently sends from `hello@mail.stellreducation.org`. The brief still says
  otherwise; revisit if the domain is ever added.
- **Personal emails to the first two teachers.** Michelle Matlock
  (`mmmatlock@wcpss.net`, Wake STEM ECHS, 10 Aug) and Janet Ivey-Duensing
  (`janetsplanetofficial@gmail.com`, 13 Aug). Arming the drip will **not** reach
  them — `member.created` already fired and there is no retro-send. David took
  this one.
- **Day-5 email is 120 body words** against a stated 50–100 limit. It is David's
  own copy; flagged, no response yet.
- **Two carried-over choices never explicitly approved:** "Challenges" and
  "Campaigns" are bold as sentence openers, and the house sign-off block
  (`All the best, / David Shaw / …`) is appended to each drip email. His Word doc
  bodies stop before the signature.

### Needs a session
- **Michelle's member record has empty `first_name`/`last_name`** — Clerk
  captured none at signup. Her emails render the "Hi there," fallback. Set on
  `/admin/members/2561d6c5-8d83-4379-bd16-87c059efc437`. Worth checking whether
  the Clerk sign-up flow collects a name at all, since this will recur.
- **The house template change affects EVERY transactional email** — DocuSign
  reminders, session reminders, invoices, waitlist notifications. Only the
  account confirmation was rendered and eyeballed. The others inherit the new
  chrome untested.
- **Test + Activate.** After `--apply`, send a Test on each from `/admin/email`,
  then Activate a family's campaigns **together** — a member registering between
  activations gets a partial sequence.

### Deferred by decision
- Tier-entitled members are not written to `community_space_members`, so Space
  member counts read 0 and members are invisible to each other. Access works;
  visibility does not.

---

## 6. Traps worth not rediscovering

- **`substituteTokens` throws on an unknown `{{token}}`, at *render* time.** A
  stray token typed into the admin editor saves cleanly and then breaks every
  send for that campaign. This is why the copy lives in a script, not the UI.
  Resolvable tokens: `firstName`, `lastName`, `fullName`, `email`,
  `membershipId`, `tier`, `unsubscribeUrl`.
- **Supabase's SQL Editor does not hold a transaction across separate runs.** A
  documented `BEGIN` … check … `COMMIT` as three executions cannot work. Prefer a
  dry-run script that reads live state.
- **Do not freeze expected row counts into docs.** An earlier runbook said
  "expect 13 rows / 7 members"; two members were hard-deleted before it ran, so
  the right answer was 10/5 and following the doc would have meant rolling back a
  correct result.
- **The admin UI cannot edit a template.** The Templates tab offers create and
  archive only. The API supports `PATCH`; nothing calls it. Copy changes go
  through the script.
- **The `Test` button uses example merge values**, so a test email reads
  "Hi Jordan," not the real name and not the "there" fallback. That is correct
  behaviour, not a bug.
- **A raw prod `INSERT` via the Supabase MCP tool was blocked** by the auto-mode
  classifier; the equivalent repo script was not.
- **Branches were reset/squashed twice mid-session** by parallel sessions, and the
  local checkout was switched out from under this one. Verify with
  `git branch -r --contains <sha>` and check file *content*, not just the log.

---

## 7. Repo state at close-out

- `main` carries everything through PR #24.
- **`3a2c2b7` ("Extend the four-email welcome to the High School and College tier
  families") is committed locally but NOT pushed** — it is the parallel session's
  work, sitting on `feat/tier-welcome-drips-2026-08-14`, one ahead of origin.
  Confirm with that session before touching it.
- `docs/RUNBOOK-tier-welcome-drips.md` says
  `feat/teacher-onboarding-2026-08-13` is "not merged". It is — PR #21, `d7ad474`.
- Deleted this session as divergent duplicates:
  `docs/backfill-member-roles-2026-08-13.sql`,
  `docs/teacher-drip-copy-2026-08-13.md`.

## 8. Commands

```bash
npm run backfill:member-roles              # dry run; --apply to write
npm run seed:welcome-drips                 # dry run
npm run seed:welcome-drips -- --preview    # render HTML to /tmp, touch nothing
npm run seed:welcome-drips -- --apply      # create/update as drafts
```
