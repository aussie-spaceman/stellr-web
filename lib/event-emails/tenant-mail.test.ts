// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { fakeChainDb, type ChainCall } from '@/test/helpers/fake-chain-db'

// S5 B14: tenant event mail. The sender is "<Tenant> via Stellr" with the
// tenant's Reply-To, nothing goes out with the flag off, and A7's confirmation
// helper is transactional and email-only.

const h = vi.hoisted(() => ({ sendEmail: vi.fn(async (_o: Record<string, unknown>) => ({ id: 'msg-1' }) as { id: string | null; suppressed?: true }) }))
vi.mock('@/lib/email', () => ({ sendEmail: h.sendEmail }))

const TENANT = '11111111-1111-4111-8111-111111111111'

function tenantsDb(row: Record<string, unknown> | null, error: string | null = null) {
  return fakeChainDb((call: ChainCall) => {
    if (call.table !== 'tenants') return { data: null, error: { message: `unexpected ${call.table}` } }
    return error ? { data: null, error: { message: error } } : { data: row, error: null }
  })
}

const ORGANISER = { display_name: 'Rocket Club', branding: { reply_to: 'events@rocket.example.org' } }

beforeEach(() => {
  h.sendEmail.mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

const load = () => import('./tenant-mail')

describe('tenantEventSender', () => {
  it('sends as "<Tenant> via Stellr" from the platform domain, with replies to the tenant', async () => {
    const { tenantEventSender, TENANT_EVENT_FROM_ADDRESS } = await load()
    expect(tenantEventSender(ORGANISER)).toEqual({
      from: `"Rocket Club via Stellr" <${TENANT_EVENT_FROM_ADDRESS}>`,
      replyTo: 'events@rocket.example.org',
    })
    expect(TENANT_EVENT_FROM_ADDRESS).toMatch(/@mail\.stellreducation\.org$/)
  })

  it('gives no sender without a valid Reply-To, so replies never land in Stellr’s inbox', async () => {
    const { tenantEventSender } = await load()
    expect(tenantEventSender({ display_name: 'Rocket Club', branding: {} })).toBeNull()
    expect(tenantEventSender({ display_name: 'Rocket Club', branding: { reply_to: 'not an address' } })).toBeNull()
    expect(tenantEventSender({ display_name: 'Rocket Club', branding: null })).toBeNull()
    expect(tenantEventSender({ display_name: '   ', branding: ORGANISER.branding })).toBeNull()
  })

  it('keeps header-breaking characters out of the From name and caps its length', async () => {
    const { tenantEventSender, senderName } = await load()
    const s = tenantEventSender({ display_name: 'Evil "Club" <x@y>\r\nBcc: z@w', branding: ORGANISER.branding })
    expect(s?.from).not.toMatch(/[\r\n]/)
    expect(s?.from.match(/"/g)).toHaveLength(2)
    expect(s?.from.match(/</g)).toHaveLength(1)
    expect(senderName('x'.repeat(200))).toHaveLength(64)
  })
})

describe('loadTenantSender', () => {
  it('reads nothing and gives no sender with the flag off, the default', async () => {
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', '')
    const { loadTenantSender } = await load()
    const fake = tenantsDb(ORGANISER)
    expect(await loadTenantSender(fake.db, TENANT)).toBeNull()
    expect(fake.calls).toEqual([])
  })

  it('never gives Stellr a tenant sender: its mail keeps its own', async () => {
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', 'true')
    const { loadTenantSender } = await load()
    const fake = tenantsDb(ORGANISER)
    expect(await loadTenantSender(fake.db, STELLR_TENANT_ID)).toBeNull()
    expect(fake.calls).toEqual([])
  })

  it('with the flag on, reads the tenant and builds its sender; a failed read gives none', async () => {
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', 'true')
    const { loadTenantSender } = await load()
    expect(await loadTenantSender(tenantsDb(ORGANISER).db, TENANT)).toMatchObject({ replyTo: 'events@rocket.example.org' })
    expect(await loadTenantSender(tenantsDb(null, 'boom').db, TENANT)).toBeNull()
    expect(await loadTenantSender(tenantsDb(null).db, TENANT)).toBeNull()
  })
})

describe('sendTenantConfirmation (A7)', () => {
  const input = { tenantId: TENANT, to: 'parent@example.org', subject: 'You’re registered', html: '<p>Hi</p>', text: 'Hi' }

  it('sends nothing with the flag off', async () => {
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', '')
    const { sendTenantConfirmation } = await load()
    expect(await sendTenantConfirmation(tenantsDb(ORGANISER).db, input)).toEqual({ ok: false, reason: 'disabled' })
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it('refuses Stellr, whose confirmations keep their own templates and sender', async () => {
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', 'true')
    const { sendTenantConfirmation } = await load()
    expect(await sendTenantConfirmation(tenantsDb(ORGANISER).db, { ...input, tenantId: STELLR_TENANT_ID })).toEqual({ ok: false, reason: 'stellr' })
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it('refuses a tenant with no sender', async () => {
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', 'true')
    const { sendTenantConfirmation } = await load()
    expect(await sendTenantConfirmation(tenantsDb({ display_name: 'Rocket Club', branding: {} }).db, input)).toEqual({ ok: false, reason: 'no_sender' })
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it('sends one transactional email from the tenant’s sender', async () => {
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', 'true')
    const { sendTenantConfirmation } = await load()
    expect(await sendTenantConfirmation(tenantsDb(ORGANISER).db, input)).toEqual({ ok: true, id: 'msg-1' })
    expect(h.sendEmail).toHaveBeenCalledTimes(1)
    expect(h.sendEmail.mock.calls[0][0]).toEqual({
      to: 'parent@example.org',
      from: '"Rocket Club via Stellr" <no-reply@mail.stellreducation.org>',
      replyTo: 'events@rocket.example.org',
      subject: 'You’re registered',
      html: '<p>Hi</p>',
      text: 'Hi',
      kind: 'transactional',
    })
  })

  it('reports a suppressed address as not sent, and a failed send without throwing', async () => {
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', 'true')
    const { sendTenantConfirmation } = await load()
    h.sendEmail.mockResolvedValueOnce({ id: null, suppressed: true })
    expect(await sendTenantConfirmation(tenantsDb(ORGANISER).db, input)).toEqual({ ok: true, id: null, suppressed: true })
    h.sendEmail.mockRejectedValueOnce(new Error('resend down'))
    expect(await sendTenantConfirmation(tenantsDb(ORGANISER).db, input)).toEqual({ ok: false, reason: 'send_failed', error: 'resend down' })
  })
})

describe('todayInZone', () => {
  it('gives the date in the tenant’s zone, and falls back to Mountain for a zone Intl does not know', async () => {
    const { todayInZone, todayInMountain } = await import('./render')
    const now = new Date('2026-09-28T15:00:00Z')
    expect(todayInZone('Australia/Sydney', now)).toBe('2026-09-29')
    expect(todayInZone('America/Denver', now)).toBe('2026-09-28')
    expect(todayInZone('Not/AZone', now)).toBe(todayInMountain(now))
    expect(todayInZone('Not/AZone', new Date('2026-09-29T03:00:00Z'))).toBe('2026-09-28')
  })
})
