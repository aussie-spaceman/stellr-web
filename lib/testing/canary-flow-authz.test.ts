// @vitest-environment node
/**
 * Holds the S7 table (lib/testing/canary-flow-scenarios.ts) to lib/authz for the probes
 * a switch reaches: P11 and P12 drive the real requireEventRoute, as the email tab's
 * route calls it, with K3's personas as the fake role tables hold them, in all nine
 * AUTHZ_SOURCE and LOADSCOPED_MODE pairs. A change to the guard that moves an answer
 * fails here, not in K9's supervised window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { fakeDb, type Tables } from '@/test/fixtures/authz-principal'

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND')
  }),
}))

import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { resetErrorCaptureState } from '@/lib/app-errors'
import { requireEventRoute } from '@/lib/authz'
import { ALL_RUN_MODES, ISOLATION_PROBES, modeLabel, type ProbeContext, type RunMode } from './canary-flow-scenarios'
import { CANARY_FLOW_EVENT, CANARY_FLOW_TENANT } from './canary-flow-seed'

const USER = 'user_canary_flow_placeholder'
const CANARY = CANARY_FLOW_TENANT.id
const SLUG = CANARY_FLOW_EVENT.slug
const EMAILS_ROUTE = '/api/admin/events/[slug]/emails'

const membership = (tenant_id: string, role: string) => ({ tenant_id, role, clerk_user_id: USER, member_id: null })

/** What K3 seeds for each persona, as the role tables and the Clerk claim hold it. */
const PERSONAS: Record<string, { claimsRole: string; tables: Tables }> = {
  // The event_manager claim, dev-canary's event_manager membership and the assignment,
  // stamped dev-canary by the S3 derivation.
  'canary-manager': {
    claimsRole: 'event_manager',
    tables: {
      tenant_memberships: [membership(CANARY, 'event_manager')],
      event_manager_assignments: [{ clerk_user_id: USER, event_slug: SLUG, tenant_id: CANARY }],
    },
  },
  // The same, with a Stellr event_manager membership as well (the Clerk role synced to
  // Stellr): the assignment is still dev-canary's, so Stellr's host gives it nothing.
  'canary-manager with a Stellr membership': {
    claimsRole: 'event_manager',
    tables: {
      tenant_memberships: [membership(CANARY, 'event_manager'), membership(STELLR_TENANT_ID, 'event_manager')],
      event_manager_assignments: [{ clerk_user_id: USER, event_slug: SLUG, tenant_id: CANARY }],
    },
  },
  // Stellr's admin claim and Stellr's tenant_admin membership.
  'stellr-probe-admin': {
    claimsRole: 'admin',
    tables: { tenant_memberships: [membership(STELLR_TENANT_ID, 'tenant_admin')] },
  },
}

function as(persona: string, m: RunMode) {
  const p = PERSONAS[persona]
  const db = fakeDb({
    members: [],
    tenants: [{ id: CANARY, status: 'active' }],
    events: [{ slug: SLUG, tenant_id: CANARY }],
    ...p.tables,
  })
  vi.mocked(supabaseServer).mockReturnValue(db.client)
  vi.mocked(auth).mockResolvedValue({ userId: USER, sessionClaims: { metadata: { role: p.claimsRole } } } as never)
  vi.stubEnv('AUTHZ_SOURCE', m.authzSource)
  vi.stubEnv('LOADSCOPED_MODE', m.loadScopedMode)
}

/** The status the email tab answers: requireEventRoute's refusal, or the 200 it goes on to. */
async function emailTab(): Promise<number> {
  const route = await requireEventRoute(SLUG, { route: EMAILS_ROUTE })
  return route.ok ? 200 : route.status
}

const CONTEXT = { canarySlug: SLUG, stellrSlug: 'a-stellr-event' } as ProbeContext
const probe = (id: string) => ISOLATION_PROBES.find((p) => p.id === id)!

function expectedStatus(id: string, m: RunMode): number {
  const e = probe(id).expect(m)
  if ('notRun' in e) throw new Error(`${id} is not run`)
  return e.status
}

beforeEach(() => {
  resetErrorCaptureState()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('S7 against lib/authz requireEventRoute', () => {
  it("P11 and P12 are the email tab's own route and persona", () => {
    expect(probe('P11')).toMatchObject({ persona: 'canary-manager', host: 'stellr' })
    expect(probe('P12')).toMatchObject({ persona: 'stellr-probe-admin', host: 'stellr' })
    expect(probe('P11').request(CONTEXT)).toEqual({ method: 'GET', path: `/api/admin/events/${SLUG}/emails` })
    expect(probe('P12').request(CONTEXT)).toEqual({ method: 'GET', path: `/api/admin/events/${SLUG}/emails` })
  })

  for (const m of ALL_RUN_MODES) {
    it(`P11, canary-manager on its own event's email tab, answers as the table says under ${modeLabel(m)}`, async () => {
      for (const persona of ['canary-manager', 'canary-manager with a Stellr membership']) {
        as(persona, m)
        expect(await emailTab(), persona).toBe(expectedStatus('P11', m))
      }
    })

    it(`P12, stellr-probe-admin on dev-canary's email tab, answers as the table says under ${modeLabel(m)}`, async () => {
      as('stellr-probe-admin', m)
      expect(await emailTab()).toBe(expectedStatus('P12', m))
    })
  }

  it('under postgres the table says 403 for P11 and 404 for P12, in every load-scoped mode', () => {
    for (const m of ALL_RUN_MODES.filter((x) => x.authzSource === 'postgres')) {
      expect(expectedStatus('P11', m), modeLabel(m)).toBe(403)
      expect(expectedStatus('P12', m), modeLabel(m)).toBe(404)
    }
  })
})
