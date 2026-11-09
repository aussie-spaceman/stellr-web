// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// S5 B9: the webhook, with the real sync and the real rules. An active rule attaches a
// Stellr Space to every new event. It must not fire for another tenant's event: the
// Space link needs no container, and lib/spaces blanks an event-linked Space's tier and
// role grants for every Stellr member.

const STELLR_SPACE = 'stellr-space-1'

const state = vi.hoisted(() => ({
  mirrorTenant: null as string | null,
  writes: [] as Array<{ op: string; table: string; row: unknown }>,
}))

function fakeDb() {
  const from = (table: string) => {
    let op = 'read'
    const builder: Record<string, unknown> = {}
    const chain = () => builder
    for (const name of ['select', 'eq', 'neq', 'is', 'in', 'limit', 'order']) builder[name] = chain
    for (const name of ['insert', 'update', 'upsert', 'delete']) {
      builder[name] = (row: unknown) => {
        state.writes.push({ op: name, table, row })
        op = 'write'
        return builder
      }
    }
    builder.maybeSingle = async () => {
      if (table === 'events') return { data: state.mirrorTenant ? { tenant_id: state.mirrorTenant } : null, error: null }
      if (table === 'object_type_relations') return { data: { allowed: true }, error: null }
      if (table === 'community_spaces' && op === 'write') return { data: { id: 'event-space' }, error: null }
      return { data: null, error: null }
    }
    builder.then = (resolve: (value: unknown) => unknown) => {
      if (table === 'tier_grant_rules') {
        return resolve({
          data: [{ id: 'r1', name: 'Attach', grant_kind: 'attach_object', grant_object_type: 'space', grant_object_ref: 'stellr-space-1', is_dynamic: false }],
          error: null,
        })
      }
      return resolve({ data: [], error: null })
    }
    return builder
  }
  return { from, rpc: async () => ({ error: null }) }
}

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => fakeDb() }))
vi.mock('@/lib/space-inheritance', () => ({ reconcileEventSpaceRoster: async () => undefined }))
vi.mock('@/lib/container-sync', () => ({ ensureEventContainer: async () => 'container-1' }))
vi.mock('@/lib/survey/distributions', () => ({ ensureDistribution: async () => ({ action: 'scheduled' }) }))
vi.mock('@/lib/survey/events', () => ({ loadSurveyEvent: async () => null }))
vi.mock('@/lib/env-guards', () => ({ isRealProductionApp: () => false }))
vi.mock('@/lib/hubspot-event-options', () => ({ syncEventOptions: async () => ({}) }))
vi.mock('@/lib/events/sync', () => ({ syncEventMirrorSafe: async () => ({ status: 'synced' }) }))

const SECRET = 'top-secret-value'
const { POST } = await import('./route')

function publish() {
  return POST(new Request('https://app.test/api/admin/sanity/event-sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-secret': SECRET },
    body: JSON.stringify({ _id: 'doc1', _type: 'event', slug: { current: 'an-event' }, title: 'An event' }),
  }))
}

const ruleLink = () =>
  state.writes.find((w) => w.table === 'community_space_sources' && (w.row as { space_id?: string }).space_id === STELLR_SPACE)

beforeEach(() => {
  process.env.SANITY_WEBHOOK_SECRET = SECRET
  state.writes = []
  state.mirrorTenant = null
})

describe('POST /api/admin/sanity/event-sync: object_created rules', () => {
  it('fires them for a Stellr event', async () => {
    state.mirrorTenant = STELLR_TENANT_ID
    const res = await publish()

    expect(res.status).toBe(200)
    expect(ruleLink()).toBeDefined()
    expect((await res.json()).rules.applied).toHaveLength(1)
  })

  it('fires them for an event the mirror has no row for yet', async () => {
    const res = await publish()

    expect(res.status).toBe(200)
    expect(ruleLink()).toBeDefined()
  })

  it('does not fire them for another tenant\'s event, and writes no link at all', async () => {
    state.mirrorTenant = '11111111-1111-4111-8111-111111111111'
    const res = await publish()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(state.writes.filter((w) => w.table === 'community_space_sources')).toEqual([])
    expect(json.rules).toEqual({ applied: [], skipped: [] })
    expect(json.eventSpaceId).toBeNull()
  })
})
