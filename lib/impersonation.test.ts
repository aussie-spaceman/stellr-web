import { describe, it, expect, vi, beforeAll } from 'vitest'

// The impersonation ticket is a security boundary: it names whose account the
// whole member portal will render as. These tests pin the properties that make
// it safe to trust — unforgeable, non-retargetable, and self-expiring.

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: null, sessionClaims: null }) }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({}) }))

beforeAll(() => {
  process.env.IMPERSONATION_SECRET = 'test-signing-secret'
})

const { encodeTicket, decodeTicket, IMPERSONATION_TTL_SECONDS } = await import('@/lib/impersonation')

const ticket = { memberId: 'member-123', adminMemberId: 'admin-9', issuedAt: Date.now() }

describe('impersonation ticket', () => {
  it('round-trips a valid ticket', () => {
    const raw = encodeTicket(ticket)
    expect(raw).toBeTruthy()
    expect(decodeTicket(raw!)).toMatchObject({ memberId: 'member-123', adminMemberId: 'admin-9' })
  })

  it('rejects a tampered payload — the retargeting attack', () => {
    const raw = encodeTicket(ticket)!
    const sig = raw.slice(raw.lastIndexOf('.') + 1)
    // Re-point the ticket at a different member, keeping the original signature.
    const forged = Buffer.from(
      JSON.stringify({ ...ticket, memberId: 'someone-else' })
    ).toString('base64url')
    expect(decodeTicket(`${forged}.${sig}`)).toBeNull()
  })

  it('rejects a tampered signature', () => {
    const raw = encodeTicket(ticket)!
    expect(decodeTicket(raw.slice(0, -1) + 'X')).toBeNull()
  })

  it('rejects an unsigned value', () => {
    const payload = Buffer.from(JSON.stringify(ticket)).toString('base64url')
    expect(decodeTicket(payload)).toBeNull()
  })

  it('rejects an expired ticket even if the cookie survived', () => {
    const stale = encodeTicket({
      ...ticket,
      issuedAt: Date.now() - (IMPERSONATION_TTL_SECONDS + 60) * 1000,
    })!
    expect(decodeTicket(stale)).toBeNull()
  })

  it('rejects junk', () => {
    expect(decodeTicket(undefined)).toBeNull()
    expect(decodeTicket('')).toBeNull()
    expect(decodeTicket('.')).toBeNull()
    expect(decodeTicket('not-a-ticket')).toBeNull()
  })
})
