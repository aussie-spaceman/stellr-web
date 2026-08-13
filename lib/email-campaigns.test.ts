import { describe, it, expect, vi, beforeEach } from 'vitest'

// The engine reaches for the service-role client at call time; swap in a stub we
// can drive per test. sendEmail is mocked so nothing ever leaves the process.
const state: {
  campaigns: Record<string, unknown>[]
  queueRows: Record<string, unknown>[]
  members: Record<string, unknown>[]
  templates: Record<string, unknown>[]
  inserts: Record<string, Record<string, unknown>[]>
  updates: Record<string, Record<string, unknown>[]>
  claimSucceeds: boolean
} = {
  campaigns: [], queueRows: [], members: [], templates: [],
  inserts: {}, updates: {}, claimSucceeds: true,
}

const sent: Array<{ to: string; subject: string }> = []

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(async (o: { to: string; subject: string }) => { sent.push(o) }),
  MARKETING_FROM: 'Stellr <hello@mail.example.org>',
}))

vi.mock('@/lib/email-render', () => ({
  renderCampaignEmail: () => ({ subject: 'Rendered', html: '<p>hi</p>', text: 'hi' }),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => makeDb(),
}))

/** Chainable Supabase stub, just enough for the engine's query shapes. */
function makeDb() {
  const record = (bucket: Record<string, Record<string, unknown>[]>, table: string, row: Record<string, unknown>) => {
    ;(bucket[table] ??= []).push(row)
  }

  return {
    from(table: string) {
      const rowsFor = () => {
        if (table === 'email_campaigns') return state.campaigns
        if (table === 'email_campaign_queue') return state.queueRows
        if (table === 'members') return state.members
        if (table === 'email_templates') return state.templates
        return []
      }
      const chain: Record<string, unknown> = {}
      Object.assign(chain, {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        not: () => chain,
        neq: () => chain,
        lte: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({
          data: state.claimSucceeds ? (rowsFor()[0] ?? null) : null,
          error: null,
        }),
        single: async () => ({ data: rowsFor()[0] ?? null, error: null }),
        insert: (payload: Record<string, unknown>) => {
          record(state.inserts, table, payload)
          return chain
        },
        update: (payload: Record<string, unknown>) => {
          record(state.updates, table, payload)
          return chain
        },
        then: (resolve: (v: unknown) => unknown) => resolve({ data: rowsFor(), error: null }),
      })
      return chain
    },
  }
}

beforeEach(() => {
  state.campaigns = []
  state.queueRows = []
  state.members = []
  state.templates = []
  state.inserts = {}
  state.updates = {}
  state.claimSucceeds = true
  sent.length = 0
  vi.clearAllMocks()
})

describe('fireCampaignEvent — delay routing', () => {
  it('sends inline when delay_days is 0, writing no queue row', async () => {
    const { fireCampaignEvent } = await import('@/lib/email-campaigns')
    state.campaigns = [{ id: 'c1', template_id: 't1', audience: {}, delay_days: 0 }]
    state.templates = [{ name: 'Welcome', subject: 'Hi', body_json: {} }]
    state.members = [{
      id: 'm1', first_name: 'Mia', last_name: 'M', email: 'mia@example.org',
      membership_id: '1', age_bracket: 'adult', marketing_unsubscribe_token: 'tok',
    }]

    await fireCampaignEvent('member.created', 'm1')

    expect(state.inserts['email_campaign_queue']).toBeUndefined()
    expect(sent).toHaveLength(1)
  })

  it('queues instead of sending when delay_days is set', async () => {
    const { fireCampaignEvent } = await import('@/lib/email-campaigns')
    state.campaigns = [{ id: 'c1', template_id: 't1', audience: {}, delay_days: 7 }]

    await fireCampaignEvent('member.created', 'm1', 'seed')

    expect(sent).toHaveLength(0)
    const queued = state.inserts['email_campaign_queue']
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ campaign_id: 'c1', member_id: 'm1', dedup_key: 'seed' })

    // Due roughly 7 days out — allow a minute of slack for test execution.
    const dueAt = new Date(queued[0].due_at as string).getTime()
    const expected = Date.now() + 7 * 86_400_000
    expect(Math.abs(dueAt - expected)).toBeLessThan(60_000)
  })

  it('treats a missing delay_days as immediate, so pre-migration rows still send', async () => {
    const { fireCampaignEvent } = await import('@/lib/email-campaigns')
    state.campaigns = [{ id: 'c1', template_id: 't1', audience: {} }] // no delay_days
    state.templates = [{ name: 'Welcome', subject: 'Hi', body_json: {} }]
    state.members = [{
      id: 'm1', first_name: 'Mia', last_name: 'M', email: 'mia@example.org',
      membership_id: '1', age_bracket: 'adult', marketing_unsubscribe_token: 'tok',
    }]

    await fireCampaignEvent('member.created', 'm1')

    expect(state.inserts['email_campaign_queue']).toBeUndefined()
    expect(sent).toHaveLength(1)
  })
})

describe('dispatchDueDrips — eligibility is re-checked at send time', () => {
  it('skips a member who left the audience between trigger and due date', async () => {
    const { dispatchDueDrips } = await import('@/lib/email-campaigns')
    state.queueRows = [{ id: 'q1', campaign_id: 'c1', member_id: 'm1', dedup_key: '' }]
    state.campaigns = [{ template_id: 't1', audience: {}, status: 'scheduled' }]
    state.templates = [{ name: 'Step 2', subject: 'Hi', body_json: {} }]
    state.members = [] // unsubscribed / deactivated — resolveAudience returns nothing

    const result = await dispatchDueDrips()

    expect(sent).toHaveLength(0)
    expect(result.skipped).toBe(1)
    const patches = state.updates['email_campaign_queue']
    expect(patches.at(-1)).toMatchObject({ status: 'skipped', note: 'no longer in audience' })
  })

  it('skips queued steps of a campaign that was paused mid-drip', async () => {
    const { dispatchDueDrips } = await import('@/lib/email-campaigns')
    state.queueRows = [{ id: 'q1', campaign_id: 'c1', member_id: 'm1', dedup_key: '' }]
    state.campaigns = [{ template_id: 't1', audience: {}, status: 'paused' }]
    state.members = [{
      id: 'm1', first_name: 'Mia', last_name: 'M', email: 'mia@example.org',
      membership_id: '1', age_bracket: 'adult', marketing_unsubscribe_token: 'tok',
    }]

    const result = await dispatchDueDrips()

    expect(sent).toHaveLength(0)
    expect(result.skipped).toBe(1)
    expect(state.updates['email_campaign_queue'].at(-1)).toMatchObject({ status: 'skipped' })
  })

  it('does not send when another cron tick already claimed the row', async () => {
    const { dispatchDueDrips } = await import('@/lib/email-campaigns')
    state.queueRows = [{ id: 'q1', campaign_id: 'c1', member_id: 'm1', dedup_key: '' }]
    state.campaigns = [{ template_id: 't1', audience: {}, status: 'scheduled' }]
    state.templates = [{ name: 'Step 2', subject: 'Hi', body_json: {} }]
    state.members = [{
      id: 'm1', first_name: 'Mia', last_name: 'M', email: 'mia@example.org',
      membership_id: '1', age_bracket: 'adult', marketing_unsubscribe_token: 'tok',
    }]
    state.claimSucceeds = false // the UPDATE … WHERE status='pending' matched nothing

    const result = await dispatchDueDrips()

    expect(sent).toHaveLength(0)
    expect(result.sent).toBe(0)
  })
})
