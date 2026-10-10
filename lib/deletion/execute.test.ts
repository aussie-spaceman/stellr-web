import { beforeEach, describe, expect, it, vi } from 'vitest'

// executeDeletion orchestrates a lot of collaborators; stub every side-effecting
// one so the test can assert the erasure/removal CALLS the orchestrator makes
// (tombstone per holder, remove event participation per departing member) and
// that they land on the HARD path only.
const tombstoneCredentialsFor = vi.fn(async () => 1)
const removeEventParticipation = vi.fn(async () => {})
const retainSignedRecords = vi.fn(async () => {})
const startRetentionClock = vi.fn(async () => {})
const purgeSurveyDataFor = vi.fn(async () => {})
const archiveEntity = vi.fn(async () => {})
const runExternalCleanup = vi.fn(async () => [])
const deletionPreflight = vi.fn(async () => ({ canDelete: true, blockers: [], entity: '', id: '' }))

vi.mock('@/lib/credentials', () => ({ tombstoneCredentialsFor }))
vi.mock('@/lib/event-participation-sync', () => ({ removeEventParticipation }))
vi.mock('@/lib/esign/retention', () => ({ retainSignedRecords, startRetentionClock }))
vi.mock('@/lib/survey/purge', () => ({ purgeSurveyDataFor }))
vi.mock('@/lib/refunds/execute', () => ({ executeRefund: vi.fn() }))
vi.mock('./archive', () => ({ archiveEntity }))
vi.mock('./external', () => ({ runExternalCleanup }))
vi.mock('./preflight', () => ({ deletionPreflight }))

// Canned reads keyed by (table, selected columns). Writes just succeed.
const participantsById: Record<string, unknown>[] = [{ id: 'p1' }, { id: 'p2' }]
const participantMembers: Record<string, unknown>[] = [{ member_id: 'mem1' }, { member_id: 'mem2' }]

vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from(table: string) {
      const b: Record<string, unknown> = { table, op: 'select', cols: '', count: false }
      const chain = {
        select: (cols: string, opts?: { head?: boolean }) => { b.cols = cols; b.count = !!opts?.head; return chain },
        delete: () => { b.op = 'delete'; return chain },
        update: () => { b.op = 'update'; return chain },
        eq: () => chain,
        neq: () => chain,
        in: () => chain,
        is: () => chain,
        maybeSingle: async () => ({ data: single(table, b.cols as string), error: null }),
        then: (resolve: (v: unknown) => unknown) => {
          if (b.op !== 'select') return resolve({ data: null, error: null })
          if (b.count) return resolve({ count: 0, error: null })
          return resolve({ data: list(table, b.cols as string), error: null })
        },
      }
      return chain
    },
  }),
}))

function list(table: string, cols: string): Record<string, unknown>[] {
  if (table === 'participants' && cols === 'id') return participantsById
  if (table === 'participants' && cols === 'member_id') return participantMembers
  return []
}
function single(table: string, cols: string): Record<string, unknown> | null {
  if (table === 'participants' && cols.includes('registrations(event_slug)')) {
    return { member_id: 'mem1', registrations: { event_slug: 'evt' } }
  }
  if (table === 'participants' && cols === 'registration_id') return { registration_id: 'r1' }
  if (table === 'registrations' && cols === 'event_slug') return { event_slug: 'evt' }
  if (table === 'registrations' && cols.includes('type')) return { type: 'group', status: 'confirmed' }
  return null
}

const { executeDeletion } = await import('./execute')

beforeEach(() => {
  for (const fn of [tombstoneCredentialsFor, removeEventParticipation, retainSignedRecords,
    startRetentionClock, purgeSurveyDataFor, archiveEntity, runExternalCleanup]) fn.mockClear()
})

describe('executeDeletion — credential erasure (deep review MP-2 / MP-11)', () => {
  it('hard-deleting a group registration tombstones every participant credential by participant id', async () => {
    await executeDeletion('registration', 'r1', { mode: 'hard' })
    // Each student's event credential is tombstoned before the cascade nulls the
    // link — matched by participant_id, so a credential issued with a null
    // member_id (no account at award time) is still caught.
    expect(tombstoneCredentialsFor).toHaveBeenCalledWith(expect.anything(), 'participant', 'p1')
    expect(tombstoneCredentialsFor).toHaveBeenCalledWith(expect.anything(), 'participant', 'p2')
  })

  it('hard-deleting a member tombstones by the member AND by each of their participant rows', async () => {
    await executeDeletion('member', 'mem1', { mode: 'hard' })
    expect(tombstoneCredentialsFor).toHaveBeenCalledWith(expect.anything(), 'member', 'mem1')
    expect(tombstoneCredentialsFor).toHaveBeenCalledWith(expect.anything(), 'participant', 'p1')
    expect(tombstoneCredentialsFor).toHaveBeenCalledWith(expect.anything(), 'participant', 'p2')
  })

  it('SOFT-deleting a member never tombstones credentials (recoverable deactivation)', async () => {
    await executeDeletion('member', 'mem1', { mode: 'soft' })
    expect(tombstoneCredentialsFor).not.toHaveBeenCalled()
  })
})

describe('executeDeletion — event Space access (deep review REG-10)', () => {
  it('revokes event participation for every departing member of a deleted group', async () => {
    await executeDeletion('registration', 'r1', { mode: 'hard' })
    expect(removeEventParticipation).toHaveBeenCalledWith(expect.anything(), { memberId: 'mem1', eventSlug: 'evt' })
    expect(removeEventParticipation).toHaveBeenCalledWith(expect.anything(), { memberId: 'mem2', eventSlug: 'evt' })
  })

  it('revokes event participation for a deleted participant', async () => {
    await executeDeletion('participant', 'p1', { mode: 'hard' })
    expect(removeEventParticipation).toHaveBeenCalledWith(expect.anything(), { memberId: 'mem1', eventSlug: 'evt' })
  })
})
