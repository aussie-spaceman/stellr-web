// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SENSITIVE_TABLES, plaintextKeys, shadowColumns } from '@/lib/field-crypto-fields'
import { TABLE_REGISTRY } from '@/lib/tenancy/registry'

// The catalogue, the migration, the pgTAP file and the docs must agree.

// SQL only: comments stripped, so prose about what the migration does not do can't trip a check.
const migration = readFileSync('supabase/migrations/20261104400000_field_crypto_shadow.sql', 'utf8').replace(/--[^\n]*/g, '')
const pgtap = readFileSync('supabase/tests/database/field_crypto.test.sql', 'utf8')
const doc = readFileSync('docs/FIELD-CRYPTO.md', 'utf8')
const schema = [
  readFileSync('supabase/baseline.sql', 'utf8'),
  ...readdirSync('supabase/migrations')
    .filter((f) => /^\d{14}_.+\.sql$/.test(f))
    .sort()
    .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')),
].join('\n')

describe('sensitive-column catalogue', () => {
  it('names real tables, each in the tenancy registry', () => {
    for (const t of SENSITIVE_TABLES) expect(TABLE_REGISTRY[`public.${t.table}`], t.table).toBeDefined()
  })

  it('names plaintext columns that exist in the schema', () => {
    for (const t of SENSITIVE_TABLES) {
      for (const f of t.fields) {
        expect(schema, `${t.table}.${f.column}`).toMatch(new RegExp(`\\b${f.column}\\s+text`))
      }
    }
  })

  it('the migration adds exactly the shadow columns, as nullable text', () => {
    for (const t of SENSITIVE_TABLES) {
      for (const c of shadowColumns(t)) {
        expect(migration, `${t.table}.${c}`).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${c} text[,;]\\s*\\n`))
      }
    }
    const added = [...migration.matchAll(/ADD COLUMN IF NOT EXISTS (\w+) text/g)].map((m) => m[1])
    expect(added.length).toBe(SENSITIVE_TABLES.reduce((n, t) => n + shadowColumns(t).length, 0))
  })

  it('the migration never drops or alters a plaintext column', () => {
    expect(migration).not.toMatch(/DROP COLUMN|ALTER COLUMN|RENAME/i)
    expect(migration).not.toMatch(/SECURITY DEFINER/i)
  })

  it('the pgTAP file checks every shadow column', () => {
    for (const t of SENSITIVE_TABLES) {
      for (const c of shadowColumns(t)) expect(pgtap, `${t.table}.${c}`).toContain(`'${t.table}', '${c}'`)
    }
  })

  it('docs/FIELD-CRYPTO.md lists every sensitive column', () => {
    for (const t of SENSITIVE_TABLES) for (const f of t.fields) expect(doc, `${t.table}.${f.column}`).toContain(`${t.table}.${f.column}`)
  })

  it('has a plaintext key list for whole-row copies', () => {
    expect(plaintextKeys()).toContain('health_conditions')
    expect(plaintextKeys()).toContain('guardian_email')
    expect(new Set(plaintextKeys()).size).toBe(plaintextKeys().length)
  })
})
