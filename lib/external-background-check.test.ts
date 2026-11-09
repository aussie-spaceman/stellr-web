// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { deriveCompliance, externalCheckValidUntil, type ExternalBackgroundCheck, type BackgroundCheck } from '@/lib/compliance'

// A background check the member already holds from another organisation
// (owner, 9 Nov 2026): no license number or state, document mandatory, valid
// 3 years from completion or to an earlier printed expiry, and once verified it
// clears for everything a background check clears for.

vi.mock('@/lib/uploads', () => ({ claimUpload: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notifyCommunityAdmins: vi.fn() }))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/event-manager', () => ({ recheckEventManagerClearance: vi.fn() }))

const { validateExternalCheckDates, externalCheckSchema } = await import('./external-background-check')

const ext = (over: Partial<ExternalBackgroundCheck> = {}): ExternalBackgroundCheck => ({
  id: 'x1', issuer: 'ISD 196', completed_on: '2025-08-01', document_expires_on: null, document_path: 'm1/bc/1.pdf',
  verified_at: '2026-01-01T00:00:00Z', verified_label: 'Admin', ...over,
})
const REF = '2026-11-09T12:00:00Z'
const adult = (external: ExternalBackgroundCheck | null, checks: BackgroundCheck[] = []) =>
  deriveCompliance(null, checks, 'mentor', '1980-01-01', REF, external)

describe('externalCheckValidUntil', () => {
  it('is three years from completion', () => expect(externalCheckValidUntil(ext())).toBe('2028-08-01'))
  it('or the printed expiry, if sooner', () => expect(externalCheckValidUntil(ext({ document_expires_on: '2027-06-30' }))).toBe('2027-06-30'))
  it('a later printed expiry does not extend it', () => expect(externalCheckValidUntil(ext({ document_expires_on: '2030-01-01' }))).toBe('2028-08-01'))
})

describe('deriveCompliance with an uploaded check', () => {
  it('a verified one clears, as a background check', () => {
    expect(adult(ext())).toMatchObject({ state: 'valid_bc', clearedBy: 'external_background_check' })
  })

  it('an unverified one is waiting verification, not cleared', () => {
    expect(adult(ext({ verified_at: null })).state).toBe('awaiting_verification')
  })

  it('an expired one does not clear', () => {
    const s = adult(ext({ completed_on: '2023-01-01' }))
    expect(s.state).toBe('invalid')
    expect(s.detail).toMatch(/uploaded background check expired/i)
  })

  it('never masks a Stellr not-cleared decision (BG-2)', () => {
    const notCleared: BackgroundCheck = {
      id: 'bc1', status: 'referred', result: null, assessment: null, includes_canceled: false, provider_report_ref: null,
      adjudicated_at: '2026-03-01T00:00:00Z', adjudication_outcome: 'not_cleared', adjudicated_label: 'Adjudicator', adjudication_notes: null,
      provider_adjudication: null, ordered_at: '2026-02-01T00:00:00Z', completed_at: null, expires_at: null, report_pdf_url: null,
    }
    expect(adult(ext(), [notCleared]).state).toBe('invalid')
  })

  it('is ignored for someone who needs no clearance', () => {
    expect(deriveCompliance(null, [], 'subscriber', '1980-01-01', REF, ext()).state).toBe('not_required')
  })
})

describe('validateExternalCheckDates', () => {
  const today = '2026-11-09'
  it('accepts a recent check', () => expect(validateExternalCheckDates({ completed_on: '2025-08-01' }, today)).toBeNull())
  it('refuses a future completion', () => expect(validateExternalCheckDates({ completed_on: '2026-12-01' }, today)).toMatch(/future/))
  it('refuses an expiry before completion', () => {
    expect(validateExternalCheckDates({ completed_on: '2025-08-01', document_expires_on: '2025-01-01' }, today)).toMatch(/before the completion/)
  })
  it('refuses a check older than three years', () => {
    expect(validateExternalCheckDates({ completed_on: '2023-06-01' }, today)).toMatch(/more than 3 years/)
  })
  it('refuses one whose printed expiry has passed', () => {
    expect(validateExternalCheckDates({ completed_on: '2025-08-01', document_expires_on: '2026-06-01' }, today)).toMatch(/already expired/)
  })
})

describe('externalCheckSchema', () => {
  const base = { issuer: 'ISD 196', completed_on: '2025-08-01', storagePath: 'm1/bc/1.pdf', fileType: 'application/pdf' }
  it('needs no license number or state', () => expect(externalCheckSchema.safeParse(base).success).toBe(true))
  it('needs the document', () => {
    expect(externalCheckSchema.safeParse({ ...base, storagePath: '' }).success).toBe(false)
    expect(externalCheckSchema.safeParse({ issuer: 'X', completed_on: '2025-08-01' }).success).toBe(false)
  })
  it('needs an issuer', () => expect(externalCheckSchema.safeParse({ ...base, issuer: '  ' }).success).toBe(false))
  it('treats a blank expiry as none', () => {
    expect(externalCheckSchema.parse({ ...base, document_expires_on: '' }).document_expires_on).toBeNull()
  })
})
