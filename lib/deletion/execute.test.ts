import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

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
const liveScholarshipOffers = vi.fn(async (_db: unknown, regId: string) => (regId === 'r1' ? ['sch-1'] : []))
const cancelScholarshipsOnWithdrawal = vi.fn(async (_db: unknown, ids: string[]) => ids.map((id) => ({ id, percent: 50 })))

vi.mock('@/lib/credentials', () => ({ tombstoneCredentialsFor }))
vi.mock('@/lib/event-participation-sync', () => ({ removeEventParticipation }))
vi.mock('@/lib/esign/retention', () => ({ retainSignedRecords, startRetentionClock }))
vi.mock('@/lib/survey/purge', () => ({ purgeSurveyDataFor }))
vi.mock('@/lib/refunds/execute', () => ({ executeRefund: vi.fn() }))
vi.mock('./archive', () => ({ archiveEntity }))
vi.mock('./external', () => ({ runExternalCleanup }))
vi.mock('./preflight', () => ({ deletionPreflight }))
vi.mock('@/lib/scholarship-cancel', () => ({ liveScholarshipOffers, cancelScholarshipsOnWithdrawal }))

// Tables deleted from so far: the membership sync must see the assignments gone.
const deletedTables: string[] = []
const loadEventAssignees = vi.fn<(db: unknown, slug: string) => Promise<{ clerkUserId: string; tenantId: string | null }[] | null>>(async () => [])
const syncEventManagerUnassigned = vi.fn(async (..._a: unknown[]): Promise<{ ok: true } | { ok: false; step: string; code: string }> => {
  expect(deletedTables).toContain('event_manager_assignments')
  return { ok: true }
})
const reportRoleSyncFailure = vi.fn(async (..._a: unknown[]) => {})
vi.mock('@/lib/authz/role-sync', () => ({ loadEventAssignees, syncEventManagerUnassigned }))
vi.mock('@/lib/authz/role-sync-report', () => ({ reportRoleSyncFailure }))

// Canned reads keyed by (table, selected columns). Writes just succeed.
const participantsById: Record<string, unknown>[] = [{ id: 'p1' }, { id: 'p2' }]
const participantMembers: Record<string, unknown>[] = [{ member_id: 'mem1' }, { member_id: 'mem2' }]
// deep review QUALTEST-N1: inject a read error on a table so we can assert the
// erasure/teardown aborts (throws) instead of silently treating the failed read
// as an empty result. Mutated per-test; cleared in beforeEach.
const readErrors: Record<string, unknown> = {}
// The registration's type for the "is this an individual registration left
// empty?" read. Mutated per-test; reset in beforeEach.
let registrationType = 'group'
// S5 wave 6: the declined or expired tenant guardian consents on the registration.
let refusedConsents: Record<string, unknown>[] = []

vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from(table: string) {
      const b: Record<string, unknown> = { table, op: 'select', cols: '', count: false }
      const chain = {
        select: (cols: string, opts?: { head?: boolean }) => { b.cols = cols; b.count = !!opts?.head; return chain },
        delete: () => { b.op = 'delete'; deletedTables.push(table); return chain },
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
  if (table === 'tenant_guardian_consents' && cols === 'participant_id') return refusedConsents
  return []
}
function single(table: string, cols: string): Record<string, unknown> | null {
  if (table === 'participants' && cols.includes('registrations(event_slug)')) {
    return { member_id: 'mem1', registrations: { event_slug: 'evt' } }
  }
  if (table === 'participants' && cols === 'registration_id') return { registration_id: 'r1' }
  if (table === 'registrations' && cols === 'event_slug') return { event_slug: 'evt' }
  if (table === 'registrations' && cols.includes('type')) return { type: registrationType, status: 'confirmed' }
  return null
}

const { executeDeletion } = await import('./execute')

beforeEach(() => {
  for (const fn of [tombstoneCredentialsFor, removeEventParticipation, retainSignedRecords,
    startRetentionClock, purgeSurveyDataFor, archiveEntity, runExternalCleanup,
    liveScholarshipOffers, cancelScholarshipsOnWithdrawal]) fn.mockClear()
  for (const k of Object.keys(readErrors)) delete readErrors[k]
  registrationType = 'group'
  refusedConsents = []
  deletedTables.length = 0
  loadEventAssignees.mockClear()
  syncEventManagerUnassigned.mockClear()
  reportRoleSyncFailure.mockClear()
})

describe('executeDeletion — event manager memberships (S5 C9)', () => {
  it('syncs each manager of a deleted event after its assignments are gone', async () => {
    loadEventAssignees.mockResolvedValueOnce([{ clerkUserId: 'user_a', tenantId: null }, { clerkUserId: 'user_b', tenantId: STELLR_TENANT_ID }])
    const result = await executeDeletion('event', 'colorado', { mode: 'hard' })
    expect(result.deleted).toBe(true)
    expect(syncEventManagerUnassigned).toHaveBeenCalledWith(expect.anything(), 'user_a', 'colorado', STELLR_TENANT_ID, null)
    expect(syncEventManagerUnassigned).toHaveBeenCalledWith(expect.anything(), 'user_b', 'colorado', STELLR_TENANT_ID, STELLR_TENANT_ID)
  })

  it('reports a failed sync, and the deletion still completes', async () => {
    loadEventAssignees.mockResolvedValueOnce([{ clerkUserId: 'user_a', tenantId: null }])
    const failed = { ok: false as const, step: 'membership_delete', code: 'unknown' }
    syncEventManagerUnassigned.mockResolvedValueOnce(failed)
    const result = await executeDeletion('event', 'colorado', { mode: 'hard' })
    expect(result.deleted).toBe(true)
    expect(reportRoleSyncFailure).toHaveBeenCalledWith('event_delete', failed, expect.anything())
  })

  it('reports an unreadable assignee list, and the deletion still completes', async () => {
    loadEventAssignees.mockResolvedValueOnce(null)
    const result = await executeDeletion('event', 'colorado', { mode: 'hard' })
    expect(result.deleted).toBe(true)
    expect(syncEventManagerUnassigned).not.toHaveBeenCalled()
    expect(reportRoleSyncFailure).toHaveBeenCalledWith('event_delete', expect.objectContaining({ ok: false, step: 'event_assignees' }), expect.anything())
  })

  it('does nothing for any other entity', async () => {
    await executeDeletion('registration', 'r1', { mode: 'hard' })
    expect(loadEventAssignees).not.toHaveBeenCalled()
    expect(reportRoleSyncFailure).not.toHaveBeenCalled()
  })
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

describe('executeDeletion — scholarship offers end with the registration', () => {
  it('a soft withdrawal cancels the live offers on the registration', async () => {
    const result = await executeDeletion('registration', 'r1', { mode: 'soft' })
    expect(liveScholarshipOffers).toHaveBeenCalledWith(expect.anything(), 'r1')
    expect(cancelScholarshipsOnWithdrawal).toHaveBeenCalledWith(expect.anything(), ['sch-1'])
    expect(result.scholarshipsCancelled).toEqual([{ id: 'sch-1', percent: 50 }])
  })

  it('a hard delete reads the offers BEFORE the row goes (the FK nulls the link) and cancels them after', async () => {
    const result = await executeDeletion('registration', 'r1', { mode: 'hard' })
    expect(liveScholarshipOffers.mock.invocationCallOrder[0]).toBeLessThan(archiveEntity.mock.invocationCallOrder[0])
    expect(cancelScholarshipsOnWithdrawal.mock.invocationCallOrder[0]).toBeGreaterThan(archiveEntity.mock.invocationCallOrder[0])
    expect(result.scholarshipsCancelled).toEqual([{ id: 'sch-1', percent: 50 }])
  })

  it('deleting the only student on an individual registration withdraws it and cancels its offer', async () => {
    registrationType = 'individual'
    const result = await executeDeletion('participant', 'p1', { mode: 'hard' })
    expect(liveScholarshipOffers).toHaveBeenCalledWith(expect.anything(), 'r1')
    expect(result.scholarshipsCancelled).toEqual([{ id: 'sch-1', percent: 50 }])
  })

  it('cancels nothing when the withdrawal itself fails', async () => {
    readErrors.registrations = { message: 'pool exhausted' }
    await expect(executeDeletion('registration', 'r1', { mode: 'hard' })).rejects.toThrow()
    expect(cancelScholarshipsOnWithdrawal).not.toHaveBeenCalled()
  })
})

// S5 wave 6: the archive-free removal of a tenant event's registration whose
// guardian declined the consent form or never signed it.
describe('executeDeletion — pending_guardian_consent_registration', () => {
  it('removes the registration as a registration hard delete, with no archive snapshot', async () => {
    refusedConsents = [{ participant_id: 'p1' }, { participant_id: 'p2' }]
    const result = await executeDeletion('pending_guardian_consent_registration', 'r1', { mode: 'hard', deletedBy: null })
    expect(result).toMatchObject({ entity: 'pending_guardian_consent_registration', deleted: true, mode: 'hard' })
    expect(archiveEntity).not.toHaveBeenCalled()
    expect(retainSignedRecords).toHaveBeenCalledWith(expect.anything(), { kind: 'registration', id: 'r1' })
    expect((runExternalCleanup.mock.calls[0] as unknown[])[0]).toMatchObject({ type: 'registration', external: ['docusign'] })
    expect(deletedTables).toContain('registrations')
  })

  it('refuses a registration with any participant whose consent was not declined or expired', async () => {
    refusedConsents = [{ participant_id: 'p1' }]
    await expect(executeDeletion('pending_guardian_consent_registration', 'r1', { mode: 'hard' })).rejects.toThrow(/guardian consent/)
    expect(deletedTables).toEqual([])
    expect(runExternalCleanup).not.toHaveBeenCalled()
  })

  it('refuses when the consent read fails', async () => {
    readErrors.tenant_guardian_consents = { message: 'down' }
    await expect(executeDeletion('pending_guardian_consent_registration', 'r1', { mode: 'hard' })).rejects.toThrow(/awaiting guardian consent/)
    expect(deletedTables).toEqual([])
  })
})
