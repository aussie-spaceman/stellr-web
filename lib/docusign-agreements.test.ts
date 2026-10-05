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

import { agreementCovers, agreementExpiry, agreementVersionFor, dispatchAgreement } from './docusign-agreements'
import { AGREEMENT_VERSION } from './esign/native/plan'

interface Fixture {
  /** Envelope already attached to this exact participant row. */
  participantEnvelope?: { id: string; status?: string } | null
  /** Live (sent/delivered) envelope for this person on this event. */
  openEnvelope?: { id: string } | null
  /** Completed, unexpired agreement on the member's record. */
  completedEnvelope?: Record<string, unknown> | null
  /** Result of the email → member fallback lookup. */
  memberByEmail?: { id: string } | null
}

interface Filters { eq: Record<string, unknown>; ins: Record<string, unknown[]> }

function makeDb(fixture: Fixture) {
  const inserts: { table: string; payload: Record<string, unknown> }[] = []

  const db = {
    from(table: string) {
      const filters: Filters = { eq: {}, ins: {} }
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => { filters.eq[col] = val; return chain },
        in: (col: string, vals: unknown[]) => { filters.ins[col] = vals; return chain },
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

function resolve(table: string, filters: Filters, fixture: Fixture): unknown {
  if (table === 'members') return fixture.memberByEmail ?? null
  if (table !== 'agreements') return null
  if (filters.eq.participant_id) {
    const row = fixture.participantEnvelope
    if (!row) return null
    // Honour the status filter so a dead (voided/declined) envelope does not
    // count as paperwork on record.
    if (row.status && filters.ins.status && !filters.ins.status.includes(row.status)) return null
    return row
  }
  if (filters.ins.status) return fixture.openEnvelope ?? null
  if (filters.eq.status === 'completed') {
    const row = fixture.completedEnvelope
    // Honour the envelope_type filter, so equivalence (mentor ≡ volunteer) is
    // what the query asks for rather than something the fixture assumes.
    const types = filters.ins.envelope_type
    if (row && types && row.envelope_type && !types.includes(row.envelope_type)) return null
    return row ?? null
  }
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

  it('RE-ISSUES when the participant\'s only envelope was voided', async () => {
    // A voided envelope is dead paperwork. This check used to match ANY row for
    // the participant regardless of status, so once an envelope was voided no
    // code path could ever issue a replacement — dispatchAgreement just returned
    // and the participant stayed unpapered. Surfaced 9 Sept 2026 re-issuing the
    // consent forms that had been executed in the DocuSign sandbox.
    const { db, inserts } = makeDb({ participantEnvelope: { id: 'env-voided', status: 'voided' } })
    await dispatchAgreement(db, ADULT)

    expect(createAdult).toHaveBeenCalledTimes(1)
    expect(inserts).toHaveLength(1)
  })

  it('still skips when the participant has a live (sent) envelope', async () => {
    const { db, inserts } = makeDb({ participantEnvelope: { id: 'env-live', status: 'sent' } })
    await dispatchAgreement(db, ADULT)

    expect(createAdult).not.toHaveBeenCalled()
    expect(inserts).toHaveLength(0)
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

  it('alerts admins when the agreement could not be issued at all', async () => {
    // Registration is deliberately allowed to succeed when DocuSign fails, so
    // nothing else in the system notices that a participant is unpapered. That
    // silence is how three months of demonstration consent forms went unremarked,
    // and the most likely production cause now is the 40-envelope monthly cap.
    createAdult.mockRejectedValueOnce(new Error('ENVELOPE_LIMIT_EXCEEDED'))
    const { db, inserts } = makeDb({})
    await dispatchAgreement(db, ADULT)

    // No envelope, but a visible "needs paperwork" row the daily job retries:
    // dead paperwork ('voided'), so nothing treats it as in flight.
    expect(inserts).toHaveLength(1)
    expect(inserts[0].payload).toMatchObject({
      status: 'voided',
      envelope_type: 'adult',
      issue_error: 'ENVELOPE_LIMIT_EXCEEDED',
    })
    expect(String(inserts[0].payload.envelope_id)).toMatch(/^failed:/)
    expect(notifyCommunityAdmins).toHaveBeenCalledTimes(1)
    const alert = notifyCommunityAdmins.mock.calls[0][0] as {
      body: string; email: { subject: string }
    }
    expect(alert.body).toContain('Ada Lovelace')
    expect(alert.body).toContain('ENVELOPE_LIMIT_EXCEEDED')
    expect(alert.body).toContain('NO paperwork')
    expect(alert.email.subject).toContain('Ada Lovelace')
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

describe('dispatchAgreement — outcome', () => {
  it('reports issued / in_flight / on_file / failed / not_required', async () => {
    expect(await dispatchAgreement(makeDb({}).db, ADULT)).toBe('issued')
    expect(await dispatchAgreement(makeDb({ openEnvelope: { id: 'x' } }).db, ADULT)).toBe('in_flight')
    expect(await dispatchAgreement(makeDb({
      completedEnvelope: {
        id: 'env-signed', completed_at: '2026-01-15T00:00:00Z',
        signer_name: 'Ada', signer_email: 'ada@example.com', reused_from: null,
      },
    }).db, ADULT)).toBe('on_file')
    createAdult.mockRejectedValueOnce(new Error('boom'))
    expect(await dispatchAgreement(makeDb({}).db, ADULT)).toBe('failed')
    expect(await dispatchAgreement(makeDb({}).db, { ...ADULT, eventRole: null })).toBe('not_required')
  })
})

describe('dispatchAgreement — mentor and volunteer are the same document', () => {
  const VOLUNTEER = { ...ADULT, participantId: null, eventSlug: 'volunteer-program', eventRole: 'volunteer' }
  const SIGNED = {
    id: 'env-mentor-signed', completed_at: '2026-01-15T00:00:00Z',
    signer_name: 'Ada', signer_email: 'ada@example.com', reused_from: null,
  }

  it('a signed MENTOR agreement covers a volunteer requirement (no second envelope)', async () => {
    const { db, inserts } = makeDb({ completedEnvelope: { ...SIGNED, envelope_type: 'mentor' } })
    expect(await dispatchAgreement(db, VOLUNTEER)).toBe('on_file')
    expect(inserts[0].payload.reused_from).toBe('env-mentor-signed')
    expect(inserts[0].payload.envelope_type).toBe('volunteer')
  })

  it('a signed VOLUNTEER agreement covers a mentor requirement', async () => {
    const { db } = makeDb({ completedEnvelope: { ...SIGNED, envelope_type: 'volunteer' } })
    expect(await dispatchAgreement(db, { ...ADULT, eventRole: 'mentor' })).toBe('on_file')
  })

  it('an ADULT agreement is not coverage for a volunteer', async () => {
    const { db } = makeDb({ completedEnvelope: { ...SIGNED, envelope_type: 'adult' } })
    expect(await dispatchAgreement(db, VOLUNTEER)).toBe('issued')
  })
})

describe('V2.3 validity: a minor agreement lasts while current, others 3 years', () => {
  const at = '2026-01-15T00:00:00Z'
  const later = new Date('2032-01-01T00:00:00Z')

  it('a V2.3 minor agreement has no end date; older ones and adults keep 3 years', () => {
    expect(agreementExpiry(at, 'minor', '2.3')).toBeNull()
    expect(agreementExpiry(at, 'minor', null)?.toISOString()).toBe('2029-01-15T00:00:00.000Z')
    expect(agreementExpiry(at, 'adult', '2.3')?.toISOString()).toBe('2029-01-15T00:00:00.000Z')
    expect(agreementExpiry(at, 'mentor', '2.3')?.toISOString()).toBe('2029-01-15T00:00:00.000Z')
  })

  it('reuses a minor agreement only on the current version, at any age of the signature', () => {
    expect(agreementCovers({ completed_at: at, envelope_type: 'minor', agreement_version: AGREEMENT_VERSION }, later)).toBe(true)
    expect(agreementCovers({ completed_at: at, envelope_type: 'minor', agreement_version: null }, new Date('2026-02-01'))).toBe(false)
    expect(agreementCovers({ completed_at: at, envelope_type: 'minor', agreement_version: '2.2' }, new Date('2026-02-01'))).toBe(false)
  })

  it('reuses an adult agreement for 3 years whatever its version', () => {
    expect(agreementCovers({ completed_at: at, envelope_type: 'adult', agreement_version: null }, new Date('2028-12-31'))).toBe(true)
    expect(agreementCovers({ completed_at: at, envelope_type: 'adult', agreement_version: AGREEMENT_VERSION }, later)).toBe(false)
  })

  const STUDENT = {
    ...ADULT, firstName: 'Kid', email: 'kid@example.com', dateOfBirth: '2012-05-01', eventRole: 'participant',
    guardianFirstName: 'Pat', guardianLastName: 'Lovelace', guardianEmail: 'pat@example.com',
  }
  const SIGNED_MINOR = {
    id: 'env-minor-signed', completed_at: '2024-01-15T00:00:00Z', envelope_type: 'minor',
    signer_name: 'Pat', signer_email: 'pat@example.com', reused_from: null,
  }

  it('asks a family to sign again when their agreement predates V2.3', async () => {
    const { db } = makeDb({ completedEnvelope: { ...SIGNED_MINOR, agreement_version: null } })
    await dispatchAgreement(db, STUDENT)
    expect(createConsent).toHaveBeenCalledTimes(1)
  })

  it('reuses a V2.3 agreement however long ago it was signed, carrying its version', async () => {
    const { db, inserts } = makeDb({ completedEnvelope: { ...SIGNED_MINOR, agreement_version: AGREEMENT_VERSION } })
    expect(await dispatchAgreement(db, STUDENT)).toBe('on_file')
    expect(createConsent).not.toHaveBeenCalled()
    expect(inserts[0].payload).toMatchObject({ reused_from: 'env-minor-signed', agreement_version: AGREEMENT_VERSION })
  })

  it('records a DocuSign agreement as V2.3 only once its templates are declared updated', async () => {
    const before = process.env.DOCUSIGN_AGREEMENT_VERSION
    try {
      delete process.env.DOCUSIGN_AGREEMENT_VERSION
      const first = makeDb({})
      await dispatchAgreement(first.db, ADULT)
      expect(first.inserts[0].payload.agreement_version).toBeNull()

      process.env.DOCUSIGN_AGREEMENT_VERSION = '2.3'
      const second = makeDb({})
      await dispatchAgreement(second.db, ADULT)
      expect(second.inserts[0].payload.agreement_version).toBe('2.3')
    } finally {
      if (before === undefined) delete process.env.DOCUSIGN_AGREEMENT_VERSION
      else process.env.DOCUSIGN_AGREEMENT_VERSION = before
    }
  })

  it('records Stellr signing agreements as the current version', () => {
    expect(agreementVersionFor('native')).toBe(AGREEMENT_VERSION)
  })
})
