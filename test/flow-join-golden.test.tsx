import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tree } from './golden-tree'

// What Stellr's group join page returns, pinned before B5b split it so a tenant page
// can reuse the body without the signed-in prefill. The golden file holds the element
// tree, that tree as HTML, and each read in order, with the exact select and filters.
// A change to the golden file is a change to what Stellr serves: read the diff.

const reads: string[] = []
type Answer = { data: unknown; error?: unknown; count?: number }
const state = vi.hoisted(() => ({
  answers: {} as Record<string, (filters: string) => unknown>,
  userId: null as string | null,
  user: null as unknown,
  event: {} as unknown,
  eventThrows: false,
  prefillThrows: false,
}))

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => {
    reads.push('auth()')
    return { userId: state.userId }
  },
  currentUser: async () => {
    reads.push('currentUser()')
    return state.user
  },
}))

vi.mock('@/lib/sanity', () => ({
  getEventBySlug: async (slug: string) => {
    reads.push(`getEventBySlug(${slug})`)
    if (state.eventThrows) throw new Error('sanity down')
    return state.event
  },
}))

vi.mock('@/lib/registration-prefill', () => ({
  getRegistrationPrefill: async () => {
    reads.push('getRegistrationPrefill()')
    if (state.prefillThrows) throw new Error('prefill failed')
    return { memberId: 'm-1', email: 'member@example.test', first_name: 'Pre' }
  },
}))

vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from(table: string) {
      const parts: string[] = []
      const record = (name: string, ...args: unknown[]) => {
        parts.push(`${name}(${args.map((a) => JSON.stringify(a)).join(', ')})`)
        return builder
      }
      const answer = () => {
        const filters = parts.join('.')
        reads.push(`${table}.${filters}`)
        const found = state.answers[table]?.(filters) as Answer | undefined
        return { data: null, error: null, ...found }
      }
      const builder = {
        select: (...a: unknown[]) => record('select', ...a),
        eq: (...a: unknown[]) => record('eq', ...a),
        ilike: (...a: unknown[]) => record('ilike', ...a),
        limit: (...a: unknown[]) => record('limit', ...a),
        maybeSingle: async () => answer(),
        then: (done: (v: unknown) => void) => done(answer()),
      }
      return builder
    },
  }),
}))

vi.mock('@/app/(flow)/register/[slug]/join/[token]/GroupJoinClient', () => ({
  default: function GroupJoinClient(props: object) {
    return <div data-form="join" data-props={JSON.stringify(props)} />
  },
}))

const TOKEN_ROW = { token: 'tok', event_slug: 'nv', event_title: 'Nevada Design Challenge', registration_id: 'reg-1', expires_at: '2999-01-01T12:00:00Z' }
const REG = {
  teacher_first_name: 'Grace',
  teacher_last_name: 'Hopper',
  school_name: 'Test High',
  school_address_state: 'NV',
  registrant_role: 'teacher',
  status: 'pending',
  member_pays_individually: false,
  adult_count: 1,
  student_count: 4,
}
const USER = { primaryEmailAddressId: 'e2', emailAddresses: [{ id: 'e1', emailAddress: 'old@example.test' }, { id: 'e2', emailAddress: 'member@example.test' }] }

function answers(over: Partial<Record<string, (filters: string) => unknown>> = {}) {
  return {
    group_join_tokens: () => ({ data: TOKEN_ROW }),
    registrations: () => ({ data: REG }),
    schools: () => ({ data: { state: 'CO' } }),
    members: () => ({ data: { school_email: null } }),
    participants: () => ({ data: null, count: 2 }),
    ...over,
  } as Record<string, (filters: string) => unknown>
}

beforeEach(() => {
  reads.length = 0
  state.answers = answers()
  state.userId = null
  state.user = null
  state.event = { gradeMin: 7, gradeMax: 12 }
  state.eventThrows = false
  state.prefillThrows = false
})

async function page() {
  reads.length = 0
  const { default: Page } = await import('@/app/(flow)/register/[slug]/join/[token]/page')
  const out: ReactNode = await Page({ params: Promise.resolve({ slug: 'nv', token: 'tok' }) })
  return { tree: tree(out), html: renderToStaticMarkup(<>{out}</>), reads: [...reads] }
}

const signedIn = () => {
  state.userId = 'user_1'
  state.user = USER
}

describe("Stellr's group join page", () => {
  it('returns what it returned before the split', async () => {
    const out: Record<string, unknown> = {}

    out['no such link'] = await (async () => {
      state.answers = answers({ group_join_tokens: () => ({ data: null }) })
      return page()
    })()
    state.answers = answers({ group_join_tokens: () => ({ data: null, error: { message: 'boom' } }) })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    out['token read fails'] = await page()
    state.answers = answers({ group_join_tokens: () => ({ data: { ...TOKEN_ROW, expires_at: '2000-01-15T12:00:00Z' } }) })
    out['expired link'] = await page()
    state.answers = answers({ registrations: () => ({ data: null, error: { message: 'boom' } }) })
    out['registration read fails'] = await page()
    error.mockRestore()

    state.answers = answers()
    out['signed out, the form'] = await page()
    state.answers = answers({ registrations: () => ({ data: { ...REG, school_address_state: null } }) })
    out['signed out, state from the schools table'] = await page()
    state.answers = answers({ registrations: () => ({ data: { ...REG, adult_count: null, student_count: null } }) })
    out['signed out, older registration with no counts'] = await page()
    state.answers = answers({ participants: () => ({ data: null, count: 5 }) })
    out['signed out, group full'] = await page()
    state.answers = answers({ registrations: () => ({ data: { ...REG, registrant_role: 'student_manager', member_pays_individually: true } }) })
    out['signed out, student manager and pay individually'] = await page()
    state.answers = answers()
    state.eventThrows = true
    out['event read fails, default grade band'] = await page()
    state.eventThrows = false

    signedIn()
    out['signed in, the form with their prefill'] = await page()
    state.prefillThrows = true
    out['signed in, prefill fails'] = await page()
    state.prefillThrows = false
    state.answers = answers({ participants: (filters: string) => (filters.includes('member@example.test') ? { data: { id: 'p-1' } } : { data: null, count: 2 }) })
    out['signed in, already on the roster'] = await page()
    state.answers = answers({
      members: () => ({ data: { school_email: 'school@example.test' } }),
      participants: (filters: string) => (filters.includes('school@example.test') ? { data: { id: 'p-1' } } : { data: null, count: 2 }),
    })
    out['signed in, on the roster under their school address'] = await page()
    state.answers = answers({ members: () => ({ data: { school_email: 'school@example.test' } }) })
    out['signed in, school address not on the roster'] = await page()

    await expect(`${JSON.stringify(out, null, 1)}\n`).toMatchFileSnapshot('./fixtures/flow-join-golden.json')
  })
})

describe('the shared body, as a tenant page calls it', () => {
  it('reads no prefill for a signed-in member and hands the form none', async () => {
    signedIn()
    const { groupJoinBody } = await import('@/app/(flow)/register/[slug]/join/[token]/join-body')
    const html = renderToStaticMarkup(<>{await groupJoinBody({ slug: 'nv', token: 'tok' })}</>)
    expect(reads).not.toContain('getRegistrationPrefill()')
    expect(html).toContain('&quot;prefill&quot;:null')
    expect(html).toContain('&quot;isAuthenticated&quot;:true')
  })
})
