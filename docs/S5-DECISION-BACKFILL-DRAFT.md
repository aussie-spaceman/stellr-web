# DRAFT: S5 decision register backfill

> **DRAFT, for the record slice to fold into `docs/S5-DECISION-REGISTER.md`.** This file does not change the register. It collects the owner decisions from S5 waves 2 to 6 that the register does not hold yet (its section "Not in this register yet"; tracker row `s5-programme.41`), C13's four wave 4 follow-ups (tracker `s5-programme.44`), the scoping questions nobody answered, and a definition of "C18m". Each entry sits under the gate it blocks, with the options, a proposed safe default and a status. Nothing here is answered: every open entry is **owner decides**.

Written 14 Nov 2026 against `dev` at `1d9b6977`. Sources, all on `dev`: `docs/TENANCY-S5.md` ("Owner decisions wave 2 raised" to "Owner decisions wave 6 raised", and "Owner gates", "Decisions"), `docs/TENANCY-S5-registration.md` ("Owner decisions"), `docs/TENANCY-S5-data.md`, `docs/AUTHZ.md`, `docs/S5-CRONS-LIMITS-SMMA.md` and the tracker `docs/handovers/tracker/2026-11-11-s5-programme.md`. The scoping questions come from the private S5 scoping output of 4 Nov 2026; only the questions are copied. People are named by role only.

## How to read an entry

- **Id:** `BF-<n>` for a wave decision, `SQ-<n>` for a scoping question, `T-44a` to `T-44d` for C13's follow-ups. These are working ids for this draft only; the record slice gives each the register's own id when it moves, and leaves a line here mapping old to new.
- **From:** the slice that raised it, and the wave.
- **Safe default:** what the code does today or what we recommend building until the owner answers. Defaults fail closed: they refuse, hold or keep Stellr-only rather than open a path.
- **Status:** "Open" (owner decides); "Partly settled" (part answered, with the link); "Settled, to record" (answered or decided by what was built, and the register should link it rather than ask again).

How many: 72 wave entries (`BF-1` to `BF-72`), of which 3 are "Settled, to record" and 6 "Partly settled"; 4 C13 follow-ups; the 15 scoping questions the 14 Nov review found with no tracked answer (`SQ-1` to `SQ-15`; reading `docs/AUTHZ.md` settles 2 of them by what was built and part of a third), and a short list of scoping questions answered elsewhere.

## Gate: platform audit on production (`PLATFORM_AUDIT_ENABLED`)

`W7-17` already lets P1 go on `dev` with C13 and B16 open; every entry here gates production only. A row written on the wrong chain, or holding a uuid it should not, cannot be corrected later, because `platform_audit_events` is append-only (`docs/PLATFORM-AUDIT.md`).

| Id | From | Question | Options | Safe default | Status |
|---|---|---|---|---|---|
| BF-1 | A14, wave 3 | How do consent audit rows relate to the purge of a self-registered minor who never got consent, once `PLATFORM_AUDIT_ENABLED` and `MINOR_SELF_SIGNUP_ENABLED` are both on? Needs legal input | (a) audit rows hold no member uuid for these actions; (b) keep the uuid and record a legal basis for retaining it; (c) keep both flags from being on together until decided | (c): the two flags are not on together on production until answered | Open |
| BF-2 | A14, wave 3 | Review the limits on upload signing before the audit flag goes on | (a) keep today's limits; (b) tighten them behind their own flag | (a), with any change behind its own flag, because it is live behaviour | Open |
| BF-3 | B15, B18, S2 | Route limits for `schools/search` and `store/checkout` (both allow-listed in `lib/security/route-guards.ts` with a note that S5 adds a rate limit), before audit goes on production; held in tracker `s5-programme.42` | (a) set limit values and build B15; (b) the owner's written decision to go ahead without | (a), with the audit flag waiting for B15 on production | Open |
| BF-4 | B16, wave 4 | May a member's registration payment and withdrawal audit rows, which carry the member's Clerk actor, go on the chain of the tenant that owns the event? Also covers webhook rows for a tenant's registration (wave 8's A13a) | (a) owning tenant's chain; (b) Stellr's chain; (c) the platform chain | (b) Stellr's chain, as built, until decided | Open |
| BF-5 | B16, wave 4 | Accept the Active CPU and row cost of one extra `auth()` and one `after()` write per audited member or community request; and are read-like GETs (downloads, survey open, withdraw preview) audited at all? | (a) accept, and audit those GETs; (b) accept, GETs not audited; (c) sample | Measure on `dev` during P1, then decide; GETs not audited meanwhile | Partly settled: gates production only (`W7-17`) |
| BF-6 | C13, wave 4 | Member uuids in audit metadata for moderation, role and roster operations. These rows can concern minors and cannot be purged | (a) keep uuids; (b) strip them before production; (c) keep with a recorded basis | (b) until decided: removing them is a small code change while the flag is off on production | Partly settled: gates production only (`W7-17`); `docs/PLATFORM-AUDIT.md` sentence still owed |
| BF-7 | C15, wave 4 | Which chain do the seven `platform_destined` events belong on: Stellr's, the platform's, or the owning tenant's where known? Decide before audit is on with a second tenant | (a) Stellr's; (b) platform; (c) owning tenant's | (a), as built, until a second tenant has records | Open |
| BF-8 | C15, wave 4 | Extend BF-1's decision and its legal input to `deletion.entity.delete`, `member.record.merge` and `deletion.request.review`, which store the uuid of an erased member or participant, possibly a minor, in a table with no retention path | (a) same answer as BF-1; (b) separate answer | (a) | Open |
| BF-9 | C10, wave 3 | `OPERATIONAL_WRITERS`' `lib/app-errors` entry (`lib/security/audit-coverage.ts`) also covers `authz_mismatch` rows, which carry a validated `members.id` and skip the scrubber | (a) accept; (b) give them a separate named entry | (b): a separate entry makes the exemption visible | Open |
| BF-10 | Owner gates | Audit exemptions for anonymous writes. `AUDIT_EXEMPTIONS` is empty; proposed for `contact`, `subscribe`, `lp-lead`, `white-paper`, `join-network`, `host-event`, `asset-request` and `csp-report` (`docs/TENANCY-S5.md`, Gates) | (a) approve the list with reasons; (b) audit them | (a) with a reason per route, each on the register | Open |
| BF-11 | Owner gates | The sign-in consent gate: `childAwaitingConsent` and `childAwaitingConsentBlock` record through the activity log. Do they also need a platform audit event? | (a) yes; (b) activity log is enough | (a): one event per block, with no member uuid until BF-1 is answered | Open |

## Gate: any non-memory `RATE_LIMIT_STORE` on production

| Id | From | Question | Options | Safe default | Status |
|---|---|---|---|---|---|
| BF-12 | A9, wave 4 | Whether check-in's by-name path gets an unsuffixed per-IP cap ahead of the store call. A venue's shared IP would feel it | (a) add the cap; (b) no cap, watch `rate_limit_hits` | Decide from P5's rows on `dev` | Partly settled: no cap on `dev` before P5 (`W7-20`); production open |
| BF-13 | B4, wave 2 | Does the nightly backup hold the hashed limiter counters? | (a) exclude `rate_limit_hits` from `ops/backups/backup.sh`; (b) keep them and say so in `docs/RUNBOOK-backups.md` | (a): counters are disposable and keyed by HMACs of IPs and names | Open |

## Gate: `AUTHZ_SOURCE=shadow`, then `postgres`, on production

| Id | From | Question | Options | Safe default | Status |
|---|---|---|---|---|---|
| BF-14 | C10, wave 3 | Sampling for shadow decisions. `lib/authz.ts` has no sampling (`docs/AUTHZ.md`, "Shadow reads are not sampled"). It comes before `lib/store/auth.ts` leaves `HELD_WRAPPERS`, which C23 needs | (a) sample admin reads only; (b) no sampling, measured; (c) split `store/returns`' member PATCH from the catalogue check | (b) on `dev` with Active CPU read; no member-serving call site moves to `lib/authz` until decided | Open |
| BF-15 | C15, wave 4 | Route by route for the 9 `platform_destined` routes: owner-only, or Stellr staff? Seven answer from the Clerk claim under every source until C25 | (a) owner-only (`platform_admins`); (b) Stellr admins | (b) for now: it keeps today's access | Open |
| BF-16 | C15, wave 4 | May C25 convert these claim checks to `isStellrAdmin` while BF-15 is open? | (a) yes; (b) wait | (a): keeps mapped Stellr admins, and is not the owner-only choice | Open |
| BF-17 | C9, wave 2 | Run `scripts/map-tenancy-roles.ts --check` on `dev`, then production, before shadow, and decide what to do with stale rows. Should a Clerk revoke through `set-admin` go ahead when the Postgres write is refused? | (a) revoke goes ahead, drift reported; (b) refuse the revoke | (a): removing access should never be blocked; `--check` reports the drift | Open |
| BF-18 | B20, held | The `proxy.ts` admin prefilter under `postgres`: sync a Clerk claim from `tenant_memberships`, or relax the proxy to signed-in-only and rely on the page guards (`docs/AUTHZ.md`, precondition 8). Held in tracker `s5-programme.42` | (a) sync the claim; (b) signed-in only | (a): keeps the proxy database-free and today's confinement | Open |

## Gate: routing on a real zone (`TENANT_ROUTING_ENABLED` with a zone attached)

| Id | From | Question | Options | Safe default | Status |
|---|---|---|---|---|---|
| BF-19 | B5, wave 2 | Add to "Real tenant hosts": routing stays off on any deployment with a zone until B5c and B10(d) pass, and A7, C6 and B10(c) pass | (a) add it; (b) leave as is | (a) | Partly settled: `docs/TENANCY-S5.md`, "Owner gates", Real tenant hosts, covers B6 and the icon decision; the register should hold the full rule |
| BF-20 | B5c, wave 4 | Icons and web manifest on tenant pages link Stellr's files. Moving them changes Stellr's live icon URLs | (a) leave until S10; (b) move them now | (a) until a real zone attaches; decide before that | Open |
| BF-21 | B6, B10, wave 4 | Per-request rendering or ISR for tenant pages, once the first canary zone shows its Active CPU and CMS volume. Choosing per-request closes B10(b) | (a) per-request with the enforcing nonce CSP; (b) ISR with a weaker host policy | (a), as built, measured during K9 phase B | Open |
| BF-22 | B10a, wave 3 | Check (a) never compares signed-in or real-record pages with routing on. Accept, or give it a slice | (a) accept, checked by a person at D7 sign-off; (b) a slice | (a) | Open |
| BF-23 | B10, wave 4 | Whether the route-by-route Stellr-host outcomes in `e2e/tenancy/host-cases.ts` stay in the public repo as worded, or become totals and a hash; which capability-token outcomes on Stellr's hosts to accept at the gate | (a) keep as worded; (b) totals and a hash | (b) once the repo is still public at the gate; tokens accepted only route by route with a reason | Open |
| BF-24 | C6, wave 2 | Whether per-route lists of differing refusals stay public or become totals and a hash (a CI artifact is not an option on a public repo); which capability-token outcomes to accept before the S5 gate | as BF-23 | as BF-23; the 5 accepted reasons in `test/idor/idor-snapshot.json` reviewed by the owner | Open |
| BF-25 | Owner gates | The final tenant-host allow-list (`lib/tenancy/tenant-surface.ts`) | (a) as built, deny by default; (b) widen route by route | (a): each new route moves from `pending` only with its own tenant-host case | Open |
| BF-26 | Owner gates | The tenant-tree segment: `%5Ft` for `/_t`, or `/t` | | Built as `app/%5Ft` in B5 (#534) and on production since #548 | Settled, to record |
| BF-27 | Owner gates | Where tenant staff work: an admin surface on their own host, or the platform app host with a tenant switcher | (a) own host, after `lib/authz` membership checks and S6 MFA; (b) platform host with a switcher | Neither yet: `/admin` is a 404 on tenant hosts until S6 (`docs/TENANCY-S5.md`, Risks) | Open |

## Gate: the first non-owner tenant on production

| Id | From | Question | Options | Safe default | Status |
|---|---|---|---|---|---|
| BF-28 | A3, wave 2 | A tenant tightens an event and an existing participant no longer qualifies | (a) keep refusing the change; (b) apply to new writes and report the affected people to staff | (a), as built (`docs/TENANCY-S5-registration.md`, Owner decisions) | Open |
| BF-29 | Owner gates | Live tenant events with no start date | (a) refuse registration; (b) take age on today in the event's time zone | (a), as built: both the API and the trigger refuse | Open |
| BF-30 | A7, owner gates | Should `register/group` get `childAwaitingConsentBlock`, as `individual` and `group-join` have? | (a) yes, as its own tested change; (b) no | (a), built as a deliberate change with its own tests, not inside a refactor | Open |
| BF-31 | A0, A4, A5, wave 2 | The remaining decisions on how the register routes treat an existing member's record and what they answer. Two were settled on 5 Nov (A5, A6); the rest are in the private slice reports, because the behaviour is live and the repo is public | owner reviews the slice reports | Today's behaviour stands | Open |
| BF-32 | A5, wave 2 | People an organiser enters on the group form: with no session, naming someone on file still links them to the group. What else is held back until they confirm? | (a) hold the link until the named person confirms; (b) link, but show nothing about them | (b), as built: their profile is not rewritten | Open |
| BF-33 | B0, wave 2 | `C4-F5`, the store catalogue: give it a tenant, or accept the outcome with a written reason | (a) tenant column; (b) accept, store is Stellr-only | (b), consistent with BF-52 | Open |
| BF-34 | B0, wave 2 | The access rule for a library file that has lost its last attachment | (a) staff only; (b) its uploader and staff | (a) | Open |
| BF-35 | B3, wave 2 | `alumni-upgrades`, `campaigns`, `campaign-drip` and `campaign-events` pick people from shared `members` with no tenant limit; tenant registrants could receive Stellr marketing or Alumni grants. Wave 7 named B23 for it, waiting on what counts as a Stellr member | (a) B23 limits them to Stellr's members; (b) accept | (a): no tenant-only person receives Stellr marketing; B23 before the first tenant event | Open |
| BF-36 | B3, wave 2 | Retention for inactive tenants: `survey-retention` is assumed to keep running for them | (a) keep running; (b) stop with the tenant | (a): retention deletes, so stopping it would keep data longer | Open |
| BF-37 | B8, wave 3 | Should a tenant event write `event_participations` and the activity log? Set to no, because Stellr's account and staff pages read them with no tenant scope | (a) no; (b) yes, after a slice scopes those reads | (a), as built | Settled, to record (confirm) |
| BF-38 | B11, wave 3 | The agent-written reason on the service-role ratchet entry for `scripts/hubspot-sync-event-options.ts`, or have the script pass `allTenants: true` | (a) confirm the reason; (b) `allTenants: true` | (a): `allTenants` would let a manual `--apply` write another tenant's events to Stellr's portal | Open |
| BF-39 | C14, wave 3 | Should a member purge also protect a login holding only a `duty_holder` membership or `admin_duties` row? Today it counts `admin` and `event_manager` | (a) extend; (b) keep | (a): protecting more logins from deletion is the safe side | Open |
| BF-40 | C14, wave 3 | Add to Owner gates: before the first non-owner tenant on production, view-as refuses a target tied to that tenant until S6 support mode exists | (a) add; (b) not | (a) | Open |
| BF-41 | C14, held | The C14 remainder: the member layout and `NavUserButton` read Clerk claims. Held in tracker `s5-programme.42` | (a) convert in C21; (b) leave until C25 | (a) | Open |
| BF-42 | C0b, wave 3 | `participants_membership_id_seq` also feeds `members.membership_id`, so numbers are shared across tenants | (a) keep the shared counter; (b) per-tenant numbering | (a): numbers reveal only a count; revisit if a tenant objects | Open |
| BF-43 | C0b, held | The composite foreign key: name its slice after A10 to A12, or record that the carry trigger is enough. Held in tracker `s5-programme.42` | (a) a slice after every unhinted embed is hinted; (b) carry trigger is enough | (b) until A11 and A12 land, then decide | Open |
| BF-44 | B5d, held | Tenant-scoped data caches (cache keys and tags carry the tenant) for the 5 data-cache users. Deferred to S8 or S9 in wave 7. Held in tracker `s5-programme.42` | (a) build in S5; (b) S8 or S9 | (b), with no tenant price or event data cached before then | Open |
| BF-45 | B17, wave 4 | An alert contact for each tenant. With no active tenant admin, or after a failed lookup, admin alerts are dropped and logged | (a) a per-tenant alert contact; (b) a platform-ops fallback that strips personal data | (b) until tenants are onboarded, then (a) as an onboarding field | Open |
| BF-46 | B17, wave 4 | Do a suspended tenant's admins still receive alerts about its records? `tenants.status` is not read today | (a) yes; (b) no, platform ops instead | (b) | Open |
| BF-47 | B17, wave 4 | When the events-mirror read fails while an event email is built, keep Stellr's assignments for the manager audience, or leave managers out of that send | (a) keep, as now; (b) leave out | (b) for a non-Stellr event once one exists; (a) is safe while every event is Stellr's | Open |
| BF-48 | C13, wave 4 | The disposition register: are `training/assignments` and `training/tracking` release-1 tenant features? If they stay Stellr products, they and the pilot routes that read by event or cohort need a named gate or a C6 disposition entry | (a) tenant features; (b) Stellr-only | (b), each with a disposition entry before the first non-owner tenant | Open |
| BF-49 | C16, wave 4 | How far a guardian's credential opt-out recorded by one organiser reaches. As built it touches that tenant's rows only, except under `LOADSCOPED_MODE=off` where Stellr's stays global | (a) per tenant; (b) everywhere the child appears | (b) for a guardian's withdrawal of consent, which the privacy policy promises; needs a slice | Open |
| BF-50 | C16, wave 4 | Does a media opt-out signed on another organiser's form bind a tenant's do-not-use list? As built it does, but the tenant's CSV can show the other form's signing date and reason | (a) bind, show only "opted out"; (b) do not bind | (a), with the other form's date and reason hidden from the tenant | Open |
| BF-51 | C18, wave 6 | How the companies area is confined for Stellr's admins before the first tenant event | (a) `LOADSCOPED_MODE=enforce`; (b) `AUTHZ_SOURCE=postgres`; (c) an owner check (#624) | (a), already required before the consent flag (`W7-14`) | Open |
| BF-52 | C18m | Store offerings and the merch batch on an event: C23 (tenants get a store) or Stellr-only for good. See [What "C18m" means](#what-c18m-means) | (a) C23; (b) Stellr-only for good | (b): tenant staff get today's 503 and another tenant's event answers 404 | Open |
| BF-53 | Owner gates | Cron fairness: how per-tenant crons share one run's time budget | (a) round-robin with a per-tenant cap; (b) Stellr first | (a), with Stellr's run never starved (B3's failure isolation) | Open |
| BF-54 | Owner gates | The disposition register's split (51 / 9 / 55 / 16 in `docs/TENANCY-S5.md`, Owner gates) | owner reviews each class | Every unreviewed route stays `stellr_only` | Open |
| BF-55 | D6, wave 3 | Name a slice for `group-invoice-sync` | | Named B22 in wave 7's plan; it opens wave 8 if not built (`docs/PLAN-S5-wave8-DRAFT.md`) | Settled, to record |

## Gate: priced tenant events (S9)

| Id | From | Question | Options | Safe default | Status |
|---|---|---|---|---|---|
| BF-56 | A7, wave 5 | A tenant event with an explicit $0 Stripe price is treated as priced and refused. Should $0 count as free? | (a) $0 is free; (b) priced, refused | (b), as built, until S9 | Open |
| BF-57 | A7, wave 5 | The tenant tree's pay-seat page shows a Pay button the API refuses for a tenant's seat | (a) hide the button; (b) S9 opens tenant payments | (a) before routing on any zone | Open |
| BF-58 | A7, A8, wave 5 | Which slice, A8 or S9, gives the organiser-side payment writers (`changeGroupPaymentMethod` in `lib/group-payment-change.ts`, and the team payment-link route) their tenant checks | (a) A8b in wave 8; (b) S9 | (a): checks land before any priced tenant event | Open |
| BF-59 | A8, wave 6 | Before S9, should the roster writers also check the event's current price, not only the registration's money columns? | (a) yes; (b) no | (a) | Open |

## Gate: guardian consent on production (`TENANT_GUARDIAN_CONSENT_ENABLED`)

None of these gates wave 7 or wave 8: `dev` uses a placeholder document (`W7-6`). All are listed in `docs/TENANCY-S5.md`, "Owner decisions wave 6 raised".

| Id | From | Question | Options | Safe default | Status |
|---|---|---|---|---|---|
| BF-60 | A16 | The consent document's wording, with legal input. Only platform staff can publish it | owner and counsel draft | No document on production, so every tenant minor is refused | Open |
| BF-61 | A16 | Guardian identity assurance: an emailed link to an address that is none of the registrant's, plus the birth-year question and the attestation at signing | (a) enough, matching Stellr's own minor consent; (b) stronger | (a) | Open |
| BF-62 | A16 | Caps: 5 invitations a day per guardian address across every organiser; 30 an hour per organiser | (a) as proposed; (b) other values | (a) | Open |
| BF-63 | A16 | The consent window: 14 days, or until the event starts if sooner | (a) as proposed; (b) other | (a) | Open |
| BF-64 | A16 | The new wording: `GUARDIAN_REQUIRED_MESSAGE`, `GUARDIAN_CONSENT_BUSY_MESSAGE`, the door and desk refusals, the confirmation page line, the five registrant notices, and the document title | owner approves or rewords | Built as proposed, flag off | Open |
| BF-65 | A16 | Moving a participant to another registration needs a fresh guardian signature (as built, consent resets to pending) | (a) confirm; (b) carry the signature | (a) | Open |
| BF-66 | A16 | A group check-in with one consent-pending member gets a 409, and nobody in the group is checked in (tracker `s5-programme.24`) | (a) keep; (b) check in the rest and return the held names | (a) until (b) is built and tested | Open |

## Gate: `TENANT_DB_ENABLED` on production

| Id | From | Question | Options | Safe default | Status |
|---|---|---|---|---|---|
| BF-67 | C11t, wave 6 | Which PEM goes in `TENANT_DATABASE_CA_CERT`: the provider's published root CA, or a bundle. Decided by the pooler TLS canary's run (P6) | (a) root CA; (b) bundle | (a) if it verifies; never a weaker `sslmode` (`W7-7`) | Partly settled: rule approved (`W7-7`); P6 not run (tracker `s5-programme.30`) |
| BF-68 | C18, wave 6 | Add `tenant-db` to branch protection on `main` | (a) add; (b) `dev` only | (a), with the owner's yes (`W7-32`) | Partly settled: required on `dev` (tracker `s5-programme.5`) |
| BF-69 | `W7-18` | How `TENANT_DATABASE_URL`, which holds the password the owner keeps (`W7-7`), reaches the Vercel project without passing through an agent | (a) the owner enters it in the dashboard; (b) the owner runs the CLI | (a) | Open (asked at P6) |

## Gate: CI and the S5 sign-off

| Id | From | Question | Options | Safe default | Status |
|---|---|---|---|---|---|
| BF-70 | C5a, wave 2 | Turn on the required code-owner ruleset (`.github/CODEOWNERS` only requests review until then), and confirm a PR label is enough to raise a ratchet | (a) ruleset now, label plus owner review to raise; (b) label alone | (a) (`docs/RUNBOOK-agent-controls.md`, section 2) | Open |
| BF-71 | ci.yml | `e2e-local` is report-only and not a required check (`.github/workflows/ci.yml`, the `e2e-local` job) | (a) make it required once it agrees with `e2e`; (b) keep report-only | (b) until its agreement runs are recorded | Open |

## Gate: the SMMA sign-off

| Id | From | Question | Options | Safe default | Status |
|---|---|---|---|---|---|
| BF-72 | D6, wave 3 | The SMMA self-assessment, held privately (tracker `s5-programme.38`): public or private, and the AU under-16 feature set for Stellr's community | owner decides | Stays private; tenant hosts keep the community fence (`docs/S5-CRONS-LIMITS-SMMA.md`) | Open |

## Settled since the wave tables, to link rather than ask

These are answered in the wave tables or the register already. The record slice adds `REF` rows for them, so nobody asks again: B5's host-keyed matcher entry (5 Nov 2026); B18's `teacher-grant` follow-up (#566, promoted in #561); A9's limiter store write in `OPERATIONAL_WRITERS` (9 Nov 2026, #576); the tenant email share (9 Nov 2026); `postgres` for C11 (9 Nov 2026); A7's guardian-consent route, refusal copy and member-profile rule, which also settles B5b's prefill question (10 Nov 2026); B14's admin copy and the signing engine's tenant sender (10 Nov 2026); C16's follow-up on tenant payment-method changes after S9 (10 Nov 2026); C11's `verify-full` rule and the `tenant-db` job from C18 (10 Nov 2026); TB3 E (`REF-2`); the A16 CODEOWNERS lines (`PR625-1`). Each is in `docs/TENANCY-S5.md` under its wave.

## C13's wave 4 follow-ups (T-44)

Tracker row `s5-programme.44` says these were held in the private handover only. They concern C13's 42 audited pilot handlers (`docs/TENANCY-S5.md`, "Wave 4 status", the C13 row; T-44c is also noted there under "The audit actor") (community, academy, training, coaching and entitlements admin). Each needs a C6 disposition entry or a named gate before the first non-owner tenant. None changes Stellr's behaviour today.

| Id | Gate | Finding | Options | Safe default | Status |
|---|---|---|---|---|---|
| T-44a | First non-owner tenant | The space add-source action under `spaces/[id]` pulls event-participation cohorts with no tenant filter, so a tenant event's cohort could be added to a Stellr space | (a) filter to Stellr's events; (b) disposition entry: community is Stellr-only and tenant events write no participations (BF-37) | (a): a one-line Stellr-scope filter, plus the disposition entry | Open |
| T-44b | First non-owner tenant | Remove-post and dismiss-flag act on a flag by id without checking it belongs to the space in the path | (a) check the flag's space; (b) accept, admin-only | (a): it is also a plain IDOR fix for Stellr | Open |
| T-44c | Platform audit on production | All 42 pilot handlers audit with the session actor inside `after()`, which is unproved: the session may not be readable after the response | (a) prove one real row on `dev` during P1; (b) capture the actor before the response | (a), then (b) if the row lacks its actor | Open |
| T-44d | Platform audit on production | Active CPU: `recordAuditFailure` imports `lib/app-errors` eagerly; a lazy import would keep the mailer out of the 29 pilot routes' import closure (`docs/TENANCY-S5.md`, Risks, Active CPU) | (a) lazy import; (b) leave | (a) | Open |

## Scoping questions with no recorded answer (DEC-SCOPE-OPENQ)

From the S5 scoping output of 4 Nov 2026. A search of the S5 docs on `dev` finds no answer to these.

| Id | Gate | Question | Options | Safe default | Status |
|---|---|---|---|---|---|
| SQ-1 | Routing on a real zone | `llms.txt` on tenant hosts (robots and sitemap are answered: Disallow all until S10, `docs/TENANCY-S5-routing.md`) | (a) 404 until S10; (b) tenant-specific | (a) | Open |
| SQ-2 | First non-owner tenant | Is there a feature that moves a registration to another event (a transfer)? A3's companion trigger on `registrations` assumes such updates can happen | (a) no such feature, trigger stays as a backstop; (b) yes, specify it | (a) | Open |
| SQ-3 | First non-owner tenant | Does the in-app notification bell (`lib/notify.ts` writing `community_notifications`) count as social? `lib/registration-checkout.ts` reaches it today | (a) social, banned on tenant surfaces, email-only for tenant events; (b) not social | (a) | Open |
| SQ-4 | First non-owner tenant | Where the tenant "My events" page lives (under the tenant tree, not `/community/events`) and which lane owns it | (a) Lane B under `app/%5Ft`; (b) Lane A | (a), built in S10 with the community decoupling | Open |
| SQ-5 | Routing on a real zone | Host-map cache TTL: 60 seconds proposed. Is a new or suspended tenant taking up to a minute per warm instance acceptable, or should suspension purge through a revalidation hook? | (a) 60 s; (b) 60 s plus a purge on suspension | (b) | Open |
| SQ-6 | `AUTHZ_SOURCE=postgres` | Is the production flip to Postgres authority part of S5, or S6's "authority moves" item? | (a) S5 ships the switch and shadow, the flip is S6's first step; (b) all in S5 | (a), which matches C25 "may be the first S6 step" (`docs/TENANCY-S5.md`, Lane C) | Open |
| SQ-7 | `AUTHZ_SOURCE=postgres` | An `event_manager` membership as an explicit row (dual-written) or implied by an assignment | (a) explicit row, assignments stay the authority for which events; (b) implied | (a), as built (`docs/AUTHZ.md`, Role mapping) | Settled by build, to record |
| SQ-8 | First non-owner tenant | Does any tenant role below admin grant portal access? Stellr's duty holders never open `/admin` | (a) no portal access below event manager; (b) yes | (a) (`docs/AUTHZ.md`: `duty_holder` never opens `/admin`; tenants get no scopes in release 1) | Settled for Stellr, open for tenants |
| SQ-9 | S7 | Do group ownership (`ownsTeam` in `lib/team-access.ts`) and self-ownership queries become authz resource predicates in S5, or wait for S7 identities? | (a) wait for S7; (b) S5 | (a): they are participant-class, outside staff convergence | Open |
| SQ-10 | S5 sign-off | Delete a converted area's service-role path once flipped and stable? After how many clean days? | (a) delete after N clean days; (b) keep both | (a) with N = 30, matching the 30-day checklist | Open |
| SQ-11 | S5 code quality | Typed rows for the SQL modules: hand-written types, zod at the boundary, or generated `lib/database.types.ts` | (a) hand-written; (b) zod; (c) generated | (a) until a generated file is approved | Open |
| SQ-12 | First non-owner tenant | Before S7 tenant profiles, may tenant staff open a member detail page, or only the participant record under their event? | (a) participant record only; (b) member page | (a): the 16 `members/*` routes stay `stellr_only` | Open |
| SQ-13 | `AUTHZ_SOURCE=shadow` | Source of truth for event-manager scope inside `loadScoped`: `event_manager_assignments` or `tenant_memberships` | (a) assignments; (b) memberships | (a), as built (`docs/AUTHZ.md`: assignments stay the authority) | Settled by build, to record |
| SQ-14 | First non-owner tenant | `event-emails` uses Mountain time everywhere. Should tenant events use the event's time zone in S5, or wait for S8? | (a) S8; (b) S5 | (a): Stellr stays on Mountain either way; no tenant event email before S8 sends on the wrong day without a check | Open |
| SQ-15 | Non-memory limiter on production | Should limiter keys on tenant hosts include the tenant id for every route, or only per-event routes? | (a) every route; (b) per-event routes only | (a): abuse on one tenant then never throttles another or Stellr | Open |

**Scoping questions answered elsewhere** (link them; do not ask again): a malformed id answers the route's own 404 (`docs/TENANCY-S5-data.md`, `LOADSCOPED_MODE`); scopes stay Stellr-only in `admin_duties` (`docs/AUTHZ.md`); `/admin` is a 404 on tenant hosts until S6 (`docs/TENANCY-S5.md`, Risks); robots and sitemap on tenant hosts (`docs/TENANCY-S5-routing.md`); the tenant-tree segment (BF-26); per-request rendering or ISR (BF-21) and where tenant staff work (BF-27) are carried as wave entries above. Two more scoping questions are recorded only as risks, and the record slice should ask them as entries: the static assets and `/api/img` that bypass the proxy and stay Stellr-branded on tenant hosts, and the 21 unscoped `next.config` redirects (`docs/TENANCY-S5.md`, Risks, "Bypasses on tenant hosts"); default for both: accepted until S10's brand sweep.

**One more scoping question that wave 8 depends on:** which admin areas are tenant features in release 1. Proposed default: credentials and surveys become tenant features later, behind `W7-9` and the survey hold (`W7-16`); scholarships, the store and DocuSign stay Stellr-only (decision 15; BF-52). Owner decides. The record slice gives it an id; `docs/PLAN-S5-wave8-DRAFT.md` cites it as SQ-16.

## What "C18m" means

The only earlier use of "C18m" is in the private wave 7 plan, which lists "B20 and C18m (decision only)" among the items wave 7 left out. It is not defined in any committed record.

**Working definition (inferred; the owner confirms):** C18m is the **C18 merch decision**, the one part of C18's leftovers that needs an owner decision rather than code: whether an event's **store offerings and merch batch** (`app/api/admin/events/[slug]/offerings` and `merch/commit`, read through a `StellrOnlyDb`) move to C23 so tenants get a store, or stay **Stellr-only for good** (`docs/TENANCY-S5-data.md`, "What C18 converted, and what it left"). It is entry BF-52 above.

The other two C18 leftovers, the participant company move and Auto-Assign with `override`, are code with proposed slices (Lane A's grants slice and A10), not decisions, so they are not C18m. If the owner meant something else by C18m, BF-52 stays as written and C18m gets its own entry.

## For the record slice

1. Move each entry into `docs/S5-DECISION-REGISTER.md` under the same gate heading, with a register id and "Open" in the Answer column; add the `REF` rows for the settled ones.
2. Remove the matching lines from the register's "Not in this register yet" and tick tracker rows `s5-programme.41` and `.44` when every entry is in.
3. Bring the open entries to the owner about 5 at a time, each with its safe default, citing register ids only.
