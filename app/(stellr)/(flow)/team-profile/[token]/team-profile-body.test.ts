// @vitest-environment node
//
// S5 wave 7, A10a: a team profile link shows only on its own tenant's page. Stellr's
// page answers another tenant's link as one nobody holds, so it never shows that
// tenant's student, event or answers; the tenant's page answers Stellr's links the same
// way. The event here is loadable, so a refusal is the tenant check and not a missing
// event. A NULL tenant is a Stellr row the backfill has not reached.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { STELLR_TENANT_ID as STELLR } from '@/lib/tenancy/constants'
import { fakeChainDb, type ChainCall } from '@/test/helpers/fake-chain-db'

const CANARY = 'c0000000-0000-4000-8000-0000000000aa'

const h = vi.hoisted(() => ({ tenant: null as string | null, calls: [] as ChainCall[] }))

vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => {
    const fake = fakeChainDb((call) => {
      if (call.table === 'team_profiles') {
        return {
          data: {
            id: 'tp-1', participant_id: 'p-1', member_id: null, event_slug: 'the-event', token_version: 1, prefilled_from: null,
            definition_version: 1, answers: {}, submitted_at: null, first_sent_at: null, last_sent_at: null, send_count: 1,
            last_send_error: null, created_at: '2099-01-01T00:00:00Z', updated_at: '2099-01-01T00:00:00Z', tenant_id: h.tenant,
          },
          error: null,
        }
      }
      if (call.table === 'participants') return { data: { first_name: 'Sam' }, error: null }
      return { data: null, error: null }
    })
    // One client per page call: its calls land here as the page makes them.
    h.calls = fake.calls
    return fake.db
  },
}))
vi.mock('@/lib/survey/events', () => ({
  loadSurveyEvent: async (slug: string) => ({ slug, title: 'The Event', date: '2099-05-01', timeZone: 'UTC', cancelled: false, isCampaign: false }),
  loadAllSurveyEvents: async () => [],
}))
vi.mock('@/lib/event-emails/send', () => ({ loadEventForEmail: async (slug: string) => ({ slug }) }))
vi.mock('@/components/survey/SurveyNotice', () => ({ SurveyNotice: function SurveyNotice() { return null } }))
vi.mock('@/components/team-profile/TeamProfileForm', () => ({ TeamProfileForm: function TeamProfileForm() { return null } }))

const { default: TeamProfilePage } = await import('./page')
const { TeamProfileBody } = await import('./team-profile-body')
const { tenantTeamProfileSession } = await import('@/lib/tenancy/tenant-records')
const { teamProfileToken } = await import('@/lib/team-profile/tokens')

type Session = { studentFirstName: string } | null
const token = () => teamProfileToken('tp-1', 1)

/** The session Stellr's page hands its body: null is "this link isn't valid". */
async function stellrPageSession(): Promise<Session> {
  const el = (await TeamProfilePage({ params: Promise.resolve({ token: token() }) })) as ReactElement<{ session: Session }>
  return el.props.session
}
const tenantPageSession = (tenantId: string) =>
  tenantTeamProfileSession({ tenantId, tenantSlug: 'canary' }, token()) as Promise<Session>
/** A refused link reads the row and nothing about the student. */
const readTheStudent = () => h.calls.some((c) => c.table === 'participants')

beforeEach(() => {
  vi.stubEnv('SURVEY_TOKEN_SECRET', 'test-only-token-secret-not-used-anywhere-else')
  h.tenant = null
  h.calls = []
})

describe("Stellr's team profile page", () => {
  it("shows Stellr's links, a NULL tenant included", async () => {
    for (const tenant of [STELLR, null]) {
      h.tenant = tenant
      expect(await stellrPageSession()).toMatchObject({ studentFirstName: 'Sam' })
    }
  })

  it("answers another tenant's link as one nobody holds, before reading the student", async () => {
    h.tenant = CANARY
    expect(await stellrPageSession()).toBeNull()
    expect(readTheStudent()).toBe(false)
  })
})

describe("the tenant's team profile session", () => {
  it("is the tenant's own link's, and answers Stellr's, NULL included, as unknown", async () => {
    h.tenant = CANARY
    expect(await tenantPageSession(CANARY)).toMatchObject({ studentFirstName: 'Sam' })
    for (const tenant of [STELLR, null]) {
      h.tenant = tenant
      h.calls = []
      expect(await tenantPageSession(CANARY)).toBeNull()
      expect(readTheStudent()).toBe(false)
    }
  })
})

describe('the shared body', () => {
  it('shows the form for a session, and "this link isn’t valid" for none', () => {
    const none = TeamProfileBody({ token: token(), session: null }) as ReactElement<{ title: string }>
    expect((none.type as { name: string }).name).toBe('SurveyNotice')
    expect(none.props.title).toBe('This link isn’t valid')
    const shown = TeamProfileBody({
      token: token(),
      session: { row: { submitted_at: null }, answers: {}, studentFirstName: 'Sam', eventTitle: 'The Event', open: true, prefilled: false } as never,
    }) as ReactElement<{ children: ReactElement<{ children: ReactElement<{ studentFirstName: string }> }> }>
    expect(shown.props.children.props.children.props.studentFirstName).toBe('Sam')
  })
})
