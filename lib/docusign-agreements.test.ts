import { describe, it, expect, vi, beforeEach } from 'vitest'

const { sendEmail, createAdult, createConsent, notifyCommunityAdmins } = vi.hoisted(() => ({
  sendEmail: vi.fn(async (_opts: unknown) => {}),
  createAdult: vi.fn(async (_opts: unknown) => ({ envelopeId: 'env-new', signerCount: 1 })),
  createConsent: vi.fn(async (_opts: unknown) => ({ envelopeId: 'env-new-minor', signerCount: 2 })),
  notifyCommunityAdmins: vi.fn(async (_input: unknown) => {}),
}))

vi.mock('./docusign', async (importOriginal) => {
  // classifyAgreement / isMinor are pure and are what decide WHICH document is
  // required — keep the real ones and stub only the network calls.
  const actual = await importOriginal<typeof import('./docusign')>()
  return {
    ...actual,
    createConsentEnvelope: createConsent,
    createAdultAgreementEnvelope: createAdult,
    createMentorAgreementEnvelope: vi.fn(async () => ({ envelopeId: 'env-mentor', signerCount: 1 })),
    createVolunteerAgreementEnvelope: vi.fn(async () => ({ envelopeId: 'env-vol', signerCount: 1 })),
  }
})
vi.mock('./email', () => ({
  sendEmail,
  docusignSentToMinorEmail:  () => ({ subject: 'sent-minor', html: '', text: '' }),
  docusignSentToSignerEmail: () => ({ subject: 'sent-signer', html: '', text: '' }),
  docusignOnFileEmail:       () => ({ subject: 'on-file', html: '', text: '' }),
}))
vi.mock('./notify', () => ({ notifyCommunityAdmins }))

import { dispatchAgreement } from './docusign-agreements'

interface Fixture {
  /** Envelope already attached to this exact participant row. */
  participantEnvelope?: { id: string } | null
  /** Live (sent/delivered) envelope for this person on this event. */
  openEnvelope?: { id: string } | null
  /** Completed, unexpired agreement on the member's record. */
  completedEnvelope?: Record<string, unknown> | null
  /** Result of the email → member fallback lookup. */
  memberByEmail?: { id: string } | null
}

function makeDb(fixture: Fixture) {
  const inserts: { table: string; payload: Record<string, unknown> }[] = []

  const db = {
    from(table: string) {
      const filters: { eq: Record<string, unknown>; inCol: string | null } = { eq: {}, inCol: null }
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => { filters.eq[col] = val; return chain },
        in: (col: string) => { filters.inCol = col; return chain },
        gte: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: resolve(table, filters, fixture), error: null }),
        insert: async (payload: Record<string, unknown>) => {
          inserts.push({ table, payload })
          return { error: null }
        },
      }
      return chain
    },
  }
  return { db: db as never, inserts }
}

function resolve(
  table: string,
  filters: { eq: Record<string, unknown>; inCol: string | null },
  fixture: Fixture,
): unknown {
  if (table === 'members') return fixture.memberByEmail ?? null
  if (table !== 'docusign_envelopes') return null
  if (filters.eq.participant_id) return fixture.participantEnvelope ?? null
  if (filters.inCol === 'status') return fixture.openEnvelope ?? null
  if (filters.eq.status === 'completed') return fixture.completedEnvelope ?? null
  return null
}

const ADULT = {
  participantId: 'p1',
  memberId: 'm1',
  eventSlug: 'nevada-2027',
  eventTitle: 'Nevada 2027',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  dateOfBirth: '1990-01-01',
  eventRole: 'adult',
}

beforeEach(() => vi.clearAllMocks())

describe('dispatchAgreement — never issues paperwork already in the system', () => {
  it('issues a fresh envelope when nothing is on record', async () => {
    const { db, inserts } = makeDb({})
    await dispatchAgreement(db, ADULT)

    expect(createAdult).toHaveBeenCalledTimes(1)
    expect(inserts).toHaveLength(1)
    expect(inserts[0].payload.envelope_id).toBe('env-new')
    expect(inserts[0].payload.status).toBe('sent')
  })

  it('skips when this participant already has an envelope', async () => {
    const { db, inserts } = makeDb({ participantEnvelope: { id: 'env-existing' } })
    await dispatchAgreement(db, ADULT)

    expect(createAdult).not.toHaveBeenCalled()
    expect(inserts).toHaveLength(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('skips when an unsigned envelope for this person is already out for the event', async () => {
    // The gap this closes: findValidAgreement only matches COMPLETED paperwork,
    // so a person re-added under a new participant row was chased twice for the
    // same signature.
    const { db, inserts } = makeDb({ openEnvelope: { id: 'env-in-flight' } })
    await dispatchAgreement(db, ADULT)

    expect(createAdult).not.toHaveBeenCalled()
    expect(inserts).toHaveLength(0)
  })

  it('reuses unexpired signed paperwork on the member record instead of re-sending', async () => {
    const { db, inserts } = makeDb({
      completedEnvelope: {
        id: 'env-signed', completed_at: '2026-01-15T00:00:00Z',
        signer_name: 'Ada Lovelace', signer_email: 'ada@example.com', reused_from: null,
      },
    })
    await dispatchAgreement(db, ADULT)

    expect(createAdult).not.toHaveBeenCalled()
    // A coverage row is written pointing back at the signed envelope.
    expect(inserts).toHaveLength(1)
    expect(inserts[0].payload.reused_from).toBe('env-signed')
    expect(inserts[0].payload.status).toBe('completed')
    expect((sendEmail.mock.calls[0][0] as { subject: string }).subject).toBe('on-file')
  })

  it('falls back to email when the caller has no member id, and still finds coverage', async () => {
    // A failed/skipped member upsert (blank sheet rows) used to bypass the
    // on-file check entirely and re-send paperwork the person had signed.
    const { db, inserts } = makeDb({
      memberByEmail: { id: 'm-resolved' },
      completedEnvelope: {
        id: 'env-signed', completed_at: '2026-01-15T00:00:00Z',
        signer_name: 'Ada Lovelace', signer_email: 'ada@example.com', reused_from: null,
      },
    })
    await dispatchAgreement(db, { ...ADULT, memberId: null })

    expect(createAdult).not.toHaveBeenCalled()
    expect(inserts[0].payload.reused_from).toBe('env-signed')
    // The coverage row is attributed to the member we resolved, not left null.
    expect(inserts[0].payload.member_id).toBe('m-resolved')
  })

  it('still issues when the person has no member row at all', async () => {
    const { db } = makeDb({ memberByEmail: null })
    await dispatchAgreement(db, { ...ADULT, memberId: null })

    expect(createAdult).toHaveBeenCalledTimes(1)
  })

  it('alerts admins instead of issuing when a minor has no guardian on file', async () => {
    const { db, inserts } = makeDb({})
    await dispatchAgreement(db, {
      ...ADULT, eventRole: 'participant', dateOfBirth: '2012-01-01',
      guardianEmail: null, guardianFirstName: null,
    })

    expect(createConsent).not.toHaveBeenCalled()
    expect(inserts).toHaveLength(0)
    expect(notifyCommunityAdmins).toHaveBeenCalledTimes(1)
  })
})
