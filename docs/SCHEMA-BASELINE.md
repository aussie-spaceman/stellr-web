# The database schema of record

`supabase/baseline.sql` is a `pg_dump --schema-only` of production, taken
9 Sept 2026. It is the authoritative definition of the `public` schema: 101
tables, 8 enum types, 18 functions, 98 RLS policies, 145 indexes, 11 triggers.

## Why it exists

Seeding the new dev database was the first time `supabase/migrations/` had ever
been replayed from zero. It failed three times, each on a different defect:

1. `001` assumed `participants` and `registrations` already existed — they were
   created by `supabase/schema.sql`, whose own header says "Run this in the
   Supabase SQL editor", so they were never part of the migration set.
2. `uuid_generate_v4()` could not resolve. Supabase installs uuid-ossp into the
   `extensions` schema, which is on the search path for the SQL editor and
   PostgREST but not for a `supabase db push` session.
3. `003` referenced `public.members` — and **no file in this repository has ever
   created that table.** Seven migrations carry "run in the SQL editor"
   instructions; the DDL for the central membership table was applied by hand
   and never committed.

So the migration history cannot rebuild the database, and until this dump the
schema existed in exactly one place: the live production database. That is a
disaster-recovery gap, and the reason no environment was ever reproducible.

## What this changes

- **The repository now contains the schema.** Production could be rebuilt.
- **A new environment is one command**, rather than an archaeology exercise.

## What it does not change

`supabase/migrations/001`–`148` remain **historical, not replayable**. They are
kept as the record of how production evolved. Do not attempt a replay from zero;
load the baseline instead. The fix in `005` and `008` (adding
`set search_path = public, extensions;`) is kept because it is correct
regardless, but it does not make the set replayable — the missing `members` DDL
does that, and it is not recoverable from this repo's history.

## Standing up a new database

```bash
# 1. Schema. Requires psql 18+ — pg_dump 18 emits a \restrict directive.
#
# --set ON_ERROR_STOP=1 is NOT optional. Without it psql prints errors and
# carries on, so a target that already holds some of these tables ends up
# silently half-migrated: the pre-existing tables keep their old shape and
# every CREATE TABLE for them is skipped. That happened on 9 Sept — the dev
# database looked right (matching table count, functions and policies) while
# participants and registrations were 31 columns short, and it surfaced only
# when a trigger fired on a column that was not there.
#
# Load into an EMPTY schema; a partial load is the failure mode this guards
# against.
/opt/homebrew/opt/libpq/bin/psql "<session-pooler-URI>" -W --set ON_ERROR_STOP=1 \
  -c 'drop schema public cascade' \
  -c 'create schema public' \
  -f supabase/baseline.sql

# 2. Tell the CLI those migrations are already present, so `db push` applies
#    only NEW ones rather than trying to replay all 148.
npx supabase migration repair --status applied <version> …
```

Verify parity by comparing **columns**, not tables — a table count matches long
before the schema does:

```sql
select count(distinct table_name) as tables, count(*) as columns
from information_schema.columns where table_schema = 'public';
```

## Keeping it current

Refresh the baseline whenever a migration lands in production:

```bash
/opt/homebrew/opt/libpq/bin/pg_dump "<prod-session-pooler-URI>" -W \
  --schema=public --schema-only --no-owner -f supabase/baseline.sql
```

A stale baseline is worse than none — it will be trusted. Note production still
has **no** `supabase_migrations.schema_migrations` ledger; which migrations are
applied there remains tribal knowledge, and is the next thing worth fixing.
