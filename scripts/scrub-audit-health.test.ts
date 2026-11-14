// @vitest-environment node
//
// S0 audit scrub (docs/THREAT-MODEL.md TB4 I). The pure scrub over nested
// snapshots, its idempotence, the key list held in step with the S4 catalogue
// and the migration's trigger array, the guards (backup flag, production,
// unknown flags), and a run over a stand-in client. No database is touched.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SENSITIVE_TABLES, bidxColumn, encColumn } from '../lib/field-crypto-fields'
import {
  SCRUB_KEYS,
  formatReport,
  isProductionUrl,
  parseArgs,
  refusal,
  rowPatch,
  scrubJson,
  scrubTable,
  type Options,
  type PageQuery,
  type ScrubDb,
} from './scrub-audit-health'
import { PRODUCTION_SUPABASE_REF } from './production-guard.mjs'

const MIGRATIONS = join(__dirname, '..', 'supabase', 'migrations')
const migrationFile = () => {
  const found = readdirSync(MIGRATIONS).filter((f) => f.endsWith('_s0_audit_scrub_trigger.sql'))
  expect(found).toHaveLength(1)
  return readFileSync(join(MIGRATIONS, found[0]), 'utf8')
}

// Placeholder values only: nothing here is a real person.
const participantRow = () => ({
  id: 'p-1',
  first_name: 'Placeholder',
  school_name: 'Placeholder School',
  health_conditions: 'placeholder condition',
  health_conditions_enc: 'sf1.placeholder',
  dietary_requirements: ['placeholder diet'],
  emergency_contact_first_name: 'Placeholder',
  emergency_contact_last_name: 'Contact',
  emergency_contact_email: 'placeholder@example.test',
  emergency_contact_email_bidx: 'bi1.placeholder.mac',
  emergency_contact_phone: '000',
  emergency_contact_relationship: 'placeholder',
})

describe('SCRUB_KEYS', () => {
  it('is every catalogue column with its _enc and _bidx shadows, sorted, no more', () => {
    const expected = new Set<string>()
    for (const t of SENSITIVE_TABLES) {
      for (const f of t.fields) {
        expected.add(f.column)
        expected.add(encColumn(f.column))
        if (f.blindIndex) expected.add(bidxColumn(f.column))
      }
    }
    expect([...SCRUB_KEYS]).toEqual([...expected].sort())
  })

  it('covers health and emergency contact on both members and participants', () => {
    for (const k of ['health_conditions', 'ec_phone', 'ec_relationship', 'emergency_contact_phone', 'emergency_contact_relationship', 'dietary_requirements']) {
      expect(SCRUB_KEYS).toContain(k)
    }
  })

  it('is exactly the array the migration gives the audit trigger', () => {
    const sql = migrationFile()
    const block = sql.match(/-- scrub-keys:begin[\s\S]*?ARRAY\[([\s\S]*?)\]::text\[\];\s*-- scrub-keys:end/)
    expect(block, 'the migration keeps its key list between scrub-keys markers').not.toBeNull()
    const inSql = [...block![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    expect(inSql).toEqual([...SCRUB_KEYS])
  })

  it('is exactly the list the pgTAP test checks the audit rows against', () => {
    const sql = readFileSync(join(__dirname, '..', 'supabase', 'tests', 'database', 's0_audit_scrub.test.sql'), 'utf8')
    const block = sql.match(/-- scrub-keys:begin[\s\S]*?ARRAY\[([\s\S]*?)\]::text\[\];\s*-- scrub-keys:end/)
    expect(block, 'the pgTAP file keeps its key list between scrub-keys markers').not.toBeNull()
    expect([...block![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual([...SCRUB_KEYS])
  })
})

describe('the migration', () => {
  const body = () =>
    migrationFile()
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n')

  it('replaces the audit trigger function and removes the keys from both row images', () => {
    const sql = body()
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.audit_members\(\) RETURNS trigger/)
    expect(sql).toMatch(/to_jsonb\(OLD\) - v_scrub/)
    expect(sql).toMatch(/to_jsonb\(NEW\) - v_scrub/)
    expect(sql).not.toMatch(/SECURITY DEFINER/i)
  })

  it('is forward-only: it touches no existing audit or archive row', () => {
    const sql = body()
    expect(sql).not.toMatch(/\bUPDATE\s+(public\.)?(audit_log|deletion_archive)\b/i)
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(sql).not.toMatch(/\bTRUNCATE\b/i)
    expect(sql).not.toMatch(/\bDROP\b/i)
  })
})

describe('scrubJson', () => {
  it('removes the keys from a nested deletion_archive snapshot and keeps everything else', () => {
    const snapshot = {
      participants: [participantRow(), { ...participantRow(), id: 'p-2', health_conditions: null }],
      registrations: [{ id: 'r-1', event_slug: 'placeholder-event', notes: { ec_phone: '000', kept: 'yes' } }],
      members: [{ id: 'm-1', first_name: 'Placeholder', ec_first_name: 'Placeholder', ec_email_enc: 'sf1.placeholder', email: 'member@example.test' }],
    }
    const { value, removed } = scrubJson(snapshot)
    expect(value).toEqual({
      participants: [
        { id: 'p-1', first_name: 'Placeholder', school_name: 'Placeholder School' },
        { id: 'p-2', first_name: 'Placeholder', school_name: 'Placeholder School' },
      ],
      registrations: [{ id: 'r-1', event_slug: 'placeholder-event', notes: { kept: 'yes' } }],
      members: [{ id: 'm-1', first_name: 'Placeholder', email: 'member@example.test' }],
    })
    expect(removed.get('health_conditions')).toBe(2)
    expect(removed.get('ec_phone')).toBe(1)
    expect(removed.get('ec_first_name')).toBe(1)
    expect(removed.get('ec_email_enc')).toBe(1)
    expect(removed.get('emergency_contact_email_bidx')).toBe(2)
  })

  it('is idempotent: a second pass removes nothing and changes nothing', () => {
    const first = scrubJson({ members: [participantRow()] })
    const second = scrubJson(first.value)
    expect(second.removed.size).toBe(0)
    expect(second.value).toEqual(first.value)
  })

  it('never mutates its input', () => {
    const row = participantRow()
    const before = structuredClone(row)
    scrubJson({ participants: [row] })
    expect(row).toEqual(before)
  })

  it('leaves keys that only resemble a scrubbed one, and values that merely mention one', () => {
    const input = { health_conditions_note: 'kept', ec_email_verified: true, label: 'health_conditions', list: ['ec_phone', 1, null] }
    const { value, removed } = scrubJson(input)
    expect(value).toEqual(input)
    expect(removed.size).toBe(0)
  })

  it('passes scalars and null through', () => {
    for (const v of [null, undefined, 'text', 3, true]) expect(scrubJson(v)).toEqual({ value: v, removed: new Map() })
  })

  it('refuses JSON nested past the depth limit rather than half-scrubbing it', () => {
    let deep: unknown = { health_conditions: 'placeholder' }
    for (let i = 0; i < 100; i++) deep = { child: deep }
    expect(() => scrubJson(deep)).toThrow(/nested deeper/)
  })
})

describe('rowPatch', () => {
  it('patches only the audit_log image that held a key', () => {
    const counts = new Map<string, number>()
    const patch = rowPatch('audit_log', { id: 'a-1', old_data: null, new_data: { id: 'm-1', ec_phone: '000', first_name: 'Placeholder' } }, counts)
    expect(patch).toEqual({ new_data: { id: 'm-1', first_name: 'Placeholder' } })
    expect(counts.get('ec_phone')).toBe(1)
  })

  it('returns null for a row with nothing to scrub', () => {
    expect(rowPatch('deletion_archive', { id: 'd-1', snapshot: { members: [{ id: 'm-1' }] } })).toBeNull()
  })
})

describe('parseArgs and refusal', () => {
  const ok = (argv: string[]) => {
    const o = parseArgs(argv)
    if ('error' in o) throw new Error(o.error)
    return o as Options
  }
  const devUrl = 'https://placeholderdevref.supabase.co'
  const prodUrl = `https://${PRODUCTION_SUPABASE_REF}.supabase.co`

  it('is a dry run by default', () => {
    const o = ok(['--i-have-a-backup'])
    expect(o.apply).toBe(false)
    expect(o.tables).toEqual(['audit_log', 'deletion_archive'])
  })

  it('refuses to run at all without --i-have-a-backup, dry run included', () => {
    expect(refusal(ok([]), devUrl)).toMatch(/--i-have-a-backup/)
    expect(refusal(ok(['--apply']), devUrl)).toMatch(/--i-have-a-backup/)
    expect(refusal(ok(['--i-have-a-backup']), devUrl)).toBeNull()
  })

  it('refuses the production project unless --production is passed', () => {
    expect(isProductionUrl(prodUrl)).toBe(true)
    expect(isProductionUrl(devUrl)).toBe(false)
    expect(refusal(ok(['--i-have-a-backup']), prodUrl)).toMatch(/PRODUCTION/)
    expect(refusal(ok(['--i-have-a-backup', '--apply']), prodUrl)).toMatch(/PRODUCTION/)
    expect(refusal(ok(['--i-have-a-backup', '--apply', '--production']), prodUrl)).toBeNull()
  })

  it('refuses a missing URL', () => {
    expect(refusal(ok(['--i-have-a-backup']), undefined)).toMatch(/NEXT_PUBLIC_SUPABASE_URL/)
  })

  it('rejects unknown flags and bad values instead of guessing', () => {
    expect(parseArgs(['--aply'])).toEqual({ error: 'Unknown argument: --aply' })
    expect(parseArgs(['--table', 'members'])).toHaveProperty('error')
    expect(parseArgs(['--batch', '0'])).toHaveProperty('error')
    expect(parseArgs(['--batch', '5000'])).toHaveProperty('error')
    expect(parseArgs(['--max-rows', 'many'])).toHaveProperty('error')
    expect(ok(['--table', 'deletion_archive', '--batch', '50', '--max-rows', '10'])).toMatchObject({ tables: ['deletion_archive'], batch: 50, maxRows: 10 })
  })
})

// A stand-in for the Supabase client: one table of rows, keyset paging by id.
function fakeDb(rows: Record<string, unknown>[], failIds: string[] = []) {
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = []
  const db: ScrubDb = {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: (n: number) => {
            const page = (after: string | null): PageQuery => {
              const data = rows.filter((r) => after === null || String(r.id) > after).slice(0, n).map((r) => structuredClone(r))
              return {
                gt: (_c: string, v: string) => page(v),
                then: (resolve, reject) => Promise.resolve({ data, error: null }).then(resolve, reject),
              }
            }
            return page(null)
          },
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: (_c: string, id: string) => {
          if (failIds.includes(id)) return Promise.resolve({ error: { code: 'XX000' } })
          updates.push({ id, patch })
          const row = rows.find((r) => r.id === id)!
          Object.assign(row, patch)
          return Promise.resolve({ error: null })
        },
      }),
    }),
  }
  return { db, updates }
}

const auditRows = () =>
  Array.from({ length: 7 }, (_, i) => ({
    id: `a-${i}`,
    old_data: i % 2 ? { id: 'm', health_conditions: 'placeholder', first_name: 'Old' } : { id: 'm', first_name: 'Old' },
    new_data: { id: 'm', first_name: 'New' },
  }))

describe('scrubTable', () => {
  it('dry run counts across pages and writes nothing', async () => {
    const { db, updates } = fakeDb(auditRows())
    const r = await scrubTable(db, 'audit_log', { apply: false, batch: 3, maxRows: 5000 })
    expect(r).toMatchObject({ scanned: 7, holding: 3, updated: 0, failed: 0, stopped: false })
    expect(r.keys.get('health_conditions')).toBe(3)
    expect(updates).toHaveLength(0)
  })

  it('apply scrubs only the rows holding a key, and a rerun finds nothing', async () => {
    const rows = auditRows()
    const { db, updates } = fakeDb(rows)
    const r = await scrubTable(db, 'audit_log', { apply: true, batch: 3, maxRows: 5000 })
    expect(r).toMatchObject({ scanned: 7, holding: 3, updated: 3, failed: 0 })
    expect(updates.map((u) => Object.keys(u.patch))).toEqual([['old_data'], ['old_data'], ['old_data']])
    expect(rows.every((row) => !JSON.stringify(row).includes('health_conditions'))).toBe(true)
    expect(rows.find((row) => row.id === 'a-1')!.old_data).toEqual({ id: 'm', first_name: 'Old' })
    const again = await scrubTable(db, 'audit_log', { apply: true, batch: 3, maxRows: 5000 })
    expect(again).toMatchObject({ scanned: 7, holding: 0, updated: 0 })
  })

  it('stops at --max-rows and says so', async () => {
    const { db } = fakeDb(auditRows())
    const r = await scrubTable(db, 'audit_log', { apply: true, batch: 2, maxRows: 2 })
    expect(r).toMatchObject({ updated: 2, stopped: true })
    expect(formatReport(r, true).join('\n')).toMatch(/rerun to continue/)
  })

  it('counts a failed update without stopping', async () => {
    const { db } = fakeDb(auditRows(), ['a-1'])
    const r = await scrubTable(db, 'audit_log', { apply: true, batch: 10, maxRows: 5000 })
    expect(r).toMatchObject({ holding: 3, updated: 2, failed: 1 })
  })

  it('reports counts and key names, never a value or a row id', async () => {
    const { db } = fakeDb([{ id: 'd-secret-id', snapshot: { participants: [participantRow()] } }])
    const r = await scrubTable(db, 'deletion_archive', { apply: false, batch: 10, maxRows: 5000 })
    const text = formatReport(r, false).join('\n')
    expect(text).toMatch(/emergency_contact_phone: 1/)
    for (const leak of ['placeholder condition', 'placeholder@example.test', 'd-secret-id', 'sf1.placeholder', '000']) {
      expect(text).not.toContain(leak)
    }
  })
})
