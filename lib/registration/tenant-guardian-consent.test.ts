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
  guardianInvitationOutcome,
} = await import('./tenant-guardian-consent')

const CANARY = 'c0000000-0000-4000-8000-0000000000aa'
const ROW = { id: 'tgc-1', tenant_id: CANARY, registration_id: 'reg-1', participant_id: 'p-1', status: 'pending', removal_attempts: 0, agreement_id: 'agr-1' as string | null }
/** The row after the participant moved to a registration on another event: reset to pending, unlinked. */
const MOVED = { ...ROW, registration_id: 'reg-2', agreement_id: null }
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
  /** The participant's pending consent, as a settle reads it first (null: none). */
  current?: unknown
  /** The event an envelope read by id was issued for, and the event of a registration read by id. */
  envelopeEvent?: string
  registrationEvent?: string
} = {}) {
  rec.respond((c: DbCall): DbResult | undefined => {
    if (c.table === 'tenant_guardian_consents' && c.op === 'update' && (c.payload as Record<string, unknown>).status) {
      return { data: opts.moved ?? [ROW], error: null }
    }
    if (c.table === 'tenant_guardian_consents' && c.op === 'select' && c.single === 'maybe') {
      return { data: opts.current === undefined ? ROW : opts.current, error: null }
    }
    if (c.table === 'agreements' && c.op === 'select' && c.single === 'maybe') {
      return { data: { event_slug: opts.envelopeEvent ?? 'canary-cup' }, error: null }
    }
    if (c.table === 'registrations' && c.op === 'select' && c.single === 'maybe') {
      return { data: { event_slug: opts.registrationEvent ?? 'canary-cup' }, error: null }
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

  it('the update is keyed on the envelope the row was checked against, so a move in between settles nothing', async () => {
    arrange()
    await settleTenantGuardianConsentSigned(db, ENVELOPE)
    const update = rec.calls.find((c) => c.op === 'update')!
    expect(update.filters).toEqual(expect.arrayContaining([['eq', 'id', 'tgc-1'], ['eq', 'registration_id', 'reg-1'], ['eq', 'agreement_id', 'agr-1']]))
  })

  it('a linked consent is not settled by another envelope', async () => {
    arrange({ current: { ...ROW, agreement_id: 'agr-9' } })
    expect(await settleTenantGuardianConsentSigned(db, ENVELOPE)).toBe(false)
    expect(writes()).toEqual([])
    expect(h.audit).not.toHaveBeenCalled()
    expect(h.confirmation).not.toHaveBeenCalled()
  })

  it('LA-1: after a move to another event, the old registration’s envelope does not settle the new consent', async () => {
    arrange({ current: MOVED, envelopeEvent: 'canary-cup', registrationEvent: 'other-cup' })
    expect(await settleTenantGuardianConsentSigned(db, ENVELOPE)).toBe(false)
    expect(writes()).toEqual([])
    expect(h.audit).not.toHaveBeenCalled()
    expect(h.confirmation).not.toHaveBeenCalled()
  })

  it('an unlinked consent (the link write failed) is settled by its own event’s envelope, keyed on the unlinked row', async () => {
    arrange({ current: { ...ROW, agreement_id: null } })
    expect(await settleTenantGuardianConsentSigned(db, ENVELOPE)).toBe(true)
    const update = rec.calls.find((c) => c.op === 'update')!
    expect(update.filters).toEqual(expect.arrayContaining([['eq', 'registration_id', 'reg-1'], ['is', 'agreement_id', null]]))
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

  it('LA-1: declining the old registration’s envelope after a move neither declines nor removes the new registration', async () => {
    arrange({ current: MOVED, envelopeEvent: 'canary-cup', registrationEvent: 'other-cup' })
    const deleteRegistration = vi.fn(async () => {})
    await settleTenantGuardianConsentDeclined(db, ENVELOPE, { deleteRegistration })
    expect(writes()).toEqual([])
    expect(deleteRegistration).not.toHaveBeenCalled()
    expect(h.confirmation).not.toHaveBeenCalled()
    expect(h.audit).not.toHaveBeenCalled()
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

  it('LA-1: after a move, a completed envelope from the old registration neither settles nor holds the new consent: it expires', async () => {
    arrange({
      pending: [MOVED],
      agreements: [{ id: 'agr-1', status: 'completed', event_slug: 'canary-cup' }],
      registrationEvent: 'other-cup',
    })
    const deleteRegistration = vi.fn(async () => {})
    const r = await sweepTenantGuardianConsents(db, { now: NOW, deleteRegistration })
    expect(r).toMatchObject({ signed: [], held: [], expired: ['tgc-1'], removed: ['tgc-1'] })
    expect(deleteRegistration).toHaveBeenCalledWith('reg-2')
    expect(subjects()).toEqual(['Registration cancelled: Canary Cup'])
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
        { id: 'agr-2', envelope_id: 'native-2', provider: 'native', participant_id: 'p-2', tenant_id: CANARY },
      ],
      consentsFor: [{ participant_id: 'p-1', registration_id: 'reg-1', agreement_id: 'agr-1' }],
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
    // LA-4: the lifted hold leaves a trace, ids only, on the voided envelope.
    expect(h.audit.mock.calls.map(([m]) => m)).toEqual([
      expect.objectContaining({
        action: 'registration.guardian_consent.lift',
        actor: { system: true },
        target: { table: 'agreements', id: 'agr-2' },
        metadata: { event_tenant_id: CANARY, participant_id: 'p-2', reason: 'lifted' },
      }),
    ])
  })

  it('a lifted consent whose envelope cannot be voided is not recorded as lifted yet: the next run tries again', async () => {
    arrange({ openEnvelopes: [{ id: 'agr-2', envelope_id: 'native-2', provider: 'native', participant_id: 'p-2', tenant_id: CANARY }] })
    const voidEnvelope = vi.fn(async () => { throw new Error('engine down') })
    const r = await sweepTenantGuardianConsents(db, { now: NOW, deleteRegistration: vi.fn(), voidEnvelope })
    expect(r).toMatchObject({ voided: [], errors: [{ consentId: 'agreement:agr-2', error: 'engine down' }] })
    expect(h.audit).not.toHaveBeenCalled()
  })

  it('LA-1: an open envelope from a registration the participant has left is voided, and audited as superseded', async () => {
    arrange({
      openEnvelopes: [
        // The old event's envelope: the row now belongs to reg-2, on another event, unlinked.
        { id: 'agr-1', envelope_id: 'native-1', provider: 'native', participant_id: 'p-1', tenant_id: CANARY, event_slug: 'canary-cup' },
        // A linked row's own envelope stays out for signature.
        { id: 'agr-3', envelope_id: 'native-3', provider: 'native', participant_id: 'p-3', tenant_id: CANARY, event_slug: 'canary-cup' },
        // A linked row's other envelope is voided.
        { id: 'agr-4', envelope_id: 'native-4', provider: 'native', participant_id: 'p-3', tenant_id: CANARY, event_slug: 'canary-cup' },
      ],
      consentsFor: [
        { participant_id: 'p-1', registration_id: 'reg-2', agreement_id: null },
        { participant_id: 'p-3', registration_id: 'reg-3', agreement_id: 'agr-3' },
      ],
      registrationEvent: 'other-cup',
    })
    const voidEnvelope = vi.fn(async (_row: { envelope_id: string; provider: string | null }) => {})
    const r = await sweepTenantGuardianConsents(db, { now: NOW, deleteRegistration: vi.fn(), voidEnvelope })
    expect(voidEnvelope.mock.calls.map(([row]) => row.envelope_id)).toEqual(['native-1', 'native-4'])
    expect(r).toMatchObject({ voided: ['agr-1', 'agr-4'], errors: [] })
    expect(h.audit.mock.calls.map(([m]) => [m.action, (m.target as { id: string }).id, (m.metadata as { reason: string }).reason])).toEqual([
      ['registration.guardian_consent.void', 'agr-1', 'superseded'],
      ['registration.guardian_consent.void', 'agr-4', 'superseded'],
    ])
    expect(h.confirmation).not.toHaveBeenCalled()
  })

  it('T-25: an open consent envelope whose consent row was settled by a correction to 18 or over is voided as lifted', async () => {
    arrange({
      openEnvelopes: [{ id: 'agr-1', envelope_id: 'native-1', provider: 'native', participant_id: 'p-1', tenant_id: CANARY, event_slug: 'canary-cup' }],
      // The row is kept, settled, still linked to its envelope.
      consentsFor: [{ participant_id: 'p-1', registration_id: 'reg-1', agreement_id: 'agr-1', status: 'settled' }],
    })
    const voidEnvelope = vi.fn(async (_row: { envelope_id: string; provider: string | null }) => {})
    const r = await sweepTenantGuardianConsents(db, { now: NOW, deleteRegistration: vi.fn(), voidEnvelope })
    expect(voidEnvelope.mock.calls).toEqual([[{ envelope_id: 'native-1', provider: 'native' }]])
    expect(r).toMatchObject({ voided: ['agr-1'], errors: [] })
    expect(h.audit.mock.calls.map(([m]) => [m.action, (m.metadata as { reason: string }).reason])).toEqual([['registration.guardian_consent.lift', 'lifted']])
  })

  it('a pending consent row still linked to its open envelope is not voided', async () => {
    arrange({
      openEnvelopes: [{ id: 'agr-1', envelope_id: 'native-1', provider: 'native', participant_id: 'p-1', tenant_id: CANARY, event_slug: 'canary-cup' }],
      consentsFor: [{ participant_id: 'p-1', registration_id: 'reg-1', agreement_id: 'agr-1', status: 'pending' }],
    })
    const voidEnvelope = vi.fn(async () => {})
    const r = await sweepTenantGuardianConsents(db, { now: NOW, deleteRegistration: vi.fn(), voidEnvelope })
    expect(voidEnvelope).not.toHaveBeenCalled()
    expect(r.voided).toEqual([])
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

describe('the retry cap (s5-programme.26)', () => {
  const NOW = new Date('2026-12-01T12:00:00Z')
  const failing = () => vi.fn(async () => { throw new Error('blocked') })

  /** The sweep's retry read answers `retries`; the escalation's marking update answers `marked`. */
  function arrangeRetries(retries: unknown[], marked: unknown[] | 'error' = [{ id: 'tgc-1' }]) {
    rec.respond((c: DbCall): DbResult | undefined => {
      if (c.table === 'tenant_guardian_consents' && c.op === 'update' && 'escalated_at' in (c.payload as object)) {
        return marked === 'error' ? { data: null, error: { message: 'down' } as never } : { data: marked, error: null }
      }
      if (c.table === 'tenant_guardian_consents' && c.op === 'select' && c.filters.some((f) => f[0] === 'in' && f[1] === 'status')) {
        return { data: retries, error: null }
      }
      if (c.table === 'participants' && c.op === 'select') return { data: PARTICIPANT, error: null }
      if (c.op === 'select') return { data: [], error: null }
      return undefined
    })
  }

  it('the cap is five failed removals', async () => {
    const { MAX_REMOVAL_ATTEMPTS } = await import('./tenant-guardian-consent')
    expect(MAX_REMOVAL_ATTEMPTS).toBe(5)
  })

  it('the retry read leaves out rows already escalated to staff', async () => {
    arrangeRetries([])
    await sweepTenantGuardianConsents(db, { now: NOW, deleteRegistration: vi.fn(), voidEnvelope: vi.fn() })
    const read = rec.calls.find((c) => c.table === 'tenant_guardian_consents' && c.filters.some((f) => f[0] === 'in' && f[1] === 'status'))!
    expect(read.filters).toEqual(expect.arrayContaining([['in', 'status', ['declined', 'expired']], ['is', 'escalated_at', null]]))
  })

  it('below the cap, a failed removal is rescheduled and nobody is alerted', async () => {
    arrangeRetries([{ ...ROW, status: 'expired', removal_attempts: 3 }])
    const notifyStaff = vi.fn(async () => {})
    const r = await sweepTenantGuardianConsents(db, { now: NOW, deleteRegistration: failing(), voidEnvelope: vi.fn(), notifyStaff })
    expect(r).toMatchObject({ removed: [], escalated: [] })
    const retry = rec.calls.filter((c) => c.op === 'update').at(-1)!
    expect(retry.payload).toEqual({ removal_attempts: 4, next_attempt_at: new Date(NOW.getTime() + 20 * 3600_000).toISOString() })
    expect(notifyStaff).not.toHaveBeenCalled()
  })

  it('at the cap, rescheduling stops: the row is marked for staff, and the event’s tenant’s staff are alerted once, with ids only', async () => {
    arrangeRetries([{ ...ROW, status: 'declined', removal_attempts: 4 }])
    const notifyStaff = vi.fn(async (_input: { body: string; email?: { html: string; text?: string } }, _opts?: { tenantId?: string }) => {})
    const r = await sweepTenantGuardianConsents(db, { now: NOW, deleteRegistration: failing(), voidEnvelope: vi.fn(), notifyStaff })
    expect(r).toMatchObject({ removed: [], escalated: ['tgc-1'], errors: [] })

    const mark = rec.calls.filter((c) => c.op === 'update').at(-1)!
    expect(mark.payload).toEqual({ removal_attempts: 5, next_attempt_at: null, escalated_at: NOW.toISOString() })
    expect(mark.filters).toEqual(expect.arrayContaining([['eq', 'id', 'tgc-1'], ['is', 'escalated_at', null]]))

    expect(notifyStaff).toHaveBeenCalledTimes(1)
    const [input, opts] = notifyStaff.mock.calls[0]
    expect(opts).toEqual({ tenantId: CANARY })
    expect(input).toMatchObject({ type: 'action', referenceType: 'tenant_guardian_consent', referenceId: 'tgc-1' })
    for (const text of [input.body, input.email?.html, input.email?.text]) {
      expect(text).toContain('reg-1')
      expect(text).toContain('tgc-1')
      expect(text).toContain('p-1')
      expect(text).not.toContain(PARTICIPANT.email)
      expect(text).not.toContain(PARTICIPANT.first_name)
      expect(text).not.toContain(PARTICIPANT.registrations.event_title)
    }
    // The registrant is told nothing: the registration is still there.
    expect(h.confirmation).not.toHaveBeenCalled()
  })

  it('a row another run already marked alerts nobody again', async () => {
    arrangeRetries([{ ...ROW, status: 'declined', removal_attempts: 4 }], [])
    const notifyStaff = vi.fn(async () => {})
    const r = await sweepTenantGuardianConsents(db, { now: NOW, deleteRegistration: failing(), voidEnvelope: vi.fn(), notifyStaff })
    expect(r.escalated).toEqual(['tgc-1'])
    expect(notifyStaff).not.toHaveBeenCalled()
  })

  it('a failed mark alerts nobody and leaves the row for the next run', async () => {
    arrangeRetries([{ ...ROW, status: 'declined', removal_attempts: 4 }], 'error')
    const notifyStaff = vi.fn(async () => {})
    const r = await sweepTenantGuardianConsents(db, { now: NOW, deleteRegistration: failing(), voidEnvelope: vi.fn(), notifyStaff })
    expect(r).toMatchObject({ escalated: [], removed: [] })
    expect(notifyStaff).not.toHaveBeenCalled()
  })

  it('a failed alert does not throw: the row stays marked', async () => {
    arrangeRetries([{ ...ROW, status: 'expired', removal_attempts: 7 }])
    const notifyStaff = vi.fn(async () => { throw new Error('mail down') })
    const r = await sweepTenantGuardianConsents(db, { now: NOW, deleteRegistration: failing(), voidEnvelope: vi.fn(), notifyStaff })
    expect(r).toMatchObject({ escalated: ['tgc-1'], errors: [] })
    expect(notifyStaff).toHaveBeenCalledTimes(1)
  })

  it('with no staff alert passed, the row is still marked and escalated, and the log carries ids only', async () => {
    arrangeRetries([{ ...ROW, status: 'declined', removal_attempts: 4 }])
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await sweepTenantGuardianConsents(db, { now: NOW, deleteRegistration: failing(), voidEnvelope: vi.fn() })
    expect(r.escalated).toEqual(['tgc-1'])
    expect(rec.calls.filter((c) => c.op === 'update').at(-1)!.payload).toMatchObject({ escalated_at: NOW.toISOString() })
    const logged = errors.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
    expect(logged).toContain('tgc-1')
    expect(logged).not.toContain(PARTICIPANT.email)
    errors.mockRestore()
  })

  it('the module does not load lib/notify at run time: a tenant host reaches it', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('lib/registration/tenant-guardian-consent.ts', 'utf8')
    expect(src).not.toMatch(/import\(\s*['"]@\/lib\/notify['"]\s*\)/)
    expect(src).not.toMatch(/^import \{[^}]*\} from '@\/lib\/notify'/m)
  })

  it('a decline whose first removal fails is rescheduled, not escalated', async () => {
    arrange()
    const notifyStaff = vi.fn(async () => {})
    await settleTenantGuardianConsentDeclined(db, ENVELOPE, { deleteRegistration: failing(), notifyStaff })
    expect(notifyStaff).not.toHaveBeenCalled()
    expect(rec.calls.filter((c) => c.op === 'update').at(-1)!.payload).toMatchObject({ removal_attempts: 1 })
  })
})

describe('helpers', () => {
  it('unconsentedParticipantIds reads this tenant’s held consents, and nothing for Stellr', async () => {
    rec.respond((c) => (c.table === 'tenant_guardian_consents'
      ? { data: c.filters.some((f) => f[0] === 'gt') ? [] : [{ participant_id: 'p-1' }], error: null }
      : undefined))
    expect([...(await unconsentedParticipantIds(db, CANARY))]).toEqual(['p-1'])
    // Held: pending, declined, expired. Not signed, and not settled (a correction to 18 or over).
    expect(rec.calls[0].filters).toEqual([['eq', 'tenant_id', CANARY], ['in', 'status', ['pending', 'declined', 'expired']]])
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

  it('guardianInvitationOutcome: out only when sent or queued; a result that sent nothing is not out', () => {
    expect(guardianInvitationOutcome({ ok: true, result: { sent: 1, deferred: 0, failed: 0 } })).toEqual({ invitation: 'sent', out: true })
    expect(guardianInvitationOutcome({ ok: true, result: { sent: 0, deferred: 1, failed: 0 } })).toEqual({ invitation: 'deferred', out: true })
    expect(guardianInvitationOutcome({ ok: true, result: { sent: 1, deferred: 0, failed: 1 } })).toEqual({ invitation: 'failed', out: false })
    expect(guardianInvitationOutcome({ ok: true, result: { sent: 0, deferred: 0, failed: 0 } })).toEqual({ invitation: 'not_sent', out: false })
    expect(guardianInvitationOutcome({ ok: false, reason: 'no_sender' })).toEqual({ invitation: 'no_sender', out: false })
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
