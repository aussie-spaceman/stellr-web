// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { STELLR_OR_NULL } from '@/lib/tenancy/stellr-scope'

// The tracking route is stellr_only and takes its event slug from the query string, so what
// it may show is decided by the read. It sees Stellr's registrations and volunteers, and
// rows with no tenant yet, and never another tenant's. A slug can exist on two tenants.

const OTHER = '00000000-0000-4000-8000-00000000c0de'
const SLUG = 'shared-slug'

type Row = Record<string, unknown>

const h = vi.hoisted(() => ({ db: null as unknown }))

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => h.db }))
vi.mock('@/lib/events/repo', () => ({
  getAllEvents: async () => [],
  getAllCampaigns: async () => [],
  getEventsBySlugs: async () => [],
}))

/** Honours the Stellr-or-NULL filter the way PostgREST does, so a missing filter changes the rows. */
function tenantColumn(row: Row, filter: string | null): boolean {
  if (!filter) return true
  expect(filter).toBe(STELLR_OR_NULL)
  return row.tenant_id === null || row.tenant_id === STELLR_TENANT_ID
}

function standIn(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    let filter: string | null = null
    let referenced: string | null = null
    const query: Record<string, unknown> = {
      select: () => query,
      eq: () => query,
      in: () => query,
      not: () => query,
      order: () => query,
      limit: () => query,
      or: (f: string, opts?: { referencedTable?: string }) => {
        filter = f
        referenced = opts?.referencedTable ?? null
        return query
      },
      then: (resolve: (v: unknown) => unknown) => {
        const rows = (tables[table] ?? []).filter((r) => tenantColumn(referenced ? (r[referenced] as Row) : r, filter))
        return resolve({ data: rows, error: null })
      },
    }
    return query
  }
  return { from }
}

const STELLR_REG = { id: 'reg-stellr', school_name: 'A', tenant_id: STELLR_TENANT_ID }
const UNSTAMPED_REG = { id: 'reg-unstamped', school_name: 'B', tenant_id: null }
const OTHER_REG = { id: 'reg-other', school_name: 'C', tenant_id: OTHER }

const volunteer = (id: string, tenant: string | null) => ({
  member_id: id,
  mentoring_cohorts: { campaign_ref: SLUG, container_type: 'event_participation', tenant_id: tenant },
  members: { first_name: 'V', last_name: id, age_bracket: 'adult' },
})

const tables = (): Record<string, Row[]> => ({
  registrations: [STELLR_REG, UNSTAMPED_REG, OTHER_REG],
  cohort_members: [volunteer('vol-stellr', STELLR_TENANT_ID), volunteer('vol-unstamped', null), volunteer('vol-other', OTHER)],
  course_object_assignments: [],
  container_contents: [],
  training_modules: [],
  training_progress: [],
})

describe('getObjectTracking on an event', () => {
  beforeEach(() => {
    h.db = null
  })

  async function peopleSeen() {
    const seenRegs: string[] = []
    const db = standIn(tables())
    const from = db.from
    h.db = {
      from: (t: string) => {
        const q = from(t) as Record<string, unknown>
        if (t !== 'participants') return q
        const inner: Record<string, unknown> = {
          select: () => inner,
          in: (_c: string, ids: string[]) => {
            seenRegs.push(...ids)
            return inner
          },
          not: () => inner,
          then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
        }
        return inner
      },
    }
    const { getObjectTracking } = await import('@/lib/training-admin')
    const spy = vi.spyOn(await import('@/lib/training-audience'), 'eventVolunteers')
    await getObjectTracking('competition', SLUG)
    const volunteers = (await spy.mock.results[0]?.value) as { memberId: string }[] | undefined
    spy.mockRestore()
    return { seenRegs, volunteers: (volunteers ?? []).map((v) => v.memberId) }
  }

  it("reads Stellr's registrations and unstamped ones, and not another tenant's", async () => {
    const { seenRegs } = await peopleSeen()
    expect(seenRegs).toEqual(['reg-stellr', 'reg-unstamped'])
  })

  it("reads Stellr's volunteers and unstamped ones, and not another tenant's", async () => {
    const { volunteers } = await peopleSeen()
    expect(volunteers).toEqual(['vol-stellr', 'vol-unstamped'])
  })

  it('with Stellr the only tenant, the filter takes nothing away', async () => {
    const rows = [STELLR_REG, UNSTAMPED_REG]
    expect(rows.filter((r) => tenantColumn(r, STELLR_OR_NULL))).toEqual(rows)
  })
})
