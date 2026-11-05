import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CronRun } from '@/lib/cron-runs'
import {
  partitionByTenant,
  rotateFrom,
  runPerTenant,
  tenantSliceMs,
  TENANT_CURSOR_KEY,
  type TenantJob,
} from '@/lib/cron-tenants'
import { assertMadeScope } from '@/lib/tenancy/scope-context'
import { STELLR_TENANT_ID as STELLR } from '@/lib/tenancy/constants'
import { CANARY_TENANT } from '@/lib/testing/honeytokens'
import { planTwoTenantSeed } from '@/lib/testing/two-tenant-seed'

const CANARY = CANARY_TENANT.id as string
const THIRD = 'ffffffff-0000-4000-8000-000000000003'
const SUSPENDED = 'eeeeeeee-0000-4000-8000-000000000002'

type Row = Record<string, unknown>
const seeded = planTwoTenantSeed().tenants as Row[]

function tenantRow(id: string, status: string): Row {
  return { id, status, time_zone: 'UTC', is_platform_owner: false }
}

/** A database holding `tenants`, the previous run's result, the job's newest child row, and a log of ledger writes. */
function fakeDb(
  opts: { tenants?: Row[]; tenantsError?: boolean; previous?: Row; newestChild?: Row; onInsert?: () => void } = {},
) {
  const inserts: Row[] = []
  const updates: Row[] = []
  const reads: string[] = []
  const nots: string[] = []
  const db = {
    from(table: string) {
      reads.push(table)
      if (table === 'tenants') {
        const result = () =>
          opts.tenantsError ? { data: null, error: { message: 'down' } } : { data: opts.tenants ?? seeded, error: null }
        const q = {
          select: () => q,
          in: (_: string, ids: string[]) => {
            const r = result()
            return Promise.resolve(r.data ? { ...r, data: r.data.filter((t) => ids.includes(t.id as string)) } : r)
          },
          then: (ok: (v: unknown) => unknown) => Promise.resolve(result()).then(ok),
        }
        return q
      }
      let columns = ''
      const q = {
        insert: (row: Row) => {
          inserts.push(row)
          opts.onInsert?.()
          return { select: () => ({ single: async () => ({ data: { id: `child-${inserts.length}` }, error: null }) }) }
        },
        update: (row: Row) => {
          updates.push(row)
          return { eq: async () => ({ error: null }) }
        },
        select: (cols: string) => {
          columns = cols
          return q
        },
        eq: () => q,
        not: (column: string) => {
          nots.push(column)
          return q
        },
        is: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => {
          if (columns.includes('tenant_id')) return { data: opts.newestChild ?? null, error: null }
          return { data: opts.previous ? { result: opts.previous, parent_id: null } : null, error: null }
        },
      }
      return q
    },
  } as unknown as SupabaseClient
  return { db, inserts, updates, reads, nots }
}

function fakeRun(id: string | null = 'parent-1') {
  const fails: { where: string; message: string }[] = []
  const run: CronRun = {
    id,
    fail: (where, err) => fails.push({ where, message: err instanceof Error ? err.message : String(err) }),
    finish: async () => {},
  }
  return { run, fails }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('partitionByTenant', () => {
  it('sends NULL tenant_id to Stellr and keeps each group in order', () => {
    const rows = [
      { n: 1, tenant_id: STELLR },
      { n: 2, tenant_id: null },
      { n: 3, tenant_id: CANARY },
      { n: 4, tenant_id: STELLR },
    ]
    const groups = partitionByTenant(rows)
    expect(groups.get(STELLR)?.map((r) => r.n)).toEqual([1, 2, 4])
    expect(groups.get(CANARY)?.map((r) => r.n)).toEqual([3])
  })

  it('refuses a row whose query left tenant_id out, rather than filing it under Stellr', () => {
    const rows = [{ n: 1, tenant_id: CANARY }, { n: 2 }] as unknown as { tenant_id: string | null }[]
    expect(() => partitionByTenant(rows)).toThrow(/tenant_id/)
  })
})

describe('rotateFrom', () => {
  it('starts at the cursor and wraps round', () => {
    expect(rotateFrom(['c', 'a', 'b'], null)).toEqual(['a', 'b', 'c'])
    expect(rotateFrom(['a', 'b', 'c'], 'b')).toEqual(['b', 'c', 'a'])
  })
  it('survives a cursor whose tenant has gone', () => {
    expect(rotateFrom(['a', 'c'], 'b')).toEqual(['c', 'a'])
    expect(rotateFrom(['a', 'c'], 'z')).toEqual(['a', 'c'])
  })
})

describe('tenantSliceMs', () => {
  it('shares what is left, with a floor, and never exceeds it', () => {
    expect(tenantSliceMs(30_000, 3, 5_000)).toBe(10_000)
    expect(tenantSliceMs(9_000, 3, 5_000)).toBe(5_000)
    expect(tenantSliceMs(2_000, 3, 5_000)).toBe(2_000)
    expect(tenantSliceMs(40_000, 1, 5_000)).toBe(40_000)
  })
})

describe('runPerTenant, no work', () => {
  it('reads nothing, runs nothing and adds nothing to the result', async () => {
    const { db, reads, inserts } = fakeDb()
    const { run, fails } = fakeRun()
    const fn = vi.fn(async () => ({}))
    const out = await runPerTenant(db, run, { job: 'surveys', deadline: 10_000, tenantIds: [], now: () => 0, fn })
    expect(fn).not.toHaveBeenCalled()
    expect(out.ledger).toEqual({})
    expect(out.results.size).toBe(0)
    expect(reads).toEqual([])
    expect(inserts).toEqual([])
    expect(fails).toEqual([])
  })
})

describe('runPerTenant, Stellr alone', () => {
  it('matches a plain call: whole budget, no child row, no new result keys, one read of tenants', async () => {
    const { db, inserts, updates, reads } = fakeDb()
    const { run, fails } = fakeRun()
    const deadline = 41_000
    let seen: TenantJob | null = null
    const out = await runPerTenant(db, run, {
      job: 'surveys',
      deadline,
      tenantIds: [STELLR],
      now: () => 1_000,
      fn: async (job) => {
        seen = job
        job.fail('item-1', new Error('one bad row'))
        return { opened: 2 }
      },
    })
    expect(seen!.deadline).toBe(deadline)
    expect(seen!.tenant.isPlatformOwner).toBe(true)
    expect(seen!.tenant.timeZone).toBe('America/Denver')
    expect(out.ledger).toEqual({})
    expect(out.results.get(STELLR)).toEqual({ opened: 2 })
    expect(fails).toEqual([{ where: 'item-1', message: 'one bad row' }])
    expect(inserts).toEqual([])
    expect(updates).toEqual([])
    expect(reads).toEqual(['tenants'])
  })

  it('hands over the run deadline exactly when the clock moves during the run', async () => {
    let t = 0
    const { db } = fakeDb()
    let handed = 0
    await runPerTenant(db, fakeRun().run, {
      job: 'surveys',
      deadline: 10_000,
      tenantIds: [STELLR],
      now: () => (t += 7),
      fn: async ({ deadline }) => {
        handed = deadline
        return {}
      },
    })
    expect(handed).toBe(10_000)
  })

  it('does not race Stellr alone against its slice', async () => {
    const { db } = fakeDb()
    const { run, fails } = fakeRun()
    const out = await runPerTenant(db, run, {
      job: 'surveys',
      deadline: 1,
      overrunMs: 1,
      tenantIds: [STELLR],
      now: () => 0,
      fn: async ({ signal }) => {
        await new Promise((resolve) => setTimeout(resolve, 30))
        return { aborted: signal.aborted }
      },
    })
    expect(out.results.get(STELLR)).toEqual({ aborted: false })
    expect(fails).toEqual([])
  })

  it('gives each tenant a system scope for its own tenant', async () => {
    const { db } = fakeDb()
    const seen: { tenantId: string; kind: string; slugs: unknown }[] = []
    await runPerTenant(db, fakeRun().run, {
      job: 'surveys',
      deadline: 10_000,
      tenantIds: [STELLR, CANARY],
      now: () => 0,
      fn: async ({ scope }) => {
        assertMadeScope(scope)
        seen.push({ tenantId: scope.tenantId, kind: scope.actor.kind, slugs: scope.eventSlugs })
        return {}
      },
    })
    expect(seen.map((s) => s.tenantId).sort()).toEqual([STELLR, CANARY].sort())
    for (const s of seen) expect(s).toMatchObject({ kind: 'system', slugs: null })
  })

  it("labels a thrown run 'run', as the routes do today", async () => {
    const { db } = fakeDb()
    const { run, fails } = fakeRun()
    await runPerTenant(db, run, {
      job: 'surveys',
      deadline: 10_000,
      tenantIds: [STELLR],
      now: () => 0,
      fn: async () => {
        throw new Error('boom')
      },
    })
    expect(fails).toEqual([{ where: 'run', message: 'boom' }])
  })

  it('never skips Stellr, whatever its status', async () => {
    const { db } = fakeDb({ tenants: [{ id: STELLR, status: 'suspended', time_zone: 'America/Denver', is_platform_owner: true }] })
    const fn = vi.fn(async () => ({}))
    const out = await runPerTenant(db, fakeRun().run, { job: 'x', deadline: 10_000, tenantIds: [STELLR], now: () => 0, fn })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(out.skipped).toEqual([])
  })

  it('still runs Stellr when tenants cannot be read, and records the read failure', async () => {
    const { db } = fakeDb({ tenantsError: true })
    const { run, fails } = fakeRun()
    const called: string[] = []
    await runPerTenant(db, run, {
      job: 'x',
      deadline: 10_000,
      tenantIds: [STELLR, CANARY],
      now: () => 0,
      fn: async ({ tenant }) => {
        called.push(tenant.id)
        return {}
      },
    })
    expect(called).toEqual([STELLR])
    expect(fails.map((f) => f.where).sort()).toEqual(['t:' + CANARY + ':run', 'tenants'].sort())
  })
})

describe('runPerTenant, two tenants', () => {
  it('a throwing tenant is recorded and the other still finishes', async () => {
    const { db, inserts, updates } = fakeDb()
    const { run, fails } = fakeRun()
    const out = await runPerTenant(db, run, {
      job: 'surveys',
      deadline: 60_000,
      tenantIds: [STELLR, CANARY],
      now: () => 0,
      fn: async ({ tenant }) => {
        if (tenant.id === CANARY) throw new Error('tenant B failed')
        return { opened: 1 }
      },
    })
    expect(out.results.get(STELLR)).toEqual({ opened: 1 })
    expect(out.results.has(CANARY)).toBe(false)
    expect(fails).toEqual([{ where: `t:${CANARY}:run`, message: 'tenant B failed' }])
    expect(inserts).toEqual([
      { job: 'surveys', tenant_id: STELLR, parent_id: 'parent-1' },
      { job: 'surveys', tenant_id: CANARY, parent_id: 'parent-1' },
    ])
    expect(updates.map((u) => u.ok)).toEqual([true, false])
    expect(out.ledger.tenants).toEqual({
      [STELLR]: { ok: true, opened: 1 },
      [CANARY]: { ok: false },
    })
  })

  it('writes no child rows when the parent has no row', async () => {
    const { db, inserts } = fakeDb()
    const out = await runPerTenant(db, fakeRun(null).run, {
      job: 'surveys',
      deadline: 60_000,
      tenantIds: [STELLR, CANARY],
      now: () => 0,
      fn: async () => ({}),
    })
    expect(inserts).toEqual([])
    expect(out.results.size).toBe(2)
  })

  it('skips a suspended tenant without failing the run', async () => {
    const { db } = fakeDb({ tenants: [...seeded, tenantRow(SUSPENDED, 'suspended')] })
    const { run, fails } = fakeRun()
    const called: string[] = []
    const out = await runPerTenant(db, run, {
      job: 'surveys',
      deadline: 60_000,
      fairness: 'rotate',
      now: () => 0,
      fn: async ({ tenant }) => {
        called.push(tenant.id)
        return {}
      },
    })
    expect(called).toEqual([STELLR, CANARY].sort())
    expect(out.skipped).toEqual([SUSPENDED])
    expect(fails).toEqual([])
  })

  it('includeInactive still reaches suspended and archived tenants, for retention', async () => {
    const ARCHIVED = 'dddddddd-0000-4000-8000-000000000004'
    const { db } = fakeDb({ tenants: [...seeded, tenantRow(SUSPENDED, 'suspended'), tenantRow(ARCHIVED, 'archived')] })
    const called: string[] = []
    const out = await runPerTenant(db, fakeRun().run, {
      job: 'survey-retention',
      deadline: 60_000,
      includeInactive: true,
      now: () => 0,
      fn: async ({ tenant }) => {
        called.push(tenant.id)
        return {}
      },
    })
    expect(called).toEqual(expect.arrayContaining([SUSPENDED, ARCHIVED, STELLR, CANARY]))
    expect(out.skipped).toEqual([])
  })

  it('Stellr with a suspended tenant keeps the attributed path, not the plain one', async () => {
    const { db, inserts } = fakeDb({ tenants: [...seeded, tenantRow(SUSPENDED, 'suspended')] })
    const { run, fails } = fakeRun()
    const out = await runPerTenant(db, run, {
      job: 'surveys',
      deadline: 60_000,
      tenantIds: [STELLR, SUSPENDED],
      now: () => 0,
      fn: async ({ fail }) => {
        fail('item', new Error('x'))
        return {}
      },
    })
    expect(out.ledger.skipped).toEqual([SUSPENDED])
    expect(inserts).toHaveLength(1)
    expect(fails[0].where).toBe(`t:${STELLR}:item`)
  })

  it('Stellr with an unknown tenant keeps the attributed path and records the unknown one', async () => {
    const { db, inserts } = fakeDb()
    const { run, fails } = fakeRun()
    const out = await runPerTenant(db, run, {
      job: 'surveys',
      deadline: 60_000,
      tenantIds: [STELLR, THIRD],
      now: () => 0,
      fn: async ({ fail }) => {
        fail('item', new Error('x'))
        return {}
      },
    })
    expect(Object.keys(out.ledger)).toContain('tenants')
    expect(inserts).toHaveLength(1)
    expect(fails.map((f) => f.where)).toEqual([`t:${THIRD}:run`, `t:${STELLR}:item`])
  })

  it("a result's own ok cannot hide a recorded failure in the ledger", async () => {
    const { db } = fakeDb()
    const out = await runPerTenant(db, fakeRun().run, {
      job: 'surveys',
      deadline: 60_000,
      tenantIds: [STELLR, CANARY],
      now: () => 0,
      fn: async ({ tenant, fail }) => {
        if (tenant.id === CANARY) fail('item', new Error('x'))
        return { ok: true }
      },
    })
    expect(out.ledger.tenants).toEqual({ [STELLR]: { ok: true }, [CANARY]: { ok: false } })
  })

  it('moves on from a tenant that overruns its slice, aborts it, and serves the next', async () => {
    const { db, updates } = fakeDb()
    const { run, fails } = fakeRun()
    let aborted = false
    const out = await runPerTenant(db, run, {
      job: 'surveys',
      deadline: 10,
      floorMs: 0,
      overrunMs: 5,
      tenantIds: [STELLR, CANARY],
      fairness: 'rotate',
      now: () => 0,
      fn: async ({ tenant, signal }) => {
        if (tenant.id !== [STELLR, CANARY].sort()[0]) return { served: true }
        signal.addEventListener('abort', () => {
          aborted = true
        })
        return new Promise<Record<string, unknown>>(() => {})
      },
    })
    const [hung, next] = [STELLR, CANARY].sort()
    expect(aborted).toBe(true)
    expect(out.results.get(next)).toEqual({ served: true })
    expect(out.results.has(hung)).toBe(false)
    expect(fails.map((f) => f.where)).toEqual([`t:${hung}:slice`])
    expect(updates.map((u) => u.ok)).toEqual([false, true])
  })

  it('a tenant that rejects after the runner moved on does not fail the run again or crash', async () => {
    const { db } = fakeDb()
    const { run, fails } = fakeRun()
    await runPerTenant(db, run, {
      job: 'surveys',
      deadline: 5,
      floorMs: 0,
      overrunMs: 1,
      tenantIds: [CANARY],
      now: () => 0,
      fn: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30))
        throw new Error('late')
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(fails.map((f) => f.where)).toEqual([`t:${CANARY}:slice`])
  })

  it('takes a slow child insert out of the slice and never hands time past the run deadline', async () => {
    const clock = { t: 0 }
    const { db } = fakeDb({
      onInsert: () => {
        clock.t += 500
      },
    })
    const handed: number[] = []
    await runPerTenant(db, fakeRun().run, {
      job: 'surveys',
      deadline: 1_000,
      floorMs: 0,
      tenantIds: [CANARY],
      now: () => clock.t,
      fn: async ({ deadline }) => {
        handed.push(deadline)
        return {}
      },
    })
    expect(handed).toEqual([1_000])
  })

  it('leaves out Stellr-only and idle runs when reading the cursor', async () => {
    const { db, nots } = fakeDb()
    await runPerTenant(db, fakeRun().run, {
      job: 'surveys',
      deadline: 60_000,
      tenantIds: [STELLR, CANARY],
      now: () => 0,
      fn: async () => ({}),
    })
    expect(nots).toContain(`result->>${TENANT_CURSOR_KEY}`)
  })

  it('puts the tenant a killed run died on last, so the others are served first', async () => {
    const tenants = [...seeded, tenantRow(THIRD, 'active')]
    const sorted = [STELLR, CANARY, THIRD].sort()
    const { db } = fakeDb({ tenants, newestChild: { tenant_id: sorted[0], finished_at: null } })
    const order: string[] = []
    await runPerTenant(db, fakeRun().run, {
      job: 'surveys',
      deadline: 60_000,
      fairness: 'rotate',
      now: () => 0,
      fn: async ({ tenant }) => {
        order.push(tenant.id)
        return {}
      },
    })
    expect(order).toEqual([sorted[1], sorted[2], sorted[0]])
  })

  it('keeps the order when the newest child row finished', async () => {
    const tenants = [...seeded, tenantRow(THIRD, 'active')]
    const sorted = [STELLR, CANARY, THIRD].sort()
    const { db } = fakeDb({ tenants, newestChild: { tenant_id: sorted[0], finished_at: '2026-11-04T00:00:00Z' } })
    const order: string[] = []
    await runPerTenant(db, fakeRun().run, {
      job: 'surveys',
      deadline: 60_000,
      fairness: 'rotate',
      now: () => 0,
      fn: async ({ tenant }) => {
        order.push(tenant.id)
        return {}
      },
    })
    expect(order).toEqual(sorted)
  })

  it('marks the run failed when tenants are cut off on consecutive multi-tenant runs', async () => {
    const clock = { t: 0 }
    const sorted = [STELLR, CANARY].sort()
    const { db } = fakeDb({ previous: { [TENANT_CURSOR_KEY]: sorted[0], notReached: [sorted[1]] } })
    const { run, fails } = fakeRun()
    await runPerTenant(db, run, {
      job: 'surveys',
      deadline: 10_000,
      tenantIds: [STELLR, CANARY],
      fairness: 'rotate',
      now: () => clock.t,
      fn: async () => {
        clock.t = 10_000
        return {}
      },
    })
    expect(fails.map((f) => f.where)).toEqual([`t:${sorted[1]}:not_reached`])
  })

  it('a single cut-off is not a failure', async () => {
    const clock = { t: 0 }
    const { db } = fakeDb()
    const { run, fails } = fakeRun()
    const out = await runPerTenant(db, run, {
      job: 'surveys',
      deadline: 10_000,
      tenantIds: [STELLR, CANARY],
      now: () => clock.t,
      fn: async () => {
        clock.t = 10_000
        return {}
      },
    })
    expect(out.notReached).toHaveLength(1)
    expect(fails).toEqual([])
  })

  it('leaving fairness out keeps Stellr first, whatever the cursor says', async () => {
    const { db } = fakeDb({ tenants: [...seeded, tenantRow(THIRD, 'active')], previous: { [TENANT_CURSOR_KEY]: THIRD } })
    const order: string[] = []
    await runPerTenant(db, fakeRun().run, {
      job: 'surveys',
      deadline: 60_000,
      now: () => 0,
      fn: async ({ tenant }) => {
        order.push(tenant.id)
        return {}
      },
    })
    expect(order[0]).toBe(STELLR)
  })

  it('the cursor names the third tenant when the deadline cut off only the third', async () => {
    const tenants = [...seeded, tenantRow(THIRD, 'active')]
    const sorted = [STELLR, CANARY, THIRD].sort()
    const clock = { t: 0 }
    const { db } = fakeDb({ tenants })
    let done = 0
    const out = await runPerTenant(db, fakeRun().run, {
      job: 'surveys',
      deadline: 10_000,
      fairness: 'rotate',
      now: () => clock.t,
      fn: async () => {
        if (++done === 2) clock.t = 10_000
        return {}
      },
    })
    expect(out.notReached).toEqual([sorted[2]])
    expect(out.ledger[TENANT_CURSOR_KEY]).toBe(sorted[2])
  })

  it('a non-owner tenant alone still gets a child row and attributed failures', async () => {
    const { db, inserts } = fakeDb()
    const { run, fails } = fakeRun()
    await runPerTenant(db, run, {
      job: 'surveys',
      deadline: 60_000,
      tenantIds: [CANARY],
      now: () => 0,
      fn: async ({ fail }) => {
        fail('item', new Error('x'))
        return {}
      },
    })
    expect(inserts).toHaveLength(1)
    expect(fails[0].where).toBe(`t:${CANARY}:item`)
  })

  it('rotation advances across runs, so every tenant gets to go first', async () => {
    const tenants = [...seeded, tenantRow(THIRD, 'active')]
    let previous: Row | undefined
    const firsts: string[] = []
    for (let i = 0; i < 3; i++) {
      const { db } = fakeDb({ tenants, previous })
      const order: string[] = []
      const out = await runPerTenant(db, fakeRun().run, {
        job: 'surveys',
        deadline: 60_000,
        fairness: 'rotate',
        now: () => 0,
        fn: async ({ tenant }) => {
          order.push(tenant.id)
          return {}
        },
      })
      firsts.push(order[0])
      previous = { [TENANT_CURSOR_KEY]: out.ledger[TENANT_CURSOR_KEY] }
    }
    expect(new Set(firsts).size).toBe(3)
  })

  it('a tenant the deadline cut off goes first next run', async () => {
    const clock = { t: 0 }
    const { db } = fakeDb()
    const out = await runPerTenant(db, fakeRun().run, {
      job: 'surveys',
      deadline: 10_000,
      tenantIds: [STELLR, CANARY],
      fairness: 'rotate',
      now: () => clock.t,
      fn: async () => {
        clock.t = 10_000
        return {}
      },
    })
    const [first, second] = [STELLR, CANARY].sort()
    expect(out.results.has(first)).toBe(true)
    expect(out.notReached).toEqual([second])
    expect(out.ledger[TENANT_CURSOR_KEY]).toBe(second)
  })

  it('slices sum to no more than the deadline when each tenant spends all of its slice', async () => {
    const tenants = [...seeded, tenantRow(THIRD, 'active')]
    const start = 1_000
    const deadline = start + 30_000
    const clock = { t: start }
    const slices: number[] = []
    const { db } = fakeDb({ tenants })
    const out = await runPerTenant(db, fakeRun().run, {
      job: 'surveys',
      deadline,
      floorMs: 5_000,
      now: () => clock.t,
      fn: async ({ deadline: sliceEnd }) => {
        slices.push(sliceEnd - clock.t)
        clock.t = sliceEnd
        return {}
      },
    })
    expect(slices).toEqual([10_000, 10_000, 10_000])
    expect(clock.t).toBeLessThanOrEqual(deadline)
    expect(out.notReached).toEqual([])
  })

  it('stellr_first puts Stellr first whatever the cursor says', async () => {
    const tenants = [...seeded, tenantRow(THIRD, 'active')]
    const { db } = fakeDb({ tenants, previous: { [TENANT_CURSOR_KEY]: THIRD } })
    const order: string[] = []
    await runPerTenant(db, fakeRun().run, {
      job: 'surveys',
      deadline: 60_000,
      fairness: 'stellr_first',
      now: () => 0,
      fn: async ({ tenant }) => {
        order.push(tenant.id)
        return {}
      },
    })
    expect(order[0]).toBe(STELLR)
    expect(order[1]).toBe(THIRD)
  })
})
