// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeChainDb, type ChainCall } from '@/test/helpers/fake-chain-db'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// B14b's admin count: other tenants' signing invitations held because their
// tenant has no usable sender. drainOutbox never reads those signers, so this
// count is the only place they show. Counts only, never a name.

vi.mock('@/lib/email', async (orig) => ({ ...(await orig<typeof import('@/lib/email')>()), sendEmail: vi.fn() }))
const { heldSigningInvites } = await import('./outbox')

const ROCKET = '11111111-1111-4111-8111-111111111111'
const QUIET = '33333333-3333-4333-8333-333333333333'
const TENANTS = [
  { id: ROCKET, display_name: 'Rocket Club', branding: { reply_to: 'events@rocket.example.org' } },
  { id: QUIET, display_name: 'Quiet Org', branding: {} },
]

/** Signers waiting in the outbox, by their envelope's tenant. */
const WAITING = [
  { tenant: null }, { tenant: STELLR_TENANT_ID }, { tenant: ROCKET }, { tenant: QUIET }, { tenant: QUIET },
]

// Answers as PostgREST would for the filters the count sends.
function db(opts: { tenantsFail?: boolean; countFail?: boolean } = {}) {
  return fakeChainDb((call: ChainCall) => {
    if (call.table === 'tenants') {
      if (opts.tenantsFail) return { data: null, error: { message: 'tenants unreadable' } }
      return { data: TENANTS, error: null }
    }
    if (call.table === 'agreement_recipients') {
      if (opts.countFail) return { data: null, error: { message: 'count failed' } }
      const notIn = call.filters.find((f) => f.method === 'not' && f.args[1] === 'in')?.args[2] as string | undefined
      const excluded = notIn ? notIn.replace(/[()]/g, '').split(',') : []
      const count = WAITING.filter((w) => w.tenant && w.tenant !== STELLR_TENANT_ID && !excluded.includes(w.tenant)).length
      return { data: null, error: null, count } as never
    }
    return { data: null, error: null }
  })
}

beforeEach(() => {
  vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', 'true')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('heldSigningInvites', () => {
  it('counts waiting signers of tenants with no usable sender, leaving out Stellr’s and those that can be sent', async () => {
    const fake = db()
    expect(await heldSigningInvites(fake.db)).toBe(2)
    const read = fake.calls.find((c) => c.table === 'agreement_recipients')!
    expect(read.columns).toContain('envelope:agreements!inner')
    expect(read.filters).toEqual(expect.arrayContaining([
      { method: 'eq', args: ['status', 'sent'] },
      { method: 'is', args: ['invite_sent_at', null] },
      { method: 'eq', args: ['envelope.provider', 'native'] },
      { method: 'not', args: ['envelope.tenant_id', 'is', null] },
      { method: 'neq', args: ['envelope.tenant_id', STELLR_TENANT_ID] },
      { method: 'not', args: ['envelope.tenant_id', 'in', `(${ROCKET})`] },
    ]))
  })

  it('flag off: null, and nothing is read (behaviour unchanged)', async () => {
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', '')
    const fake = db()
    expect(await heldSigningInvites(fake.db)).toBeNull()
    expect(fake.calls).toEqual([])
  })

  it('the tenants cannot be read: null, not every tenant’s signers counted as held', async () => {
    expect(await heldSigningInvites(db({ tenantsFail: true }).db)).toBeNull()
  })

  it('the count cannot be read: null, never a throw', async () => {
    expect(await heldSigningInvites(db({ countFail: true }).db)).toBeNull()
  })
})
