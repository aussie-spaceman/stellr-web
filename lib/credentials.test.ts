import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/env', () => ({ SITE_URL: 'https://www.stellreducation.org' }))
// docusign-agreements pulls in email/notify/docusign; only agreementExpiry is
// needed here and it is pure.
// Pre-V2.3 rows (no agreement_version) keep their 3 years; that is what these
// fixtures are.
vi.mock('@/lib/docusign-agreements', () => ({
  agreementValid: (row: { completed_at: string | null }, now = new Date()) => {
    if (!row.completed_at) return false
    const d = new Date(row.completed_at)
    d.setFullYear(d.getFullYear() + 3)
    return d > now
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
  ageBlock,
  consentForMinor,
  shareConsentFor,
  credentialUrl,
  tombstoneCredentialsFor,
  unpublishCredentialsFor,
  issueCredential,
  type CredentialRow,
} from './credentials'

const NOW = new Date('2026-09-21T12:00:00Z')

function row(over: Partial<CredentialRow> = {}): CredentialRow {
  return {
    id: 'c1', number: 'STL-2026-7K3MQ8ZD', source: 'course', member_id: 'm1', participant_id: null,
    module_id: 'mod1', event_slug: null, recipient_name: 'Ada Lovelace', title: 'Orbital Mechanics 101',
    description: null, criteria: null, skills: [], issuer: 'Stellr Academy', role_label: null, award: null, award_type: null,
    theme: 'space', badge_path: null, pd_hours: null, standards: [], activity_title: null, activity_date: null, activity_location: null,
    issued_at: '2026-09-01T00:00:00Z', expires_at: null, status: 'issued',
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
  it('age blocks are never overridden by consent', () => {
    expect(canShare(row({ is_minor: true }), 'under_13')).toEqual({ ok: false, reason: 'under_13' })
    expect(canShare(row(), 'dob_unknown')).toEqual({ ok: false, reason: 'dob_unknown' })
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

// ── Erasure ──────────────────────────────────────────────────────────────────
// The write half of right-to-erasure. Only the READING of tombstoned_at was
// covered before (credentialState / canShare), so the call that lib/deletion
// makes on a member or participant delete had no test at all.

function makeTombstoneDb(rows: { id: string }[] | null, error: { message: string } | null = null) {
  const calls: Record<string, unknown>[] = []
  const db = {
    calls,
    from(table: string) {
      const f: Record<string, unknown> = { table }
      const chain = {
        update: (payload: Record<string, unknown>) => { f.payload = payload; return chain },
        eq: (k: string, v: unknown) => { f[k] = v; return chain },
        is: (k: string, v: unknown) => { f[`is:${k}`] = v; return chain },
        select: async () => { calls.push({ ...f }); return { data: rows, error } },
      }
      return chain
    },
  }
  return db as unknown as Parameters<typeof tombstoneCredentialsFor>[0] & { calls: Record<string, unknown>[] }
}

describe('tombstoneCredentialsFor', () => {
  it('blanks the name and makes the page private, keeping the number resolvable', async () => {
    const db = makeTombstoneDb([{ id: 'c1' }, { id: 'c2' }])
    const n = await tombstoneCredentialsFor(db, 'member', 'm1')
    expect(n).toBe(2)

    const q = (db as unknown as { calls: Record<string, unknown>[] }).calls[0]
    const payload = q.payload as Record<string, unknown>
    expect(q.table).toBe('credentials')
    expect(payload.recipient_name).toBe('')
    expect(payload.visibility).toBe('private')
    expect(typeof payload.tombstoned_at).toBe('string')
    // The number is deliberately NOT cleared: a verifier holding a CV must get
    // "withdrawn" rather than a 404 that looks like a forgery.
    expect(payload).not.toHaveProperty('number')
    expect(payload).not.toHaveProperty('status')
  })

  it('targets the right column for each kind of holder', async () => {
    const asMember = makeTombstoneDb([])
    await tombstoneCredentialsFor(asMember, 'member', 'm1')
    expect((asMember as unknown as { calls: Record<string, unknown>[] }).calls[0].member_id).toBe('m1')

    const asParticipant = makeTombstoneDb([])
    await tombstoneCredentialsFor(asParticipant, 'participant', 'p1')
    expect((asParticipant as unknown as { calls: Record<string, unknown>[] }).calls[0].participant_id).toBe('p1')
  })

  it('never re-tombstones a row that already carries a timestamp', async () => {
    const db = makeTombstoneDb([])
    await tombstoneCredentialsFor(db, 'member', 'm1')
    expect((db as unknown as { calls: Record<string, unknown>[] }).calls[0]['is:tombstoned_at']).toBeNull()
  })

  it('reports zero and does not throw when the write fails — a delete must not be blocked by this', async () => {
    const db = makeTombstoneDb(null, { message: 'permission denied' })
    await expect(tombstoneCredentialsFor(db, 'member', 'm1')).resolves.toBe(0)
  })
})


describe('unpublishCredentialsFor (guardian opt-out)', () => {
  function makeDb(rows: unknown[] | null) {
    const calls: Record<string, unknown>[] = []
    const db = {
      calls,
      from(table: string) {
        const f: Record<string, unknown> = { table }
        const chain = {
          update: (payload: Record<string, unknown>) => { f.payload = payload; return chain },
          or: (v: string) => { f.or = v; return chain },
          eq: (k: string, v: unknown) => { f[k] = v; return chain },
          is: (k: string, v: unknown) => { f[`is:${k}`] = v; return chain },
          select: async () => { calls.push({ ...f }); return { data: rows, error: null } },
        }
        return chain
      },
    }
    return db as unknown as Parameters<typeof unpublishCredentialsFor>[0] & { calls: Record<string, unknown>[] }
  }

  it('makes only public, non-tombstoned pages private for the member or participant', async () => {
    const db = makeDb([row({ visibility: 'private' })])
    const out = await unpublishCredentialsFor(db, { memberId: 'm1', participantId: 'p1' })
    expect(out).toHaveLength(1)
    const q = db.calls[0]
    expect(q.table).toBe('credentials')
    expect((q.payload as Record<string, unknown>).visibility).toBe('private')
    expect(q.or).toBe('member_id.eq.m1,participant_id.eq.p1')
    expect(q.visibility).toBe('public')
    expect(q['is:tombstoned_at']).toBeNull()
    // Revoked pages are included on purpose: no status filter.
    expect(q).not.toHaveProperty('status')
  })

  it('does nothing without a holder', async () => {
    const db = makeDb([])
    await expect(unpublishCredentialsFor(db, { memberId: null, participantId: null })).resolves.toEqual([])
    expect(db.calls).toHaveLength(0)
  })
})

// ── Age rules (D5, 2 Oct): under 13 never public; unknown DOB never public ──

describe('ageBlock', () => {
  it('blocks under 13 and unknown DOB, from the live date', () => {
    expect(ageBlock('2014-09-22', NOW)).toBe('under_13')   // 11
    expect(ageBlock('2013-09-22', NOW)).toBe('under_13')   // 12, birthday tomorrow
    expect(ageBlock('2013-09-21', NOW)).toBeNull()         // 13 today
    expect(ageBlock(null, NOW)).toBe('dob_unknown')
    expect(ageBlock('not-a-date', NOW)).toBe('dob_unknown')
  })
})

describe('shareConsentFor', () => {
  const view = (dob: string | null, over: Partial<CredentialRow> = {}) => ({ ...row(over), date_of_birth: dob })
  const granting = () => makeDb({ id: 'e1', completed_at: new Date().toISOString() })

  it('an under-13 is blocked even with a granting consent form', async () => {
    const recent = `${new Date().getUTCFullYear() - 10}-01-01`
    expect(await shareConsentFor(granting(), view(recent, { is_minor: true }))).toBe('under_13')
  })
  it('an unknown DOB is blocked', async () => {
    expect(await shareConsentFor(granting(), view(null))).toBe('dob_unknown')
  })
  it('an adult needs no consent', async () => {
    expect(await shareConsentFor(granting(), view('1990-05-05'))).toBe('not_required')
  })
  it('a minor today needs consent even when is_minor was stored false', async () => {
    const sixteen = `${new Date().getUTCFullYear() - 16}-01-01`
    expect(await shareConsentFor(makeDb(null), view(sixteen, { is_minor: false }))).toBe('none')
    expect(await shareConsentFor(granting(), view(sixteen, { is_minor: false }))).toBe('granted')
  })
})

// Educator PD (7 Oct 2026): one live PD credential per member per event. A
// revoked one does not block a corrected re-issue, so the lookup filters on
// status — the partial index credentials_pd_once does the same in the DB.
function makeIssueDb(existing: Record<string, unknown> | null) {
  const calls: { filters: Record<string, unknown>; insert?: Record<string, unknown> }[] = []
  const db = {
    from() {
      const call: { filters: Record<string, unknown>; insert?: Record<string, unknown> } = { filters: {} }
      calls.push(call)
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => { call.filters[k] = v; return q },
        maybeSingle: async () => ({ data: existing, error: null }),
        insert: (payload: Record<string, unknown>) => { call.insert = payload; return q },
        single: async () => ({ data: { id: 'new', ...call.insert }, error: null }),
      }
      return q
    },
    calls,
  }
  return db as unknown as Parameters<typeof issueCredential>[0] & { calls: typeof calls }
}

describe('issueCredential — educator PD', () => {
  const input = {
    source: 'pd' as const,
    memberId: 'm1',
    eventSlug: 'co-2026',
    recipient: { firstName: 'Maria', lastName: 'Gordon', dateOfBirth: null },
    title: 'Professional Development — Sample (8 hours)',
    pdHours: 8,
    standards: ['NGSS SEP 1'],
    activityTitle: 'Sample',
    activityDate: '2026-10-04',
    activityLocation: 'Springfield, CO',
  }

  it('looks for a live one for this member and event only', async () => {
    const db = makeIssueDb(null)
    const { created, row } = await issueCredential(db, input)
    expect(created).toBe(true)
    expect(db.calls[0].filters).toEqual({ source: 'pd', member_id: 'm1', event_slug: 'co-2026', status: 'issued' })
    const ins = db.calls[1].insert!
    expect(ins.pd_hours).toBe(8)
    expect(ins.standards).toEqual(['NGSS SEP 1'])
    expect(ins.activity_title).toBe('Sample')
    expect(ins.award_type).toBeNull()
    // No DOB yet (admin-created teacher): not a minor, and the page stays private.
    expect(ins.is_minor).toBe(false)
    expect(row.number).toMatch(/^STL-\d{4}-/)
  })

  it('returns the live one instead of issuing twice', async () => {
    const db = makeIssueDb({ id: 'c1', number: 'STL-2026-AAAAAAAA' })
    const { created, row } = await issueCredential(db, input)
    expect(created).toBe(false)
    expect(row.id).toBe('c1')
    expect(db.calls).toHaveLength(1)
  })

  it('needs a member and an event', async () => {
    await expect(issueCredential(makeIssueDb(null), { ...input, memberId: null })).rejects.toThrow(/memberId \+ eventSlug/)
  })

  it('never writes hours onto another kind of credential', async () => {
    const db = makeIssueDb(null)
    await issueCredential(db, { ...input, source: 'course', moduleId: 'mod1' })
    expect(db.calls[1].insert!.pd_hours).toBeNull()
  })
})

// Mentor credentials (8 Oct 2026): mentors are members with no participants
// row, so the lookup is member + event + award — credentials_event_mentor_once.
describe('issueCredential — volunteer mentor', () => {
  const input = {
    source: 'event' as const,
    awardType: 'mentor',
    memberId: 'm9',
    eventSlug: 'co-2026',
    recipient: { firstName: 'Pauline', lastName: 'Mentor', dateOfBirth: '1980-05-01' },
    title: 'Sample — Volunteer Mentor',
    roleLabel: 'Mentor',
  }

  it('dedupes on member, event and award, never on participant', async () => {
    const db = makeIssueDb(null)
    const { created } = await issueCredential(db, input)
    expect(created).toBe(true)
    expect(db.calls[0].filters).toEqual({ source: 'event', member_id: 'm9', event_slug: 'co-2026', award_type: 'mentor' })
    const ins = db.calls[1].insert!
    expect(ins.award_type).toBe('mentor')
    expect(ins.participant_id).toBeNull()
    expect(ins.member_id).toBe('m9')
    expect(ins.is_minor).toBe(false)
  })

  it('returns the existing one instead of issuing twice', async () => {
    const db = makeIssueDb({ id: 'c9', number: 'STL-2026-BBBBBBBB' })
    const { created } = await issueCredential(db, input)
    expect(created).toBe(false)
    expect(db.calls).toHaveLength(1)
  })

  it('needs a member and an event', async () => {
    await expect(issueCredential(makeIssueDb(null), { ...input, memberId: null })).rejects.toThrow(/mentor credential needs memberId/)
  })
})
