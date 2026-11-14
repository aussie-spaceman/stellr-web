// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  MIRROR_DETAIL_FIELDS,
  MIRROR_DETAIL_GAPS,
  TenantRequiredError,
  getEventBySlugForTenant,
  getEventsByIdsForTenant,
  getEventsBySlugsForTenant,
  toEventDetail,
  toEventIdMeta,
  toEventMeta,
  type TenantEventRow,
} from './tenant-repo'
import { toEventRow, type SanityEventDoc } from './sync'

// S5 C8 / C25: the events facade's Postgres door takes an explicit tenant, throws
// without one, filters every query by it, and answers in lib/sanity's shapes.

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const TENANT_B = '22222222-2222-4222-8222-222222222222'
const TENANT_C = '33333333-3333-4333-8333-333333333333'

function row(tenant: string, slug: string, over: Partial<TenantEventRow> = {}): TenantEventRow {
  return {
    tenant_id: tenant,
    slug,
    sanity_id: `${slug}-${tenant.slice(0, 4)}`,
    title: `${slug} for ${tenant.slice(0, 4)}`,
    activity_type: 'live_event',
    starts_at: '2026-12-05T06:00:00.000Z',
    ends_at: '2026-12-06T06:00:00.000Z',
    time_zone: 'America/Chicago',
    country: 'US',
    status: null,
    raw: {},
    ...over,
  }
}

type Filter = { op: 'eq' | 'in'; col: string; val: unknown }

/**
 * A fake supabase-js client whose events table answers from `rows`, applying the
 * eq / in filters it is given (so a missing tenant filter shows up as a leak), and
 * recording each query's filters. `ignoreTenant` drops the tenant_id filter, as a
 * misbehaving view or policy might, to show the getters' own row check.
 */
function fakeDb(rows: TenantEventRow[], opts: { error?: string; ignoreTenant?: boolean } = {}) {
  const queries: { table: string; cols: string; filters: Filter[] }[] = []
  const from = (table: string) => {
    const q = { table, cols: '', filters: [] as Filter[] }
    queries.push(q)
    const result = () => {
      if (opts.error) return { data: null, error: { message: opts.error } }
      const data = rows.filter((r) =>
        q.filters.every((f) => {
          if (opts.ignoreTenant && f.col === 'tenant_id') return true
          const v = (r as unknown as Record<string, unknown>)[f.col]
          return f.op === 'eq' ? v === f.val : (f.val as unknown[]).includes(v)
        }),
      )
      return { data, error: null }
    }
    const builder = {
      select(cols: string) { q.cols = cols; return builder },
      eq(col: string, val: unknown) { q.filters.push({ op: 'eq', col, val }); return builder },
      in(col: string, val: unknown[]) { q.filters.push({ op: 'in', col, val }); return builder },
      async maybeSingle() {
        const r = result()
        if (r.error) return r
        if (r.data!.length > 1) return { data: null, error: { message: 'multiple rows' } }
        return { data: r.data![0] ?? null, error: null }
      },
      then<T>(resolve: (v: ReturnType<typeof result>) => T) { return Promise.resolve(resolve(result())) },
    }
    return builder
  }
  return { db: { from } as unknown as SupabaseClient, queries }
}

const SHARED = [
  row(TENANT_A, 'shared-slug', { title: 'Tenant A event' }),
  row(TENANT_B, 'shared-slug', { title: 'Tenant B event' }),
  row(TENANT_A, 'only-a'),
  row(TENANT_B, 'only-b'),
]

describe('getEventBySlugForTenant', () => {
  it('a slug shared by two tenants resolves only within the tenant passed in', async () => {
    const { db } = fakeDb(SHARED)
    expect(await getEventBySlugForTenant(db, TENANT_A, 'shared-slug')).toMatchObject({ title: 'Tenant A event' })
    expect(await getEventBySlugForTenant(db, TENANT_B, 'shared-slug')).toMatchObject({ title: 'Tenant B event' })
    expect(await getEventBySlugForTenant(db, TENANT_C, 'shared-slug')).toBeNull()
  })

  it("another tenant's slug is a miss, not a fallback", async () => {
    const { db } = fakeDb(SHARED)
    expect(await getEventBySlugForTenant(db, TENANT_A, 'only-b')).toBeNull()
    expect(await getEventBySlugForTenant(db, TENANT_B, 'only-a')).toBeNull()
  })

  it('filters the query by tenant_id and slug, on the events table', async () => {
    const { db, queries } = fakeDb(SHARED)
    await getEventBySlugForTenant(db, TENANT_A, 'only-a')
    expect(queries).toHaveLength(1)
    expect(queries[0].table).toBe('events')
    expect(queries[0].filters).toEqual([
      { op: 'eq', col: 'tenant_id', val: TENANT_A },
      { op: 'eq', col: 'slug', val: 'only-a' },
    ])
  })

  it("drops a row that comes back under another tenant, even if the filter did not hold", async () => {
    const { db } = fakeDb([row(TENANT_B, 'only-b')], { ignoreTenant: true })
    expect(await getEventBySlugForTenant(db, TENANT_A, 'only-b')).toBeNull()
  })

  it('a read error throws rather than reading as no event', async () => {
    const { db } = fakeDb(SHARED, { error: 'boom' })
    await expect(getEventBySlugForTenant(db, TENANT_A, 'only-a')).rejects.toThrow(/events facade read failed: boom/)
  })

  it('a blank slug is a miss with no query', async () => {
    const { db, queries } = fakeDb(SHARED)
    expect(await getEventBySlugForTenant(db, TENANT_A, '')).toBeNull()
    expect(queries).toHaveLength(0)
  })
})

describe('a missing tenant throws, and no query runs', () => {
  const bad: unknown[] = [undefined, null, '', '   ', 0, 'not-a-uuid', 'stellr']
  it.each(bad)('tenant %j', async (tenant) => {
    const { db, queries } = fakeDb(SHARED)
    const t = tenant as string
    await expect(getEventBySlugForTenant(db, t, 'shared-slug')).rejects.toBeInstanceOf(TenantRequiredError)
    await expect(getEventsBySlugsForTenant(db, t, ['shared-slug'])).rejects.toBeInstanceOf(TenantRequiredError)
    await expect(getEventsByIdsForTenant(db, t, ['shared-slug-1111'])).rejects.toBeInstanceOf(TenantRequiredError)
    // Even an empty list throws: a caller with no tenant is a bug whatever it asks for.
    await expect(getEventsBySlugsForTenant(db, t, [])).rejects.toBeInstanceOf(TenantRequiredError)
    expect(queries).toHaveLength(0)
  })
})

describe('getEventsBySlugsForTenant', () => {
  it("returns only the tenant's rows for the slugs asked", async () => {
    const { db, queries } = fakeDb(SHARED)
    const got = await getEventsBySlugsForTenant(db, TENANT_A, ['shared-slug', 'only-a', 'only-b', 'nope'])
    expect(got.map((e) => e.title).sort()).toEqual(['Tenant A event', `only-a for ${TENANT_A.slice(0, 4)}`].sort())
    expect(queries[0].filters[0]).toEqual({ op: 'eq', col: 'tenant_id', val: TENANT_A })
    expect(queries[0].filters[1]).toMatchObject({ op: 'in', col: 'slug' })
  })

  it("drops another tenant's rows even if the filter did not hold", async () => {
    const { db } = fakeDb(SHARED, { ignoreTenant: true })
    const got = await getEventsBySlugsForTenant(db, TENANT_B, ['shared-slug', 'only-a'])
    expect(got.map((e) => e.title)).toEqual(['Tenant B event'])
  })

  it('an empty list answers [] with no query, as lib/sanity does', async () => {
    const { db, queries } = fakeDb(SHARED)
    expect(await getEventsBySlugsForTenant(db, TENANT_A, [])).toEqual([])
    expect(await getEventsBySlugsForTenant(db, TENANT_A, ['', ''])).toEqual([])
    expect(queries).toHaveLength(0)
  })

  it('a long list reads in chunks, each filtered by tenant', async () => {
    const many = Array.from({ length: 250 }, (_, i) => row(TENANT_A, `slug-${i}`))
    const { db, queries } = fakeDb([...many, row(TENANT_B, 'slug-7')])
    const got = await getEventsBySlugsForTenant(db, TENANT_A, many.map((r) => r.slug))
    expect(got).toHaveLength(250)
    expect(queries).toHaveLength(3)
    for (const q of queries) expect(q.filters[0]).toEqual({ op: 'eq', col: 'tenant_id', val: TENANT_A })
  })

  it('a read error throws', async () => {
    const { db } = fakeDb(SHARED, { error: 'down' })
    await expect(getEventsBySlugsForTenant(db, TENANT_A, ['only-a'])).rejects.toThrow(/down/)
  })
})

describe('getEventsByIdsForTenant', () => {
  it("matches the CMS document id (sanity_id) within the tenant only", async () => {
    const { db, queries } = fakeDb(SHARED)
    const ids = SHARED.map((r) => r.sanity_id)
    const got = await getEventsByIdsForTenant(db, TENANT_B, ids)
    expect(got.map((e) => e._id).sort()).toEqual(SHARED.filter((r) => r.tenant_id === TENANT_B).map((r) => r.sanity_id).sort())
    expect(queries[0].filters).toEqual([
      { op: 'eq', col: 'tenant_id', val: TENANT_B },
      { op: 'in', col: 'sanity_id', val: ids },
    ])
  })

  it('returns the getEventsByIds projection only: no endDate or setting', async () => {
    const r = row(TENANT_A, 'multi', { ends_at: '2026-12-08T06:00:00.000Z', raw: { setting: 'virtual' } })
    const { db } = fakeDb([r])
    const [got] = await getEventsByIdsForTenant(db, TENANT_A, [r.sanity_id])
    expect(got).toEqual({ _id: r.sanity_id, title: r.title, slug: { current: 'multi' }, activityType: 'live_event', date: '2026-12-05' })
  })

  it('an empty list answers [] with no query', async () => {
    const { db, queries } = fakeDb(SHARED)
    expect(await getEventsByIdsForTenant(db, TENANT_A, [])).toEqual([])
    expect(queries).toHaveLength(0)
  })
})

// ── Shape adapter, against fixture rows the mirror writer itself produces ─────

const NOW = new Date('2026-11-14T00:00:00Z')

/** A mirror row exactly as lib/events/sync.ts's toEventRow writes it for `doc`. */
function mirrored(doc: SanityEventDoc, tenantId = TENANT_A): TenantEventRow {
  const r = toEventRow(doc, { tenantId, currency: 'usd' }, NOW)
  if (!r) throw new Error('fixture did not map')
  return { ...r, raw: r.raw }
}

const TEXAS_DOC: SanityEventDoc = {
  _id: 'evt-texas',
  _updatedAt: '2026-11-01T00:00:00Z',
  title: 'Texas Space Settlement Design',
  slug: 'texas-ssdc',
  activityType: 'live_event',
  type: 'competition',
  gradeLevel: '9-12',
  gradeMin: 9,
  gradeMax: 12,
  date: '2027-02-12',
  endDate: '2027-02-14',
  startTime: '08:30',
  endTime: '17:00',
  setting: 'in_person',
  venue: 'Placeholder Hall',
  city: 'Houston',
  state: 'TX',
  status: 'scheduled',
  registrationOpen: true,
  registrationOpenDate: '2026-10-01',
  registrationCloseDate: '2027-01-31',
  capacity: 120,
}

describe('toEventDetail', () => {
  it("maps a synced row to getEventBySlug's fields, as Sanity holds them", () => {
    expect(toEventDetail(mirrored(TEXAS_DOC))).toEqual({
      _id: 'evt-texas',
      title: 'Texas Space Settlement Design',
      slug: { current: 'texas-ssdc' },
      type: 'competition',
      gradeLevel: '9-12',
      gradeMin: 9,
      gradeMax: 12,
      date: '2027-02-12',
      endDate: '2027-02-14',
      activityType: 'live_event',
      setting: 'in_person',
      venue: 'Placeholder Hall',
      city: 'Houston',
      state: 'TX',
      registrationOpen: true,
      registrationOpenDate: '2026-10-01',
      registrationCloseDate: '2027-01-31',
      capacity: 120,
      startTime: '08:30',
      endTime: '17:00',
      status: 'scheduled',
    })
  })

  it('a one-day event has no endDate, as in Sanity', () => {
    const got = toEventDetail(mirrored({ ...TEXAS_DOC, endDate: undefined }))
    expect(got.date).toBe('2027-02-12')
    expect(got).not.toHaveProperty('endDate')
  })

  it('a US event with no CMS country answers unset; elsewhere the country is kept', () => {
    expect(toEventDetail(mirrored(TEXAS_DOC))).not.toHaveProperty('country')
    const au = toEventDetail(mirrored({ ...TEXAS_DOC, _id: 'evt-au', slug: 'au', state: 'NSW', country: 'AU' }))
    expect(au.country).toBe('AU')
  })

  it('an undated campaign maps with its campaign fields and no dates', () => {
    const got = toEventDetail(
      mirrored({ _id: 'cmp-1', slug: 'fall-campaign', title: 'Fall Campaign', activityType: 'campaign', season: 'fall', campaignYear: 2027, deadline: '2026-12-01' }),
    )
    expect(got).toEqual({
      _id: 'cmp-1',
      title: 'Fall Campaign',
      slug: { current: 'fall-campaign' },
      activityType: 'campaign',
      season: 'fall',
      campaignYear: 2027,
      deadline: '2026-12-01',
    })
  })

  it("a tenant's row with no CMS document behind it maps from the typed columns alone", () => {
    const got = toEventDetail(
      row(TENANT_B, 'tenant-only', {
        title: 'Tenant-only event',
        starts_at: '2027-03-05T13:00:00.000Z', // local midnight, Sydney (UTC+11)
        ends_at: '2027-03-07T13:00:00.000Z',
        time_zone: 'Australia/Sydney',
        country: 'AU',
        status: 'postponed',
        raw: {},
      }),
    )
    expect(got).toEqual({
      _id: `tenant-only-${TENANT_B.slice(0, 4)}`,
      title: 'Tenant-only event',
      slug: { current: 'tenant-only' },
      date: '2027-03-06',
      endDate: '2027-03-07',
      activityType: 'live_event',
      country: 'AU',
      status: 'postponed',
    })
  })

  it('typed columns win over raw, and a status outside the union is dropped', () => {
    const r = mirrored(TEXAS_DOC)
    const got = toEventDetail({ ...r, title: 'Renamed in Postgres', status: 'archived' })
    expect(got.title).toBe('Renamed in Postgres')
    expect(got).not.toHaveProperty('status')
  })

  it('never returns a field the mirror lacks, even if raw carries one', () => {
    const r = mirrored(TEXAS_DOC)
    const got = toEventDetail({ ...r, raw: { ...r.raw, stripePriceId: 'price_placeholder', description: 'x', tagline: 'y' } })
    for (const gap of MIRROR_DETAIL_GAPS) expect(got, gap).not.toHaveProperty(gap)
    for (const k of Object.keys(got)) expect(MIRROR_DETAIL_FIELDS as readonly string[], k).toContain(k)
  })

  it('survives a null or non-object raw', () => {
    expect(toEventDetail({ ...row(TENANT_A, 'x'), raw: null })).toMatchObject({ slug: { current: 'x' }, date: '2026-12-05' })
  })
})

describe('toEventMeta and toEventIdMeta', () => {
  it("map a synced row to getEventsBySlugs' and getEventsByIds' fields", () => {
    const r = mirrored(TEXAS_DOC)
    expect(toEventMeta(r)).toEqual({
      _id: 'evt-texas',
      title: 'Texas Space Settlement Design',
      slug: { current: 'texas-ssdc' },
      activityType: 'live_event',
      date: '2027-02-12',
      endDate: '2027-02-14',
      setting: 'in_person',
    })
    expect(toEventIdMeta(r)).toEqual({
      _id: 'evt-texas',
      title: 'Texas Space Settlement Design',
      slug: { current: 'texas-ssdc' },
      activityType: 'live_event',
      date: '2027-02-12',
    })
  })
})

// ── The typed contract, held against lib/sanity.ts's own projections ─────────

/** The top-level field names of the GROQ projection in lib/sanity.ts's `fn`. */
function projectionFields(fn: string): string[] {
  const src = readFileSync('lib/sanity.ts', 'utf8')
  const start = src.indexOf(`export async function ${fn}(`)
  expect(start, fn).toBeGreaterThan(-1)
  const body = src.slice(start, src.indexOf('\n}\n', start))
  const open = body.indexOf('{', body.indexOf('*[_type == "event"'))
  let depth = 0
  let end = open
  for (let i = open; i < body.length; i++) {
    if (body[i] === '{') depth++
    if (body[i] === '}' && --depth === 0) { end = i; break }
  }
  let proj = body.slice(open + 1, end).replace(/\/\/[^\n]*/g, '')
  while (/\{[^{}]*\}/.test(proj)) proj = proj.replace(/\{[^{}]*\}/g, '')
  return proj
    .split(',')
    .map((s) => s.trim().match(/^"?([A-Za-z_][A-Za-z0-9_]*)/)?.[1])
    .filter((s): s is string => Boolean(s))
    .sort()
}

describe('the adapter contract matches lib/sanity.ts', () => {
  it("every getEventBySlug field is either mapped or a listed gap, and none is both", () => {
    const mapped = new Set<string>(MIRROR_DETAIL_FIELDS)
    for (const g of MIRROR_DETAIL_GAPS) expect(mapped.has(g), g).toBe(false)
    expect(projectionFields('getEventBySlug')).toEqual([...MIRROR_DETAIL_FIELDS, ...MIRROR_DETAIL_GAPS].sort())
  })

  it("getEventsBySlugs' projection is exactly what toEventMeta can fill", () => {
    expect(projectionFields('getEventsBySlugs')).toEqual(['_id', 'activityType', 'date', 'endDate', 'setting', 'slug', 'title'])
  })

  it("getEventsByIds' projection is exactly what toEventIdMeta fills", () => {
    expect(projectionFields('getEventsByIds')).toEqual(Object.keys(toEventIdMeta(mirrored(TEXAS_DOC))).sort())
  })
})

describe('the Postgres door', () => {
  const src = readFileSync('lib/events/tenant-repo.ts', 'utf8')
  const specs = [...src.matchAll(/(?:from\s+|import\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1])

  it('brings no client of its own and does not go through the Sanity-only facade', () => {
    expect(specs.sort()).toEqual(['@/lib/sanity', '@/lib/survey/timezone', '@supabase/supabase-js'])
    expect(src).not.toMatch(/supabaseServer|createClient|SUPABASE_SERVICE_ROLE/)
    // lib/sanity and supabase-js are type-only imports: nothing from either loads at runtime.
    expect(src).toMatch(/^import type \{ SupabaseClient \} from '@supabase\/supabase-js'$/m)
    expect(src).toMatch(/^import type \{ EventMeta, StellarEvent \} from '@\/lib\/sanity'$/m)
  })

  it('only reads', () => {
    expect(src).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/)
  })
})
