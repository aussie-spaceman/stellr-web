import { describe, it, expect } from 'vitest'
import {
  findExistingRegistrations,
  resolveDuplicate,
  type ExistingRegistration,
} from '@/lib/registration-duplicates'

function match(over: Partial<ExistingRegistration> = {}): ExistingRegistration {
  return {
    registrationId: 'reg-1',
    email: 'dan@example.com',
    role: 'participant',
    type: 'individual',
    status: 'pending',
    invoiceRequested: false,
    memberPaysIndividually: false,
    teacherEmail: null,
    ...over,
  }
}

describe('resolveDuplicate', () => {
  it('is none for no matches', () => {
    expect(resolveDuplicate(undefined, { sessionMatches: false })).toEqual({ kind: 'none' })
    expect(resolveDuplicate([], { sessionMatches: true })).toEqual({ kind: 'none' })
  })

  it('a confirmed registration wins over anything pending', () => {
    const confirmed = match({ registrationId: 'reg-2', status: 'confirmed' })
    const r = resolveDuplicate([match(), confirmed], { sessionMatches: true })
    expect(r).toEqual({ kind: 'already_registered', registration: confirmed })
  })

  it('pending individual + matching session → resume', () => {
    expect(resolveDuplicate([match()], { sessionMatches: true })).toMatchObject({ kind: 'resume' })
  })

  it('pending individual + no session → email the link (never the checkout)', () => {
    expect(resolveDuplicate([match()], { sessionMatches: false })).toMatchObject({ kind: 'email_link' })
  })

  it('a participant in someone else’s pending group → in_group', () => {
    const r = resolveDuplicate([match({ type: 'group', role: 'participant' })], { sessionMatches: true })
    expect(r).toMatchObject({ kind: 'in_group' })
  })

  it('organiser of a pending card group → resume / email_link by session', () => {
    const org = match({ type: 'group', role: 'organiser', teacherEmail: 'dan@example.com' })
    expect(resolveDuplicate([org], { sessionMatches: true })).toMatchObject({ kind: 'resume' })
    expect(resolveDuplicate([org], { sessionMatches: false })).toMatchObject({ kind: 'email_link' })
  })

  it('organiser with an open invoice → invoice_pending', () => {
    const org = match({ type: 'group', role: 'organiser', invoiceRequested: true })
    expect(resolveDuplicate([org], { sessionMatches: true })).toMatchObject({ kind: 'invoice_pending' })
  })

  it('organiser of a members-pay-individually group or a campaign → already_registered', () => {
    expect(
      resolveDuplicate([match({ type: 'group', role: 'organiser', memberPaysIndividually: true })], { sessionMatches: true }),
    ).toMatchObject({ kind: 'already_registered' })
    expect(
      resolveDuplicate([match({ type: 'campaign', role: 'organiser' })], { sessionMatches: true }),
    ).toMatchObject({ kind: 'already_registered' })
  })

  it('prefers the person’s own individual registration when they are also in a group', () => {
    const own = match({ registrationId: 'own' })
    const group = match({ registrationId: 'grp', type: 'group', role: 'participant' })
    expect(resolveDuplicate([group, own], { sessionMatches: false })).toEqual({ kind: 'email_link', registration: own })
  })
})

// Stub covering the three queries: participants by email, registrations by id
// + event, registrations by teacher_email + event.
function makeDb(opts: {
  participants: { email: string; registration_id: string }[]
  registrations: { id: string; event_slug: string; type: string; status: string; invoice_requested?: boolean; member_pays_individually?: boolean; teacher_email?: string | null }[]
}) {
  const calls: string[] = []
  const db = {
    from(table: string) {
      calls.push(table)
      if (table === 'participants') {
        return {
          select: () => ({
            in: async (_col: string, emails: string[]) => ({
              data: opts.participants.filter((p) => emails.includes(p.email)),
              error: null,
            }),
          }),
        }
      }
      // registrations: capture the filters then resolve on await
      const filters: Record<string, unknown> = {}
      const chain = {
        select: () => chain,
        in: (col: string, vals: string[]) => { filters[`in:${col}`] = vals; return chain },
        eq: (col: string, v: unknown) => { filters[`eq:${col}`] = v; return chain },
        neq: (col: string, v: unknown) => { filters[`neq:${col}`] = v; return chain },
        then: (resolve: (v: { data: unknown; error: null }) => void) => {
          const rows = opts.registrations.filter((r) => {
            if (filters['in:id'] && !(filters['in:id'] as string[]).includes(r.id)) return false
            if (filters['in:teacher_email'] && !(filters['in:teacher_email'] as string[]).includes(r.teacher_email ?? '')) return false
            if (filters['eq:event_slug'] && r.event_slug !== filters['eq:event_slug']) return false
            if (filters['neq:status'] && r.status === filters['neq:status']) return false
            return true
          })
          resolve({ data: rows, error: null })
        },
      }
      return chain
    },
  }
  return { db: db as never, calls }
}

describe('findExistingRegistrations', () => {
  it('returns only registrations on this event, ignoring withdrawn ones', async () => {
    const { db } = makeDb({
      participants: [
        { email: 'dan@example.com', registration_id: 'other-event' },
        { email: 'dan@example.com', registration_id: 'this-event' },
        { email: 'dan@example.com', registration_id: 'withdrawn' },
      ],
      registrations: [
        { id: 'other-event', event_slug: 'texas', type: 'individual', status: 'confirmed' },
        { id: 'this-event', event_slug: 'colorado', type: 'individual', status: 'pending' },
        { id: 'withdrawn', event_slug: 'colorado', type: 'individual', status: 'withdrawn' },
      ],
    })

    const out = await findExistingRegistrations(db, ['Dan@Example.com'], 'colorado')

    expect(out.get('dan@example.com')).toEqual([
      expect.objectContaining({ registrationId: 'this-event', role: 'participant', status: 'pending' }),
    ])
  })

  it('finds an organiser who has no participant row of their own', async () => {
    const { db } = makeDb({
      participants: [],
      registrations: [
        { id: 'grp', event_slug: 'colorado', type: 'group', status: 'pending', teacher_email: 'teach@school.org' },
      ],
    })

    const out = await findExistingRegistrations(db, ['teach@school.org'], 'colorado')

    expect(out.get('teach@school.org')).toEqual([
      expect.objectContaining({ registrationId: 'grp', role: 'organiser', type: 'group' }),
    ])
  })

  it('is empty (and queries nothing) for no emails', async () => {
    const { db, calls } = makeDb({ participants: [], registrations: [] })
    expect((await findExistingRegistrations(db, ['', '  '], 'colorado')).size).toBe(0)
    expect(calls).toEqual([])
  })
})
