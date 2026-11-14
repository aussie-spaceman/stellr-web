# Registration eligibility: the record

Who may take part in an event, where that is checked, and how it rolls out. Built by A2 and A3. Plan of record: `docs/TENANCY-S5.md`. Code wins over this file; if they disagree, fix this file.

Registration stays open: anyone can register, and control is by age. Nothing here is an invite list.

## Where it stands

| Piece | Where | State |
|---|---|---|
| The check that gives the registrant a message | `lib/registration/eligibility.ts`, `assertEligible()` | Built. **A7 wires it into the register routes** (#594; **since promoted** in #600, 9 Nov 2026), through `assertRegistrable`, which adds the consent rule below for tenant events |
| The database backstop | `supabase/migrations/20261105041211_participants_eligibility.sql` | On the `dev` database since 5 Nov 2026, with the ledger re-read |
| Its tests | `supabase/tests/database/participant_eligibility.test.sql`, `test/registration/participants-eligibility-sql.test.ts` | The second reads the constants and the SQL, and fails if one side changes alone. The pgTAP passes in CI's `db` job |
| Production | | Applied on 5 Nov 2026 with the owner's yes, through the Supabase MCP (`.claude/releases/promote-2026-11-05.md`) |
| Tenant guardian consent (A16) | `lib/registration/tenant-guardian-consent.ts`, migration `20261110164339_tenant_guardian_consent.sql` | On production (#625, promoted in #643 on 12 Nov 2026), behind `TENANT_GUARDIAN_CONSENT_ENABLED`, off. The migration is on the `dev` database since 11 Nov 2026 and on production since 12 Nov 2026 |

A7 replaced `checkRegistrationAge` with `assertEligible` in individual, group (both roster points) and group-join; for Stellr's events that makes exactly the old call. **Since promoted:** A7 is on production (#600, 9 Nov 2026). A8 (#625, promoted in #643 on 12 Nov 2026) does the same for the other participant writers.

**Tenant events and consent (A7, fail-closed).** Stellr's consent is its own agreement, sent as Stellr, so it cannot serve a tenant. By default the register API refuses anyone under 18, today or on the day, for a non-Stellr event, through `TENANT_MIN_AGE_WITHOUT_GUARDIAN_CONSENT`, with the reason `under_minimum_age` and the wording the owner approved on 10 Nov 2026. The trigger keeps the platform floor of 14. Wave 6 adds the tenant guardian-consent flow, behind a flag ([below](#tenant-guardian-consent-a16)), and typed details only on a tenant host ([below](#typed-details-only-on-a-tenant-host-a7f)). A live tenant event with no start date refuses everyone (`eligibility_unavailable`, 503) until the owner decides how such events are dated.

## The rule

**Stellr's own events** keep today's rules, including under-13s with a parent. `assertEligible` makes exactly today's call: no floor, and "today" from `appToday()`.

**Any other tenant's event:**

- The floor is `GREATEST(14, tenant minimum, event minimum)`. `TENANT_MIN_PARTICIPANT_AGE` (`lib/tenancy/constants.ts`) is the 14, so neither a tenant row nor an event row can lower it.
- Age is taken on the event's start date, in the event's IANA time zone. "Today" is the date in that zone too.
- Nobody under 13 today is admitted, however far off the event is: tenant events have no parental-consent flow for under-13s, and turning 14 by the start date does not change that we would be collecting a child's data now (`TENANT_MIN_AGE_TODAY`).
- Under 18, today or on the day, is refused by the API unless the guardian-consent flow admits them (A16: flag-gated, `register/individual` only).
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

## Typed details only on a tenant host (A7f)

Owner decision, 10 Nov 2026: a Stellr member's profile is not used at a tenant event until S7's per-tenant consent grant exists. Built in wave 6 (#625, promoted in #643 on 12 Nov 2026) in `lib/registration/individual/gate.ts` and `lib/registration/group/gate.ts`. The gates take the tenant branch only when `requestTenant()` names a tenant other than Stellr, which needs `TENANT_ROUTING_ENABLED`.

On a tenant host:

- **Individual:** the gate reads neither the session's member nor Stellr's child-awaiting-consent state. The typed address stands, the typed date of birth is not compared with a stored one, and the registration is treated as having no session.
- **Group:** the organiser's typed address and name stand, and no session member is read. On Stellr's hosts a signed-in organiser's name is their account's, whatever is sent (owner decision, 13 Nov 2026; `settleRegistrantName` in `lib/registration/group/parse.ts`).
- **Group-join** already worked this way.

These registrations link no member, so nothing may treat their typed email as the session's. Until S7, a tenant event relies on the typed date of birth alone. On Stellr's hosts the gates run the same code as before.

## Tenant guardian consent (A16)

Owner decision, 10 Nov 2026, built in wave 6 (#625, promoted in #643 on 12 Nov 2026) behind `TENANT_GUARDIAN_CONSENT_ENABLED` (off by default; on only when exactly `true`). The flow is `lib/registration/tenant-guardian-consent.ts`; the envelope is `lib/esign/tenant-guardian-consent.ts`. **With the flag off** every minor at a tenant event gets the approved refusal, as above, and the register route and the sweep read and write nothing new.

**With it on, for `register/individual` on a tenant event:**

1. **Who.** A registrant who passes `assertEligible` (14 or older on the day, 13 or older today) and is under 18 may register pending consent (`assertRegistrable` with `guardianConsent`; group and group-join do not pass it). They need a parent or legal guardian named as the form's emergency contact: a name, a plausible email that is none of the registrant's own addresses, and the relationship Parent or Legal Guardian (`guardianFromForm`). Without one: 400 `guardian_required`, nothing written.
2. **When.** Only when the flow can run (`tenantGuardianConsentReadiness`): the flag, signing configured with a consent document published under `tenant_guardian_consent`, a tenant sender (which also needs `TENANT_EVENT_MAIL_ENABLED`), the tenant's display name, and an event that has not started. Otherwise the approved refusal, nothing written.
3. **Caps.** Before any write: 5 invitations a day per guardian address, across every organiser, and 30 an hour per organiser; past a cap, 429 `guardian_consent_busy`. Proposals, counted per instance unless `RATE_LIMIT_STORE` is `postgres`.
4. **What is saved.** The registration and participant, as for an adult. The participant insert writes a pending `tenant_guardian_consents` row through a database trigger. The route sets the window (14 days, or the event start if sooner) and records a native envelope stamped with the tenant, with the guardian as its only signer.
5. **Invitation.** Through the signing engine's tenant sender (`sendTenantSigningInvitation`, B14b). An invitation that sent nothing counts as not sent, and the registrant's notice says the guardian was emailed only when the invitation was sent or is waiting in the signing outbox's daily allowance (`guardianInvitationOutcome`; `consent_pending`, otherwise `consent_pending_unsent`).
6. **Signed.** The guardian confirms the child's birth year and attests to being the parent or legal guardian, as on Stellr's own minor consent. Completion (`lib/esign/completion.ts`) marks the consent signed and sends the registrant `consent_signed`. Settling or declining needs the envelope for the participant's current registration.
7. **Declined or expired.** A decline (`lib/esign/native/flow.ts`), or the window closing, removes the registration through the deletion-registry entity `pending_guardian_consent_registration`: a hard delete with no archive, which `executeDeletion` refuses unless every participant on the registration is declined or expired. The registrant is told only after the rows are gone.

**While pending:**

- **No check-in.** `zzz_participants_refuse_unconsented_check_in` refuses any write that sets `checked_in_at` while the consent is not signed, whoever writes it. The public check-in route answers 403 `guardian_consent_pending` and the desk 409 (`lib/check-in-consent.ts`). A desk group check-in with one pending member is one statement, so nobody in it is checked in.
- **No tenant event mail.** For another tenant's email, `resolveAudience` leaves out participants whose consent is not signed, and their signers' links, from every roster-based audience, "All attendees" (#605) included. The read pages until it comes back empty and throws on failure, so a send fails and retries rather than reaching them. Volunteer mentors and event managers are not participants and are not filtered. This read runs for a tenant's email whatever the flag says; Stellr's sends make no extra read.
- **Audited,** ids only, behind `PLATFORM_AUDIT_ENABLED`: `registration.guardian_consent.request`, `.sign`, `.decline`, `.expire`, and from the sweep `.lift` and `.void`.

**The sweep.** `sweepTenantGuardianConsents`, step 4 of the `membership-expiry` cron, only with the flag on. At most 25 rows for each of its steps (`SWEEP_BATCH`): it retries failed removals (next try after 20 hours), expires pending consents past their window and removes their registration, for a pending consent past its window, settles it signed if its envelope completed without its hook, holds one whose guardian has signed but whose envelope is still finalising, and voids open consent envelopes no consent needs any more. Retries have no cap yet (tracker `s5-programme.26`).

**On `dev` (S5 wave 7, K5, #653).** The consent document's field map is `lib/esign/native/templates/tenant-guardian-consent-v1.fields.json`: its prefill keys match `planTenantGuardianConsent`, the organiser, event, child's name and date of birth, and relationship are locked, and the guardian can correct only their own name and email. The e2e stack publishes `tenant_guardian_consent`, so the flow reads as ready there. For `dev` only, `scripts/esign-template.ts` can publish a document titled "DEV PLACEHOLDER – NOT A CONSENT FORM", marked on every page, and approve it only with `--dev-placeholder`; the admin screens and the active-template loader refuse a placeholder on the real production app. Nothing is published or approved on `dev` yet (owner decision `W7-6`; `docs/TENANCY-S5.md`, Wave 7 status). Since A10a and A10b (wave 7, on `dev`), credentials, team profiles and surveys also leave out a consent-pending tenant minor.

**What it does not cover.** Group and group-join refuse every minor, flag or not, as do the roster writers (A8): none collects a guardian. Stellr's own pending-consent row, purge and consent document are not reused. The consent row holds no contact data: the guardian's name and email stay on the participant's emergency-contact columns and on the envelope.

### The migration

`supabase/migrations/20261110164339_tenant_guardian_consent.sql`. On the `dev` database since 11 Nov 2026, and on production since 12 Nov 2026, applied through the production migration Action before #643 merged.

- **The table.** `public.tenant_guardian_consents`: one row per consent-pending participant (`participant_id` unique), with its status (`pending`, `signed`, `declined`, `expired`), window and removal attempts. Stellr's tenant id is refused by CHECK. RLS on, `service_role` only, no `tenant_app` grant.
- **The envelope type.** `agreements.envelope_type` also accepts `tenant_guardian_consent`. The CHECK is dropped and added again, wider, in the one transaction, which scans every `agreements` row.
- **No check-in before consent.** `zzz_participants_refuse_unconsented_check_in`, BEFORE UPDATE OF `checked_in_at`, when it goes from NULL to a value: 23514 with the message `guardian_consent_pending`.
- **Pending from the moment it exists.** `zzz_participants_open_tenant_guardian_consent`, AFTER INSERT OR UPDATE OF `date_of_birth`, `registration_id`. For a participant under 18, today or on the day, on another tenant's mirrored event, it writes a pending row in the same statement, whichever writer saved them. An insert that already sets `checked_in_at` is refused too. A move to another registration resets the row to pending: a signature covers one registration.
- **A date-of-birth correction to 18 or over** removes a row still `pending`, so the adult is no longer held from check-in, event mail or the sweep. A `signed`, `declined` or `expired` row is left as it is. The sweep then voids the open envelope and audits it as `registration.guardian_consent.lift`.
- **For Stellr:** both functions return before writing for a Stellr event or an unmirrored one. Each participant insert, and each update that changes `date_of_birth` or `registration_id`, makes one indexed join (the lookups A3's trigger makes on the same writes); each check-in write makes one indexed lookup on an empty set and is never refused.
- **Sealing.** Both functions are SECURITY DEFINER with a pinned `search_path`, and EXECUTE is revoked from PUBLIC, anon and authenticated.
- **Locks** (corrected 12 Nov 2026; the file's header understates them). Each is held until the transaction ends. The foreign keys stop writes to `tenants`, `registrations`, `participants` and `agreements` from the `CREATE TABLE`, the file's first statement after `SET LOCAL lock_timeout`. The CHECK then takes ACCESS EXCLUSIVE on `agreements`, and `DROP TRIGGER IF EXISTS` takes ACCESS EXCLUSIVE on `participants` even when the trigger is absent, so reads of those two wait as well. `lock_timeout` (5 s) bounds each wait to take a lock, not how long it is held. On production the Action's step that runs the transaction took about 3 s, in the dry run and again in the real run, so no lock was held longer than that. Detail: `docs/TENANCY-S5.md`, Wave 6 status, "Its locks".
- **Tests.** `supabase/tests/database/tenant_guardian_consent.test.sql`, plan 37, passed in #625's `db` job. `test/registration/tenant-guardian-consent-sql.test.ts` holds the SQL's literals (Stellr's id, 18, the 14-day window) equal to their TypeScript constants.

**Edges it does not re-check.** Re-owning an event, renaming its slug or changing its start date does not re-check consent. A move onto a Stellr event's registration leaves the old pending row, because the trigger returns before it for a Stellr event (tracker `s5-programme.26`).

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
- **The mirror sync.** `lib/events/sync.ts` upserts every column on each sync. A refused change leaves the mirror on the old values, and the failed sync goes to `app_errors`. It keeps an existing row's tenant (`upsertEventRows`), so it cannot hand a tenant row to Stellr. Any other writer can: the trigger refuses that while the row has tenant registrations, but not the handover of a row with none. **Since K4 (S5 wave 7, #649, on `dev`, not promoted),** `upsertEventRows` keeps a non-owner row's own settings, from the one owner read it already makes per batch: its `min_participant_age` (NULL included), and its `time_zone` unless the venue moved (the country changed, or, on a US row an earlier sync wrote, the state changed, compared through `normaliseState` so "Nevada" equals "NV"). A missing or invalid stored zone is recomputed as before. When the kept zone differs from the one derived, `starts_at` and `ends_at` are derived again in the kept zone, so the parity query below still returns 0. A Stellr row is written exactly as `toEventRow` returns it, byte for byte, and a new row still defaults to Stellr. On production the sync still writes a NULL minimum until wave 7 is promoted, which matters only once a tenant event is held in Sanity; no such row exists today.
- **The mirror backfill.** `scripts/backfill-events-mirror.ts` upserts in batches of 50, so one event the trigger refuses (23514) fails its whole batch, and the script stops there. The events in that batch and every later batch stay on their old values until that event is resolved and the script is re-run.
- **Not re-checked:** `tenants.min_participant_age` changing; a new `events` row arriving for a slug that already has registrations; `activity_type` changing, where a campaign going live with no start date refuses only new writes.
- **Concurrency.** None of the triggers takes a row lock, so that Stellr writes gain no wait. Under READ COMMITTED, a participant insert running alongside a registration move or an event change can commit a row neither check judged against the final state. Accepted: this is the backstop behind the API gate, and such moves are rare staff actions.
- **Slug renames.** `rename_event_slug` on a tenant event with participants needs the mirror to hold the new slug first, or it is refused as an unmirrored tenant event.
- **Partial state in `register/group`.** It writes the registration and members before participants, so a trigger refusal would leave them behind. A6 pinned that every person with a row passes one check before the first write. A7 runs `assertEligible` over everyone there before the first write, so the risk is closed on production since #600 (9 Nov 2026). See the note in `lib/registration/group/persist.ts`.
- **Writers that drop the error.** `lib/sheet-participant-sync.ts` ignored the error on `update(payload)` in its existing-row and raced branches, so a 23514 would vanish. A8 (#625) handles it: an eligibility refusal (`isEligibilityRefusal`, which matches the trigger's own message) on the insert, the existing-row update or the raced update is skipped and listed in `skippedForDateOfBirth`. The other six files that update `participants` must not touch `date_of_birth` or `registration_id`, or need the same.
- **The other participant writers (A8).** The shared roster add (`lib/group-participant-add.ts`, organiser and staff), team-leader edit and remove, and the sheet import take their rules from the registration's `tenant_id` (`lib/registration/roster-context.ts`), with no read for a Stellr registration, so Stellr's age call is the old one. On another tenant's group they take that tenant's rules and refuse every minor, flag or not, look up no Member ID, write participant rows only, and refuse a group that takes money.
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

1. **`dev` migration.** Applied 5 Nov 2026, and the ledger re-read. Still owed: confirm a Stellr registration on `dev` still writes (tracker `s5-programme.35` and `docs/TENANCY-S5-flow-checklist.md`, "Steps owed from waves 4 to 6", since 14 Nov 2026).
2. **Parity query on `dev`, then production.** `dev`, 5 Nov 2026: 0 mismatches across 9 dated events, after `scripts/backfill-events-mirror.ts` filled the mirror (11 rows, all Stellr's). Production's backfill and query are still owed.
3. **Production migration.** Applied 5 Nov 2026 with the owner's yes, through the Supabase MCP, and the ledger re-read (`.claude/releases/promote-2026-11-05.md`). It is a no-op for Stellr apart from the one lookup above.
4. **A7** wires `assertEligible` into the register routes, supplies `tenant_id` on every write, Stellr's too, and refuses priced tenant events. From #594, since promoted in #600. For Stellr it adds an owner read of `public.events` to each register, pay and pay-seat request (one read, or two when the row for the CMS document holds another slug or is missing, so that the owner agrees with the slug's row the trigger uses), and a failed read, or two rows naming different owners, answers a retryable 503. **A8** does the same for team-leader add and edit and the roster sheet import, from the registration's tenant (#625, since promoted in #643 on 12 Nov 2026).
5. **The S3 enforce flip**, after A7, A8, B16 and C20 and 7 clean days, and before the first non-owner event on production. A3 relies on it.
6. **Before the first tenant event:** the sync fix above, and the owner's decision below.
7. **Owner's manual test on a tenant event:** a 13-year-old, a NULL date of birth, a future date and an over-120 date refused by the API and by the database. With `TENANT_GUARDIAN_CONSENT_ENABLED` off, a 15-year-old is refused by the API too; with it on and the flow ready, a 15-year-old with a guardian named is saved pending, cannot be checked in, and is confirmed only once the guardian signs. A Stellr 12-year-old still registers.

`docs/THREAT-MODEL.md` rates "Age-gate bypass" L, down from M: its condition, A3 and A7 both on production, was met (A3 on 5 Nov 2026, A7 in #600), and the owner made the move on 11 Nov 2026 (tracker `s5-programme.19`).

## The fail-closed work beside it (A0)

A0 hardened the register routes for read failures. It is a defect fix, and it changes Stellr's behaviour only when a read has already failed:

- A failed read of a prior member, or a failed school-address read in the group route, answers 503 with "Registration is temporarily unavailable. Please try again shortly." Nothing further is written, and a registration already inserted is removed the way the participant-failure path does.
- On `register/pay`, an unavailable event source answers 503 with a retry message, and an unresolved event answers 503 `no_price`. A resolved free event with paid add-ons still checks out.

## Owner decisions

- **A tightening that an existing participant fails.** Today it is refused, so the old rule keeps admitting new registrants until staff resolve that person. The alternative is to apply it to new writes and report the affected participants to staff, which needs a table staff can read and a follow-up slice. It only matters once tenant events exist, and should be settled before the first one.
- **Live tenant events with no start date.** Both sides refuse them today. Listed in the plan of record's owner gates.
- **The refusal copy for under-minimum registrants.** Settled 10 Nov 2026: approved as written.
- **Guardian consent (A16).** The consent document, the assurance level, the caps, the window, the new wording and the re-signature rule are listed under "Owner decisions wave 6 raised" in `docs/TENANCY-S5.md`.
