import { beforeEach, describe, expect, it, vi } from 'vitest'

// removeEventParticipation only touches the DB, but importing the module pulls
// in its grant-side collaborators. Stub them so the test exercises the removal
// query shapes in isolation.
vi.mock('@/lib/activity-log', () => ({ logActivity: vi.fn() }))
vi.mock('@/lib/membership-grants', () => ({ applyGrantTrigger: vi.fn() }))
vi.mock('@/lib/container-sync', () => ({ ensureRosterMembership: vi.fn() }))
vi.mock('@/lib/space-inheritance', () => ({ syncObjectSpaceRoster: vi.fn() }))

const { removeEventParticipation } = await import('./event-participation-sync')

// Count the fake Supabase returns for the "does this member still have another
// active participant on the event?" guard.
let stillInCount: number
// Every delete the code issues, recorded as `${table}` for assertions.
let deletes: { table: string }[]

function makeDb() {
  deletes = []
  const listFor: Record<string, unknown[]> = {
    mentoring_cohorts: [{ id: 'c1' }, { id: 'c2' }],
    community_space_sources: [{ space_id: 's1' }],
  }
  return {
    from(table: string) {
      const b: Record<string, unknown> = { table, op: 'select', count: false }
      const chain = {
        select: (_cols: string, opts?: { head?: boolean }) => {
          b.count = !!opts?.head
          return chain
        },
        delete: () => { b.op = 'delete'; return chain },
        update: () => { b.op = 'update'; return chain },
        eq: () => chain,
        neq: () => chain,
        in: () => chain,
        is: () => chain,
        then: (resolve: (v: unknown) => unknown) => {
          if (b.op === 'delete' || b.op === 'update') {
            deletes.push({ table })
            return resolve({ data: null, error: null })
          }
          if (b.count) return resolve({ count: stillInCount, error: null })
          return resolve({ data: listFor[table] ?? [], error: null })
        },
      }
      return chain
    },
  } as unknown as Parameters<typeof removeEventParticipation>[0]
}

beforeEach(() => {
  stillInCount = 0
})

describe('removeEventParticipation (deep review REG-10)', () => {
  it('revokes the cohort roster row, the inherited Space membership and the participation row', async () => {
    const db = makeDb()
    await removeEventParticipation(db, { memberId: 'mem1', eventSlug: 'evt' })
    const tables = deletes.map((d) => d.table)
    // Deactivating the cohort membership is what stops reconcileEventSpaceRoster
    // re-granting the Space on the next registration for the event.
    expect(tables).toContain('cohort_members')
    expect(tables).toContain('community_space_members')
    expect(tables).toContain('event_participations')
  })

  it('does NOTHING when the member still has another active participant on the event', async () => {
    stillInCount = 1
    const db = makeDb()
    await removeEventParticipation(db, { memberId: 'mem1', eventSlug: 'evt' })
    // Another registration still entitles them — removing one must not strip
    // access they hold by another route.
    expect(deletes).toHaveLength(0)
  })

  it('is a no-op without a member or an event slug', async () => {
    const db = makeDb()
    await removeEventParticipation(db, { memberId: null, eventSlug: 'evt' })
    await removeEventParticipation(db, { memberId: 'mem1', eventSlug: null })
    expect(deletes).toHaveLength(0)
  })
})
