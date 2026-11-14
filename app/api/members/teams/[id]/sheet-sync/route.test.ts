// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Threat model §6.11 (S0): when "Sync From Sheet" registers a Drive push channel
// (first sync, or renewal once the last channel expired) it generates a random
// 32-byte token, passes it to Google as the channel token and stores the same value
// in sheet_watch_channels.token, which the webhook checks X-Goog-Channel-Token
// against. A live channel is left alone.

const s = vi.hoisted(() => ({
  existing: null as null | { expiration: string },
  inserts: [] as Record<string, unknown>[],
  watchSheet: vi.fn(async (_sheet: string, channelId: string, _token: string) => ({
    channel_id: channelId,
    resource_id: 'resource-placeholder-1',
    expiration: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
  })),
}))

function chain(result: () => unknown) {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit']) q[m] = () => q
  q.maybeSingle = async () => ({ data: result(), error: null })
  return q
}

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'user_placeholder' }) }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/audit/route', () => ({ withAudit: (_spec: unknown, handler: unknown) => handler }))
vi.mock('@/lib/registration/team-audit', () => ({ teamAudit: () => {}, TEAM_SHEET_SYNC_AUDIT: {} }))
vi.mock('@/lib/tenancy/request-tenant', () => ({ requestTenant: async () => ({ tenantId: 'tenant-stellr-placeholder' }) }))
vi.mock('@/lib/registration/event-context', () => ({ rowTenant: (t: string | null) => t ?? 'tenant-stellr-placeholder' }))
vi.mock('@/lib/team-access', () => ({ ownsTeam: () => true }))
vi.mock('@/lib/google-sheets', () => ({ isGoogleSheetsConfigured: () => true, watchSheet: s.watchSheet }))
vi.mock('@/lib/sheet-participant-sync', () => ({
  SHEET_SYNC_COLUMNS: 'id, spreadsheet_id, tenant_id',
  SheetSyncRefused: class extends Error {},
  syncParticipantsFromSheet: async () => ({ created: 0, updated: 0, paymentLinksSent: 0, skippedForDateOfBirth: 0 }),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      if (table === 'members') return chain(() => ({ id: 'member-placeholder-1', email: 'organiser@example.test' }))
      if (table === 'registrations') {
        return chain(() => ({ id: 'reg-placeholder-1', spreadsheet_id: 'sheet-placeholder-1', tenant_id: null, teacher_member_id: 'member-placeholder-1' }))
      }
      if (table === 'sheet_watch_channels') {
        const q = chain(() => s.existing)
        q.insert = async (row: Record<string, unknown>) => {
          s.inserts.push(row)
          return { error: null }
        }
        return q
      }
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

const { POST } = await import('./route')

const call = () => POST(
  new Request('https://app.test/api/members/teams/reg-placeholder-1/sheet-sync', { method: 'POST' }) as never,
  { params: Promise.resolve({ id: 'reg-placeholder-1' }) },
)

beforeEach(() => {
  s.existing = null
  s.inserts = []
})
afterEach(() => s.watchSheet.mockClear())

describe('POST /api/members/teams/[id]/sheet-sync: watch channel token', () => {
  it('registers a new channel with a random 32-byte token and stores the same token', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).watchActive).toBe(true)

    expect(s.watchSheet).toHaveBeenCalledTimes(1)
    const token = s.watchSheet.mock.calls[0][2]
    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
    expect(token.length).toBeLessThanOrEqual(256) // Google's limit on a channel token

    expect(s.inserts).toHaveLength(1)
    expect(s.inserts[0]).toMatchObject({ registration_id: 'reg-placeholder-1', token })
  })

  it('renews an expired channel with a fresh token each time', async () => {
    s.existing = { expiration: new Date(Date.now() - 60 * 1000).toISOString() }
    await call()
    await call()
    const [a, b] = s.inserts.map((r) => r.token)
    expect(typeof a).toBe('string')
    expect(a).not.toBe(b)
  })

  it('leaves a live channel alone', async () => {
    s.existing = { expiration: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }
    const res = await call()
    expect((await res.json()).watchActive).toBe(true)
    expect(s.watchSheet).not.toHaveBeenCalled()
    expect(s.inserts).toHaveLength(0)
  })
})
