import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'

// deep review INT-4: a Google Drive push fires while the organiser is still
// typing a row, so a name-only (email-less) row used to sync with email='',
// match nothing, and be inserted as a phantom participant — then orphaned the
// moment the email was filled in (the email lookup no longer matched the
// email-less row, so a SECOND participant was inserted). Skipping rows without a
// syntactically valid email closes that.

const readSheetParticipants = vi.fn()
vi.mock('@/lib/google-sheets', () => ({ readSheetParticipants }))
vi.mock('@/lib/member-sync', () => ({
  upsertMember: vi.fn(async (_db: unknown, m: { email: string }) => `member-${m.email}`),
}))
// batchInvites just runs the body — the signing batch is not under test here.
vi.mock('@/lib/esign/outbox', () => ({
  batchInvites: (_db: unknown, fn: () => unknown) => fn(),
}))
vi.mock('@/lib/docusign-agreements', () => ({ dispatchAgreement: vi.fn(async () => {}) }))
vi.mock('@/lib/school-link', () => ({ linkMembersToRegistrationSchool: vi.fn(async () => {}) }))
vi.mock('@/lib/event-participation-sync', () => ({ recordEventParticipationForRegistration: vi.fn(async () => {}) }))
vi.mock('@/lib/individual-payment', () => ({ ensureIndividualPayments: vi.fn(async () => ({ charged: 0, waived: 0 })) }))
vi.mock('@/lib/docusign', () => ({ isMinor: () => false }))

const { syncParticipantsFromSheet } = await import('@/lib/sheet-participant-sync')

const reg = {
  id: 'reg1',
  spreadsheet_id: 'sheet1',
  school_name: 'Rocket High',
  event_slug: 'ev',
  event_title: 'Event',
  school_address_state: 'CO',
}

/** A sheet row with all the empty-string fields readSheetParticipants returns. */
function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    membership_id: '', type: '', first_name: '', last_name: '', email: '', phone: '',
    date_of_birth: '', gender: '', t_shirt_size: '', grade: '', dietary_requirements: [],
    health_conditions: '', ec_first_name: '', ec_last_name: '', ec_email: '', ec_phone: '',
    ec_relationship: '', ...overrides,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('syncParticipantsFromSheet — half-typed rows do not create phantoms', () => {
  it('creates exactly one participant across a name-only then email-filled sync', async () => {
    const fake = fakeSupabase({ participants: [] })

    // First push: the organiser has only typed a first name — no email yet.
    readSheetParticipants.mockResolvedValueOnce([row({ first_name: 'Jane' })])
    await syncParticipantsFromSheet(fake.client, reg)

    // Second push: the email is now filled in.
    readSheetParticipants.mockResolvedValueOnce([row({ first_name: 'Jane', email: 'jane@x.com', date_of_birth: '2011-04-05' })])
    await syncParticipantsFromSheet(fake.client, reg)

    expect(fake.table('participants')).toHaveLength(1)
    expect(fake.table('participants')[0].email).toBe('jane@x.com')
  })

  it('skips a row whose only content is an invalid/blank email', async () => {
    const fake = fakeSupabase({ participants: [] })
    readSheetParticipants.mockResolvedValueOnce([row({ first_name: 'Half', email: 'not-an-email' })])
    await syncParticipantsFromSheet(fake.client, reg)
    expect(fake.table('participants')).toHaveLength(0)
  })
})

// S0 (2 Nov 2026): the registration routes' date-of-birth check. A row whose
// date of birth is blank or not a real past date is left out and reported —
// not the whole sync — and syncs once it is fixed.
describe('syncParticipantsFromSheet — rows without a usable date of birth', () => {
  it('skips and reports them, writing no member or participant, and syncs the rest', async () => {
    const { upsertMember } = await import('@/lib/member-sync')
    const fake = fakeSupabase({ participants: [] })
    readSheetParticipants.mockResolvedValueOnce([
      row({ first_name: 'Blank', last_name: 'Dob', email: 'blank@x.com' }),
      row({ first_name: 'Future', last_name: 'Dob', email: 'future@x.com', date_of_birth: '2030-05-01' }),
      row({ first_name: 'Good', last_name: 'Dob', email: 'good@x.com', date_of_birth: '2011-04-05' }),
    ])
    const r = await syncParticipantsFromSheet(fake.client, reg)
    expect(r.skippedForDateOfBirth).toEqual(['Blank Dob', 'Future Dob'])
    expect(r.created).toBe(1)
    expect(fake.table('participants').map((p) => p.email)).toEqual(['good@x.com'])
    expect(upsertMember).toHaveBeenCalledTimes(1)
    expect(upsertMember).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ email: 'good@x.com', date_of_birth: '2011-04-05' }))
  })

  it('adds the row once its date of birth is fixed', async () => {
    const fake = fakeSupabase({ participants: [] })
    readSheetParticipants.mockResolvedValueOnce([row({ first_name: 'Typo', email: 'typo@x.com', date_of_birth: '2030-05-01' })])
    await syncParticipantsFromSheet(fake.client, reg)
    expect(fake.table('participants')).toHaveLength(0)
    readSheetParticipants.mockResolvedValueOnce([row({ first_name: 'Typo', email: 'typo@x.com', date_of_birth: '2010-05-01' })])
    const r = await syncParticipantsFromSheet(fake.client, reg)
    expect(r.skippedForDateOfBirth).toEqual([])
    expect(fake.table('participants')).toHaveLength(1)
  })
})
