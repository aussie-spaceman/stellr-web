# Registration eligibility: the record

Who may take part in an event, where that is checked, and how it rolls out. Built by A2 and A3. Plan of record: `docs/TENANCY-S5.md`. Code wins over this file; if they disagree, fix this file.

Registration stays open: anyone can register, and control is by age. Nothing here is an invite list.

## Where it stands

| Piece | Where | State |
|---|---|---|
| The check that gives the registrant a message | `lib/registration/eligibility.ts`, `assertEligible()` | Built. **A7 wires it into the register routes** (on `dev` since #594, not promoted), through `assertRegistrable`, which adds the consent rule below for tenant events |
| The database backstop | `supabase/migrations/20261105041211_participants_eligibility.sql` | On the `dev` database since 5 Nov 2026, with the ledger re-read |
| Its tests | `supabase/tests/database/participant_eligibility.test.sql`, `test/registration/participants-eligibility-sql.test.ts` | The second reads the constants and the SQL, and fails if one side changes alone. The pgTAP passes in CI's `db` job |
| Production | | Applied on 5 Nov 2026 with the owner's yes, through the Supabase MCP (`.claude/releases/promote-2026-11-05.md`) |

On production, until A7 is promoted, the live age check is `checkRegistrationAge` in `lib/registration-eligibility.ts`. On `dev`, A7 has replaced it with `assertEligible` in individual, group (both roster points) and group-join; for Stellr's events that makes exactly the old call.

**Tenant events and consent (A7, fail-closed).** Tenants have no way yet to collect a parent's or guardian's consent: Stellr's consent is its own agreement, sent as Stellr. So the register API refuses anyone under 18, today or on the day, for a non-Stellr event, through `TENANT_MIN_AGE_WITHOUT_GUARDIAN_CONSENT`, with the reason `under_minimum_age`. The trigger keeps the platform floor of 14, so a later consent flow can lower the API's rule without a migration. Which way to go is the owner's (`docs/TENANCY-S5.md`, Owner decisions wave 5 raised), and the refusal wording is a proposal. A live tenant event with no start date refuses everyone (`eligibility_unavailable`, 503) until the owner decides how such events are dated.

## The rule

**Stellr's own events** keep today's rules, including under-13s with a parent. `assertEligible` makes exactly today's call: no floor, and "today" from `appToday()`.

**Any other tenant's event:**

- The floor is `GREATEST(14, tenant minimum, event minimum)`. `TENANT_MIN_PARTICIPANT_AGE` (`lib/tenancy/constants.ts`) is the 14, so neither a tenant row nor an event row can lower it.
- Age is taken on the event's start date, in the event's IANA time zone. "Today" is the date in that zone too.
- Nobody under 13 today is admitted, however far off the event is: tenant events have no parental-consent flow, and turning 14 by the start date does not change that we would be collecting a child's data now (`TENANT_MIN_AGE_TODAY`).
- An undated campaign takes its age on today's date.

## What fails closed

The two sides refuse in the same order.

| Case | `assertEligible` | Trigger reason |
|---|---|---|
| Tenant row missing | `eligibility_unavailable` / `tenant_missing` | `tenant_missing` |
| Minimum not a whole number, 0 or more | `eligibility_unavailable` / `min_age_invalid` | The columns are integers |
| Unknown time zone | `eligibility_unavailable` / `time_zone_invalid` | `time_zone_invalid` |
| Live event with no start date | `eligibility_unavailable` / `start_date_missing` | `start_date_missing` |
| Unreadable start date | `eligibility_unavailable` / `start_date_invalid` | The column is a timestamp |
| No date of birth | `dob_missing` | `dob_missing` |
| In the future, over 120, or not a real or finite date | `dob_invalid` | `dob_invalid` |
| Below the floor on the day, or under 13 today | `under_minimum_age` | `under_minimum_age` |
| No event found | `eligibility_unavailable` / `event_missing` | `event_missing`, unless the registration is NULL or Stellr (below) |

`eligibility_unavailable` shows the registrant a message asking them to contact the organiser, and carries no date of birth or name. The trigger also has `tenant_handover`, below.

**Choosing a context.** Only a positive read makes an event Stellr's. A Sanity miss, a mirror miss or a mirror read error must never become `stellrContext`, because a miss is exactly what a tenant event looks like in Sanity, and the result would be no age floor. Pass what you have to `eligibilityContextFromMirror`, which refuses when it is empty, and refuses a row carrying only one of Stellr's two marks (its id and the owner flag).

## The database backstop

Three triggers, each after anything that changes what it reads:

| Trigger | Fires | Does |
|---|---|---|
| `zzz_participants_assert_eligible` | BEFORE INSERT, or UPDATE OF `date_of_birth`, `registration_id` on `participants` | Refuses the row. BEFORE, so a NULL date of birth on a tenant event is 23514, ahead of the NOT NULL check. Sorts after `zz_tenancy_derive_tenant_id`. An update that changes neither column is not re-judged |
| `zzz_registrations_assert_eligible` | BEFORE UPDATE OF `event_slug`, `tenant_id` on `registrations`, when one changed | Re-checks everyone on the registration against the new event |
| `zz_events_assert_participants_eligible` | AFTER UPDATE OF `starts_at`, `tenant_id`, `min_participant_age`, `time_zone`, `slug` on `events`, when one changed | Re-checks a tenant event's existing participants, withdrawn registrations included. A change that leaves any of them ineligible is refused |

`zz_events_assert_participants_eligible` also raises `tenant_handover` when a tenant event is handed to Stellr with tenant-stamped registrations still on its slug, because a Stellr event switches the rule off for them.

**The contract.** Every refusal is SQLSTATE **23514**, with the message `participant eligibility: <reason>`: the reason alone, never a date of birth, a name or an event. A writer may match on the code and reason, and shows the registrant its own message from `assertEligible`.

**Sealing.** The trigger functions are SECURITY DEFINER with a pinned `search_path`, and EXECUTE is revoked from PUBLIC, anon and authenticated. The shared check `participant_eligibility_refusal` is SECURITY INVOKER and called only from them.

## The Stellr no-op

A platform-owner event returns before any age rule runs, so a 12-year-old, a 13-year-old, an over-120 date and a future date all insert on a Stellr event: Stellr's date rules stay in the app. A NULL date of birth is still the column's own NOT NULL refusal (23502). pgTAP pins these, and a 12-year-old on an unmirrored event with a Stellr or a NULL `tenant_id`.

It is not free, and it is not entirely inert:

- Each Stellr participant write gains one lookup: `registrations` by primary key, `events` by its unique slug, `tenants` by primary key. It takes no row lock and adds no new wait.
- **A failed read fails the write, for Stellr too.** Unlike `tenancy_derive_tenant_id`, which swallows errors, this does not: failing closed is right for a tenant. Watch for it after the migration lands on `dev`, and again on production.
- Applying the migration locks three live tables. It sets `lock_timeout = '5s'` to fail fast rather than queue registration and check-in behind it. Retry if it times out.

## No `events` row

Sanity is the source of truth and `events` is a background mirror, so refusing outright would break Stellr registrations for an unmirrored event.

- With an `events` row: `events.tenant_id` joined to `tenants` decides.
- With none: the write passes only when `registrations.tenant_id` is NULL or Stellr. Otherwise it raises 23514 (`event_missing`).

**That does not stop an unmirrored tenant event by itself.** pgTAP pins the gap:

- In log mode, the default, `tenancy_derive_tenant_id` stamps an unstamped registration with no `events` row as Stellr (`no_event`). This check then sees Stellr and admits a 13-year-old or a NULL date of birth, and the row lands in Stellr's scope.
- `derivation_mode='enforce'` raises 23503 for that row, but only while the writer supplies no `tenant_id`. A supplied Stellr id on a slug the mirror does not have is kept in both modes, and looks the same as a real unmirrored Stellr event.
- So once every write path supplies `tenant_id` (A7, A8), what protects an unmirrored tenant event is those writers' resolver never answering Stellr for it.

## Known limits

Recorded so they are decided on purpose.

- **A refused tightening freezes the old rule.** A refused raise of the minimum, or a refused earlier start date, leaves new registrants judged by the old values, in the trigger and in `eligibilityContextFromMirror`, until staff resolve that participant. Any registrant who only just meets the floor can hold an event in that state. Owner decision, below.
- **The mirror sync.** `lib/events/sync.ts` upserts every column on each sync. A refused change leaves the mirror on the old values, and the failed sync goes to `app_errors`. It keeps an existing row's tenant (`upsertEventRows`), so it cannot hand a tenant row to Stellr. Any other writer can: the trigger refuses that while the row has tenant registrations, but not the handover of a row with none. The sync still writes a NULL minimum (`toEventRow`), which clears a tenant row's own minimum, and the trigger does not stop that. **The sync must stop overwriting the minimum on a non-owner row before a tenant event is held in Sanity.** No such row exists today.
- **The mirror backfill.** `scripts/backfill-events-mirror.ts` upserts in batches of 50, so one event the trigger refuses (23514) fails its whole batch, and the script stops there. The events in that batch and every later batch stay on their old values until that event is resolved and the script is re-run.
- **Not re-checked:** `tenants.min_participant_age` changing; a new `events` row arriving for a slug that already has registrations; `activity_type` changing, where a campaign going live with no start date refuses only new writes.
- **Concurrency.** None of the triggers takes a row lock, so that Stellr writes gain no wait. Under READ COMMITTED, a participant insert running alongside a registration move or an event change can commit a row neither check judged against the final state. Accepted: this is the backstop behind the API gate, and such moves are rare staff actions.
- **Slug renames.** `rename_event_slug` on a tenant event with participants needs the mirror to hold the new slug first, or it is refused as an unmirrored tenant event.
- **Partial state in `register/group`.** It writes the registration and members before participants, so a trigger refusal would leave them behind. A6 pinned that every person with a row passes one check before the first write. A7 runs `assertEligible` over everyone there before the first write, so the risk is closed on `dev` (#594) and closes on production when A7 is promoted. See the note in `lib/registration/group/persist.ts`.
- **Writers that drop the error.** `lib/sheet-participant-sync.ts` ignores the error on `update(payload)` in its existing-row and raced branches, so a 23514 would vanish. A8 handles it. The other six files that update `participants` must not touch `date_of_birth` or `registration_id`, or need the same.
- **Date of birth is self-declared.** A liar can still pass. Accepted in `docs/THREAT-MODEL.md`, section 9.

## The parity query

The trigger takes the event's day from `starts_at` in `time_zone`. Sanity's `date` is the source. They must agree, or the two sides could judge different days. Read-only; expect 0. The owner witnesses it on production.

```sql
SELECT count(*)
FROM public.events e
WHERE e.starts_at IS NOT NULL
  AND (e.starts_at AT TIME ZONE e.time_zone)::date::text IS DISTINCT FROM e.raw->>'date';
```

## Rollout order

1. **`dev` migration.** Applied 5 Nov 2026, and the ledger re-read. Still owed: confirm a Stellr registration on `dev` still writes.
2. **Parity query on `dev`, then production.** `dev`, 5 Nov 2026: 0 mismatches across 9 dated events, after `scripts/backfill-events-mirror.ts` filled the mirror (11 rows, all Stellr's). Production's backfill and query are still owed.
3. **Production migration.** Applied 5 Nov 2026 with the owner's yes, through the Supabase MCP, and the ledger re-read (`.claude/releases/promote-2026-11-05.md`). It is a no-op for Stellr apart from the one lookup above.
4. **A7** wires `assertEligible` into the register routes, supplies `tenant_id` on every write, Stellr's too, and refuses priced tenant events. On `dev` since #594, not promoted. For Stellr it adds an owner read of `public.events` to each register, pay and pay-seat request (one read, or two when the row for the CMS document holds another slug or is missing, so that the owner agrees with the slug's row the trigger uses), and a failed read, or two rows naming different owners, answers a retryable 503. **A8** does the same for team-leader add and edit and the roster sheet import.
5. **The S3 enforce flip**, after A7, A8, B16 and C20 and 7 clean days, and before the first non-owner event on production. A3 relies on it.
6. **Before the first tenant event:** the sync fix above, and the owner's decision below.
7. **Owner's manual test on a tenant event:** a 13-year-old, a NULL date of birth, a future date and an over-120 date refused by the API and by the database. While A7's consent rule stands, a 15-year-old is refused by the API too. A Stellr 12-year-old still registers.

`docs/THREAT-MODEL.md` lowers "Age-gate bypass" from M to L only once A3 and A7 are both on production.

## The fail-closed work beside it (A0)

A0 hardened the register routes for read failures. It is a defect fix, and it changes Stellr's behaviour only when a read has already failed:

- A failed read of a prior member, or a failed school-address read in the group route, answers 503 with "Registration is temporarily unavailable. Please try again shortly." Nothing further is written, and a registration already inserted is removed the way the participant-failure path does.
- On `register/pay`, an unavailable event source answers 503 with a retry message, and an unresolved event answers 503 `no_price`. A resolved free event with paid add-ons still checks out.

## Owner decisions

- **A tightening that an existing participant fails.** Today it is refused, so the old rule keeps admitting new registrants until staff resolve that person. The alternative is to apply it to new writes and report the affected participants to staff, which needs a table staff can read and a follow-up slice. It only matters once tenant events exist, and should be settled before the first one.
- **Live tenant events with no start date.** Both sides refuse them today. Listed in the plan of record's owner gates.
- **The refusal copy for under-minimum registrants.** Listed in the same place.
