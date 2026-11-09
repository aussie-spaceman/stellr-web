// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureEventContainer, ensureSpaceContainer, ensureTrainingContainer } from '@/lib/container-sync'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { OPTIONAL_EVENT_TABLES, optionalEventWrites } from '../../scripts/s5-inventory.mjs'

// docs/TENANCY-S5.md, B16: the Lane B writers of the community tables name their
// tenant themselves, ahead of the S3 enforce flip, which would refuse a row with no
// event key and no tenant_id. Community is Stellr-only (B9), and the CHECK on these
// tables allows Stellr or NULL, so Stellr is the only value they can write. In log
// mode, today's mode, the derivation trigger stamped the same value, so for Stellr
// nothing changes but the derivation log's `no_key` rows.

const LANE_B_WRITERS = [
  'lib/coaching.ts',
  'lib/container-sync.ts',
  'lib/event-space-sync.ts',
  'lib/mentoring.ts',
  'lib/resource-finalise.ts',
  'lib/resource-upload.ts',
  'app/api/community/resources/attach/route.ts',
]

const COMMUNITY_TABLES = ['community_spaces', 'community_resources', 'mentoring_cohorts', 'training_modules']

describe('community table writes name their tenant', () => {
  it('the tables are ones the scan watches', () => {
    for (const t of COMMUNITY_TABLES) expect(OPTIONAL_EVENT_TABLES).toContain(t)
  })

  it.each(LANE_B_WRITERS)('%s sets tenant_id on every insert and upsert', (file) => {
    const writes = optionalEventWrites(file, readFileSync(file, 'utf8')).filter((w: { table: string }) => COMMUNITY_TABLES.includes(w.table))
    expect(writes.length, `${file}: the scan found no write, so it is not reading the file`).toBeGreaterThan(0)
    for (const w of writes) expect(w, `${file}:${w.line}`).toMatchObject({ tenantId: 'explicit' })
  })

  it('and the value written is Stellr', () => {
    for (const file of LANE_B_WRITERS) {
      const src = readFileSync(file, 'utf8')
      // Row literals only: a type such as `{ tenant_id: string }` is not a write.
      const values = [...src.matchAll(/tenant_id:\s*([^,}\n]+)/g)].map((m) => m[1].trim()).filter((v) => v !== 'string')
      expect(values.length, file).toBeGreaterThan(0)
      for (const v of values) expect(v, file).toBe('STELLR_TENANT_ID')
    }
  })
})

/** A client whose lookups find nothing, recording what each insert was given. */
function fakeDb() {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
  const chain = (result: unknown): Record<string, unknown> => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit']) q[m] = () => q
    q.maybeSingle = async () => result
    q.single = async () => result
    return q
  }
  const db = {
    from: (table: string) => ({
      select: () => chain({ data: null, error: null }),
      insert: (row: Record<string, unknown>) => {
        inserts.push({ table, row })
        return chain({ data: { id: 'created-1' }, error: null })
      },
    }),
  }
  return { db: db as unknown as SupabaseClient, inserts }
}

describe('container-sync, run', () => {
  it('creates event, Space and training containers as Stellr\'s', async () => {
    const { db, inserts } = fakeDb()
    expect(await ensureEventContainer(db, 'nevada-2027', 'Nevada 2027')).toBe('created-1')
    expect(await ensureSpaceContainer(db, 'commons', 'Commons')).toBe('created-1')
    expect(await ensureTrainingContainer(db, 'module-1', 'Safety')).toBe('created-1')
    expect(inserts.map((i) => [i.table, i.row.tenant_id])).toEqual([
      ['mentoring_cohorts', STELLR_TENANT_ID],
      ['mentoring_cohorts', STELLR_TENANT_ID],
      ['mentoring_cohorts', STELLR_TENANT_ID],
    ])
  })
})
