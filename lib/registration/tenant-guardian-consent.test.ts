import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRecorder, type DbCall, type DbResult } from '@/test/registration/fixtures'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// S5 wave 6: what happens after a consent-pending registration is saved. The
// guardian signs (the participant is registered), declines, or never answers (the
// sweep); each ends in the right state, through the deletion registry where a row
// goes, with the registrant told from the tenant's sender.

const h = vi.hoisted(() => ({
  confirmation: vi.fn(async (_db: unknown, _input: Record<string, unknown>) => ({ ok: true, id: 'em_1' })),
  audit: vi.fn(async (_m: Record<string, unknown>, _o?: unknown) => ({ ok: false, skipped: 'disabled' })),
}))

vi.mock('@/lib/event-emails/tenant-mail', async (orig) => ({
  ...(await orig<typeof import('@/lib/event-emails/tenant-mail')>()),
  sendTenantConfirmation: h.confirmation,
}))
vi.mock('@/lib/audit/route', () => ({ auditMutation: h.audit }))

const {
  settleTenantGuardianConsentSigned,
  settleTenantGuardianConsentDeclined,
  sweepTenantGuardianConsents,
  unconsentedParticipantIds,
  consentWindowEnd,
  guardianFromForm,
} = await import('./tenant-guardian-consent')

const CANARY = 'c0000000-0000-4000-8000-0000000000aa'
const ROW = { id: 'tgc-1', tenant_id: CANARY, registration_id: 'reg-1', participant_id: 'p-1', status: 'pending', removal_attempts: 0 }
const ENVELOPE = { id: 'agr-1', envelope_type: 'tenant_guardian_consent', participant_id: 'p-1', tenant_id: CANARY }
const PARTICIPANT = { email: 'kid@example.com', first_name: 'Kit', registrations: { event_title: 'Canary Cup' } }

const rec = createRecorder()
const db = rec.client()
const writes = () => rec.calls.filter((c) => c.op !== 'select').map((c) => `${c.op} ${c.table}`)
const subjects = () => h.confirmation.mock.calls.map((c) => (c[1] as { subject: string }).subject)
const actions = () => h.audit.mock.calls.map((c) => c[0].action)

/** The consent table answers: the update moves `moved` rows; reads return `pending`/`retries`. */
function arrange(opts: {
  moved?: unknown[]
  pending?: unknown[]
  retries?: unknown[]
  agreements?: unknown[]
  guardianSigned?: number
  /** The sweep's void pass: open consent envelopes, and the consent rows their participants have. */
  openEnvelopes?: unknown[]
  openEnvelopesError?: boolean
  consentsFor?: unknown[]
} = {}) {
  rec.respond((c: DbCall): DbResult | undefined => {
    if (c.table === 'tenant_guardian_consents' && c.op === 'update' && (c.payload as Record<string, unknown>).status) {
      return { data: opts.moved ?? [ROW], error: null }
    }
    if (c.table === 'agreements' && c.op === 'select' && c.filters.some((f) => f[0] === 'eq' && f[1] === 'envelope_type' && !c.filters.some((g) => g[1] === 'participant_id' && g[0] === 'eq'))) {
      if (opts.openEnvelopesError) return { data: null, error: { message: 'down' } as never }
      // One page: the next read (after the last id) is empty.
      return { data: c.filters.some((f) => f[0] === 'gt') ? [] : opts.openEnvelopes ?? [], error: null }
    }
    if (c.table === 'tenant_guardian_consents' && c.op === 'select' && c.filters.some((f) => f[0] === 'in' && f[1] === 'participant_id')) {
      return { data: opts.consentsFor ?? [], error: null }
    }
    if (c.table === 'tenant_guardian_consents' && c.op === 'select') {
      const retry = c.filters.some((f) => f[0] === 'in' && f[1] === 'status')
      return { data: retry ? opts.retries ?? [] : opts.pending ?? [], error: null }
    }
    if (c.table === 'participants' && c.op === 'select') return { data: PARTICIPANT, error: null }
    if (c.table === 'agreements' && c.op === 'select') return { data: opts.agreements ?? [], error: null }
    if (c.table === 'agreement_recipients' && c.count) return { data: null, error: null, count: opts.guardianSigned ?? 0 }
    if (c.table === 'tenant_guardian_consents' && c.op === 'select') return { data: [], error: null }
    return undefined
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  rec.reset()
  vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', 'true')
})
afterEach(() => vi.unstubAllEnvs())

describe('the guardian signs', () => {
  it('the pending consent becomes signed, audited, and the registrant gets their confirmation', async () => {
    arrange()
    expect(await settleTenantGuardianConsentSigned(db, ENVELOPE)).toBe(true)
    const update = rec.calls.find((c) => c.op === 'update')!
    expect(update.payload).toMatchObject({ status: 'signed' })
    expect(update.filters).toEqual(expect.arrayContaining([['eq', 'participant_id', 'p-1'], ['eq', 'status', 'pending']]))
    expect(actions()).toEqual(['registration.guardian_consent.sign'])
    expect(h.confirmation).toHaveBeenCalledTimes(1)
    expect(h.confirmation.mock.calls[0][1]).toMatchObject({ tenantId: CANARY, to: 'kid@example.com', subject: 'Registered: Canary Cup' })
  })

  it('a replay (already settled) sends nothing', async () => {
    arrange({ moved: [] })
    expect(await settleTenantGuardianConsentSigned(db, ENVELOPE)).toBe(false)
    expect(h.confirmation).not.toHaveBeenCalled()
    expect(h.audit).not.toHaveBeenCalled()
  })

  it.each([
    ['a Stellr minor agreement', { ...ENVELOPE, envelope_type: 'minor' }],
    ['a consent envelope stamped Stellr', { ...ENVELOPE, tenant_id: STELLR_TENANT_ID }],
    ['an envelope with no participant', { ...ENVELOPE, participant_id: null }],
  ])('%s is not touched', async (_l, envelope) => {
    arrange()
    expect(await settleTenantGuardianConsentSigned(db, envelope)).toBe(false)
    expect(rec.calls).toEqual([])
  })
})

describe('the guardian declines', () => {
  it('the consent is declined, the registration removed through the registry, then the registrant told', async () => {
    arrange()
    const order: string[] = []
    h.confirmation.mockImplementation(async () => { order.push('notice'); return { ok: true, id: 'em' } })
    const deleteRegistration = vi.fn(async (id: string) => { order.push(`delete ${id}`) })
    await settleTenantGuardianConsentDeclined(db, ENVELOPE, { deleteRegistration })
    expect(rec.calls.find((c) => c.op === 'update')!.payload).toMatchObject({ status: 'declined' })
    expect(deleteRegistration).toHaveBeenCalledWith('reg-1')
    expect(order).toEqual(['delete reg-1', 'notice'])
    expect(subjects()).toEqual(['Registration cancelled: Canary Cup'])
    expect(actions()).toEqual(['registration.guardian_consent.decline'])
  })

  it('a removal that fails tells nobody and is left for the sweep', async () => {
    arrange()
    const deleteRegistration = vi.fn(async () => { throw new Error('blocked') })
    await settleTenantGuardianConsentDeclined(db, ENVELOPE, { deleteRegistration })
    expect(h.confirmation).not.toHaveBeenCalled()
    const retry = rec.calls.filter((c) => c.op === 'update').at(-1)!
    expect(retry.payload).toMatchObject({ removal_attempts: 1 })
    expect((retry.payload as { next_attempt_at: string }).next_attempt_at).toBeTruthy()
  })

  it('the default removal goes through the deletion registry as a pending-consent registration', async () => {
    vi.resetModules()
    const executeDeletion = vi.fn(async () => ({}))
    vi.doMock('@/lib/deletion/execute', () => ({ executeDeletion }))
    const fresh = await import('./tenant-guardian-consent')
    arrange()
    await fresh.settleTenantGuardianConsentDeclined(db, ENVELOPE)
    expect(executeDeletion).toHaveBeenCalledWith('pending_guardian_consent_registration', 'reg-1', { mode: 'hard', deletedBy: null })
    vi.doUnmock('@/lib/deletion/execute')
  })
})

describe('the daily sweep', () => {
  const NOW = new Date('2026-12-01T12:00:00Z')

  it('a pending consent past its window, with the envelope still open, is expired and its registration removed', async () => {
    arrange({ pending: [ROW], agreements: [{ id: 'agr-1', status: 'sent' }], guardianSigned: 0 })
    const deleteRegistration = vi.fn(async () => {})
    const r = await sweepTenantGuardianConsents(db, { now: NOW, deleteRegistration })
    expect(r).toMatchObject({ expired: ['tgc-1'], removed: ['tgc-1'], signed: [], held: [], errors: [] })
    expect(deleteRegistration).toHaveBeenCalledWith('reg-1')
    expect(subjects()).toEqual(['Registration cancelled: Canary Cup'])
    expect(actions()).toEqual(['registration.guardian_consent.expire'])
    const due = rec.calls.find((c) => c.table === 'tenant_guardian_consents' && c.op === 'select' && c.filters.some((f) => f[1] === 'expires_at'))!
    expect(due.filters).toEqual(expect.arrayContaining([['eq', 'status', 'pending'], ['lte', 'expires_at', NOW.toISOString()]]))
  })

  it('a missed completion is settled signed, not removed', async () => {
    arrange({ pending: [ROW], agreements: [{ id: 'agr-1', status: 'completed' }] })
    const deleteRegistration = vi.fn(async () => {})
    const r = await sweepTenantGuardianConsents(db, { now: NOW, deleteRegistration })
    expect(r).toMatchObject({ signed: ['tgc-1'], expired: [], removed: [] })
    expect(deleteRegistration).not.toHaveBeenCalled()
    expect(subjects()).toEqual(['Registered: Canary Cup'])
  })

  it('a guardian who has signed while the envelope is finalising is held', async () => {
    arrange({ pending: [ROW], agreements: [{ id: 'agr-1', status: 'sent' }], guardianSigned: 1 })
    const deleteRegistration = vi.fn(async () => {})
    const r = await sweepTenantGuardianConsents(db, { now: NOW, deleteRegistration })
    expect(r).toMatchObject({ held: ['tgc-1'], expired: [], removed: [] })
    expect(deleteRegistration).not.toHaveBeenCalled()
    expect(writes()).toEqual([])
  })

  it('a declined consent whose removal failed before is removed on the next run', async () => {
    arrange({ retries: [{ ...ROW, status: 'declined', removal_attempts: 1 }] })
    const deleteRegistration = vi.fn(async () => {})
    const r = await sweepTenantGuardianConsents(db, { now: NOW, deleteRegistration })
    expect(r.removed).toEqual(['tgc-1'])
    expect(subjects()).toEqual(['Registration cancelled: Canary Cup'])
  })

  it('an open consent envelope whose participant has no consent row any more (corrected to 18 or over) is voided', async () => {
    arrange({
      openEnvelopes: [
        { id: 'agr-1', envelope_id: 'native-1', provider: 'native', participant_id: 'p-1' },
        { id: 'agr-2', envelope_id: 'native-2', provider: 'native', participant_id: 'p-2' },
      ],
      consentsFor: [{ participant_id: 'p-1' }],
    })
    const voidEnvelope = vi.fn(async (_row: { envelope_id: string; provider: string | null }) => {})
    const r = await sweepTenantGuardianConsents(db, { now: NOW, deleteRegistration: vi.fn(), voidEnvelope })
    expect(voidEnvelope.mock.calls).toEqual([[{ envelope_id: 'native-2', provider: 'native' }]])
    expect(r).toMatchObject({ voided: ['agr-2'], errors: [] })
    const open = rec.calls.find((c) => c.table === 'agreements' && c.filters.some((f) => f[1] === 'envelope_type'))!
    expect(open.filters).toEqual(expect.arrayContaining([
      ['eq', 'envelope_type', 'tenant_guardian_consent'],
      ['in', 'status', ['created', 'sent', 'delivered']],
    ]))
    // The registrant hears nothing about it.
    expect(h.confirmation).not.toHaveBeenCalled()
  })

  it('a failed read of open envelopes voids nothing and is recorded', async () => {
    arrange({ openEnvelopesError: true })
    const voidEnvelope = vi.fn(async () => {})
    const r = await sweepTenantGuardianConsents(db, { now: NOW, deleteRegistration: vi.fn(), voidEnvelope })
    expect(voidEnvelope).not.toHaveBeenCalled()
    expect(r.voided).toEqual([])
    expect(r.errors).toEqual([{ consentId: 'open-envelopes', error: expect.stringContaining('down') }])
  })
})

describe('helpers', () => {
  it('unconsentedParticipantIds reads this tenant’s unsigned consents, and nothing for Stellr', async () => {
    rec.respond((c) => (c.table === 'tenant_guardian_consents'
      ? { data: c.filters.some((f) => f[0] === 'gt') ? [] : [{ participant_id: 'p-1' }], error: null }
      : undefined))
    expect([...(await unconsentedParticipantIds(db, CANARY))]).toEqual(['p-1'])
    expect(rec.calls[0].filters).toEqual([['eq', 'tenant_id', CANARY], ['neq', 'status', 'signed']])
    rec.reset()
    expect((await unconsentedParticipantIds(db, STELLR_TENANT_ID)).size).toBe(0)
    expect(rec.calls).toEqual([])
  })

  it('unconsentedParticipantIds reads every page, even when the server caps a read below the page asked for', async () => {
    // More rows than one capped read returns: the database answers 2 rows a read,
    // in participant_id order after the `gt` key, as PostgREST's max-rows would.
    const all = ['p-01', 'p-02', 'p-03', 'p-04', 'p-05'].map((participant_id) => ({ participant_id }))
    rec.respond((c) => {
      if (c.table !== 'tenant_guardian_consents') return undefined
      const after = c.filters.find((f) => f[0] === 'gt')?.[2] as string | undefined
      return { data: all.filter((r) => !after || r.participant_id > after).slice(0, 2), error: null }
    })
    expect([...(await unconsentedParticipantIds(db, CANARY))].sort()).toEqual(all.map((r) => r.participant_id))
    expect(rec.calls.map((c) => c.filters.find((f) => f[0] === 'gt')?.[2] ?? null)).toEqual([null, 'p-02', 'p-04', 'p-05'])
  })

  it('unconsentedParticipantIds fails closed when a later page cannot be read', async () => {
    rec.respond((c) => {
      if (c.table !== 'tenant_guardian_consents') return undefined
      return c.filters.some((f) => f[0] === 'gt')
        ? { data: null, error: { message: 'down' } as never }
        : { data: [{ participant_id: 'p-1' }], error: null }
    })
    await expect(unconsentedParticipantIds(db, CANARY)).rejects.toThrow('Reading guardian consents failed: down')
  })

  it('consentWindowEnd: 14 days, or the event start if sooner, or none once it has started', () => {
    const now = new Date('2026-11-10T12:00:00Z')
    expect(consentWindowEnd(now, null)?.toISOString()).toBe('2026-11-24T12:00:00.000Z')
    expect(consentWindowEnd(now, '2027-01-01T07:00:00Z')?.toISOString()).toBe('2026-11-24T12:00:00.000Z')
    expect(consentWindowEnd(now, '2026-11-15T07:00:00Z')?.toISOString()).toBe('2026-11-15T07:00:00.000Z')
    expect(consentWindowEnd(now, '2026-11-10T07:00:00Z')).toBeNull()
  })

  it('guardianFromForm takes a parent or legal guardian with a name and their own email', () => {
    const base = {
      emergency_contact_first_name: 'Pat', emergency_contact_last_name: 'Id',
      emergency_contact_email: ' Parent@Example.com ', emergency_contact_relationship: 'Legal Guardian',
    }
    expect(guardianFromForm(base, 'kid@example.com')).toEqual({ firstName: 'Pat', lastName: 'Id', email: 'parent@example.com', relationship: 'Legal Guardian' })
    expect(guardianFromForm({ ...base, emergency_contact_relationship: 'Teacher' }, 'kid@example.com')).toBeNull()
    expect(guardianFromForm(base, 'parent@example.com')).toBeNull()
    // None of the registrant's own addresses: their school email either.
    expect(guardianFromForm(base, 'kid@example.com', ['PARENT@example.com'])).toBeNull()
    expect(guardianFromForm(base, 'kid@example.com', [null, undefined, ''])).not.toBeNull()
  })

  it('consentInvitationRefusal caps one guardian address across organisers, and each organiser per hour (real limiter)', async () => {
    const { consentInvitationRefusal, GUARDIAN_INVITES_PER_ADDRESS_PER_DAY, GUARDIAN_INVITES_PER_TENANT_PER_HOUR } = await import('./tenant-guardian-consent')
    const OTHER = 'c0000000-0000-4000-8000-0000000000bb'
    // One address, spread over two organisers: the count is the address's.
    for (let i = 0; i < GUARDIAN_INVITES_PER_ADDRESS_PER_DAY; i++) {
      expect(await consentInvitationRefusal(i % 2 ? OTHER : CANARY, 'cap-test@example.com')).toBeNull()
    }
    const refused = await consentInvitationRefusal(OTHER, ' Cap-Test@Example.com ')
    expect(refused?.status).toBe(429)
    expect(await refused?.json()).toMatchObject({ code: 'guardian_consent_busy' })
    expect(Number(refused?.headers.get('Retry-After'))).toBeGreaterThan(0)

    // One organiser, many addresses: capped per hour, the other organiser unaffected.
    const TENANT = 'c0000000-0000-4000-8000-0000000000cc'
    let allowed = 0
    for (let i = 0; i < GUARDIAN_INVITES_PER_TENANT_PER_HOUR + 3; i++) {
      if (!(await consentInvitationRefusal(TENANT, `cap-tenant-${i}@example.com`))) allowed++
    }
    expect(allowed).toBe(GUARDIAN_INVITES_PER_TENANT_PER_HOUR)
    expect(await consentInvitationRefusal(OTHER, 'cap-other@example.com')).toBeNull()
  })
})
