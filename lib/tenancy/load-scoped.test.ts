import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const captureRequestError = vi.fn(async (..._args: unknown[]) => {})
vi.mock('@/lib/app-errors', () => ({ captureRequestError: (...a: unknown[]) => captureRequestError(...a) }))

import {
  isKey,
  isUuid,
  loadScoped,
  loadScopedMode,
  planScope,
  registryKey,
  scopedQuery,
  stripScopeEmbed,
  SCOPE_EMBED_ALIAS,
  VIA_PARENT_WITHOUT_FK,
  type ScopedDb,
  type ScopedFilterBuilder,
  type ShadowMismatch,
} from './load-scoped'
import { makeScope, stellrScope, isStellrScope, isEventScoped, type ScopeContext } from './scope-context'
import { STELLR_TENANT_ID } from './constants'
import { TABLE_REGISTRY } from './registry'
import { TenantContextError } from './tenant-id'

// ── An in-memory stand-in for the supabase-js calls loadScoped makes ─────────
// Supports select (with one `alias:parent!inner(cols)` embed), eq, in, or
// (plain and referencedTable) and maybeSingle. Unknown operators throw, so a
// test cannot pass by accident.

type Row = Record<string, unknown>
type Pred = (row: Row, embed: Row | null) => boolean

const CANARY = '00000000-0000-4000-8000-0000000000c1'
const STAFF = { kind: 'staff' as const, memberId: 'm-staff' }

/** child table -> parent table -> FK column on the child. */
const FKS: Record<string, Record<string, string>> = {
  participants: { registrations: 'registration_id' },
}

function fakeDb(tables: Record<string, Row[]>) {
  const calls: { table: string; schema: string; select: string; ops: string[] }[] = []
  const tableSource = (schema: string) => ({
    from(table: string) {
      return {
        select(select: string): ScopedFilterBuilder {
          const call = { table, schema, select, ops: [] as string[] }
          calls.push(call)
          const preds: Pred[] = []
          const m = /,?(\w+):(\w+)!inner\(([^)]*)\)/.exec(select)
          const embed = m ? { alias: m[1], parent: m[2] } : null
          const valueOf = (row: Row, e: Row | null, col: string) => {
            if (embed && col.startsWith(`${embed.alias}.`)) return e?.[col.slice(embed.alias.length + 1)]
            if (col.includes('.')) throw new Error(`fake: filter on unknown embed ${col}`)
            return row[col]
          }
          const parseOr = (expr: string): ((r: Row) => boolean) => {
            const clauses = expr.split(',').map((c) => {
              const [col, op, ...rest] = c.split('.')
              const v = rest.join('.')
              if (op === 'eq') return (r: Row) => r[col] === v
              if (op === 'is' && v === 'null') return (r: Row) => r[col] == null
              throw new Error(`fake: unsupported or ${c}`)
            })
            return (r) => clauses.some((f) => f(r))
          }
          const builder: ScopedFilterBuilder = {
            eq(col, v) {
              call.ops.push(`eq:${col}=${String(v)}`)
              preds.push((r, e) => valueOf(r, e, col) === v)
              return builder
            },
            in(col, vs) {
              call.ops.push(`in:${col}=(${vs.join(',')})`)
              preds.push((r, e) => vs.includes(valueOf(r, e, col)))
              return builder
            },
            or(expr, o) {
              call.ops.push(`or:${o?.referencedTable ? `${o.referencedTable}:` : ''}${expr}`)
              const f = parseOr(expr)
              if (o?.referencedTable) {
                if (!embed || o.referencedTable !== embed.alias) throw new Error('fake: or on unknown referencedTable')
                preds.push((_r, e) => e !== null && f(e))
              } else preds.push((r) => f(r))
              return builder
            },
            maybeSingle() {
              const rows = (tables[table] ?? [])
                .map((r) => {
                  let e: Row | null = null
                  if (embed) {
                    const fk = FKS[table]?.[embed.parent]
                    if (!fk) throw new Error(`fake: no FK ${table} -> ${embed.parent}`)
                    e = (tables[embed.parent] ?? []).find((p) => p.id === r[fk]) ?? null
                  }
                  return { r, e }
                })
                .filter(({ r, e }) => (!embed || e !== null) && preds.every((p) => p(r, e)))
              if (rows.length > 1) return Promise.resolve({ data: null, error: { message: 'multiple rows' } })
              if (rows.length === 0) return Promise.resolve({ data: null, error: null })
              const { r, e } = rows[0]
              const out: Row = { ...r }
              if (embed && e) out[embed.alias] = { tenant_id: e.tenant_id, event_slug: e.event_slug }
              return Promise.resolve({ data: out, error: null })
            },
            then(onF, onR) {
              return Promise.resolve({ data: [], error: null }).then(onF, onR)
            },
          }
          return builder
        },
      }
    },
  })
  const db: ScopedDb = { ...tableSource('public'), schema: (s: string) => tableSource(s) }
  return { db, calls }
}

const ID = {
  stellrReg: '11111111-1111-4111-8111-111111111111',
  stellrRegOtherEvent: '22222222-2222-4222-8222-222222222222',
  canaryReg: '33333333-3333-4333-8333-333333333333',
  nullReg: '44444444-4444-4444-8444-444444444444',
  missing: '55555555-5555-4555-8555-555555555555',
  stellrPart: '66666666-6666-4666-8666-666666666666',
  canaryPart: '77777777-7777-4777-8777-777777777777',
  member: '88888888-8888-4888-8888-888888888888',
}

function seed() {
  return {
    registrations: [
      { id: ID.stellrReg, tenant_id: STELLR_TENANT_ID, event_slug: 'nevada', team: 'A' },
      { id: ID.stellrRegOtherEvent, tenant_id: STELLR_TENANT_ID, event_slug: 'colorado', team: 'B' },
      { id: ID.canaryReg, tenant_id: CANARY, event_slug: 'canary-cup', team: 'C' },
      { id: ID.nullReg, tenant_id: null, event_slug: 'nevada', team: 'N' },
    ],
    participants: [
      { id: ID.stellrPart, registration_id: ID.stellrReg, first_name: 'S' },
      { id: ID.canaryPart, registration_id: ID.canaryReg, first_name: 'C' },
    ],
    members: [{ id: ID.member, first_name: 'M' }],
    events: [
      { id: ID.stellrReg, tenant_id: STELLR_TENANT_ID, slug: 'nevada' },
      { id: ID.canaryReg, tenant_id: CANARY, slug: 'canary-cup' },
    ],
  }
}

const notFound = () =>
  new Response(JSON.stringify({ error: 'Registration not found' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  })

async function bytes(res: Response) {
  return { status: res.status, headers: [...res.headers.entries()], body: await res.text() }
}

const stellr = stellrScope(STAFF, null)
const canary = makeScope({ tenantId: CANARY, eventSlugs: null, actor: { kind: 'tenant_admin', memberId: 'm-canary' } })
const nevadaManager = stellrScope({ kind: 'event_manager', memberId: 'm-em' }, ['nevada'])

beforeEach(() => {
  captureRequestError.mockClear()
})

// ── Mode ─────────────────────────────────────────────────────────────────────

describe('loadScopedMode', () => {
  it('defaults to off and reads off/shadow/enforce case-insensitively', () => {
    expect(loadScopedMode({})).toBe('off')
    expect(loadScopedMode({ LOADSCOPED_MODE: '' })).toBe('off')
    expect(loadScopedMode({ LOADSCOPED_MODE: 'shadow' })).toBe('shadow')
    expect(loadScopedMode({ LOADSCOPED_MODE: ' Enforce ' })).toBe('enforce')
    expect(loadScopedMode({ LOADSCOPED_MODE: 'off' })).toBe('off')
  })
  it('treats an unrecognised value as off, so a typo never changes behaviour', () => {
    expect(loadScopedMode({ LOADSCOPED_MODE: 'enforced' })).toBe('off')
    expect(loadScopedMode({ LOADSCOPED_MODE: 'true' })).toBe('off')
  })
  it('reads process.env by default', () => {
    vi.stubEnv('LOADSCOPED_MODE', 'shadow')
    try {
      expect(loadScopedMode()).toBe('shadow')
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

// ── ScopeContext ─────────────────────────────────────────────────────────────

describe('ScopeContext', () => {
  it('stellrScope is tenant #1 and frozen', () => {
    expect(stellr.tenantId).toBe(STELLR_TENANT_ID)
    expect(stellr.eventSlugs).toBeNull()
    expect(isStellrScope(stellr)).toBe(true)
    expect(isEventScoped(stellr)).toBe(false)
    expect(Object.isFrozen(stellr)).toBe(true)
    expect(Object.isFrozen(stellr.actor)).toBe(true)
    expect(isStellrScope(canary)).toBe(false)
  })
  it('lower-cases the tenant id and de-duplicates event slugs', () => {
    const s = makeScope({ tenantId: CANARY.toUpperCase(), eventSlugs: ['a', 'a', 'b'], actor: { kind: 'staff' } })
    expect(s.tenantId).toBe(CANARY)
    expect(s.eventSlugs).toEqual(['a', 'b'])
    expect(Object.isFrozen(s.eventSlugs)).toBe(true)
    expect(s.actor.memberId).toBeNull()
    expect(isEventScoped(s)).toBe(true)
  })
  it('refuses a bad tenant, actor or event list', () => {
    expect(() => makeScope({ tenantId: 'nope', eventSlugs: null, actor: { kind: 'staff' } })).toThrow(TenantContextError)
    expect(() => makeScope({ tenantId: undefined, eventSlugs: null, actor: { kind: 'staff' } })).toThrow(TenantContextError)
    expect(() => makeScope({ tenantId: CANARY, eventSlugs: null, actor: { kind: 'root' } })).toThrow(/actor kind/)
    expect(() => makeScope({ tenantId: CANARY, eventSlugs: null, actor: { kind: 'staff', memberId: '' } })).toThrow(/memberId/)
    expect(() => makeScope({ tenantId: CANARY, eventSlugs: null, actor: { kind: 'staff', memberId: 7 } })).toThrow(/memberId/)
    expect(() => makeScope({ tenantId: CANARY, eventSlugs: [''], actor: { kind: 'staff' } })).toThrow(/eventSlugs/)
    expect(() => makeScope({ tenantId: CANARY, eventSlugs: [3], actor: { kind: 'staff' } })).toThrow(/eventSlugs/)
    expect(() =>
      makeScope({ tenantId: CANARY, eventSlugs: 'nevada' as unknown as string[], actor: { kind: 'staff' } }),
    ).toThrow(/array/)
  })
  it('an event manager must list their events; an empty list stays empty', () => {
    expect(() => makeScope({ tenantId: CANARY, eventSlugs: null, actor: { kind: 'event_manager' } })).toThrow(/must list/)
    const none = makeScope({ tenantId: CANARY, eventSlugs: [], actor: { kind: 'event_manager' } })
    expect(none.eventSlugs).toEqual([])
  })
  it('an omitted event list is refused, never read as every event', () => {
    const noList = { tenantId: CANARY, actor: { kind: 'staff' } } as unknown as Parameters<typeof makeScope>[0]
    expect(() => makeScope(noList)).toThrow(/must be listed/)
    expect(() => stellrScope(STAFF, undefined as unknown as null)).toThrow(/must be listed/)
    expect(stellrScope(STAFF, null).eventSlugs).toBeNull()
  })
  it('an event slug cannot carry PostgREST list syntax', () => {
    for (const bad of ['x",other-event,"y', 'a,b', 'a b', '(a)', 'x'.repeat(201)]) {
      expect(() => makeScope({ tenantId: CANARY, eventSlugs: [bad], actor: { kind: 'staff' } })).toThrow(/event slugs/)
    }
    expect(makeScope({ tenantId: CANARY, eventSlugs: ['nevada-2026.a_b:c'], actor: { kind: 'staff' } }).eventSlugs).toEqual([
      'nevada-2026.a_b:c',
    ])
  })
  it('a look-alike object is refused, in every mode', async () => {
    const forged = { tenantId: STELLR_TENANT_ID, eventSlugs: null, actor: STAFF } as ScopeContext
    const { db, calls } = fakeDb(seed())
    const legacy = vi.fn(async () => ({ data: { id: ID.member }, error: null }))
    expect(() => planScope(forged, 'registrations')).toThrow(/makeScope/)
    expect(() => scopedQuery(forged, 'registrations', { db })).toThrow(/makeScope/)
    for (const mode of ['off', 'shadow', 'enforce'] as const) {
      await expect(loadScoped(forged, 'registrations', ID.stellrReg, { db, notFound, mode, legacy })).rejects.toThrow(/makeScope/)
    }
    expect(legacy).not.toHaveBeenCalled()
    expect(calls).toHaveLength(0)
  })
})

// ── Ids and planning ─────────────────────────────────────────────────────────

describe('ids', () => {
  it('isUuid and isKey', () => {
    expect(isUuid(ID.stellrReg)).toBe(true)
    expect(isUuid(ID.stellrReg.toUpperCase())).toBe(true)
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(isUuid(`${ID.stellrReg} `)).toBe(false)
    expect(isUuid(42)).toBe(false)
    expect(isKey('nevada-2026')).toBe(true)
    expect(isKey('')).toBe(false)
    expect(isKey('a,b')).toBe(false)
    expect(isKey('x'.repeat(201))).toBe(false)
    expect(isKey(null)).toBe(false)
  })
  it('registryKey defaults to public', () => {
    expect(registryKey('registrations')).toBe('public.registrations')
    expect(registryKey(' entitlements.tiers ')).toBe('entitlements.tiers')
  })
})

describe('planScope', () => {
  it('fails closed on an unknown table', () => {
    expect(() => planScope(stellr, 'no_such_table')).toThrow(TenantContextError)
  })
  it('derived: tenant filter plus the NULL fallback only in Stellr scope and log mode', () => {
    expect(planScope(stellr, 'registrations').tenant).toEqual({ column: 'tenant_id', value: STELLR_TENANT_ID, includeNull: true })
    expect(planScope(stellr, 'registrations', { derivationMode: 'enforce' }).tenant?.includeNull).toBe(false)
    expect(planScope(canary, 'registrations').tenant).toEqual({ column: 'tenant_id', value: CANARY, includeNull: false })
  })
  it('own tables never take the NULL fallback (tenant_id is NOT NULL)', () => {
    const p = planScope(stellr, 'events')
    expect(p.tenant?.includeNull).toBe(false)
    expect(p.event).toBeNull()
  })
  it('event-scoped callers filter on the event key', () => {
    expect(planScope(nevadaManager, 'registrations').event).toEqual({ column: 'event_slug', values: ['nevada'] })
    expect(planScope(nevadaManager, 'events').event).toEqual({ column: 'slug', values: ['nevada'] })
    expect(planScope(nevadaManager, 'participants').event).toEqual({ column: 'event_slug', values: ['nevada'] })
  })
  it('an event-scoped caller cannot reach tenant-wide, Sanity-keyed or unscoped tables', () => {
    expect(() => planScope(nevadaManager, 'tenant_memberships')).toThrow(/tenant-wide/)
    expect(() => planScope(nevadaManager, 'community_spaces')).toThrow(/Sanity id/)
    expect(() => planScope(nevadaManager, 'members')).toThrow(/no event key/)
  })
  it('via_parent: an inner embed of the parent carries the filters', () => {
    const p = planScope(canary, 'participants')
    expect(p.target).toBe('parent')
    expect(p.embed).toEqual({ alias: SCOPE_EMBED_ALIAS, parent: 'registrations', columns: 'tenant_id,event_slug' })
    expect(p.tenant?.includeNull).toBe(false)
    expect(planScope(stellr, 'participants').tenant?.includeNull).toBe(true)
    expect(planScope(stellr, 'participants', { derivationMode: 'enforce' }).tenant?.includeNull).toBe(false)
  })
  it('identity, stellr_only, platform and system tables: Stellr only', () => {
    for (const t of ['members', 'community_posts', 'schools', 'cron_runs', 'entitlements.tiers']) {
      expect(() => planScope(canary, t)).toThrow(TenantContextError)
      const p = planScope(stellr, t)
      expect(p.tenant).toBeNull()
      expect(p.event).toBeNull()
    }
    expect(planScope(stellr, 'entitlements.tiers').schema).toBe('entitlements')
  })
  it('an empty event list reaches nothing', () => {
    const none = makeScope({ tenantId: STELLR_TENANT_ID, eventSlugs: [], actor: { kind: 'event_manager' } })
    expect(planScope(none, 'registrations').reachesNothing).toBe(true)
    expect(planScope(none, 'participants').reachesNothing).toBe(true)
    expect(planScope(nevadaManager, 'registrations').reachesNothing).toBe(false)
  })
  it('wrapped data keys are never planned, for any actor or tenant', () => {
    for (const kind of ['staff', 'tenant_admin', 'platform_admin', 'system'] as const) {
      expect(() => planScope(stellrScope({ kind, memberId: null }, null), 'tenant_data_keys')).toThrow(/never read/)
    }
    expect(() => planScope(canary, 'tenant_data_keys')).toThrow(/never read/)
  })
  it('the platform audit and admin tables need a platform actor in Stellr scope', () => {
    for (const t of ['platform_admins', 'platform_audit_events']) {
      for (const kind of ['staff', 'tenant_admin'] as const) {
        expect(() => planScope(stellrScope({ kind, memberId: null }, null), t)).toThrow(/platform actor/)
      }
      for (const kind of ['platform_admin', 'system'] as const) {
        expect(planScope(stellrScope({ kind, memberId: null }, null), t).tenant).toBeNull()
      }
      expect(() => planScope(makeScope({ tenantId: CANARY, eventSlugs: null, actor: { kind: 'platform_admin' } }), t)).toThrow(
        /only Stellr scope/,
      )
    }
  })
})

describe('child tables and the real schema', () => {
  const dir = path.join(process.cwd(), 'supabase')
  const sql = [
    path.join(dir, 'baseline.sql'),
    ...fs.readdirSync(path.join(dir, 'migrations')).sort().map((f) => path.join(dir, 'migrations', f)),
  ]
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n')
  // Tables since renamed: the foreign key was declared under the old name.
  const OLD_NAME: Record<string, string> = { agreement_recipients: 'docusign_envelope_recipients', agreements: 'docusign_envelopes' }
  const qualified = (t: string) => `("?public"?\\.)?"?${t}"?`
  function foreignKeys(child: string, parent: string): number {
    const c = qualified(OLD_NAME[child] ?? child)
    // A table created after the rename references the parent by its new name.
    const parentNames = [...new Set([OLD_NAME[parent] ?? parent, parent])].map(qualified).join('|')
    const ref = `REFERENCES\\s+(?:${parentNames})\\b`
    const created = new RegExp(`CREATE TABLE (IF NOT EXISTS )?${c}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i').exec(sql)
    const inline = (created?.at(-1)?.match(new RegExp(ref, 'gi')) ?? []).length
    const altered = (sql.match(new RegExp(`ALTER TABLE (ONLY )?${c}\\s+ADD CONSTRAINT[^;]*?${ref}`, 'gi')) ?? []).length
    return inline + altered
  }
  const children = Object.entries(TABLE_REGISTRY).filter(([, e]) => e.tenantColumn === 'inherited')
  const short = (k: string) => k.replace(/^public\./, '')

  // Exactly one matters beyond this file: a second foreign key between the same two
  // tables makes PostgREST refuse every live embed of them that names no hint
  // (PGRST201), so the composite foreign key cannot simply be added beside this one.
  it('all 11 either embed through exactly one foreign key or are listed as having none', () => {
    expect(children).toHaveLength(11)
    expect(new Set(children.filter(([, e]) => e.noForeignKey).map(([k]) => k))).toEqual(VIA_PARENT_WITHOUT_FK)
    for (const [key, entry] of children) {
      const fks = foreignKeys(short(key), short(entry.parent!))
      if (VIA_PARENT_WITHOUT_FK.has(key)) {
        expect([key, fks]).toEqual([key, 0])
        expect(() => planScope(stellr, key)).toThrow(/no foreign key/)
      } else {
        expect([key, fks]).toEqual([key, 1])
        expect(planScope(canary, key).embed?.parent).toBe(short(entry.parent!))
      }
    }
  })
})

// ── The real supabase-js client: the query string and error shape PostgREST sees ─

describe('loadScoped through the real supabase-js client (no network)', () => {
  function client(respond: () => Response = () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })) {
    const urls: URL[] = []
    const db = createClient('http://localhost:54321', 'test-key', {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: crypto.randomUUID() },
      global: {
        fetch: (async (input: RequestInfo | URL) => {
          urls.push(new URL(String(input)))
          return respond()
        }) as typeof fetch,
      },
    })
    return { db, urls }
  }

  it('sends the tenant filter on the row, with the NULL fallback only for Stellr', async () => {
    const { db, urls } = client()
    await loadScoped(canary, 'registrations', ID.canaryReg, { db, notFound, mode: 'enforce' })
    await loadScoped(stellr, 'registrations', ID.stellrReg, { db, notFound, mode: 'enforce' })
    expect(urls[0].pathname).toBe('/rest/v1/registrations')
    expect(urls[0].searchParams.get('id')).toBe(`eq.${ID.canaryReg}`)
    expect(urls[0].searchParams.get('tenant_id')).toBe(`eq.${CANARY}`)
    expect(urls[0].searchParams.get('or')).toBeNull()
    expect(urls[1].searchParams.get('or')).toBe(`(tenant_id.eq.${STELLR_TENANT_ID},tenant_id.is.null)`)
    expect(urls[1].searchParams.get('tenant_id')).toBeNull()
  })

  it('sends the via_parent filters against the aliased inner embed', async () => {
    const { db, urls } = client()
    await loadScoped(canary, 'participants', ID.canaryPart, { db, notFound, mode: 'enforce' })
    await loadScoped(nevadaManager, 'participants', ID.stellrPart, { db, notFound, mode: 'enforce', select: 'id' })
    expect(urls[0].searchParams.get('select')).toBe(`*,${SCOPE_EMBED_ALIAS}:registrations!inner(tenant_id,event_slug)`)
    expect(urls[0].searchParams.get(`${SCOPE_EMBED_ALIAS}.tenant_id`)).toBe(`eq.${CANARY}`)
    expect(urls[1].searchParams.get(`${SCOPE_EMBED_ALIAS}.or`)).toBe(`(tenant_id.eq.${STELLR_TENANT_ID},tenant_id.is.null)`)
    expect(urls[1].searchParams.get(`${SCOPE_EMBED_ALIAS}.event_slug`)).toBe('in.(nevada)')
  })

  it('a value the column type cannot hold (22P02) is notFound, not an error', async () => {
    const { db } = client(
      () => new Response(JSON.stringify({ code: '22P02', message: 'invalid input syntax for type uuid', details: null, hint: null }), { status: 400 }),
    )
    const r = await loadScoped(stellr, 'participants', 'abc', { db, notFound, mode: 'enforce', idColumn: 'registration_id' })
    if (r.ok || !r.response) throw new Error('expected a notFound response')
    expect(await bytes(r.response)).toEqual(await bytes(notFound()))
  })

  it('any other database error still reaches the route', async () => {
    const { db } = client(
      () => new Response(JSON.stringify({ code: 'PGRST200', message: 'no relationship', details: null, hint: null }), { status: 400 }),
    )
    const r = await loadScoped(stellr, 'participants', ID.stellrPart, { db, notFound, mode: 'enforce' })
    if (r.ok || r.response) throw new Error('expected a database error')
    expect((r.error as { code: string }).code).toBe('PGRST200')
  })
})

// ── enforce ──────────────────────────────────────────────────────────────────

describe('loadScoped (enforce)', () => {
  const opts = (db: ScopedDb) => ({ db, notFound, mode: 'enforce' as const })

  it('Stellr finds its row; Canary gets notFound for the same id', async () => {
    const { db } = fakeDb(seed())
    const hit = await loadScoped(stellr, 'registrations', ID.stellrReg, opts(db))
    expect(hit).toEqual({ ok: true, row: seed().registrations[0] })
    const miss = await loadScoped(canary, 'registrations', ID.stellrReg, opts(db))
    expect(miss.ok).toBe(false)
    expect(miss.ok === false && miss.response?.status).toBe(404)
    const own = await loadScoped(canary, 'registrations', ID.canaryReg, opts(db))
    expect(own.ok).toBe(true)
  })

  it('missing, malformed, other-tenant and other-event ids give byte-identical responses', async () => {
    const { db } = fakeDb(seed())
    const cases: [ScopeContext, unknown][] = [
      [nevadaManager, ID.missing],
      [nevadaManager, 'not-a-uuid'],
      [nevadaManager, ID.canaryReg],
      [nevadaManager, ID.stellrRegOtherEvent],
      [nevadaManager, undefined],
    ]
    const out = []
    for (const [scope, id] of cases) {
      const r = await loadScoped(scope, 'registrations', id, opts(db))
      if (r.ok || !r.response) throw new Error('expected a notFound response')
      out.push(await bytes(r.response))
    }
    for (const o of out) expect(o).toEqual(out[0])
    expect(out[0]).toEqual({ status: 404, headers: [['content-type', 'application/json']], body: '{"error":"Registration not found"}' })
    // And the event manager does reach their own event's row.
    expect((await loadScoped(nevadaManager, 'registrations', ID.stellrReg, opts(db))).ok).toBe(true)
  })

  it('a malformed id or an empty event list returns notFound with no database call', async () => {
    const { db, calls } = fakeDb(seed())
    await loadScoped(stellr, 'registrations', "x' or 1=1", opts(db))
    await loadScoped(stellr, 'registrations', 12345, opts(db))
    const none = makeScope({ tenantId: STELLR_TENANT_ID, eventSlugs: [], actor: { kind: 'event_manager' } })
    const r = await loadScoped(none, 'registrations', ID.stellrReg, opts(db))
    expect(r.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('a fresh notFound response each time', async () => {
    const { db } = fakeDb(seed())
    const factory = vi.fn(notFound)
    await loadScoped(stellr, 'registrations', ID.missing, { db, notFound: factory, mode: 'enforce' })
    await loadScoped(stellr, 'registrations', 'bad', { db, notFound: factory, mode: 'enforce' })
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('NULL tenant_id matches only in Stellr scope and only in log mode', async () => {
    const { db } = fakeDb(seed())
    expect((await loadScoped(stellr, 'registrations', ID.nullReg, opts(db))).ok).toBe(true)
    expect((await loadScoped(stellr, 'registrations', ID.nullReg, { ...opts(db), derivationMode: 'enforce' })).ok).toBe(false)
    expect((await loadScoped(canary, 'registrations', ID.nullReg, opts(db))).ok).toBe(false)
  })

  it('applies the expected filters', async () => {
    const { db, calls } = fakeDb(seed())
    await loadScoped(nevadaManager, 'registrations', ID.stellrReg, { ...opts(db), select: 'id,team' })
    await loadScoped(canary, 'registrations', ID.canaryReg, opts(db))
    expect(calls[0]).toEqual({
      table: 'registrations',
      schema: 'public',
      select: 'id,team',
      ops: [`eq:id=${ID.stellrReg}`, `or:tenant_id.eq.${STELLR_TENANT_ID},tenant_id.is.null`, 'in:event_slug=(nevada)'],
    })
    expect(calls[1].ops).toEqual([`eq:id=${ID.canaryReg}`, `eq:tenant_id=${CANARY}`])
  })

  it('via_parent: the parent embed is filtered and stripped from the row', async () => {
    const { db, calls } = fakeDb(seed())
    const hit = await loadScoped(stellr, 'participants', ID.stellrPart, opts(db))
    expect(hit).toEqual({ ok: true, row: seed().participants[0] })
    expect(calls[0].select).toBe(`*,${SCOPE_EMBED_ALIAS}:registrations!inner(tenant_id,event_slug)`)
    expect(calls[0].ops).toContain(`or:${SCOPE_EMBED_ALIAS}:tenant_id.eq.${STELLR_TENANT_ID},tenant_id.is.null`)

    expect((await loadScoped(canary, 'participants', ID.stellrPart, opts(db))).ok).toBe(false)
    expect((await loadScoped(stellr, 'participants', ID.canaryPart, opts(db))).ok).toBe(false)
    expect((await loadScoped(canary, 'participants', ID.canaryPart, opts(db))).ok).toBe(true)
    expect(calls.at(-1)!.ops).toContain(`eq:${SCOPE_EMBED_ALIAS}.tenant_id=${CANARY}`)

    const colorado = stellrScope({ kind: 'event_manager', memberId: null }, ['colorado'])
    expect((await loadScoped(colorado, 'participants', ID.stellrPart, opts(db))).ok).toBe(false)
    expect(calls.at(-1)!.ops).toContain(`in:${SCOPE_EMBED_ALIAS}.event_slug=(colorado)`)
  })

  it('identity table under Canary throws; under Stellr it loads', async () => {
    const { db, calls } = fakeDb(seed())
    await expect(loadScoped(canary, 'members', ID.member, opts(db))).rejects.toThrow(TenantContextError)
    expect(calls).toHaveLength(0)
    expect(await loadScoped(stellr, 'members', ID.member, opts(db))).toEqual({ ok: true, row: seed().members[0] })
  })

  it('an idColumn other than id validates as a key', async () => {
    const { db } = fakeDb(seed())
    const r = await loadScoped(nevadaManager, 'events', 'nevada', { ...opts(db), idColumn: 'slug' })
    expect(r.ok).toBe(true)
    expect((await loadScoped(nevadaManager, 'events', 'canary-cup', { ...opts(db), idColumn: 'slug' })).ok).toBe(false)
    expect((await loadScoped(stellr, 'events', 'bad slug!', { ...opts(db), idColumn: 'slug' })).ok).toBe(false)
    const custom = await loadScoped(stellr, 'events', 'nevada', { ...opts(db), idColumn: 'slug', isValidId: () => false })
    expect(custom.ok).toBe(false)
  })

  it('a database error is returned for the route to handle', async () => {
    const { db } = fakeDb({ registrations: [seed().registrations[0], { ...seed().registrations[0] }] })
    const r = await loadScoped(stellr, 'registrations', ID.stellrReg, opts(db))
    expect(r).toEqual({ ok: false, error: { message: 'multiple rows' } })
  })

  it('reaches a non-public schema through db.schema()', async () => {
    const tierId = '99999999-9999-4999-8999-999999999999'
    const { db, calls } = fakeDb({ tiers: [{ id: tierId }] })
    expect((await loadScoped(stellr, 'entitlements.tiers', tierId, opts(db))).ok).toBe(true)
    expect(calls[0].schema).toBe('entitlements')
    const noSchema = { from: db.from } as ScopedDb
    await expect(loadScoped(stellr, 'entitlements.tiers', tierId, opts(noSchema))).rejects.toThrow(/schema entitlements/)
  })

  it('does not need a legacy query', async () => {
    const { db } = fakeDb(seed())
    const legacy = vi.fn()
    await loadScoped(stellr, 'registrations', ID.stellrReg, { ...opts(db), legacy })
    expect(legacy).not.toHaveBeenCalled()
  })
})

// ── off ──────────────────────────────────────────────────────────────────────

describe('loadScoped (off, the default)', () => {
  it('runs only the legacy query and plans nothing', async () => {
    const { db, calls } = fakeDb(seed())
    const legacy = vi.fn(async () => ({ data: { id: ID.member }, error: null }))
    // An unregistered table throws when planned, and the id is malformed: off never plans.
    const r = await loadScoped(stellr, 'no_such_table', 'not-a-uuid', { db, notFound, legacy })
    expect(r).toEqual({ ok: true, row: { id: ID.member } })
    expect(legacy).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(0)
  })
  it('maps a legacy miss to notFound and passes a legacy error through', async () => {
    const { db } = fakeDb(seed())
    const miss = await loadScoped(stellr, 'registrations', ID.missing, {
      db,
      notFound,
      mode: 'off',
      legacy: async () => ({ data: null, error: null }),
    })
    expect(miss.ok === false && miss.response?.status).toBe(404)
    const err = await loadScoped(stellr, 'registrations', ID.missing, {
      db,
      notFound,
      mode: 'off',
      legacy: async () => ({ data: null, error: { message: 'boom' } }),
    })
    expect(err).toEqual({ ok: false, error: { message: 'boom' } })
  })
  it('requires the legacy query in off and shadow modes', async () => {
    const { db } = fakeDb(seed())
    await expect(loadScoped(stellr, 'registrations', ID.stellrReg, { db, notFound, mode: 'off' })).rejects.toThrow(TypeError)
    await expect(loadScoped(stellr, 'registrations', ID.stellrReg, { db, notFound, mode: 'shadow' })).rejects.toThrow(
      /shadow mode needs the legacy query/,
    )
  })
  it('follows LOADSCOPED_MODE when no mode is passed', async () => {
    const { db, calls } = fakeDb(seed())
    vi.stubEnv('LOADSCOPED_MODE', 'enforce')
    try {
      const r = await loadScoped(stellr, 'registrations', ID.stellrReg, { db, notFound })
      expect(r.ok).toBe(true)
      expect(calls).toHaveLength(1)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

// ── Scopes the modes never apply to ──────────────────────────────────────────

describe('loadScoped (another tenant or an event-narrowed scope always enforces)', () => {
  const orphan = makeScope({ tenantId: STELLR_TENANT_ID, eventSlugs: [], actor: { kind: 'event_manager' } })

  describe.each(['off', 'shadow'] as const)('in %s mode', (mode) => {
    function opts(db: ScopedDb, data: Row | null) {
      const onMismatch = vi.fn()
      const legacy = vi.fn(async () => ({ data, error: null }))
      return { db, notFound, mode, legacy, onMismatch }
    }
    it('another tenant never gets the legacy row', async () => {
      const { db } = fakeDb(seed())
      const o = opts(db, seed().registrations[0])
      const r = await loadScoped(canary, 'registrations', ID.stellrReg, o)
      expect(r.ok === false && r.response?.status).toBe(404)
      expect(o.legacy).not.toHaveBeenCalled()
      expect(o.onMismatch).not.toHaveBeenCalled()
    })
    it('another tenant reaches its own row through the scoped query', async () => {
      const { db } = fakeDb(seed())
      const o = opts(db, null)
      expect(await loadScoped(canary, 'registrations', ID.canaryReg, o)).toEqual({ ok: true, row: seed().registrations[2] })
      expect(o.legacy).not.toHaveBeenCalled()
    })
    it('another tenant on an identity table throws', async () => {
      const { db } = fakeDb(seed())
      const o = opts(db, { id: ID.member })
      await expect(loadScoped(canary, 'members', ID.member, o)).rejects.toThrow(TenantContextError)
      expect(o.legacy).not.toHaveBeenCalled()
    })
    it("an event manager gets notFound on another event, and their own event's row", async () => {
      const { db } = fakeDb(seed())
      const o = opts(db, seed().registrations[1])
      const r = await loadScoped(nevadaManager, 'registrations', ID.stellrRegOtherEvent, o)
      expect(r.ok === false && r.response?.status).toBe(404)
      expect((await loadScoped(nevadaManager, 'registrations', ID.stellrReg, o)).ok).toBe(true)
      expect(o.legacy).not.toHaveBeenCalled()
    })
    it('an empty event list is notFound with no query at all', async () => {
      const { db, calls } = fakeDb(seed())
      const o = opts(db, seed().registrations[0])
      const r = await loadScoped(orphan, 'registrations', ID.stellrReg, o)
      expect(r.ok === false && r.response?.status).toBe(404)
      expect(calls).toHaveLength(0)
      expect(o.legacy).not.toHaveBeenCalled()
      expect(o.onMismatch).not.toHaveBeenCalled()
    })
  })

  it('holds when the mode comes from LOADSCOPED_MODE, unset or off', async () => {
    const { db } = fakeDb(seed())
    const legacy = vi.fn(async () => ({ data: seed().registrations[0], error: null }))
    const unset = await loadScoped(canary, 'registrations', ID.stellrReg, { db, notFound, legacy })
    expect(unset.ok === false && unset.response?.status).toBe(404)
    vi.stubEnv('LOADSCOPED_MODE', 'off')
    try {
      const off = await loadScoped(canary, 'registrations', ID.stellrReg, { db, notFound, legacy })
      expect(off.ok === false && off.response?.status).toBe(404)
    } finally {
      vi.unstubAllEnvs()
    }
    expect(legacy).not.toHaveBeenCalled()
  })
})

describe('an unrecognised LOADSCOPED_MODE', () => {
  it('runs as off for Stellr and is reported once per value, without the value', async () => {
    const { db } = fakeDb(seed())
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const legacy = vi.fn(async () => ({ data: seed().registrations[0], error: null }))
    vi.stubEnv('LOADSCOPED_MODE', 'enforced')
    try {
      expect((await loadScoped(stellr, 'registrations', ID.stellrReg, { db, notFound, legacy })).ok).toBe(true)
      await loadScoped(stellr, 'registrations', ID.stellrReg, { db, notFound, legacy })
      expect(legacy).toHaveBeenCalledTimes(2)
      expect(captureRequestError).toHaveBeenCalledTimes(1)
      const [e, req] = captureRequestError.mock.calls[0] as [Error, { path: string }]
      expect(e.message).toBe('LOADSCOPED_MODE is set to an unrecognised value and was treated as off')
      expect(req.path).toBe('LOADSCOPED_MODE')
    } finally {
      vi.unstubAllEnvs()
      err.mockRestore()
    }
  })
  it('stays quiet for unset, a known value, or an explicit per-call mode', async () => {
    const { db } = fakeDb(seed())
    const legacy = vi.fn(async () => ({ data: seed().registrations[0], error: null }))
    await loadScoped(stellr, 'registrations', ID.stellrReg, { db, notFound, legacy })
    vi.stubEnv('LOADSCOPED_MODE', 'off')
    await loadScoped(stellr, 'registrations', ID.stellrReg, { db, notFound, legacy })
    vi.stubEnv('LOADSCOPED_MODE', 'also-not-a-mode')
    try {
      await loadScoped(stellr, 'registrations', ID.stellrReg, { db, notFound, legacy, mode: 'off' })
    } finally {
      vi.unstubAllEnvs()
    }
    expect(captureRequestError).not.toHaveBeenCalled()
  })
})

// ── shadow ───────────────────────────────────────────────────────────────────

describe('loadScoped (shadow)', () => {
  function shadow(db: ScopedDb, legacyRow: Row | null, extra: Record<string, unknown> = {}) {
    const seen: ShadowMismatch[] = []
    return {
      seen,
      opts: {
        db,
        notFound,
        mode: 'shadow' as const,
        label: 'POST /api/admin/registrations/[id]/invoice',
        legacy: async () => ({ data: legacyRow, error: null }),
        onMismatch: (m: ShadowMismatch) => {
          seen.push(m)
        },
        ...extra,
      },
    }
  }

  it('returns the legacy result and logs when the scoped query disagrees', async () => {
    const { db } = fakeDb(seed())
    const canaryRow = seed().registrations[2]
    const { seen, opts } = shadow(db, canaryRow)
    const r = await loadScoped(stellr, 'registrations', ID.canaryReg, opts)
    expect(r).toEqual({ ok: true, row: canaryRow })
    expect(seen).toEqual([
      {
        table: 'public.registrations',
        label: 'POST /api/admin/registrations/[id]/invoice',
        reason: 'presence',
        legacyFound: true,
        scopedFound: false,
        actorKind: 'staff',
      },
    ])
  })

  it('a legacy miss stays a miss even when the scoped query finds the row', async () => {
    const { db } = fakeDb(seed())
    const { seen, opts } = shadow(db, null)
    const r = await loadScoped(stellr, 'registrations', ID.stellrReg, opts)
    expect(r.ok === false && r.response?.status).toBe(404)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ reason: 'presence', legacyFound: false, scopedFound: true })
  })

  it('derivationMode reaches the scoped query: a NULL-tenant row misses once enforced', async () => {
    const { db } = fakeDb(seed())
    const log = shadow(db, seed().registrations[3])
    await loadScoped(stellr, 'registrations', ID.nullReg, log.opts)
    expect(log.seen).toEqual([])
    const enforced = shadow(db, seed().registrations[3], { derivationMode: 'enforce' })
    await loadScoped(stellr, 'registrations', ID.nullReg, enforced.opts)
    expect(enforced.seen.map((m) => m.reason)).toEqual(['presence'])
  })

  it('compares rows on idColumn, not on id', async () => {
    const { db } = fakeDb(seed())
    const opts = (row: Row) => shadow(db, row, { idColumn: 'slug' })
    const differs = opts({ id: ID.stellrReg, slug: 'colorado' })
    await loadScoped(stellr, 'events', 'nevada', differs.opts)
    expect(differs.seen.map((m) => m.reason)).toEqual(['row'])
    const same = opts({ id: ID.missing, slug: 'nevada' })
    await loadScoped(stellr, 'events', 'nevada', same.opts)
    expect(same.seen).toEqual([])
  })

  it('logs nothing when both agree (found or missing)', async () => {
    const { db } = fakeDb(seed())
    const a = shadow(db, seed().registrations[0])
    expect((await loadScoped(stellr, 'registrations', ID.stellrReg, a.opts)).ok).toBe(true)
    const b = shadow(db, null)
    const miss = await loadScoped(stellr, 'registrations', ID.missing, b.opts)
    expect(miss.ok === false && miss.response?.status).toBe(404)
    expect([...a.seen, ...b.seen]).toEqual([])
  })

  it('logs a different row', async () => {
    const { db } = fakeDb(seed())
    const { seen, opts } = shadow(db, { id: ID.missing })
    await loadScoped(stellr, 'registrations', ID.stellrReg, opts)
    expect(seen.map((m) => m.reason)).toEqual(['row'])
  })

  it('logs a scoped miss on a legacy hit with a malformed id, without querying', async () => {
    const { db, calls } = fakeDb(seed())
    const { seen, opts } = shadow(db, { id: 'x' })
    const r = await loadScoped(stellr, 'registrations', 'x', opts)
    expect(r.ok).toBe(true)
    expect(calls).toHaveLength(0)
    expect(seen.map((m) => m.reason)).toEqual(['presence'])
  })

  it('a plan error or a scoped error is logged and the legacy result still returned', async () => {
    const { db } = fakeDb(seed())
    const p = shadow(db, { id: ID.member })
    expect(await loadScoped(stellr, 'no_such_table', ID.member, p.opts)).toEqual({ ok: true, row: { id: ID.member } })
    expect(p.seen.map((m) => m.reason)).toEqual(['plan_error'])
    const q = shadow(db, { id: ID.member })
    expect(await loadScoped(stellr, 'tenant_data_keys', ID.member, q.opts)).toEqual({ ok: true, row: { id: ID.member } })
    expect(q.seen.map((m) => m.reason)).toEqual(['plan_error'])

    const broken = { from: () => ({ select: () => { throw new Error('network') } }) } as unknown as ScopedDb
    const s = shadow(broken, seed().registrations[0])
    expect((await loadScoped(stellr, 'registrations', ID.stellrReg, s.opts)).ok).toBe(true)
    expect(s.seen.map((m) => m.reason)).toEqual(['scoped_error'])

    const dup = fakeDb({ registrations: [seed().registrations[0], { ...seed().registrations[0] }] })
    const d = shadow(dup.db, seed().registrations[0])
    await loadScoped(stellr, 'registrations', ID.stellrReg, d.opts)
    expect(d.seen.map((m) => m.reason)).toEqual(['scoped_error'])
  })

  it('passes a legacy error through without a presence mismatch', async () => {
    const { db } = fakeDb(seed())
    const { seen, opts } = shadow(db, null, { legacy: async () => ({ data: null, error: { message: 'boom' } }) })
    expect(await loadScoped(stellr, 'registrations', ID.stellrReg, opts)).toEqual({ ok: false, error: { message: 'boom' } })
    expect(seen).toEqual([])
  })

  it('a failing log sink never fails the request', async () => {
    const { db } = fakeDb(seed())
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { opts } = shadow(db, seed().registrations[2], {
      onMismatch: () => {
        throw new Error('sink down')
      },
    })
    expect((await loadScoped(stellr, 'registrations', ID.canaryReg, opts)).ok).toBe(true)
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('by default logs to app_errors with no id in the message', async () => {
    const { db } = fakeDb(seed())
    await loadScoped(stellr, 'registrations', ID.canaryReg, {
      db,
      notFound,
      mode: 'shadow',
      legacy: async () => ({ data: seed().registrations[2], error: null }),
    })
    expect(captureRequestError).toHaveBeenCalledTimes(1)
    const [err, req, ctx] = captureRequestError.mock.calls[0] as [Error, { method: string; path: string }, { routePath: string }]
    expect(err.message).toBe(
      'loadScoped shadow mismatch: public.registrations presence (legacy found, scoped missing, actor staff)',
    )
    expect(err.message).not.toContain(ID.canaryReg)
    expect(req).toEqual({ method: 'LOADSCOPED', path: 'public.registrations' })
    expect(ctx).toEqual({ routePath: 'public.registrations' })
  })

  it('the default sink uses the label, not the table, as the route', async () => {
    const { db } = fakeDb(seed())
    await loadScoped(stellr, 'registrations', ID.canaryReg, {
      db,
      notFound,
      mode: 'shadow',
      label: 'GET /api/admin/x',
      legacy: async () => ({ data: seed().registrations[2], error: null }),
    })
    const [err, req, ctx] = captureRequestError.mock.calls[0] as [Error, { path: string }, { routePath: string }]
    expect(err.message).toContain('public.registrations')
    expect(req.path).toBe('GET /api/admin/x')
    expect(ctx.routePath).toBe('GET /api/admin/x')
  })
})

// ── scopedQuery and stripScopeEmbed ──────────────────────────────────────────

describe('scopedQuery', () => {
  it('returns a builder with the scope filters applied', () => {
    const { db, calls } = fakeDb(seed())
    scopedQuery(nevadaManager, 'participants', { db, select: 'id' }).eq('first_name', 'S')
    expect(calls[0].select).toBe(`id,${SCOPE_EMBED_ALIAS}:registrations!inner(tenant_id,event_slug)`)
    expect(calls[0].ops).toEqual([
      `or:${SCOPE_EMBED_ALIAS}:tenant_id.eq.${STELLR_TENANT_ID},tenant_id.is.null`,
      `in:${SCOPE_EMBED_ALIAS}.event_slug=(nevada)`,
      'eq:first_name=S',
    ])
    scopedQuery(canary, 'registrations', { db, derivationMode: 'enforce' })
    expect(calls[1]).toMatchObject({ select: '*', ops: [`eq:tenant_id=${CANARY}`] })
    scopedQuery(stellr, 'registrations', { db, derivationMode: 'enforce' })
    expect(calls[2].ops).toEqual([`eq:tenant_id=${STELLR_TENANT_ID}`])
    expect(() => scopedQuery(canary, 'members', { db })).toThrow(TenantContextError)
  })
  it('stripScopeEmbed removes only the scope embed', () => {
    expect(stripScopeEmbed({ id: 1, [SCOPE_EMBED_ALIAS]: { tenant_id: 'x' } })).toEqual({ id: 1 })
    const row = { id: 2 }
    expect(stripScopeEmbed(row)).toBe(row)
    expect(stripScopeEmbed(null)).toBeNull()
  })
})
