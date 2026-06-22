# Access Convergence Plan — one container model for all space types

Status: PROPOSED (not started). Authored 2026-06-22.

## Context — why this exists

Stellr's access *resolution* layer is complete and correct (`lib/community.ts`,
`lib/sessions.ts`, `lib/containers.ts`, `lib/object-roles.ts`). The pain is on the
**admin side**: the four "spaces" a member can access are each granted by a different
mechanism, through a different screen, and two of them have no admin grant path at all.

| Space type | Granting row today | Admin path today |
|---|---|---|
| Training course | `content_entitlements` (by tier) | Access Map drag — tier-level only, can't grant one person |
| Mentoring cohort | `cohort_members` row | Sessions Manager — works |
| Coaching workshop | `sessions` + `session_participants` | none — member self-books |
| Competition | `event_participations.content_tier` | none — member self-registers / pays |

Two findings from the 2026-06-22 deep dive drove this plan:

1. **The container generalisation (migration `040`) is schema-only.** `container_type`
   values `event_participation` / `campaign_participation` exist in the CHECK constraint
   but **no code ever creates them**. Competitions resolve through a wholly separate path
   (`registrations` → `participants` → `event_participations.content_tier` → a
   `campaignTiers` map rebuilt on every member load). So "convergence" = building the
   competition→container path for the first time.

2. **Payment & DocuSign are NOT access gates today.** `memberCanAccess` only checks
   entitlements + prerequisites. Payment/DocuSign are tracked and shown as roster pills
   (`lib/event-admin.ts` `getEventRoster`) but nothing blocks a member who hasn't paid or
   signed. There is no `accessUnlocked()` function. Enforcing gates is **net-new behavior.**

## Decisions locked (2026-06-22)

- **D-A. Admin grants respect the gates** — an admin-added member still must clear
  payment / DocuSign / prerequisites before access unlocks (no override path for now).
- **D-B. Full convergence** — all four space types move onto the container + roster model.
- **D-C. Training is an enrollable container too** — enrollment is an explicit roster row;
  a qualifying tier *auto-creates* that row rather than being a parallel resolution path.
- **D-D. Enforce gates for everyone** — no grandfathering. This makes data-quality
  (clean rosters + correct gate state) a hard prerequisite, so enforcement flips LAST.
- **D-E. Two-level containers** — an **event container** carries shared campaign content;
  **group sub-containers** (one per registered group/school) carry roster + management.
  A member's content tier lives on their group-roster row; the Teacher POC manages the
  group sub-container.

## Target model

Every space is a **container** (reusing `mentoring_cohorts` generalised by `040`).
Access for a member resolves through ONE path:

```
member on the container roster?  →  accessUnlocked(member, container)?  →  access
                                     (payment ∧ docusign ∧ prerequisites,
                                      per the container's gate profile)
```

- **Roster = the grant** (`cohort_members`): `(member_id, relationship, status, content_tier)`.
  "Registered for competition" and "invited to cohort" become the same row shape.
- **Auto-enroll**: a qualifying `content_entitlements` tier creates a roster row; the roster
  is then the single source of truth (keeps the Access Map useful, kills the parallel path).
- **Gate layer** is the only genuinely new code.

### Two-level container shape (D-E)

```
Event container          container_type='campaign_participation', campaign_ref=<event_slug>,
                         parent_container_id = NULL
  └─ Group sub-container  container_type='campaign_participation', campaign_ref=<event_slug>,
                          parent_container_id = <event container>, registration_id = <reg>
                          roster = that group's participants (content_tier per row)
                          manager = Teacher POC / Student Manager via object_roles
```

- **Shared event content** (campaign_material, training) resolves against the **event** container.
- **Roster / management / gates** resolve against the **group** sub-container.
- Member "is a participant of event X" = on the roster of any sub-container whose
  `campaign_ref = X` (or the event container itself, for individually-registered members).
- Content tier for event content = max tier across the member's roster rows under that event.

### Gate profiles (resolves the nuance behind D-D)

`accessUnlocked()` reads a per-container-type profile; non-applicable gates auto-pass so
"enforce for everyone" never locks people out of free spaces.

| Container type | payment | docusign | prerequisites |
|---|---|---|---|
| campaign_participation (competition) | ✓ | ✓ | ✓ |
| coaching | ✓ (session credits/paid) | per role | – |
| mentoring | – | – | ✓ (linked modules) |
| training | – | – | ✓ |
| space (free community) | – | – | – |

## Phases

Build & backfill first; flip enforcement last.

### P0 — Backfill & reconcile (no behavior change)
- **Migration** (`061_container_convergence.sql`):
  - `mentoring_cohorts`: add `parent_container_id uuid REFERENCES mentoring_cohorts(id)`,
    `campaign_ref text`, `registration_id uuid`, `content_tier text` (CHECK core/baseline/advanced/premium).
  - confirm `cohort_members.status` exists (migration `052`, values invited|active) and
    `relationship` (migration `040`); add `content_tier text` to `cohort_members`.
  - backfill: for each event with `event_participations`/`registrations`, create the event
    container + one group sub-container per `registrations` row, then `cohort_members` rows
    per participant carrying `content_tier`. Idempotent (keyed on campaign_ref + registration_id).
- **Reused**: `lib/event-participation-sync.ts` (`applyCampaignContentTier`,
  `recordEventParticipation`) shows the existing cascade to mirror.
- Output: containers + rosters exist alongside the legacy tables. Nothing reads them yet.

### P1 — Unify resolution (read from roster)
- `lib/community.ts` `getCurrentMember`: build `campaignTiers` from `cohort_members` +
  `mentoring_cohorts` (campaign sub-containers) instead of `event_participations` (lines ~116-130).
- `lib/event-portal.ts` `getMemberEvents` / `memberIsParticipant`: roster lookup instead of
  `participants` table (mirror `lib/sessions.ts` `getCohortSpace` roster check).
- Training/coaching enrollment also become roster rows (D-B, D-C). Entitlement engine
  (`memberHasEntitlement`, `memberCanAccess`) is UNCHANGED — only the source of
  `campaignTiers` moves.
- New writes: registration/Stripe confirm + admin grant write `cohort_members` rows
  (extend `applyCampaignContentTier` to upsert containers/rosters, not `event_participations`).

### P2 — `accessUnlocked()` in report-only mode
- New `lib/access-gates.ts`: `accessUnlocked(member, container) → { payment, docusign,
  prerequisites, unlocked, profile }`. Extract the per-participant aggregation from
  `lib/event-admin.ts` `getEventRoster` (lines ~81-164) into a member-scoped function;
  fold in existing `prerequisitesMet` (`lib/community.ts`).
- Wire into member portal (`app/(member)/community/events/[slug]/page.tsx`), chat
  (`lib/sessions.ts` `canAccessChannel`), and materials (`lib/event-portal.ts`) in
  **report-only**: log what *would* block via `logActivity`, do not deny yet.
- Output: a clean signal of who would be locked out — used to fix rosters before P4.

### P3 — Unified admin surface
- Extract `components/admin/community/ContainerRoster.tsx` from `SessionsManager.tsx`
  (add / bulk-add / invite / remove / content-tier), reused across all four types.
- **Direct admin grant** for competitions & coaching (the two missing add-paths): admin
  upserts a `cohort_members` row via the roster component + `MemberPicker`
  (`components/admin/MemberPicker.tsx`, already wired everywhere).
- **"All access in one place"** panel on `components/admin/AdminMemberDetail.tsx`: read every
  container the member is on (cohorts, competitions, training, coaching, spaces) + tier +
  per-row gate status, with inline add/remove. Answers "what does this person have, change it."
- Group sub-container manager = existing `object_roles` (`lib/object-roles.ts`,
  `/admin/delegations`), keyed off Teacher POC ownership.

### P4 — Flip enforcement (D-D)
- Once P2 report-only is quiet (rosters clean), turn `accessUnlocked()` from report-only to
  enforcing in portal/chat/materials. Single feature flag so it can be toggled per environment.

## Risks
- **Lockout on flip (D-D).** Mitigated by P2 report-only + P0 backfill running first. Do NOT
  enforce until reports are empty.
- **Dual-read window.** P1 reads roster while legacy `event_participations` still exists; keep
  both until P4, then deprecate the legacy content_tier path.
- **Two-level complexity (D-E).** Resolution must walk parent/child; keep the
  "any sub-container under this campaign_ref" query in one helper to avoid drift.
- **Git**: per project convention, never push remotely — user commits/pushes manually.
  Apply migration via `supabase db push` from repo root (not `~`).

## Verification
- `npx tsc --noEmit` clean after each phase.
- P0: query the new containers/rosters vs `event_participations` counts — must match.
- P1: a known competition participant still reaches `/community/events/[slug]`; a
  non-participant still 404s. Mentoring/coaching unaffected.
- P2: with a deliberately unpaid/unsigned test member, confirm a report-only log entry
  appears but access is NOT yet denied.
- P3: from `AdminMemberDetail`, add a member to a competition and a coaching workshop;
  confirm the `cohort_members` row + roster reflect it.
- P4: same unpaid member is now denied; after clearing payment + DocuSign, access unlocks.
- Run the app via the `run` skill / preview tools and exercise the member portal end-to-end.
