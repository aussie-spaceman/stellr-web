import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'crypto'

// The impersonation ticket is a security boundary: it names whose account the
// whole member portal will render as. These tests pin the properties that make
// it safe to trust — unforgeable, non-retargetable, bound to its issuer, and
// self-expiring — and the dedicated signing key behind them.

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: null, sessionClaims: null }) }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({}) }))

const SECRET = 'test-signing-secret-of-32-characters-or-more'

const saved = {
  IMPERSONATION_SECRET: process.env.IMPERSONATION_SECRET,
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  CRON_SECRET: process.env.CRON_SECRET,
}

beforeEach(() => {
  process.env.IMPERSONATION_SECRET = SECRET
  process.env.CLERK_SECRET_KEY = 'sk_test_clerk_key_that_is_long_enough_to_pass'
  process.env.CRON_SECRET = 'cron-secret-that-is-also-long-enough-to-pass'
})

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

const {
  encodeTicket,
  decodeTicket,
  impersonationConfigured,
  impersonationSecret,
  ImpersonationNotConfiguredError,
  IMPERSONATION_TTL_SECONDS,
} = await import('@/lib/impersonation')

const ticket = { memberId: 'member-123', adminMemberId: 'admin-9', issuedAt: Date.now() }

/** A ticket signed by hand, to get past encodeTicket's own refusals. */
function signWith(key: string, body: unknown): string {
  const payload = Buffer.from(JSON.stringify(body)).toString('base64url')
  return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`
}

describe('impersonation ticket', () => {
  it('round-trips a valid ticket', () => {
    const raw = encodeTicket(ticket)
    expect(raw).toBeTruthy()
    expect(decodeTicket(raw)).toMatchObject({ memberId: 'member-123', adminMemberId: 'admin-9' })
  })

  it('rejects a tampered payload — the retargeting attack', () => {
    const raw = encodeTicket(ticket)
    const sig = raw.slice(raw.lastIndexOf('.') + 1)
    // Re-point the ticket at a different member, keeping the original signature.
    const forged = Buffer.from(
      JSON.stringify({ ...ticket, memberId: 'someone-else' })
    ).toString('base64url')
    expect(decodeTicket(`${forged}.${sig}`)).toBeNull()
  })

  it('rejects a tampered signature', () => {
    const raw = encodeTicket(ticket)
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
    })
    expect(decodeTicket(stale)).toBeNull()
  })

  it('rejects junk', () => {
    expect(decodeTicket(undefined)).toBeNull()
    expect(decodeTicket('')).toBeNull()
    expect(decodeTicket('.')).toBeNull()
    expect(decodeTicket('not-a-ticket')).toBeNull()
  })
})

// S0 (Nov 2026): a ticket with no adminMemberId skipped the issuer binding, so
// any admin holding it could use it.
describe('issuer binding is mandatory', () => {
  it('refuses to issue a ticket that names no admin', () => {
    expect(() => encodeTicket({ ...ticket, adminMemberId: '' })).toThrow(/issuing admin/)
    expect(() => encodeTicket({ ...ticket, adminMemberId: null as unknown as string })).toThrow(/issuing admin/)
  })

  it('rejects a correctly signed ticket that names no admin (a legacy one)', () => {
    expect(decodeTicket(signWith(SECRET, { ...ticket, adminMemberId: null }))).toBeNull()
    const { adminMemberId: _drop, ...unbound } = ticket
    expect(decodeTicket(signWith(SECRET, unbound))).toBeNull()
  })
})

// S0 (Nov 2026): the key fell back to CLERK_SECRET_KEY, then CRON_SECRET.
describe('the signing key is dedicated', () => {
  it('uses IMPERSONATION_SECRET when it is set and long enough', () => {
    expect(impersonationConfigured()).toBe(true)
    expect(impersonationSecret()).toBe(SECRET)
  })

  it('does not fall back to CLERK_SECRET_KEY or CRON_SECRET', () => {
    delete process.env.IMPERSONATION_SECRET
    expect(impersonationConfigured()).toBe(false)
    expect(() => impersonationSecret()).toThrow(ImpersonationNotConfiguredError)
    // A ticket signed with either old fallback key is worthless.
    expect(decodeTicket(signWith(process.env.CLERK_SECRET_KEY!, ticket))).toBeNull()
    expect(decodeTicket(signWith(process.env.CRON_SECRET!, ticket))).toBeNull()
  })

  it('refuses a key shorter than 32 characters', () => {
    process.env.IMPERSONATION_SECRET = 'x'.repeat(31)
    expect(impersonationConfigured()).toBe(false)
    process.env.IMPERSONATION_SECRET = 'x'.repeat(32)
    expect(impersonationConfigured()).toBe(true)
  })

  it('refuses a copy of the Clerk key or the cron secret', () => {
    process.env.IMPERSONATION_SECRET = process.env.CLERK_SECRET_KEY
    expect(impersonationConfigured()).toBe(false)
    process.env.IMPERSONATION_SECRET = process.env.CRON_SECRET
    expect(impersonationConfigured()).toBe(false)
  })

  it('unset: issuing throws a clear error, reading a stray cookie is just "no session"', () => {
    const raw = encodeTicket(ticket)
    delete process.env.IMPERSONATION_SECRET
    expect(() => encodeTicket(ticket)).toThrow(/IMPERSONATION_SECRET/)
    // Member pages call decodeTicket on every request; it must not throw.
    expect(() => decodeTicket(raw)).not.toThrow()
    expect(decodeTicket(raw)).toBeNull()
  })

  // The owner sets the variable during rollout; "not set" for a value that is
  // merely too short sends them looking for a deploy fault instead.
  it('says which problem the key has', () => {
    delete process.env.IMPERSONATION_SECRET
    expect(new ImpersonationNotConfiguredError().message).toMatch(/IMPERSONATION_SECRET is not set/)
    process.env.IMPERSONATION_SECRET = 'x'.repeat(24)
    expect(() => impersonationSecret()).toThrow(/IMPERSONATION_SECRET is shorter than 32 characters/)
    process.env.IMPERSONATION_SECRET = process.env.CLERK_SECRET_KEY
    expect(() => impersonationSecret()).toThrow(/IMPERSONATION_SECRET is a copy of CLERK_SECRET_KEY or CRON_SECRET/)
    process.env.IMPERSONATION_SECRET = process.env.CRON_SECRET
    expect(new ImpersonationNotConfiguredError().message).not.toMatch(/not set/)
  })

  it('rotating the key ends every open ticket', () => {
    const raw = encodeTicket(ticket)
    process.env.IMPERSONATION_SECRET = 'a-completely-different-key-of-enough-length'
    expect(decodeTicket(raw)).toBeNull()
  })
})
