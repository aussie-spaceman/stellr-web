import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PROBES, RPC_PROBE, TABLE_PROBE, classifyProbe, rowCount } from './verify-db-grants'

describe('verify-db-grants', () => {
  it('passes only on a permission error', () => {
    expect(classifyProbe(401, '{"code":"42501","message":"permission denied for table cron_runs"}')).toBe('pass')
    expect(classifyProbe(403, '{"code":"42501","message":"permission denied for function x"}')).toBe('pass')
    // A bad key is also a 401, so it must not read as refused.
    expect(classifyProbe(401, '{"message":"Invalid API key"}')).toBe('inconclusive')
    expect(classifyProbe(404, '{"code":"PGRST205"}')).toBe('inconclusive')
    expect(classifyProbe(500, '')).toBe('inconclusive')
  })

  it('fails on any 2xx, including an empty result that RLS filtered', () => {
    expect(classifyProbe(200, '[]')).toBe('fail')
    expect(classifyProbe(200, 'null')).toBe('fail')
    expect(classifyProbe(204, '')).toBe('fail')
  })

  it('reports how many rows came back, never the rows', () => {
    expect(rowCount('[{"id":"00000000-0000-4000-8000-000000000000"}]')).toBe('1 row(s)')
    expect(rowCount('[]')).toBe('0 row(s)')
    expect(rowCount('null')).toBe('a non-array body')
    expect(rowCount('not json')).toBe('an unparsed body')
  })

  it('probes the harmless function and one table outside the allow-list, read-only', () => {
    expect(PROBES.map((p) => p.label)).toEqual([`rpc ${RPC_PROBE}`, `table ${TABLE_PROBE}`])
    const table = PROBES.find((p) => p.label.startsWith('table'))!
    expect(table.method).toBe('GET')
    expect(table.path).toBe(`/rest/v1/${TABLE_PROBE}?select=id&limit=1`)
    expect(table.body).toBeUndefined()
  })

  it('probes a table the S0-3 migration keeps away from anon and authenticated', () => {
    const file = readdirSync('supabase/migrations').find((f) => /^\d{14}_s0_revoke_table_grants\.sql$/.test(f))
    expect(file, 'the S0-3 migration exists').toBeTruthy()
    const sql = readFileSync(`supabase/migrations/${file}`, 'utf8')
    const granted = [...sql.matchAll(/^GRANT\s+\w+\s+ON\s+public\.(\w+)\s+TO\s+(\w+)/gim)].map((m) => m[1])
    expect(granted.length).toBeGreaterThan(0)
    expect(granted).not.toContain(TABLE_PROBE)
  })
})
