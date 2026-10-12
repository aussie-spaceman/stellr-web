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
// deep review QUALTEST-N1: inject a read error on a table so we can assert the
// erasure/teardown aborts (throws) instead of silently treating the failed read
// as an empty result. Mutated per-test; cleared in beforeEach.
const readErrors: Record<string, unknown> = {}

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
        maybeSingle: async () => {
          const e = readErrors[table] ?? null
          return { data: e ? null : single(table, b.cols as string), error: e }
        },
        then: (resolve: (v: unknown) => unknown) => {
          if (b.op !== 'select') return resolve({ data: null, error: null })
          const e = readErrors[table] ?? null
          if (b.count) return resolve({ count: e ? null : 0, error: e })
          return resolve({ data: e ? null : list(table, b.cols as string), error: e })
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
  for (const k of Object.keys(readErrors)) delete readErrors[k]
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

describe('executeDeletion — teardown reads fail closed (deep review QUALTEST-N1)', () => {
  it('aborts a member hard-delete when the participant-rows read for the credential tombstone errors', async () => {
    // A discarded error would skip the participant-linked credentials — the exact
    // null-member_id case the tombstone exists for — erasing nothing while the row
    // is deleted. Must throw so the deletion is retried, not silently incomplete.
    readErrors.participants = { message: 'statement timeout' }
    await expect(executeDeletion('member', 'mem1', { mode: 'hard' })).rejects.toThrow(/tombstone aborted/i)
  })

  it('aborts a participant hard-delete when the Space-access teardown read errors', async () => {
    // participantsLeavingEvent must not return [] on an errored read — that would
    // skip the event-Space revocation and leave the member in a minors' Space.
    readErrors.participants = { message: 'PostgREST 503' }
    await expect(executeDeletion('participant', 'p1', { mode: 'hard' })).rejects.toThrow(/teardown aborted/i)
  })

  it('aborts a group hard-delete when the registration read for the Space-access teardown errors', async () => {
    readErrors.registrations = { message: 'pool exhausted' }
    await expect(executeDeletion('registration', 'r1', { mode: 'hard' })).rejects.toThrow(/teardown aborted/i)
  })
})
