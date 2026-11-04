// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// S1 sign-up review: with sign-up open (decision 24), a new Clerk account gets a
// members row from the Clerk webhook with no date of birth. The age rules run at
// /account/onboarding, and only the member PAGES redirected there. Every
// community API took the session as-is, so an account that never onboarded (a
// child who would be refused there, say) could join open spaces, post, chat,
// comment and react by calling the API directly. Community APIs now resolve the
// caller through getOnboardedMember, which treats that account as signed out.

const { state } = vi.hoisted(() => ({
  state: {
    db: null as FakeDb | null,
    member: null as Record<string, unknown> | null,
  },
}))

vi.mock('@/lib/community', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/community')>()
  return { ...actual, getCurrentMember: async () => state.member, tiptapToPlainText: () => 'body text' }
})
vi.mock('@/lib/spaces', () => ({
  getSpaceForMember: async () => ({
    id: 'sp1',
    slug: 'general',
    access_type: 'open',
    access: { canAccess: true },
    myMuted: false,
    postingPolicy: 'all',
    myRole: 'member',
  }),
  canPostInSpace: () => true,
}))
vi.mock('@/lib/space-posts', () => ({ getChannelPosts: async () => [] }))
vi.mock('@/lib/mentions', () => ({ extractMentionIds: () => [], notifyMentions: async () => {} }))
vi.mock('@/lib/after-response', () => ({ runAfterResponse: () => {} }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => state.db!.client }))

const join_ = await import('./spaces/join/route')
const posts = await import('./posts/route')

const NOT_ONBOARDED = { id: 'm-new', first_name: '', last_name: '', isAdmin: false, date_of_birth: null, needsOnboarding: true }
const ONBOARDED = { id: 'm-ok', first_name: 'A', last_name: 'B', isAdmin: false, date_of_birth: '1990-01-01', needsOnboarding: false }

const joinSpace = () =>
  join_.POST(new Request('https://app.test', { method: 'POST', body: JSON.stringify({ spaceSlug: 'general' }) }))
const createPost = () =>
  posts.POST(new Request('https://app.test', { method: 'POST', body: JSON.stringify({ spaceSlug: 'general', title: 'Hello' }) }))

beforeEach(() => {
  state.db = fakeSupabase({ community_space_members: [], community_posts: [] })
  state.member = null
})

describe('community APIs refuse an account that has not onboarded', () => {
  it('POST /api/community/spaces/join: 401 and no roster row', async () => {
    state.member = NOT_ONBOARDED
    expect((await joinSpace()).status).toBe(401)
    expect(state.db!.table('community_space_members')).toHaveLength(0)
  })

  it('POST /api/community/posts: 401 and no post', async () => {
    state.member = NOT_ONBOARDED
    expect((await createPost()).status).toBe(401)
    expect(state.db!.table('community_posts')).toHaveLength(0)
  })

  it('still lets an onboarded member join an open space and post', async () => {
    state.member = ONBOARDED
    expect((await joinSpace()).status).toBe(200)
    expect(state.db!.table('community_space_members')).toHaveLength(1)
    expect((await createPost()).status).toBe(200)
    expect(state.db!.table('community_posts')).toHaveLength(1)
  })
})

// The structural guard: a community route added later must not resolve the
// caller with getCurrentMember, or the gap reopens for that route.
function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return routeFiles(p)
    return name === 'route.ts' ? [p] : []
  })
}

describe('every /api/community route resolves the caller through getOnboardedMember', () => {
  const root = join(process.cwd(), 'app/api/community')
  const files = routeFiles(root)

  it('finds the community routes', () => {
    expect(files.length).toBeGreaterThan(30)
  })

  it('no route calls getCurrentMember directly', () => {
    const offenders = files
      .filter((f) => /\bgetCurrentMember\s*\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(process.cwd(), f))
    expect(offenders).toEqual([])
  })
})
