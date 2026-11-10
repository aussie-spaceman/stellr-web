import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// S5 A7: what the shared register bodies show only for Stellr. Stellr's guarantee
// and mission note reach a body only through the slot Stellr's own pages fill, and a
// join link of another tenant gets the unknown link's page on Stellr's host.

const CANARY = 'c0000000-0000-4000-8000-0000000000aa'

const h = vi.hoisted(() => ({ tokenRow: null as Record<string, unknown> | null }))

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: null }), currentUser: async () => null }))
vi.mock('@/lib/registration-prefill', () => ({ getRegistrationPrefill: async () => null }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: h.tokenRow, error: null }),
      }
      return chain
    },
  }),
}))

const JoinPage = (await import('@/app/(stellr)/(flow)/register/[slug]/join/[token]/page')).default
const { groupJoinBody } = await import('@/app/(stellr)/(flow)/register/[slug]/join/[token]/join-body')

const expired = (tenantId: string | null) => ({
  token: 'tok', event_slug: 'canary-cup', registration_id: 'reg-1', tenant_id: tenantId,
  expires_at: '2000-01-01T00:00:00Z',
})

const html = async (node: Promise<unknown>) => renderToStaticMarkup((await node) as never)

beforeEach(() => {
  h.tokenRow = null
})

describe('S5 A7: the join page on Stellr’s host', () => {
  it('another tenant’s link gets the unknown link’s page, before anything about it is told', async () => {
    h.tokenRow = expired(CANARY)
    const foreign = await html(JoinPage({ params: Promise.resolve({ slug: 'canary-cup', token: 'tok' }) }))
    h.tokenRow = null
    const unknown = await html(JoinPage({ params: Promise.resolve({ slug: 'canary-cup', token: 'tok' }) }))
    expect(foreign).toBe(unknown)
    expect(foreign).toContain('Invalid Link')
  })

  it('Stellr’s own link, NULL or stamped, still answers as before', async () => {
    for (const tenantId of [null, '00000000-0000-4000-8000-000000000001']) {
      h.tokenRow = expired(tenantId)
      expect(await html(JoinPage({ params: Promise.resolve({ slug: 'canary-cup', token: 'tok' }) }))).toContain('Link Expired')
    }
  })

  it('the tenant tree’s call, which checked its own link first, still answers for it', async () => {
    h.tokenRow = expired(CANARY)
    expect(await html(groupJoinBody({ slug: 'canary-cup', token: 'tok' }))).toContain('Link Expired')
  })
})

describe('S5 A7: Stellr’s guarantee and mission note', () => {
  const read = (p: string) => readFileSync(p, 'utf8')
  const base = 'app/(stellr)/(flow)/register/[slug]'

  it('the shared bodies import neither, and render them only from the slot', () => {
    for (const body of [`${base}/individual/individual-body.tsx`, `${base}/group/group-body.tsx`]) {
      const src = read(body)
      expect(src).not.toMatch(/MoneyBackGuarantee|MissionFundingNote/)
      expect(src).toContain('stellrNotes?.guarantee')
      expect(src).toContain('stellrNotes?.missionFunding')
    }
  })

  it('Stellr’s pages fill the slot and the tenant tree’s do not', () => {
    for (const page of ['individual', 'group']) {
      expect(read(`${base}/${page}/page.tsx`)).toContain('stellrNotes: stellrRegistrationNotes()')
      expect(read(`app/%5Ft/[tenant]/(flow)/register/[slug]/${page}/page.tsx`)).not.toContain('stellrNotes')
    }
  })

  it('the pay pages show the guarantee only on a Stellr registration', () => {
    for (const body of ['pay/[token]/pay-body.tsx', 'pay-seat/[token]/pay-seat-body.tsx']) {
      expect(read(`${base}/${body}`)).toMatch(/\(reg\.tenant_id \?\? STELLR_TENANT_ID\) === STELLR_TENANT_ID && \(\s*<MoneyBackGuarantee/)
    }
  })
})
