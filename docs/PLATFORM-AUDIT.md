# Platform audit log (S4)

`public.platform_audit_events` is the audit primitive of the multi-tenancy
plan (S4). It is append-only, including against the service role, and
hash-chained, so an edited or removed row can be detected. S5 adds `audit()`
to every mutation, and S6 shows each tenant its own slice.

**Today it runs in the background.** Nothing writes to it unless
`PLATFORM_AUDIT_ENABLED=true`, and that flag is off by default. S5 has since
wired more than half of the mutating route handlers and every cron to it, through
`lib/audit/route.ts` and `lib/cron-audit.ts`, with the actions catalogued in
`lib/audit/actions.ts`. What is still unaudited is
`test/baselines/unaudited-mutations.json`. A failed audit write never changes a
response. The order to turn it on, what it costs and what cannot be undone are in
`docs/TENANCY-S5-data.md`; the steps below are the first, view-as-only check.

## Pieces

| Piece | Where |
|---|---|
| Table, triggers, functions | `supabase/migrations/20261104300000_platform_audit_events.sql` |
| Server helper: `audit()`, `verifyChain()`, `checkRecordedHeads()` | `lib/audit/platform.ts` |
| Read-only verifier (exits 1 on a break) | `scripts/verify-audit-chain.ts` |
| pgTAP | `supabase/tests/database/platform_audit.test.sql` |
| Vitest | `lib/audit/platform.test.ts`, `app/api/admin/impersonation/route.test.ts` |
| Registry entry | `lib/tenancy/registry.ts` lists it as `platform`. Its `tenant_id` is nullable (NULL is the platform chain), so it cannot be `own`, which requires `NOT NULL`. |

## Row

| Column | Holds |
|---|---|
| `tenant_id` | The chain the row belongs to. NULL is the platform chain. |
| `chain_seq` | The row's position in its chain, counting from 1. |
| `actor`, `actor_kind` | A Clerk user id (`user`), `system`, or `cron:<job>` (`cron`). A CHECK enforces the shape. |
| `action` | A dotted lower-case name, such as `support.impersonate.start`. |
| `target_table`, `target_id` | What the action touched. `target_id` is an id: a CHECK refuses `@` and whitespace. |
| `reason` | **A short code or ticket reference** (`ticket:4521`, `support_request`), never free text. The helper stores anything that is not id-shaped as `[redacted]`. The column allows 500 characters; the helper keeps at most 80. |
| `metadata` | **Ids, counts, flags and short codes only.** Never names, emails, phone numbers, dates of birth, ages, health details or free text about a person. The helper allow-lists values: a string survives only if it is shaped like an id or a short code (a UUID, a lower-case code, or a mixed-case id with a digit or `_`; no spaces, no dates, at most 80 characters). Anything else becomes `[redacted]`, `[email]` or `[phone]`. It also splits each key into words and drops the key if any word names personal data (`studentName`, `dateOfBirthIso`, `medicalNote`, `age`, `messageCount`, …), and drops nested objects. A lower-case single word such as `asthma` still looks like a code, so the key rule is what catches it: name keys for what they hold. It is capped at 4 KB. |

Rows can never be erased (see Limits), so personal data written here could not
be removed for a privacy or COPPA erasure request without breaking the chain.
That is why the helper errs towards dropping, and why callers pass ids only.
| `occurred_at` | Set by the database, to the millisecond. |
| `prev_hash`, `hash` | `hash = sha256(prev_hash ‖ canonical(row))`. NULL `prev_hash` only on row 1. |

The canonical form is a length-prefixed text form of every column except
`id`, `prev_hash` and `hash`, version-tagged `pae1`. It is defined twice:
`platform_audit_canonical()` in SQL and `canonicalRow()` in TypeScript. A
golden vector checked by both the pgTAP and the Vitest suite keeps the two in
step. Change both together, and bump the tag.

## How it stays append-only

1. **Privileges.** `service_role` holds `SELECT` only. `anon` and
   `authenticated` hold nothing.
2. **Triggers.** `BEFORE UPDATE OR DELETE` (per row) and `BEFORE TRUNCATE` (per
   statement) raise for everyone, the table owner included.
3. **One way in.** `platform_audit_append()` is `SECURITY DEFINER`. That is
   unavoidable, because the server must append without holding `INSERT`. It
   pins `search_path = ''`, and `EXECUTE` is revoked from PUBLIC, anon and
   authenticated.
4. **The database computes the chain.** A `BEFORE INSERT` trigger takes a
   per-chain advisory lock, reads the chain's head, and then sets
   `chain_seq`, `prev_hash`, `occurred_at` and `hash`. Any value a caller
   supplies for those columns is overwritten.
5. **No forks.** `UNIQUE NULLS NOT DISTINCT (tenant_id, chain_seq)` makes a
   second writer claiming the same position fail rather than fork the chain.
   This covers, for example, a caller in REPEATABLE READ, where the advisory
   lock cannot refresh the snapshot.

## What the table owner can still do, and how it is caught

The owner (`postgres`) can disable the triggers, edit or delete rows, and
replace these functions.

| Tampering | Caught by |
|---|---|
| A row edited in place | Verification recomputes its hash. |
| A row deleted from the middle | A gap in `chain_seq`. Renumbering the later rows to hide the gap changes their hashes. |
| A row moved to another tenant's chain | `tenant_id` is inside the hash. |
| The verify function replaced so that it always passes | `verifyChain()` and the script recompute every hash in TypeScript and do not call it. |
| **The newest rows removed** | **Invisible inside the database.** Caught only by `--expect` against heads recorded earlier. |
| **A whole chain rewritten with fresh hashes** | **Invisible inside the database.** Caught only by `--expect`. |

To make the last two detectable, record the heads somewhere the database
owner cannot edit, and check them later:

```sh
npx tsx scripts/verify-audit-chain.ts --heads > heads-$(date +%F).json   # store off-database
npx tsx scripts/verify-audit-chain.ts --expect heads-2026-11-20.json      # later: every recorded head must still match
```

Exit codes: 0 means intact, 1 means a break or a moved head, and 2 means the
check could not run. Verification pages until the database returns an empty
page, not a short one, so PostgREST's Max Rows setting (a hosted dashboard
value, not in the repo) cannot end it early and hide an unread row. The script is read-only. Each tenant's chain is
independent, so a tenant can verify its own chain without seeing anyone
else's.

## Turning it on

1. Apply the migration to dev, then to production, through the Production
   migration Action. **Not on 6 Nov (Nevada).**
2. Set `PLATFORM_AUDIT_ENABLED=true` on the dev Vercel project and redeploy.
   Start and end a view-as session. Then
   `npx tsx scripts/verify-audit-chain.ts` must exit 0 and show
   `00000000-0000-4000-8000-000000000001: 2 row(s)`.
3. Production: the same, after the dev check has passed.
4. Add `public.platform_audit_events` to `ops/backups/critical-tables.txt`
   once the table is on production. Adding it earlier would fail the
   `--strict-names` dump.
5. Decide where the recorded heads are kept, and how often they are taken.
   This is an owner decision. A Hobby cron costs Active CPU.

## Limits today

- True concurrency is not tested. CI's pgTAP runs in one session, so it
  simulates concurrency with interleaved appends across chains. The advisory
  lock and the unique backstop are the guarantees.
- No retention or purge path exists. A row cannot be deleted without
  disabling the trigger, which needs the owner. Retention is a later decision,
  and its purge must record the heads it removes.
- `platform_audit_heads()` scans the table. That is fine at today's volume. S5
  can add a heads table when mutations are audited everywhere.
