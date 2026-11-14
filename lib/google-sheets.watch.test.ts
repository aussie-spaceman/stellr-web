// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

// Threat model §6.11 (S0): watchSheet registers the Drive push channel with the
// caller's token, so Google echoes it in X-Goog-Channel-Token on every notification
// and app/api/webhooks/google-sheets can check it against sheet_watch_channels.token.

const watch = vi.hoisted(() => vi.fn(async () => ({
  data: { id: 'channel-placeholder-1', resourceId: 'resource-placeholder-1', expiration: String(Date.now() + 1000) },
})))

vi.mock('@googleapis/drive', () => ({ drive: () => ({ files: { watch } }) }))
vi.mock('@googleapis/sheets', () => ({ sheets: () => ({}) }))
vi.mock('google-auth-library', () => ({ JWT: class { constructor(_opts: unknown) {} } }))

afterEach(() => {
  watch.mockClear()
  vi.unstubAllEnvs()
})

describe('watchSheet', () => {
  it('sends the channel token to Google with the watch request', async () => {
    vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL', 'service-account@placeholder.test')
    vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', 'private-key-placeholder')
    const { watchSheet } = await import('./google-sheets')

    const result = await watchSheet('sheet-placeholder-1', 'channel-placeholder-1', 'token-placeholder-abc')

    expect(watch).toHaveBeenCalledTimes(1)
    expect(watch).toHaveBeenCalledWith({
      fileId: 'sheet-placeholder-1',
      requestBody: expect.objectContaining({
        id: 'channel-placeholder-1',
        type: 'web_hook',
        token: 'token-placeholder-abc',
      }),
    })
    expect(result.channel_id).toBe('channel-placeholder-1')
  })
})
