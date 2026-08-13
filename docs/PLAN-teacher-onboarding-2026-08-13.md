# Teacher onboarding — gap review & plan

> **Status, 13 Aug 2026.** Phases 1 and 2 are **built and committed** on branch
> `feat/teacher-onboarding-2026-08-13` (`aefee2a`) — not merged, not deployed.
> 192 tests pass; migration 136 dry-run applied and rolled back cleanly on prod.
> Phase 3 copy is drafted in `docs/teacher-drip-copy-2026-08-13.md`.
> **Outstanding and needing you:** run the role backfill
> (`docs/backfill-member-roles-2026-08-13.sql` — my prod write was blocked), add the
> `campaign-drip` cron to `vercel.json`, create the templates/campaigns in
> `/admin/email`, and email the two existing teachers personally.
> See §8 for the exact hand-off list.

**Date:** 13 Aug 2026
**Trigger:** first real teacher registration — `mmmatlock@wcpss.net` (Wake STEM ECHS), 10 Aug 2026.
**Scope:** the teacher self-serve signup journey, reviewed against the four user-story requirements.

> Note on the address: the registration is `mmmatlock@wcpss.net` (three `m`s), not `mmamatlock@`.
> Member id `2561d6c5-8d83-4379-bd16-87c059efc437`, membership `0000127`.

---

## 1. Verdict against the four requirements

| # | Requirement | Status | Root cause |
|---|---|---|---|
| 1 | Teacher receives account-confirmation / welcome email | **Not met** | Engine + admin UI exist; prod has **zero templates and zero campaigns** configured |
| 2 | Teacher auto-granted Educator Tier Space access | **Met** (verified) | Grant rule fired correctly — but see three caveats below |
| 3 | Admin notified of a new registration | **Not met** | No notification exists on any registration path |
| 4 | Multi-email drip welcoming the teacher | **Not supported** | `email_campaigns` has no delay/offset concept — one campaign = one immediate email |

### What actually happened for this teacher

From the activity log (`member_activity_log`), 10 Aug 15:27 UTC:

```
account     onboarding_completed   Completed account onboarding
school      school_linked          Linked to school Wake Stem ECHS
membership  tier_granted           Granted Educator membership (no expiry)
```

That is the whole trail. Three things happened; **no email was sent by Stellr at any point.**
The only mail they received was Clerk's own verification code.

---

## 2. Requirement 1 — welcome email

### Current state

The plumbing is complete and correct:

- [`app/api/members/onboarding/route.ts:245`](../app/api/members/onboarding/route.ts) fires
  `fireCampaignEvent('member.created', memberId)` on profile completion.
- [`lib/email-campaigns.ts:234`](../lib/email-campaigns.ts) resolves active `trigger_type='event'`
  campaigns bound to that key, renders per-recipient, sends via Resend, and writes an idempotency
  ledger row so replays can't double-send.
- `/admin/email` already offers `member.created` ("New member joins") as a trigger
  ([`components/admin/email/CampaignForm.tsx:9`](../components/admin/email/CampaignForm.tsx)).

The gap is purely configuration:

```sql
select count(*) from email_templates;  -- 0
select count(*) from email_campaigns;  -- 0
```

`fireCampaignEvent` finds no campaigns and returns silently. Nothing is broken; nothing is set up.

### Two code-level issues that must be fixed alongside the config

**(a) Consent gating suppresses a transactional email.**
`resolveAudience` unconditionally applies `.eq('marketing_consent', true)`
([`lib/email-campaigns.ts:51`](../lib/email-campaigns.ts)). An account-confirmation email is
transactional — the member just created an account and needs to know it worked. Routing it through
the marketing engine means anyone who opts out of marketing silently gets **no confirmation at all**.
This teacher happens to have `marketing_consent = true`, so it would have worked for them; the next
one may not.

**(b) `member.created` only fires on the self-serve path.**
It is called from the onboarding route only. Members created through event registration
(`lib/member-sync.ts`) never fire it, so they'd never receive a welcome.

### Plan

1. **Split transactional from marketing.** Send the account-confirmation as a direct
   `sendEmail()` from the onboarding route — not via the campaign engine. It is a fixed,
   branded template, always sent, never consent-gated, never unsubscribable.
   *Alternative if you'd rather keep it admin-editable:* add a `bypass_consent boolean` column to
   `email_campaigns` and have `resolveAudience` skip the consent filter when set. More flexible,
   more moving parts, and it puts an unsubscribe footer on a transactional mail.
   **Recommendation: the direct send.** It's ~40 lines, and it decouples "your account exists"
   from the marketing stack entirely.
2. Fire the confirmation from the shared member-creation path so event-registered members get it too.
3. Keep `member.created` as the entry point for the *marketing* drip (requirement 4).

---

## 3. Requirement 2 — Educator Tier Space access

### This works — verified end to end

- Grant rule `f1326bb5` *"Signup: teacher → Educator"* (`event_role=teacher`, `age_bracket=adult`,
  lifetime) fired at signup and granted the **Educator** tier, `renewal_status=active`,
  `source=rule`, no expiry.
- **Educator Tier Space** (`tier-educator`, `access_type=private`) is linked to the Educator tier
  in `community_space_tiers`.
- `resolveSpaceAccess` ([`lib/spaces.ts:60`](../lib/spaces.ts)) grants access at **read time** from
  the tier match — no roster row is required:

  ```ts
  const tierMatch = member.activeTierIds.some((id) => assignedTierIds.includes(id))
  if (tierMatch) return { canAccess: true, visible: true, reason: 'tier', gated: false }
  ```

So this teacher can enter the Educator Tier Space and see its resources today. **No action required
on the core requirement.** Three adjacent defects surfaced while verifying it, though.

### Caveat A (real bug, teacher-visible) — no `member_roles` row, so no Teachers' Room

This member has **zero rows in `member_roles`**. Consequently they do not hold the `teacher` role,
and the **Teachers' Room** space (`role-teacher`, private, granted to role `teacher`) is closed to
them — as is anything gated on `MANAGE_ROLES`.

This is not specific to this member. Every real self-serve signup since the July seed shows the
same:

| Member | event_role | member_roles |
|---|---|---|
| janetsplanetofficial@gmail.com (13 Aug) | teacher | **(none)** |
| mmmatlock@wcpss.net (10 Aug) | teacher | **(none)** |
| mark.shaw@neoshr.com.au (9 Jul) | mentor | **(none)** |
| bill.allen@stellreducation.org (8 Jul) | teacher | **(none)** |
| david.michael.shaw+em@gmail.com (8 Jul) | teacher | **(none)** |
| david.michael.shaw+rudi@gmail.com (7 Jul) | adult | **(none)** |
| david.michael.shaw+william@gmail.com (7 Jul) | participant | **(none)** |

(The 3 Jul accounts that *do* have roles were seeded by SQL; `david.shaw@` and `kieran` got theirs
from the event-registration path, which calls the sync.)

**Root cause — two halves:**

1. `syncMemberClassificationRole` is called from the Clerk webhook **only on the create branch**
   ([`app/api/webhooks/clerk/route.ts:103`](../app/api/webhooks/clerk/route.ts)). When the member
   row already exists — which is the normal case, because the onboarding POST usually lands first —
   the webhook takes the *link* branch, sets `profile_photo_url`, and never seeds roles.
2. `/api/members/onboarding` — the one place that actually knows the member is a **teacher**,
   since `event_role` is chosen in that wizard — never calls the sync at all.

So the role is written either from a stale default (`'subscriber'`) or not at all, and never from
the real declared role.

**Fix:** call `syncMemberClassificationRole(db, memberId, resolvedRole)` from the onboarding route
after the member upsert, and also from the webhook's link branch. The function is an idempotent
upsert with `ignoreDuplicates`, so calling it from both paths is safe.

### Caveat B (directory inconsistency) — role-granted spaces mis-grouped

`getSpacesDirectory` calls the resolver **without** the role arguments
([`lib/spaces.ts:171`](../lib/spaces.ts)):

```ts
const access = resolveSpaceAccess(member, s, assignedTierIds, membership)   // 4 args
```

whereas the space-page and access-check callers pass all six (lines 298, 373). The two optional
role params default to `[]`, so a role-granted space is bucketed into **Restricted** in the
directory even though opening it directly grants access. Once Caveat A is fixed this becomes
user-visible: teachers would see "Teachers' Room — restricted" in the list but get in if they
clicked through. Pass `assignedRoles` / `memberRoles` at line 171.

### Caveat C (ops/cosmetic) — tier members are invisible on the roster

Because tier access is computed at read time, no `community_space_members` row is ever written.
The Educator Tier Space reports `roster_active = 0` and this teacher appears on nobody's member
list. Access is fine; visibility to admins and other members is not. Decide whether to materialise
a roster row on tier grant, or to change the space member count to include tier-entitled members.
Low priority — flagging so it isn't rediscovered later.

---

## 4. Requirement 3 — admin notification on new registration

### Current state

Lead-capture forms all notify staff at `CONTACT_EMAIL` (default `hello@stellreducation.org`):
`app/api/contact`, `join-network`, `scholarship`, `host-event`.

**No registration or signup path notifies anyone.** The strongest signal in the funnel — someone
created an account — is the one nobody is told about. This teacher registered on 10 Aug and it was
noticed three days later.

### Plan

Add a staff notification to the onboarding route, mirroring the existing lead-form pattern.
Include name, email, school, declared role, granted tier, and a deep link to the Person 360.
Best-effort and wrapped in try/catch — a failed notification must never fail onboarding.

Worth gating behind a `REGISTRATION_ALERT_EMAIL` env var so the destination can change without a
deploy, defaulting to `CONTACT_EMAIL`.

---

## 5. Requirement 4 — multi-email drip campaign

### This is the only requirement needing real engineering

`email_campaigns` schema (verified in prod):

```
id, name, template_id, trigger_type, scheduled_at, event_key,
audience, status, created_by, created_at, updated_at, sent_at
```

There is **no delay, offset, step, or sequence-position column**. `fireCampaignEvent` loops every
matching campaign and sends immediately. Creating five campaigns on `member.created` would deliver
all five emails within the same second.

### Why not HubSpot

Checked portal 24379847: seats are `core`, `sales-starter`, `service-starter`. There is no
Marketing Hub Professional seat, and workflow-based drip automation is a Professional feature.
HubSpot cannot host this without an upgrade. **Build it in the app.**

### Design

Smallest change that fits the existing architecture:

1. **Migration** — add to `email_campaigns`:
   - `delay_days integer not null default 0` — days after the trigger event to send.
   - Optional `sequence_key text` so the emails of one drip group in the admin UI.
2. **New table** `email_campaign_queue`:
   `(id, campaign_id, member_id, due_at timestamptz, dedup_key text, status, created_at)`
   with `unique (campaign_id, member_id, dedup_key)` — same idempotency contract as
   `email_campaign_sends`.
3. **`fireCampaignEvent`** — when `delay_days = 0`, send inline exactly as today (no behaviour
   change). When `> 0`, insert a queue row at `now() + delay_days` instead.
4. **New cron** `/api/cron/campaign-drip` (daily, alongside the existing crons in `vercel.json`) —
   drains rows where `due_at <= now()`, re-resolves the member through the campaign's audience so a
   member who unsubscribed or was deactivated mid-drip is dropped, then calls `sendToMembers`.
   Re-resolving at send time rather than enqueue time is the important detail: a five-week drip
   must honour an unsubscribe in week two.
5. **Admin UI** — add a "Send N days after trigger" field to `CampaignForm`.

Roughly one migration, ~150 lines of engine + cron, one form field.

### Suggested teacher drip

Consent-gated marketing (unlike the day-0 confirmation, which is transactional):

| Day | Email |
|---|---|
| 0 | *(transactional confirmation — separate, see §2)* |
| 2 | Your Educator Tier resources — what's in the space and how to get in |
| 7 | Bring Stellr to your classroom — the competition calendar |
| 14 | Register your students — walkthrough of the group registration flow |
| 30 | Meet the community — Teachers' Room, mentors, upcoming live sessions |

Content is yours to write; the schedule above is a starting point.

### Volume note

Resend is on the **free** plan: one verified domain, **100 emails/day**, shared by transactional
and marketing sends (`lib/email.ts` — both senders sit on `mail.stellreducation.org`). A drip is
low volume, but the day-cap is real and bulk campaign loops are unthrottled. Keep it in view before
the first large send.

---

## 6. Sequenced plan

### Phase 0 — today, no deploy needed

- [ ] Create the welcome template + `member.created` campaign in `/admin/email`, so the **next**
      teacher is covered immediately. (Won't retro-send: the event already passed for these two.)
- [ ] Manually welcome `mmmatlock@wcpss.net` and `janetsplanetofficial@gmail.com` — a one-off
      scheduled campaign scoped to those two members, or a personal email. Recommend personal:
      first two teachers deserve it, and it's a chance to ask how the signup felt.
- [ ] Backfill `member_roles` for the seven affected members (see §3 table).
- [ ] Backfill the empty `first_name` / `last_name` on `mmmatlock@wcpss.net`.

### Phase 1 — one small PR

- [ ] Call `syncMemberClassificationRole` from `/api/members/onboarding` with `resolvedRole`
- [ ] Call it from the Clerk webhook's link branch too
- [ ] Transactional account-confirmation email, sent unconditionally on onboarding completion
- [ ] Staff notification on new registration (`REGISTRATION_ALERT_EMAIL` → `CONTACT_EMAIL`)
- [ ] Pass role args at `lib/spaces.ts:171`

### Phase 2 — drip engine

- [ ] Migration: `delay_days`, `sequence_key`, `email_campaign_queue`
- [ ] `fireCampaignEvent` enqueues when delayed
- [ ] `/api/cron/campaign-drip` + `vercel.json` entry
- [ ] `CampaignForm` delay field

### Phase 3 — content & verification

- [ ] Write the four drip emails
- [ ] End-to-end test with a fresh throwaway teacher account in prod: confirm the confirmation
      email, the staff alert, Educator + Teachers' Room access, and the day-2 send

### Deferred (decide, don't drift)

- [ ] Caveat C — materialise roster rows for tier-entitled members, or fix the member count

---

## 7. Hand-off — what is built, what needs you

### Built and committed (`aefee2a`, branch `feat/teacher-onboarding-2026-08-13`)

| Change | Files |
|---|---|
| Transactional account confirmation (bypasses the consent filter) | `lib/registration-notify.ts` |
| Staff alert on every registration | `lib/registration-notify.ts`, onboarding route |
| `member_roles` seeded from the declared role | `app/api/members/onboarding/route.ts` |
| Same sync on the Clerk webhook's link branch | `app/api/webhooks/clerk/route.ts` |
| Drip: `delay_days` + queue + claim-before-send | migration 136, `lib/email-campaigns.ts` |
| Drip cron | `app/api/cron/campaign-drip/route.ts` |
| Admin: delay + sequence fields, shown in the list | `CampaignForm`, `EmailManager`, types, admin API |
| Directory/space-page access agreement | `lib/spaces.ts` |
| Tests for delay routing and re-checked eligibility | `lib/email-campaigns.test.ts` (6 tests) |

Verification: 192/192 tests pass; `tsc --noEmit` clean; migration 136 applied and
rolled back against prod inside a transaction. The delay-routing test was
mutation-checked — inverting the delay branch fails it.

### Needs you

1. **Run the role backfill** — `docs/backfill-member-roles-2026-08-13.sql`.
   13 rows, 7 members, dry-run verified. My write to prod was blocked by a
   guardrail, so this one is yours. Reversible via the `source` marker.
2. **Add the cron to `vercel.json`** — the entry is written but *not committed*:
   ```json
   { "path": "/api/cron/campaign-drip", "schedule": "30 7 * * *" }
   ```
   The file also carries another session's `lead-capture-failures` entry whose
   route is still untracked, so committing the file as-is would point a prod cron
   at a 404. Land the two together, or add mine when that branch merges.
   **Until this is added, delayed campaigns queue but never send.**
3. **Create the templates and campaigns** in `/admin/email` — copy is in
   `docs/teacher-drip-copy-2026-08-13.md`, with a pre-activation checklist.
4. **Email the two existing teachers personally.** Activating the drip will not
   reach them: `member.created` already fired.
5. **Apply migration 136 to prod** as part of the deploy.

### Deploy order

Migration 136 first (the code reads `delay_days`), then the app, then the cron
entry, then activate the campaigns. Steps 1 and 4 can happen any time.

---

## 8. Open questions for David

1. **Confirmation email — transactional direct send, or consent-bypass flag on the campaign
   engine?** Recommendation above is the direct send.
2. **Should the drip be teacher-specific, or one drip with tier-filtered audiences?** The audience
   filter already supports `tierIds`, so scoping a drip to Educator is free. A second drip for
   students/parents would then be additive.
3. **Where should registration alerts go** — `hello@`, a personal address, or a Slack webhook?
