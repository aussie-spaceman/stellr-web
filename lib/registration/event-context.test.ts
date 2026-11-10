import { describe, it, expect, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { createRecorder, type DbCall, type DbResult } from '@/test/registration/fixtures'
import { deferredEventContext, resolveRegistrationEvent } from './event-context'
import { eligibilityContextProblem } from './eligibility'

const CANARY = 'c0000000-0000-4000-8000-0000000000aa'
const EVENT = { title: 'Canary Cup', date: '2027-03-12' }
const MIRROR = { tenant_id: CANARY, activity_type: 'live_event', starts_at: '2027-03-12T13:00:00Z', time_zone: 'Australia/Sydney', min_participant_age: null }
const TENANT = { id: CANARY, is_platform_owner: false, min_participant_age: 14 }

function setup(respond: (c: DbCall) => DbResult | undefined) {
  const rec = createRecorder()
  rec.respond(respond)
  return rec
}

const rows = (events: unknown, tenants: unknown = TENANT, error = false) => (c: DbCall): DbResult | undefined => {
  if (c.table === 'events') return error ? { data: null, error: { message: 'down' } } : { data: events, error: null }
  if (c.table === 'tenants') return { data: tenants, error: null }
  return undefined
}

const resolve = (rec: ReturnType<typeof createRecorder>, requestTenantId: string, getEvent = async () => EVENT as typeof EVENT | null) =>
  resolveRegistrationEvent('canary-cup', { db: rec.client(), getEvent, requestTenantId, route: 'test' })

describe('resolveRegistrationEvent (S5 A7)', () => {
  it('a slug the mirror does not hold is Stellr’s, with Stellr’s rules: the CMS date and no floor', async () => {
    const out = await resolve(setup(rows(null)), STELLR_TENANT_ID)
    expect(out).toEqual({
      kind: 'ok',
      event: EVENT,
      context: { tenantId: STELLR_TENANT_ID, isPlatformOwner: true, eligibility: { kind: 'platform_owner', isPlatformOwner: true, tenantId: STELLR_TENANT_ID, eventDate: '2027-03-12' } },
    })
  })

  it('a tenant’s event on its own host gets the tenant’s rules from the mirror and the tenant row', async () => {
    const out = await resolve(setup(rows(MIRROR)), CANARY)
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    expect(out.context).toMatchObject({ tenantId: CANARY, isPlatformOwner: false, eligibility: { kind: 'tenant', tenantMinAge: 14, eventTimeZone: 'Australia/Sydney' } })
  })

  it('an event owned by anyone but the request’s tenant is not found, on either kind of host', async () => {
    expect((await resolve(setup(rows(MIRROR)), STELLR_TENANT_ID)).kind).toBe('not_found')
    expect((await resolve(setup(rows(null)), CANARY)).kind).toBe('not_found')
    expect((await resolve(setup(rows({ ...MIRROR, tenant_id: 'd0000000-0000-4000-8000-0000000000bb' })), CANARY)).kind).toBe('not_found')
  })

  it('a CMS miss is not found and reads nothing else; a CMS throw is unavailable', async () => {
    const rec = setup(rows(MIRROR))
    expect((await resolve(rec, STELLR_TENANT_ID, async () => null)).kind).toBe('not_found')
    expect(rec.log).toEqual([])
    expect((await resolve(rec, STELLR_TENANT_ID, async () => { throw new Error('down') })).kind).toBe('unavailable')
  })

  it('a failed owner read is unavailable, never Stellr', async () => {
    expect((await resolve(setup(rows(null, TENANT, true)), STELLR_TENANT_ID)).kind).toBe('unavailable')
  })

  it('a tenant event whose rules can’t be worked out refuses: no tenant row, a live event with no date, a row claiming the owner flag', async () => {
    expect(await resolve(setup(rows(MIRROR, null)), CANARY)).toEqual({ kind: 'rules_unavailable', detail: 'tenant_missing' })
    expect(await resolve(setup(rows({ ...MIRROR, starts_at: null })), CANARY)).toEqual({ kind: 'rules_unavailable', detail: 'start_date_missing' })
    expect(await resolve(setup(rows(MIRROR, { ...TENANT, is_platform_owner: true })), CANARY)).toEqual({ kind: 'rules_unavailable', detail: 'tenant_mismatch' })
  })
})

describe('resolveRegistrationEvent: the owner by the CMS document (S5 A7)', () => {
  const DOC = { ...EVENT, _id: 'evt-canary' }
  // The mirror after a CMS rename it has not caught up with: the row still holds the
  // old slug, so a read by the new slug finds nothing.
  const renamed = (c: DbCall): DbResult | undefined => {
    if (c.table === 'tenants') return { data: TENANT, error: null }
    if (c.table !== 'events') return undefined
    const bySanityId = c.filters.some(([op, col, v]) => op === 'eq' && col === 'sanity_id' && v === 'evt-canary')
    return { data: bySanityId ? MIRROR : null, error: null }
  }

  it('a tenant’s event renamed in the CMS is still the tenant’s: not found on Stellr’s host, its rules on its own', async () => {
    const onStellr = setup(renamed)
    expect((await resolve(onStellr, STELLR_TENANT_ID, async () => DOC)).kind).toBe('not_found')
    // The row still holds the old slug, so the new slug is read too: nothing holds it,
    // and the trigger keeps the tenant the app supplies, which is the document's.
    expect(onStellr.calls.map((c) => c.filters[0])).toEqual([['eq', 'sanity_id', 'evt-canary'], ['eq', 'slug', 'canary-cup']])
    const own = await resolve(setup(renamed), CANARY, async () => DOC)
    expect(own).toMatchObject({ kind: 'ok', context: { tenantId: CANARY, isPlatformOwner: false } })
  })

  it('a document the mirror does not hold falls back to the slug, and a miss on both is Stellr’s', async () => {
    const rec = setup(rows(null))
    expect((await resolve(rec, STELLR_TENANT_ID, async () => DOC)).kind).toBe('ok')
    expect(rec.calls.map((c) => c.filters[0])).toEqual([['eq', 'sanity_id', 'evt-canary'], ['eq', 'slug', 'canary-cup']])
  })

  it('a failed read by the document is unavailable, never Stellr', async () => {
    expect((await resolve(setup(rows(null, TENANT, true)), STELLR_TENANT_ID, async () => DOC)).kind).toBe('unavailable')
  })

  // public.tenancy_derive_tenant_id stamps registrations and participants from the
  // row found by slug. Where the document's row and the slug's row name different
  // owners, approving under the document's owner would write rows the trigger stamps
  // (or, enforced, refuses) under the slug's: refused, retryably, before any write.
  const disagree = (slugTenant: string) => (c: DbCall): DbResult | undefined => {
    if (c.table === 'tenants') return { data: TENANT, error: null }
    if (c.table !== 'events') return undefined
    const bySanityId = c.filters.some(([op, col]) => op === 'eq' && col === 'sanity_id')
    return {
      data: bySanityId
        ? { ...MIRROR, slug: 'canary-cup-old' }
        : { ...MIRROR, slug: 'canary-cup', tenant_id: slugTenant },
      error: null,
    }
  }

  it('the document’s row and the slug’s row naming different owners: unavailable on every host', async () => {
    for (const host of [STELLR_TENANT_ID, CANARY]) {
      const rec = setup(disagree(STELLR_TENANT_ID))
      expect((await resolve(rec, host, async () => DOC)).kind).toBe('unavailable')
      expect(rec.calls.map((c) => c.filters[0])).toEqual([['eq', 'sanity_id', 'evt-canary'], ['eq', 'slug', 'canary-cup']])
    }
    const rec = setup(disagree('d0000000-0000-4000-8000-0000000000bb'))
    expect((await resolve(rec, CANARY, async () => DOC)).kind).toBe('unavailable')
  })

  it('the two rows agreeing on the owner: the document’s row decides, as before', async () => {
    const own = await resolve(setup(disagree(CANARY)), CANARY, async () => DOC)
    expect(own).toMatchObject({ kind: 'ok', context: { tenantId: CANARY, isPlatformOwner: false } })
  })

  it('a document whose row already holds this slug is one read: the slug’s row is that row', async () => {
    const rec = setup((c) => (c.table === 'events' ? { data: { ...MIRROR, tenant_id: STELLR_TENANT_ID, slug: 'canary-cup' }, error: null } : undefined))
    expect((await resolve(rec, STELLR_TENANT_ID, async () => DOC)).kind).toBe('ok')
    expect(rec.log).toEqual(['select events'])
  })

  it('a draft id is never used: the slug decides', async () => {
    const rec = setup(rows(null))
    await resolve(rec, STELLR_TENANT_ID, async () => ({ ...EVENT, _id: 'drafts.evt-canary' }))
    expect(rec.calls.map((c) => c.filters[0])).toEqual([['eq', 'slug', 'canary-cup']])
  })
})

describe('deferredEventContext (S5 A7)', () => {
  it('on Stellr’s host: Stellr’s rules now, and one owner read, only when confirmed', async () => {
    const rec = setup(rows(null))
    const out = await deferredEventContext(EVENT, 'canary-cup', { db: rec.client(), requestTenantId: STELLR_TENANT_ID, route: 'test' }, () => new Response(null, { status: 404 }))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.owner.eligibility).toMatchObject({ kind: 'platform_owner', eventDate: '2027-03-12' })
    expect(rec.log).toEqual([])
    expect((await out.owner.confirm()).ok).toBe(true)
    await out.owner.confirm()
    expect(rec.log).toEqual(['select events'])
  })

  it('on Stellr’s host, a tenant’s event is refused at confirm with the route’s own answer', async () => {
    const rec = setup(rows(MIRROR))
    const notFound = vi.fn(() => new Response(null, { status: 418 }))
    const out = await deferredEventContext(EVENT, 'canary-cup', { db: rec.client(), requestTenantId: STELLR_TENANT_ID, route: 'test' }, notFound)
    if (!out.ok) throw new Error('expected ok')
    const confirmed = await out.owner.confirm()
    expect(confirmed.ok).toBe(false)
    if (!confirmed.ok) expect(confirmed.response.status).toBe(418)
  })

  it('on a tenant’s host: the owner is read first, and its rules are the tenant’s', async () => {
    const rec = setup(rows(MIRROR))
    const out = await deferredEventContext(EVENT, 'canary-cup', { db: rec.client(), requestTenantId: CANARY, route: 'test' }, () => new Response(null, { status: 404 }))
    expect(rec.log).toEqual(['select events', 'select tenants'])
    if (!out.ok) throw new Error('expected ok')
    expect(out.owner.eligibility).toMatchObject({ kind: 'tenant' })
  })
})

describe('eligibilityContextProblem (S5 A7)', () => {
  const tenant = {
    kind: 'tenant' as const, isPlatformOwner: false as const, tenantId: CANARY,
    tenantMinAge: 14, eventMinAge: null, eventStartsAt: '2027-03-12T13:00:00Z', eventTimeZone: 'Australia/Sydney', activityType: 'live_event',
  }
  it.each([
    ['usable', tenant, null],
    ['an undated campaign', { ...tenant, eventStartsAt: null, activityType: 'campaign' }, null],
    ['a live event with no start date', { ...tenant, eventStartsAt: null }, 'start_date_missing'],
    ['no tenant minimum', { ...tenant, tenantMinAge: null }, 'tenant_missing'],
    ['an unknown time zone', { ...tenant, eventTimeZone: 'Mars/Olympus' }, 'time_zone_invalid'],
    ['an unreadable start', { ...tenant, eventStartsAt: 'soon' }, 'start_date_invalid'],
  ])('%s', (_l, ctx, want) => {
    expect(eligibilityContextProblem(ctx)).toBe(want)
  })
  it('the platform owner needs nothing from the event', () => {
    expect(eligibilityContextProblem({ kind: 'platform_owner', isPlatformOwner: true, tenantId: STELLR_TENANT_ID, eventDate: null })).toBeNull()
  })
})
