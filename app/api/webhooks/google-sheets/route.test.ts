// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Threat model §6.11 (S0): Google Drive push notifications are unsigned, so each
// channel carries a random token we registered with it (sheet_watch_channels.token)
// and Google echoes it in X-Goog-Channel-Token. The route syncs only when the token
// matches; a missing or wrong one is answered like an unknown channel (200, nothing
// done). A channel registered before tokens existed (token NULL) is honoured until
// its own expiration, with a warning, and refused after it.

const s = vi.hoisted(() => ({
  channel: null as null | { registration_id: string; expiration: string | null; token: string | null },
  registration: { id: 'reg-placeholder-1', spreadsheet_id: 'sheet-placeholder-1' } as Record<string, unknown> | null,
  sync: vi.fn(async () => ({ created: 0, updated: 0, paymentLinksSent: 0 })),
  tables: [] as string[],
}))

function chain(result: () => unknown) {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit']) q[m] = () => q
  q.maybeSingle = async () => ({ data: result(), error: null })
  return q
}

vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      s.tables.push(table)
      if (table === 'sheet_watch_channels') return chain(() => s.channel)
      if (table === 'registrations') return chain(() => s.registration)
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))
vi.mock('@/lib/sheet-participant-sync', () => ({
  SHEET_SYNC_COLUMNS: 'id, spreadsheet_id, tenant_id',
  syncParticipantsFromSheet: s.sync,
}))

const { POST } = await import('./route')

const TOKEN = 'channel-token-placeholder-0123456789abcdef'
const future = () => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
const past = () => new Date(Date.now() - 60 * 1000).toISOString()

function notify(headers: Record<string, string | undefined>) {
  const h: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) if (v !== undefined) h[k] = v
  return POST(new Request('https://app.test/api/webhooks/google-sheets', { method: 'POST', headers: h }) as never)
}
const update = (token?: string) => notify({
  'x-goog-channel-id': 'channel-placeholder-1',
  'x-goog-resource-state': 'update',
  'x-goog-channel-token': token,
})

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  s.channel = { registration_id: 'reg-placeholder-1', expiration: future(), token: TOKEN }
  s.registration = { id: 'reg-placeholder-1', spreadsheet_id: 'sheet-placeholder-1' }
  s.tables = []
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  s.sync.mockClear()
  vi.restoreAllMocks()
})

describe('POST /api/webhooks/google-sheets: channel token', () => {
  it('syncs when X-Goog-Channel-Token matches the stored token', async () => {
    const res = await update(TOKEN)
    expect(res.status).toBe(200)
    expect(s.sync).toHaveBeenCalledTimes(1)
  })

  it('does nothing on a wrong token, and answers like an unknown channel', async () => {
    const wrong = await update(`${TOKEN.slice(0, -1)}x`)
    expect(s.sync).not.toHaveBeenCalled()
    expect(s.tables).not.toContain('registrations')

    s.channel = null
    const unknown = await update(TOKEN)
    expect(wrong.status).toBe(unknown.status)
    expect(await wrong.text()).toBe(await unknown.text())
  })

  it('does nothing when the token header is missing', async () => {
    const res = await update(undefined)
    expect(res.status).toBe(200)
    expect(s.sync).not.toHaveBeenCalled()
    expect(s.tables).not.toContain('registrations')
  })

  it('refuses a token of a different length (a prefix of the real one)', async () => {
    await update(TOKEN.slice(0, 8))
    expect(s.sync).not.toHaveBeenCalled()
  })

  it('does nothing for a tokened channel that has expired, even with the right token', async () => {
    s.channel = { registration_id: 'reg-placeholder-1', expiration: past(), token: TOKEN }
    await update(TOKEN)
    expect(s.sync).not.toHaveBeenCalled()
  })

  describe('a channel registered before tokens (token NULL)', () => {
    it('is accepted with a warning until its expiration', async () => {
      s.channel = { registration_id: 'reg-placeholder-1', expiration: future(), token: null }
      const res = await update(undefined)
      expect(res.status).toBe(200)
      expect(s.sync).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('no token'), 'channel-placeholder-1')
    })

    it('is refused after its expiration', async () => {
      s.channel = { registration_id: 'reg-placeholder-1', expiration: past(), token: null }
      await update(undefined)
      await update(TOKEN)
      expect(s.sync).not.toHaveBeenCalled()
      expect(s.tables).not.toContain('registrations')
    })

    it('is refused when it has no expiration at all', async () => {
      s.channel = { registration_id: 'reg-placeholder-1', expiration: null, token: null }
      await update(undefined)
      expect(s.sync).not.toHaveBeenCalled()
    })
  })

  it('still acknowledges the initial sync message without touching the database', async () => {
    const res = await notify({ 'x-goog-channel-id': 'channel-placeholder-1', 'x-goog-resource-state': 'sync' })
    expect(res.status).toBe(200)
    expect(s.tables).toEqual([])
  })
})
