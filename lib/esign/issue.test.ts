// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'

const { docusignCreate, nativeCreate, notify } = vi.hoisted(() => ({
  docusignCreate: vi.fn(),
  nativeCreate: vi.fn(async () => ({ provider: 'native', externalId: 'native-1', signerCount: 1 })),
  notify: vi.fn(async () => {}),
}))

vi.mock('@/lib/esign', async (orig) => ({
  ...(await orig<typeof import('@/lib/esign')>()),
  canIssue: () => true,
  getProvider: (id: string) => ({ id, create: id === 'docusign' ? docusignCreate : nativeCreate }),
}))
vi.mock('@/lib/notify', () => ({ notifyCommunityAdmins: notify }))

import { DocusignApiError } from '@/lib/docusign'
import { AllowanceExhaustedError, ProviderUnavailableError } from './types'
import { isOutage } from './providers/docusign'
import { __resetOutageAlert, issueAgreement } from './issue'

const adult = {
  type: 'adult' as const,
  params: { eventTitle: 'E', firstName: 'A', lastName: 'B', email: 'a@example.test', phone: '1', schoolName: 'S', schoolState: 'CO' },
}

function setup(overflowTypes = ['adult']) {
  return fakeSupabase({
    esign_provider_state: [{ id: true, mode: 'auto', monthly_cap: 40, reserve: 2, overflow_types: overflowTypes, overflow_allowlist: [], exhausted_until: null }],
    agreements: [],
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetOutageAlert()
})

describe('issueAgreement when DocuSign is down', () => {
  it('issues on Stellr signing, alerts once, and asks DocuSign again next time', async () => {
    const db = setup()
    docusignCreate.mockRejectedValue(new ProviderUnavailableError('docusign', '503 Service Unavailable'))

    expect(await issueAgreement(db.client, adult)).toMatchObject({ provider: 'native' })
    expect(await issueAgreement(db.client, adult)).toMatchObject({ provider: 'native' })
    expect(docusignCreate).toHaveBeenCalledTimes(2) // nothing remembered
    expect(notify).toHaveBeenCalledTimes(1)
    expect(db.table('esign_provider_state')[0].exhausted_until).toBeNull()
  })

  it('fails as before when that type may not use Stellr signing', async () => {
    const db = setup([])
    docusignCreate.mockRejectedValue(new ProviderUnavailableError('docusign', 'timeout'))
    await expect(issueAgreement(db.client, adult)).rejects.toBeInstanceOf(ProviderUnavailableError)
    expect(nativeCreate).not.toHaveBeenCalled()
  })

  it('does not fall back on our own mistakes (a 4xx)', async () => {
    const db = setup()
    docusignCreate.mockRejectedValue(new Error('DocuSign envelope creation failed: INVALID_EMAIL_ADDRESS_FOR_RECIPIENT'))
    await expect(issueAgreement(db.client, adult)).rejects.toThrow(/INVALID_EMAIL/)
    expect(nativeCreate).not.toHaveBeenCalled()
  })
})

describe('issueAgreement when the allowance is spent', () => {
  it('records it once, and the rest of a 60-person group never asks DocuSign again', async () => {
    const db = setup()
    docusignCreate.mockRejectedValue(new AllowanceExhaustedError('docusign', 'ENVELOPE_ALLOWANCE_EXCEEDED'))
    for (let i = 0; i < 60; i++) expect(await issueAgreement(db.client, adult)).toMatchObject({ provider: 'native' })
    expect(docusignCreate).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(db.table('esign_provider_state')[0].exhausted_until).not.toBeNull()
  })
})

describe('isOutage', () => {
  it('is DocuSign failing, not our request', () => {
    expect(isOutage(new DocusignApiError('x', 503, null))).toBe(true)
    expect(isOutage(new DocusignApiError('x', 429, null))).toBe(true)
    expect(isOutage(Object.assign(new Error('fetch failed'), { name: 'TypeError' }))).toBe(true)
    expect(isOutage(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))).toBe(true)
    expect(isOutage(new DocusignApiError('x', 400, 'INVALID_REQUEST_BODY'))).toBe(false)
    expect(isOutage(new DocusignApiError('x', 401, null))).toBe(false)
    expect(isOutage(new Error('DocuSign auth failed: consent_required'))).toBe(false)
  })
})
