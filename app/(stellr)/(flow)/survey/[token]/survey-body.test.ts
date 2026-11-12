// @vitest-environment node
//
// S5 wave 7, A10b: the emailed survey link and the event-day QR page show only their own
// tenant's survey. Stellr's pages answer another tenant's link or event as one nobody
// holds, so its event, state and invitations are never shown; the tenant's pages answer
// Stellr's the same way. A NULL tenant is a Stellr row the backfill has not reached. The
// survey here is open, and the signed-in member is someone else, so a refusal is the
// tenant check: past it, Stellr's page would say whose link it is.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { STELLR_TENANT_ID as STELLR } from '@/lib/tenancy/constants'

const CANARY = 'c0000000-0000-4000-8000-0000000000aa'
const TOKEN = 'A'.repeat(43)

const h = vi.hoisted(() => ({
  inv: null as Record<string, unknown> | null,
  dist: null as Record<string, unknown> | null,
  wrongMemberAsked: 0,
  redirected: [] as string[],
}))

vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => {
    const chain: Record<string, unknown> = {}
    for (const m of ['from', 'select', 'eq', 'or', 'limit']) chain[m] = () => chain
    chain.maybeSingle = async () => ({ data: { id: 'inv-1' }, error: null })
    return chain
  },
}))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    h.redirected.push(url)
    throw new Error(`NEXT_REDIRECT ${url}`)
  },
}))
vi.mock('@/lib/community', () => ({ getSignedInMember: async () => ({ id: 'm-signed-in' }) }))
vi.mock('@/lib/survey/access', async (orig) => ({
  onPageTenant: (await orig<typeof import('@/lib/survey/access')>()).onPageTenant,
  invitationByToken: async () => h.inv,
  isWrongMember: async () => {
    h.wrongMemberAsked++
    return true
  },
  loadSession: async () => null,
  participantIdsFor: async () => [],
}))
vi.mock('@/lib/survey/distributions', () => ({ distributionForEvent: async () => h.dist, statusNow: () => 'open' }))
vi.mock('@/components/survey/SurveyNotice', () => ({ SurveyNotice: function SurveyNotice() { return null } }))
vi.mock('@/components/survey/SurveyLoader', () => ({ SurveyLoader: function SurveyLoader() { return null } }))
vi.mock('@/components/survey/SurveyAfterSubmit', () => ({ SurveyAfterSubmit: function SurveyAfterSubmit() { return null } }))
vi.mock('@/components/survey/SurveyLinkRequest', () => ({ SurveyLinkRequest: function SurveyLinkRequest() { return null } }))

const { default: SurveyPage } = await import('./page')
const { SurveyBody } = await import('./survey-body')
const { default: QrPage } = await import('../event/[slug]/page')
const { EventSurveyQrBody } = await import('../event/[slug]/qr-body')

/** The notice's title: what the visitor is told. */
async function told(el: Promise<unknown> | unknown): Promise<string> {
  let out = (await el) as ReactElement<{ title?: string; token?: string; slug?: string; tenantId?: string }>
  // A page renders its body; render that too.
  while (out && typeof out.type === 'function' && !('title' in (out.props ?? {}))) {
    out = (await (out.type as (p: unknown) => unknown)(out.props)) as typeof out
  }
  return out.props.title ?? ''
}

const invitation = (tenant: string | null) => ({ id: 'inv-1', distribution_id: 'd-1', member_id: 'm-owner', participant_id: null, tenant_id: tenant })
const distribution = (tenant: string | null) => ({ id: 'd-1', event_title: 'The Event', tenant_id: tenant })

beforeEach(() => {
  h.wrongMemberAsked = 0
  h.redirected = []
})

describe('the emailed survey link', () => {
  const stellrPage = () => told(SurveyPage({ params: Promise.resolve({ token: TOKEN }) }))

  it("Stellr's page answers another tenant's link as an unknown one, before the member is compared", async () => {
    h.inv = invitation(CANARY)
    expect(await stellrPage()).toBe('This link isn’t valid')
    expect(h.wrongMemberAsked).toBe(0)
  })

  it("Stellr's page goes on for Stellr's links, a NULL tenant included", async () => {
    for (const tenant of [STELLR, null]) {
      h.inv = invitation(tenant)
      expect(await stellrPage()).toBe('This survey belongs to someone else')
    }
    expect(h.wrongMemberAsked).toBe(2)
  })

  it("the tenant's body answers Stellr's links, a NULL tenant included, as unknown, and goes on for its own", async () => {
    for (const tenant of [STELLR, null]) {
      h.inv = invitation(tenant)
      expect(await told(SurveyBody({ token: TOKEN, tenantId: CANARY }))).toBe('This link isn’t valid')
    }
    h.inv = invitation(CANARY)
    expect(await told(SurveyBody({ token: TOKEN, tenantId: CANARY }))).toBe('This survey belongs to someone else')
  })

  it('a link nobody holds answers as before', async () => {
    h.inv = null
    expect(await stellrPage()).toBe('This link isn’t valid')
  })
})

describe('the event-day QR page', () => {
  const stellrPage = () => QrPage({ params: Promise.resolve({ slug: 'the-event' }) })
  const NONE = 'The survey isn’t open yet'

  it("Stellr's page answers another tenant's event as one with no survey, and sends nobody to its invitation", async () => {
    h.dist = distribution(CANARY)
    expect(await told(stellrPage())).toBe(NONE)
    expect(h.redirected).toEqual([])
  })

  it("Stellr's page goes on for Stellr's survey, a NULL tenant included", async () => {
    for (const tenant of [STELLR, null]) {
      h.dist = distribution(tenant)
      await expect(told(stellrPage())).rejects.toThrow('NEXT_REDIRECT /community/surveys/open/inv-1?from=qr')
    }
  })

  it("the tenant's body answers Stellr's survey as none, and goes on for its own", async () => {
    for (const tenant of [STELLR, null]) {
      h.dist = distribution(tenant)
      expect(await told(EventSurveyQrBody({ slug: 'the-event', tenantId: CANARY }))).toBe(NONE)
    }
    h.dist = distribution(CANARY)
    await expect(told(EventSurveyQrBody({ slug: 'the-event', tenantId: CANARY }))).rejects.toThrow('NEXT_REDIRECT')
  })
})
