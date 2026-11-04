// @vitest-environment node
//
// Regression tests for the S1 ops-governance review (3 Nov 2026):
//   1. prod-migrate.yml must refuse every form of top-level transaction
//      control, not only a bare `COMMIT;` (scripts/check-migration-transaction.mjs);
//   2. its production psql output must not reach the public Actions log;
//   3. the agent's read-only role must be an allowlist that never grants
//      capability tokens or people's names (docs/RUNBOOK-agent-controls.md §4);
//   4. no backup tier may outlive the 35-day nightly (COPPA §312.5(c)(1));
//   5. the hourly drill must restore over the nightly, through the same
//      overlay script a real recovery uses;
//   6. the overlay must DELETE under replica role, never TRUNCATE;
//   7. the Action must not bind to Vercel's unprotected "Production"
//      environment;
//   8. CLAUDE.md's rule must not take over from the promote skill before the
//      Action is proven.
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findTransactionControl, splitStatements } from '../scripts/check-migration-transaction.mjs'

const tx = (sql: string) => findTransactionControl(sql).map((f: { statement: string }) => f.statement)

describe('scripts/check-migration-transaction.mjs', () => {
  it.each([
    ['END (COMMIT synonym)', 'CREATE TABLE t (i int);\nEND;\nDROP POLICY p ON public.members;\n', 'END'],
    ['ABORT (ROLLBACK synonym)', 'ABORT;\n', 'ABORT'],
    ['COMMIT mid-line', 'ALTER TABLE x ENABLE ROW LEVEL SECURITY; COMMIT;\n', 'COMMIT'],
    ['commit work', 'commit work;\n', 'COMMIT WORK'],
    ['COMMIT AND CHAIN', 'COMMIT AND CHAIN;\n', 'COMMIT AND CHAIN'],
    ['bare COMMIT', 'COMMIT;\n', 'COMMIT'],
    ['BEGIN', 'BEGIN;\nCREATE TABLE t (i int);\n', 'BEGIN'],
    ['START TRANSACTION', 'start transaction isolation level serializable;', 'START TRANSACTION ISOLATION'],
    ['END TRANSACTION', 'END TRANSACTION;', 'END TRANSACTION'],
    ['ROLLBACK TO SAVEPOINT', 'SAVEPOINT a; ROLLBACK TO SAVEPOINT a;', 'SAVEPOINT A'],
    ['RELEASE SAVEPOINT', 'RELEASE SAVEPOINT a;', 'RELEASE SAVEPOINT A'],
    ['PREPARE TRANSACTION', "PREPARE TRANSACTION 'x';", 'PREPARE TRANSACTION'],
    ['COMMIT PREPARED', "COMMIT PREPARED 'x';", 'COMMIT PREPARED'],
    ['after a comment on the same line', '/* note */ COMMIT;', 'COMMIT'],
    ['no trailing semicolon', 'SELECT 1;\nCOMMIT', 'COMMIT'],
  ])('refuses %s', (_label, sql, first) => {
    expect(tx(sql)[0]).toBe(first)
  })

  it.each([
    ['PL/pgSQL END in a $$ body', 'CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$\nBEGIN\n  NULL;\nEND;\n$$;'],
    ['PL/pgSQL END in a tagged body', 'DO $fn$ BEGIN IF true THEN RAISE NOTICE \'x\'; END IF; END $fn$;'],
    ['CASE … END in a query', 'SELECT CASE WHEN true THEN 1 END;'],
    ['the word in a string', "INSERT INTO t VALUES ('a; COMMIT; b');"],
    ['the word in an E-string with an escaped quote', "SELECT E'it\\'s; COMMIT;';"],
    ['the word in a line comment', '-- COMMIT;\nSELECT 1;'],
    ['the word in a nested block comment', '/* a /* COMMIT; */ END; */ SELECT 1;'],
    ['a quoted identifier', 'CREATE TABLE "commit" (i int);'],
    ['a BEGIN ATOMIC body', 'CREATE OR REPLACE FUNCTION f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; SELECT CASE WHEN true THEN 2 END; END;\nSELECT 2;'],
    ['an old-style quoted function body', "CREATE FUNCTION f() RETURNS void AS 'BEGIN NULL; END;' LANGUAGE plpgsql;"],
    ['$1 parameters, not dollar quotes', 'PREPARE q(int) AS SELECT $1; EXECUTE q(1);'],
  ])('allows %s', (_label, sql) => {
    expect(tx(sql)).toEqual([])
  })

  it('keeps a BEGIN ATOMIC body as one statement, as psql does', () => {
    const s = splitStatements('CREATE FUNCTION f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; END; SELECT 2;')
    expect(s.map((x: { words: string[] }) => x.words[0])).toEqual(['CREATE', 'SELECT'])
  })

  it('reports the line a statement starts on', () => {
    expect(findTransactionControl('SELECT 1;\n\n-- x\n  END;')).toEqual([{ line: 4, statement: 'END' }])
  })

  it('passes every timestamped migration in the repo (the files the Action can be given)', () => {
    const files = readdirSync('supabase/migrations').filter((f) => /^\d{14}_.*\.sql$/.test(f))
    expect(files.length).toBeGreaterThan(40)
    const hits = files.filter((f) => findTransactionControl(readFileSync(join('supabase/migrations', f), 'utf8')).length)
    expect(hits).toEqual([])
  })

  it('catches the legacy files that did wrap themselves in BEGIN/COMMIT', () => {
    expect(tx(readFileSync('supabase/migrations/036_membership_id_on_members.sql', 'utf8'))).toEqual(['BEGIN', 'COMMIT'])
  })

  it('CLI exits 1 and names the line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tx-check-'))
    const f = join(dir, 'm.sql')
    writeFileSync(f, 'ALTER TABLE x ENABLE ROW LEVEL SECURITY; END;\n')
    const r = spawnSync('node', ['scripts/check-migration-transaction.mjs', f], { encoding: 'utf8' })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain(`${f}:1: top-level transaction control (END)`)
  })
})

describe('.github/workflows/prod-migrate.yml', () => {
  const yml = readFileSync('.github/workflows/prod-migrate.yml', 'utf8')
  const applyJob = yml.slice(yml.indexOf('\n  apply:'))

  it('runs the statement-level transaction check, not a line grep', () => {
    expect(yml).toContain('node scripts/check-migration-transaction.mjs "$file"')
    expect(yml).not.toMatch(/grep[^\n]*begin\|commit/i)
  })

  it('binds to its own environment, not Vercel\'s unprotected "Production" (names ignore case)', () => {
    const envs = [...yml.matchAll(/^\s*environment:\s*(\S+)/gm)].map((m) => m[1])
    expect(envs).toEqual(['prod-migrations'])
    for (const e of envs) expect(e.toLowerCase()).not.toMatch(/^production/)
  })

  it('runs every production psql with SQLSTATE-only errors', () => {
    const calls = [...applyJob.matchAll(/psql "\$PROD_DATABASE_URL"([^\n]*\\\n)*[^\n]*/g)].map((m) => m[0])
    expect(calls.length).toBe(4)
    for (const c of calls) {
      expect(c).toContain('-v VERBOSITY=sqlstate')
      expect(c).toContain('-v SHOW_CONTEXT=never')
    }
  })

  it('keeps the apply psql output out of the log, printing only == lines and SQLSTATEs', () => {
    expect(applyJob).toMatch(/-f "\$wrapper" > "\$out" 2> "\$err"/)
    expect(applyJob).toContain("grep '^== ' \"$out\"")
    expect(applyJob).toMatch(/grep -oE '\(ERROR\|FATAL\|PANIC\):\[\[:space:\]\]\+\[0-9A-Z\]\{5\}' "\$err"/)
    expect(applyJob).toContain('SET LOCAL client_min_messages = warning;')
    expect(applyJob).not.toMatch(/\\!/)
  })

  it('checks the transaction is still open before writing the ledger row', () => {
    const before = applyJob.indexOf('SELECT txid_current() AS tx_before')
    const include = applyJob.indexOf('\\i supabase/migrations/${MIGRATION}')
    const same = applyJob.indexOf('SELECT txid_current() = :tx_before AS same_tx')
    const insert = applyJob.indexOf('INSERT INTO supabase_migrations.schema_migrations')
    expect(before).toBeGreaterThan(0)
    expect(before).toBeLessThan(include)
    expect(include).toBeLessThan(same)
    expect(same).toBeLessThan(insert)
  })
})

// ── docs/RUNBOOK-agent-controls.md §4: evaluate the grant block on the schema ──

type Columns = Map<string, Map<string, string>> // table → column → information_schema data_type

function normType(raw: string): string {
  const t = raw.trim().toLowerCase()
  if (/\[\]$/.test(t) || /^\S+\s*\[\]/.test(t)) return 'ARRAY'
  if (/^uuid\b/.test(t)) return 'uuid'
  if (/^(bigint|int8|bigserial)\b/.test(t)) return 'bigint'
  if (/^(smallint|int2)\b/.test(t)) return 'smallint'
  if (/^(integer|int|int4|serial)\b/.test(t)) return 'integer'
  if (/^(numeric|decimal)\b/.test(t)) return 'numeric'
  if (/^(boolean|bool)\b/.test(t)) return 'boolean'
  if (/^(timestamptz|timestamp with time zone|timestamp\(\d\) with time zone)/.test(t)) return 'timestamp with time zone'
  if (/^timestamp\b/.test(t)) return 'timestamp without time zone'
  if (/^date\b/.test(t)) return 'date'
  if (/^text\b/.test(t)) return 'text'
  if (/^(varchar|character varying)\b/.test(t)) return 'character varying'
  if (/^jsonb?\b/.test(t)) return 'jsonb'
  return 'USER-DEFINED'
}

function splitTopLevel(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const c of s) {
    if (c === '(') depth++
    if (c === ')') depth--
    if (c === ',' && depth === 0) { out.push(cur); cur = '' } else cur += c
  }
  if (cur.trim()) out.push(cur)
  return out
}

const NOT_A_COLUMN = /^(constraint|primary|unique|check|foreign|exclude|like)\b/i
const TYPE_END = /\s+(default|not|null|primary|references|unique|check|generated|constraint|collate)\b/i

function parseColumnDef(def: string): [string, string] | null {
  const d = def.trim()
  if (!d || NOT_A_COLUMN.test(d)) return null
  const m = d.match(/^"?([a-z_][a-z0-9_]*)"?\s+([\s\S]+)$/i)
  if (!m) return null
  const type = m[2].split(TYPE_END)[0]
  return [m[1].toLowerCase(), normType(type)]
}

/** Replay CREATE TABLE / ALTER TABLE (add, rename, drop) / DROP TABLE in file order. */
function schemaColumns(): Columns {
  const files = [
    'supabase/baseline.sql',
    ...readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort().map((f) => join('supabase/migrations', f)),
  ]
  const tables: Columns = new Map()
  const name = (s: string | undefined, t: string) => `${(s ?? 'public').toLowerCase()}.${t.toLowerCase()}`
  const re =
    /create table (?:if not exists )?(?:"?(\w+)"?\.)?"?(\w+)"?\s*\(|alter table (?:if exists )?(?:only )?(?:"?(\w+)"?\.)?"?(\w+)"?\s+([^;]+);|drop table (?:if exists )?(?:"?(\w+)"?\.)?"?(\w+)"?/gi
  for (const file of files) {
    const sql = readFileSync(file, 'utf8').replace(/--[^\n]*/g, '')
    for (const m of sql.matchAll(re)) {
      if (m[2]) {
        // CREATE TABLE: body up to the matching parenthesis.
        let depth = 1
        let k = m.index! + m[0].length
        const start = k
        while (k < sql.length && depth > 0) {
          if (sql[k] === '(') depth++
          else if (sql[k] === ')') depth--
          k++
        }
        const cols = new Map<string, string>()
        for (const def of splitTopLevel(sql.slice(start, k - 1))) {
          const c = parseColumnDef(def)
          if (c) cols.set(c[0], c[1])
        }
        const key = name(m[1], m[2])
        if (!tables.has(key)) tables.set(key, cols)
      } else if (m[4]) {
        const key = name(m[3], m[4])
        const action = m[5].trim()
        const renameTable = action.match(/^rename to "?(\w+)"?$/i)
        if (renameTable) {
          const cols = tables.get(key)
          tables.delete(key)
          if (cols) tables.set(name(m[3], renameTable[1]), cols)
          continue
        }
        const cols = tables.get(key)
        if (!cols) continue
        const renameCol = action.match(/^rename (?:column )?"?(\w+)"? to "?(\w+)"?$/i)
        if (renameCol) {
          const type = cols.get(renameCol[1].toLowerCase())
          cols.delete(renameCol[1].toLowerCase())
          if (type) cols.set(renameCol[2].toLowerCase(), type)
          continue
        }
        for (const part of splitTopLevel(action)) {
          const add = part.trim().match(/^add (?:column )?(?:if not exists )?([\s\S]+)$/i)
          if (add && !/^(constraint|primary|unique|check|foreign)\b/i.test(add[1])) {
            const c = parseColumnDef(add[1])
            if (c) cols.set(c[0], c[1])
          }
          const drop = part.trim().match(/^drop (?:column )?(?:if exists )?"?(\w+)"?/i)
          if (drop && !/^(constraint|not|default|policy|trigger)$/i.test(drop[1])) cols.delete(drop[1].toLowerCase())
        }
      } else if (m[7]) {
        tables.delete(name(m[6], m[7]))
      }
    }
  }
  return tables
}

function grantRule() {
  const md = readFileSync('docs/RUNBOOK-agent-controls.md', 'utf8')
  const block = md.match(/```sql\n([\s\S]*?never text :=[\s\S]*?)```/)![1]
  const never = new RegExp(block.match(/never text := '([^']+)'/)![1], 'i')
  const denied = new Set(
    [...block.match(/denied_tables text\[\] := ARRAY\[([\s\S]*?)\];/)![1].matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map((m) => m[1]),
  )
  const shapes = [...block.matchAll(/c\.column_name ~ '([^']+)'\s*AND c\.data_type IN \(([^)]*)\)/g)].map((m) => ({
    name: new RegExp(m[1]),
    types: [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]),
  }))
  const anyName = [...block.matchAll(/OR c\.data_type = '([^']+)'/g)].map((m) => m[1])
  const grants = (table: string, column: string, type: string) =>
    !denied.has(table) &&
    !never.test(column) &&
    (shapes.some((s) => s.name.test(column) && s.types.includes(type)) || anyName.includes(type))
  return { never, denied, shapes, anyName, grants, block }
}

describe('docs/RUNBOOK-agent-controls.md §4 agent_readonly grants', () => {
  const schema = schemaColumns()
  // Lazy, so a runbook without the allowlist block fails each test, not the file.
  let cached: ReturnType<typeof grantRule> | undefined
  const rule = {
    get block() { return (cached ??= grantRule()).block },
    get shapes() { return (cached ??= grantRule()).shapes },
    get anyName() { return (cached ??= grantRule()).anyName },
    grants: (t: string, c: string, ty: string) => (cached ??= grantRule()).grants(t, c, ty),
  }
  const typeOf = (t: string, c: string) => schema.get(t)?.get(c)

  it('is an allowlist: column shapes plus a never-list, not a denylist', () => {
    expect(rule.block).not.toContain('denied_columns')
    expect(rule.shapes.length).toBe(4)
    expect(rule.anyName).toEqual(['boolean'])
    expect(rule.block).toContain('c.column_name !~* never')
  })

  // Every column the review named, plus the obvious ones. Each must exist in
  // the schema (so the test is not vacuous) and must not be granted.
  it.each([
    ['public.registrations', 'pay_token'],
    ['public.participants', 'pay_token'],
    ['public.scholarship_applications', 'offer_token'],
    ['public.scholarship_applications', 'school'],
    ['public.scholarship_applications', 'brief'],
    ['public.group_join_tokens', 'token'],
    ['public.event_settings', 'check_in_token'],
    ['public.agreements', 'minor_name'],
    ['public.credentials', 'recipient_name'],
    ['public.members', 'marketing_unsubscribe_token'],
    ['public.members', 'email'],
    ['public.members', 'first_name'],
    ['public.members', 'date_of_birth'],
    ['public.members', 'phone'],
    ['public.members', 'health_conditions'],
    ['public.members', 'gender'],
    ['public.members', 'ec_phone'],
    ['public.members', 'clerk_user_id'],
    ['public.members', 'member_code'],
    ['public.members', 'stripe_customer_id'],
  ])('never grants %s.%s', (table, column) => {
    const type = typeOf(table, column)
    expect(type, `${table}.${column} not found in the schema`).toBeDefined()
    expect(rule.grants(table, column, type!)).toBe(false)
  })

  it.each([
    ['public.members', 'id'],
    ['public.members', 'created_at'],
    ['public.members', 'is_active'],
    ['public.registrations', 'id'],
    ['public.registrations', 'created_at'],
  ])('still grants %s.%s (the role stays useful)', (table, column) => {
    const type = typeOf(table, column)
    expect(type).toBeDefined()
    expect(rule.grants(table, column, type!)).toBe(true)
  })

  it('grants no text column except ids and status-like words, anywhere in the schema', () => {
    const odd: string[] = []
    for (const [table, cols] of schema) {
      for (const [column, type] of cols) {
        if (!rule.grants(table, column, type)) continue
        if (type !== 'text' && type !== 'character varying') continue
        if (/^(id|.+_id|status|.+_status|state|kind|type|.+_type|role|.+_role|tier|slug|.+_slug|currency|source|channel|version|.+_version|season|stage|step|priority)$/.test(column)) continue
        odd.push(`${table}.${column}`)
      }
    }
    expect(odd).toEqual([])
  })
})

describe('backups keep nothing past the 35-day nightly', () => {
  it('backup.sh writes only hourly/, nightly/ and storage/ keys (no monthly copy)', () => {
    const sh = readFileSync('ops/backups/backup.sh', 'utf8')
    const code = sh.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
    expect(code).not.toMatch(/monthly/)
    // No server-side copy of an uploaded archive to another prefix.
    expect(code).not.toMatch(/s3 cp [^\n]*"s3:\/\/\$R2_BUCKET\/[^\n]*"s3:\/\/\$R2_BUCKET/)
    const prefixes = [...sh.matchAll(/(?:key|encrypt_and_upload) ?=?"?\$?\{?(\w+)\}?\/\$day_path/g)].map((m) => m[1])
    expect(new Set(prefixes)).toEqual(new Set(['kind', 'storage']))
  })

  it('the runbook lock table has no tier longer than 35 days', () => {
    const md = readFileSync('docs/RUNBOOK-backups.md', 'utf8')
    const table = md.slice(md.indexOf('| Prefix | Locked for |'), md.indexOf('**No longer tier'))
    const days = [...table.matchAll(/(\d+) days/g)].map((m) => Number(m[1]))
    expect(days.length).toBeGreaterThan(0)
    expect(Math.max(...days)).toBeLessThanOrEqual(35)
    expect(table).not.toContain('monthly/')
  })

  it('retention schedule row 29 records the COPPA reasoning and no 400-day period in force', () => {
    const row = readFileSync('docs/compliance/retention-schedule.md', 'utf8').split('\n').find((l) => l.startsWith('| 29 |'))!
    expect(row).toContain('No longer tier')
    expect(row).toContain('§312.5(c)(1)')
    expect(row).toContain('§312.10')
  })
})

describe('ops/backups/restore-drill.sh', () => {
  it('refuses --hourly without --nightly (the hourly cannot restore into an empty database)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drill-'))
    const key = join(dir, 'k.agekey')
    writeFileSync(key, 'AGE-SECRET-KEY-PLACEHOLDER\n')
    const r = spawnSync('bash', ['ops/backups/restore-drill.sh', '--identity', key, '--hourly', 'latest'], { encoding: 'utf8' })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('--hourly needs --nightly')
  })

  it('restores the hourly over a copy of the nightly with overlay-critical.sh', () => {
    const sh = readFileSync('ops/backups/restore-drill.sh', 'utf8')
    expect(sh).toContain('CREATE DATABASE $db TEMPLATE drill_nightly')
    expect(sh).toContain('"$here/overlay-critical.sh" --dbname "$db" --dump "$dir/critical.dump"')
    expect(sh).not.toMatch(/restore_and_verify hourly/)
  })
})

describe('ops/backups/overlay-critical.sh', () => {
  const dir = mkdtempSync(join(tmpdir(), 'overlay-'))
  const manifest = (lines: string[]) => {
    const p = join(dir, `m${Math.random()}.tsv`)
    writeFileSync(p, lines.map((l) => l + '\n').join(''))
    return p
  }
  const printSql = (lines: string[], extra: string[] = []) =>
    spawnSync('bash', ['ops/backups/overlay-critical.sh', '--print-sql', '--tables', manifest(lines), ...extra], { encoding: 'utf8' })

  it('deletes under replica role in one transaction, never TRUNCATE', () => {
    const r = printSql([`public.members\t3\t${'a'.repeat(64)}`, `public.registrations\t2\t${'b'.repeat(64)}`])
    expect(r.status, r.stderr).toBe(0)
    const sql = r.stdout
    expect(sql).not.toMatch(/truncate/i)
    expect(sql.indexOf('BEGIN;')).toBeLessThan(sql.indexOf('SET LOCAL session_replication_role = replica;'))
    expect(sql.indexOf('SET LOCAL session_replication_role = replica;')).toBeLessThan(sql.indexOf('DELETE FROM public.members;'))
    expect(sql.indexOf('DELETE FROM public.registrations;')).toBeLessThan(sql.indexOf('\\i '))
    expect(sql).toContain("crit text[] := ARRAY['public.members', 'public.registrations'];")
    expect(sql).toMatch(/\\if :roll_back\n {2}\\echo[^\n]*\n {2}ROLLBACK;\n\\else\n {2}COMMIT;\n\\endif/)
    expect(sql).toContain('SELECT (:orphans > 0 AND false) OR false AS roll_back')
  })

  it('honours --dry-run and --fail-on-orphans', () => {
    const r = printSql([`public.members\t3\tx`], ['--dry-run', '--fail-on-orphans'])
    expect(r.stdout).toContain('SELECT (:orphans > 0 AND true) OR true AS roll_back')
  })

  it.each(['public.members; DROP TABLE x', 'members', 'Public.Members', 'public."members"'])('refuses table name %s', (t) => {
    const r = printSql([`${t}\t1\tx`])
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('refusing table name')
  })
})

describe('CLAUDE.md agent rule and the promote skill do not contradict', () => {
  it('the Action becomes the only route only once RUNBOOK-agent-controls §7 is proven', () => {
    const md = readFileSync('CLAUDE.md', 'utf8')
    const section = md.slice(md.indexOf('## Agents: data is never instructions'), md.indexOf('## Reference'))
    expect(section).toContain('§7 records as proven')
    expect(section).toContain("promote skill's Step 3 still applies")
    const runbook = readFileSync('docs/RUNBOOK-agent-controls.md', 'utf8')
    expect(runbook).toContain('**Proven on: (not yet).**')
  })
})
