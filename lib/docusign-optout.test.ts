// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'

const { fetchValues, applyGuardianOptOut, logActivity } = vi.hoisted(() => ({
  fetchValues: vi.fn(async (): Promise<{ name: string; value: string }[]> => []),
  applyGuardianOptOut: vi.fn(async () => {}),
  logActivity: vi.fn(async () => {}),
}))

vi.mock('@/lib/esign/operations', () => ({ fetchEnvelopeFieldValues: fetchValues }))
vi.mock('@/lib/credentials-notify', () => ({ applyGuardianOptOut }))
vi.mock('@/lib/activity-log', () => ({ logActivity }))

import { recordCredentialOptOutFromForm, type OptOutEnvelope } from './docusign-optout'

const env: OptOutEnvelope = {
  id: 'row-1',
  envelope_id: 'env-1',
  provider: 'docusign',
  envelope_type: 'minor',
  reused_from: null,
  member_id: 'm1',
  participant_id: 'p1',
  credential_sharing_opt_out: false,
}

const dbWith = (over: Record<string, unknown> = {}) =>
  fakeSupabase({ agreements: [{ id: 'row-1', media_opt_out: false, quote_opt_out: false, digital_comms_opt_out: false, credential_sharing_opt_out: false, form_opt_outs: null, form_data_read_at: null, ...over }] })

describe('recording the opt-out boxes read off a signed form', () => {
  beforeEach(() => {
    fetchValues.mockReset()
    applyGuardianOptOut.mockClear()
  })

  it('records an unticked media box as an explicit "did not opt out"', async () => {
    fetchValues.mockResolvedValue([
      { name: 'MediaOptOut', value: 'false' },
      { name: 'DigitalCommsOptOut', value: 'false' },
    ])
    const db = dbWith()
    expect(await recordCredentialOptOutFromForm(db.client, env)).toBe('tab_absent')
    const row = db.tables.agreements[0]
    expect(row.form_opt_outs).toEqual({ MediaOptOut: false, DigitalCommsOptOut: false })
    expect(row.media_opt_out).toBe(false)
    expect(row.form_data_read_at).toBeTruthy()
  })

  it('records a ticked box in its column and in the answers', async () => {
    fetchValues.mockResolvedValue([
      { name: 'MediaOptOut', value: 'true' },
      { name: 'CredentialSharingOptOut', value: 'true' },
    ])
    const db = dbWith()
    expect(await recordCredentialOptOutFromForm(db.client, env)).toBe('opted_out')
    const row = db.tables.agreements[0]
    expect(row.form_opt_outs).toEqual({ MediaOptOut: true, CredentialSharingOptOut: true })
    expect(row.media_opt_out).toBe(true)
    expect(row.credential_sharing_opt_out).toBe(true)
    expect(applyGuardianOptOut).toHaveBeenCalledOnce()
  })

  it('never clears an opt-out recorded another way', async () => {
    fetchValues.mockResolvedValue([{ name: 'MediaOptOut', value: 'false' }])
    const db = dbWith({ media_opt_out: true })
    await recordCredentialOptOutFromForm(db.client, env)
    expect(db.tables.agreements[0].media_opt_out).toBe(true)
  })

  it('records an empty read as {} so the cron stops, and the media answer stays unknown', async () => {
    const db = dbWith()
    await recordCredentialOptOutFromForm(db.client, { ...env, envelope_type: 'adult' })
    expect(db.tables.agreements[0].form_opt_outs).toEqual({})
  })

  it('leaves the row unread and reports the error when DocuSign fails', async () => {
    fetchValues.mockRejectedValue(new Error('DocuSign recipient tabs fetch failed: USER_LACKS_PERMISSIONS'))
    const onError = vi.fn()
    const db = dbWith()
    expect(await recordCredentialOptOutFromForm(db.client, env, { onError })).toBe('failed')
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('USER_LACKS_PERMISSIONS') }))
    expect(db.tables.agreements[0].form_opt_outs).toBeNull()
    expect(db.tables.agreements[0].form_data_read_at).toBeNull()
  })

  it('skips coverage rows, which have no form of their own', async () => {
    const db = dbWith()
    expect(await recordCredentialOptOutFromForm(db.client, { ...env, reused_from: 'row-0' })).toBe('skipped')
    expect(fetchValues).not.toHaveBeenCalled()
  })
})
