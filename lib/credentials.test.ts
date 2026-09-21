import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/env', () => ({ SITE_URL: 'https://www.stellreducation.org' }))
// docusign-agreements pulls in email/notify/docusign; only agreementExpiry is
// needed here and it is pure.
vi.mock('@/lib/docusign-agreements', () => ({
  agreementExpiry: (completedAt: string) => {
    const d = new Date(completedAt)
    d.setFullYear(d.getFullYear() + 3)
    return d
  },
}))

import {
  generateCredentialNumber,
  normaliseCredentialNumber,
  ageOn,
  isMinorOn,
  canUseLinkedIn,
  credentialState,
  canShare,
  consentForMinor,
  credentialUrl,
  type CredentialRow,
} from './credentials'

const NOW = new Date('2026-09-21T12:00:00Z')

function row(over: Partial<CredentialRow> = {}): CredentialRow {
  return {
    id: 'c1', number: 'STL-2026-7K3MQ8ZD', source: 'course', member_id: 'm1', participant_id: null,
    module_id: 'mod1', event_slug: null, recipient_name: 'Ada Lovelace', title: 'Orbital Mechanics 101',
    description: null, criteria: null, skills: [], issuer: 'Stellr Academy', role_label: null, award: null,
    theme: 'space', badge_path: null, issued_at: '2026-09-01T00:00:00Z', expires_at: null, status: 'issued',
    revoked_at: null, revoked_reason: null, tombstoned_at: null, visibility: 'private', is_minor: false,
    ...over,
  }
}

describe('credential numbers', () => {
  it('generates STL-YYYY- plus 8 Crockford base32 chars', () => {
    const n = generateCredentialNumber(NOW)
    expect(n).toMatch(/^STL-2026-[0-9A-HJKMNP-TV-Z]{8}$/)
  })
  it('does not repeat across a batch', () => {
    const set = new Set(Array.from({ length: 500 }, () => generateCredentialNumber(NOW)))
    expect(set.size).toBe(500)
  })
  it('normalises case and whitespace and accepts the legacy 6-hex form', () => {
    expect(normaliseCredentialNumber('  stl-2026-7k3mq8zd ')).toBe('STL-2026-7K3MQ8ZD')
    expect(normaliseCredentialNumber('STL-2025-A1B2C3')).toBe('STL-2025-A1B2C3')
  })
  it('rejects junk before it reaches the database', () => {
    expect(normaliseCredentialNumber('')).toBeNull()
    expect(normaliseCredentialNumber('STL-2026')).toBeNull()
    expect(normaliseCredentialNumber("STL-2026-' OR 1=1")).toBeNull()
    expect(normaliseCredentialNumber('STL-2026-7K3MQ8ZDXX')).toBeNull()
  })
  it('builds the public URL from SITE_URL', () => {
    expect(credentialUrl('STL-2026-7K3MQ8ZD')).toBe('https://www.stellreducation.org/credentials/STL-2026-7K3MQ8ZD')
  })
})

describe('age gates', () => {
  it('ageOn respects the birthday boundary', () => {
    expect(ageOn('2010-09-21', NOW)).toBe(16)
    expect(ageOn('2010-09-22', NOW)).toBe(15)
  })
  it('isMinorOn is under 18', () => {
    expect(isMinorOn('2008-09-22', NOW)).toBe(true)
    expect(isMinorOn('2008-09-21', NOW)).toBe(false)
    expect(isMinorOn(null, NOW)).toBe(false)
  })
  it('canUseLinkedIn is 16+, and unknown DOB is a no', () => {
    expect(canUseLinkedIn('2010-09-21', NOW)).toBe(true)
    expect(canUseLinkedIn('2010-09-22', NOW)).toBe(false)
    expect(canUseLinkedIn(null, NOW)).toBe(false)
  })
})

describe('credentialState', () => {
  it('collapses the row to one word, withdrawn winning over everything', () => {
    expect(credentialState(row(), NOW)).toBe('valid')
    expect(credentialState(row({ expires_at: '2026-01-01T00:00:00Z' }), NOW)).toBe('expired')
    expect(credentialState(row({ status: 'revoked' }), NOW)).toBe('revoked')
    expect(credentialState(row({ status: 'revoked', tombstoned_at: '2026-09-02T00:00:00Z' }), NOW)).toBe('withdrawn')
  })
})

describe('canShare', () => {
  it('adults share when valid', () => {
    expect(canShare(row(), 'not_required')).toEqual({ ok: true })
  })
  it('minors need a granting consent form', () => {
    const minor = row({ is_minor: true })
    expect(canShare(minor, 'granted')).toEqual({ ok: true })
    expect(canShare(minor, 'declined')).toEqual({ ok: false, reason: 'minor_declined' })
    expect(canShare(minor, 'none')).toEqual({ ok: false, reason: 'minor_no_consent' })
  })
  it('state blocks win over consent', () => {
    expect(canShare(row({ status: 'revoked' }), 'granted')).toEqual({ ok: false, reason: 'revoked' })
    expect(canShare(row({ tombstoned_at: '2026-09-02T00:00:00Z' }), 'not_required')).toEqual({ ok: false, reason: 'withdrawn' })
  })
})

// ── consentForMinor against a minimal query double ──────────────────────────

interface Env { id: string; completed_at: string | null; credential_sharing_opt_out?: boolean; reused_from?: string | null }

function makeDb(latest: Env | null, roots: Record<string, Env> = {}) {
  const calls: Record<string, unknown>[] = []
  return {
    calls,
    from() {
      const f: Record<string, unknown> = {}
      const chain = {
        select: () => chain,
        or: (v: string) => { f.or = v; return chain },
        eq: (k: string, v: unknown) => { f[k] = v; return chain },
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => {
          calls.push({ ...f })
          if (f.id) return { data: roots[f.id as string] ?? null, error: null }
          return { data: latest, error: null }
        },
      }
      return chain
    },
  } as unknown as Parameters<typeof consentForMinor>[0]
}

describe('consentForMinor (opt-out model)', () => {
  it('a valid completed minor envelope grants by default', async () => {
    const db = makeDb({ id: 'e1', completed_at: '2026-01-10T00:00:00Z' })
    expect(await consentForMinor(db, { memberId: 'm1', participantId: null }, NOW)).toBe('granted')
  })
  it('an opt-out on the envelope declines', async () => {
    const db = makeDb({ id: 'e1', completed_at: '2026-01-10T00:00:00Z', credential_sharing_opt_out: true })
    expect(await consentForMinor(db, { memberId: 'm1', participantId: null }, NOW)).toBe('declined')
  })
  it('a coverage row defers to the envelope it reuses', async () => {
    const db = makeDb(
      { id: 'cov', completed_at: '2025-03-01T00:00:00Z', reused_from: 'root' },
      { root: { id: 'root', completed_at: '2025-03-01T00:00:00Z', credential_sharing_opt_out: true } },
    )
    expect(await consentForMinor(db, { memberId: null, participantId: 'p1' }, NOW)).toBe('declined')
  })
  it('an expired form is no consent at all', async () => {
    const db = makeDb({ id: 'e1', completed_at: '2023-01-10T00:00:00Z' })
    expect(await consentForMinor(db, { memberId: 'm1', participantId: null }, NOW)).toBe('none')
  })
  it('nobody to look up is none', async () => {
    const db = makeDb({ id: 'e1', completed_at: '2026-01-10T00:00:00Z' })
    expect(await consentForMinor(db, { memberId: null, participantId: null }, NOW)).toBe('none')
  })
  it('filters to completed minor envelopes for either id', async () => {
    const db = makeDb({ id: 'e1', completed_at: '2026-01-10T00:00:00Z' })
    await consentForMinor(db, { memberId: 'm1', participantId: 'p1' }, NOW)
    const q = (db as unknown as { calls: Record<string, unknown>[] }).calls[0]
    expect(q.or).toBe('member_id.eq.m1,participant_id.eq.p1')
    expect(q.envelope_type).toBe('minor')
    expect(q.status).toBe('completed')
  })
})
