// @vitest-environment node
// Unit tests for the IDOR harness's parts: the honeytoken scanner, the id-input
// analyser, target discovery, the honey database, the canary's mutation step
// and the canary workflow's shape.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CANARY_TENANT, HONEYTOKENS, HONEYTOKEN_VALUES, honeyColumnId, honeytokenFor, isCanaryId, scanForHoneytokens } from '@/lib/testing/honeytokens'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { isIdLikeName, requestIdInputs } from '@/lib/security/route-ast'
import { ROUTE_MANIFEST } from '@/lib/security/route-manifest'
import { idorTargetFor, segmentsOf, staffTargets, urlPatternOf } from '@/lib/security/idor-targets'
import { CREDENTIAL_NUMBER_RE } from '@/lib/credentials-core'
import { honeyClient, newHoneyDbState } from './honey-db'
import { printReportedOracles, sealReportedOracles } from './reported-oracles'
import { TENANT_HOST_ACCEPTED } from './tenant-host-accepted'
import { capRegressions, entryOf, hostTotals, isFailingEntry, isUnprovenEntry, OK_UNTOUCHED, printHostCases, sealHostCases, SIGNING_SESSION_ROUTES, tenantHostTargets, unprovenReasonKey, UNTOUCHED } from './tenant-host-targets'
import { MUTATIONS, mutate } from '../../scripts/idor-canary.mjs'
import { capGrew, checkSince } from '../../scripts/tenant-host-cap.mjs'

describe('honeytokens', () => {
  it('Canary Academy is an AU/AUD tenant distinct from Stellr', () => {
    expect(CANARY_TENANT.id).not.toBe(STELLR_TENANT_ID)
    expect(CANARY_TENANT).toMatchObject({ country: 'AU', currency: 'aud', payment_region: 'AU', min_participant_age: 14 })
    expect(CANARY_TENANT.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(HONEYTOKENS.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(HONEYTOKENS.email.endsWith('.invalid')).toBe(true)
    expect(CREDENTIAL_NUMBER_RE.test(HONEYTOKENS.credentialNumber)).toBe(true)
  })

  it('the Canary ABN fails the ABN checksum, so it can never be a real business', () => {
    const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]
    const d = CANARY_TENANT.abn.split('').map(Number)
    d[0] -= 1
    expect(d.reduce((s, x, i) => s + x * w[i], 0) % 89).not.toBe(0)
  })

  it('finds every honeytoken in a body, including URL-encoded', () => {
    for (const v of HONEYTOKEN_VALUES) expect(scanForHoneytokens(`x ${v} y`).map((h) => h.value)).toContain(v)
    expect(scanForHoneytokens(`/next?e=${encodeURIComponent(HONEYTOKENS.email)}`).map((h) => h.value)).toContain(HONEYTOKENS.email)
    expect(scanForHoneytokens(new TextEncoder().encode(HONEYTOKENS.personName))).toHaveLength(1)
    expect(scanForHoneytokens({ nested: [{ who: HONEYTOKENS.email.toUpperCase() }] })).toHaveLength(1)
  })

  it('ignores what the caller sent, even when it contains the marker', () => {
    const body = { error: `team ${HONEYTOKENS.id} not found`, slug: HONEYTOKENS.eventSlug, link: HONEYTOKENS.token }
    expect(scanForHoneytokens(body, { sent: [HONEYTOKENS.id, HONEYTOKENS.eventSlug, HONEYTOKENS.token] })).toEqual([])
    expect(scanForHoneytokens({ ...body, owner: HONEYTOKENS.memberId }, { sent: [HONEYTOKENS.id] }).map((h) => h.value)).toContain(HONEYTOKENS.memberId)
    expect(scanForHoneytokens({ ok: true, id: 'something-else' })).toEqual([])
  })

  it('picks a honeytoken by input name', () => {
    expect(honeytokenFor('id')).toBe(HONEYTOKENS.id)
    expect(honeytokenFor('teamId')).toBe(HONEYTOKENS.id)
    expect(honeytokenFor('slug')).toBe(HONEYTOKENS.eventSlug)
    expect(honeytokenFor('event_slug')).toBe(HONEYTOKENS.eventSlug)
    expect(honeytokenFor('token')).toBe(HONEYTOKENS.token)
    expect(honeytokenFor('number')).toBe(HONEYTOKENS.credentialNumber)
    expect(honeytokenFor('memberIds')).toEqual([HONEYTOKENS.id])
    expect(honeytokenFor('...path')).toEqual([HONEYTOKENS.storagePath])
    expect(honeytokenFor('storagePath')).toBe(HONEYTOKENS.storagePath)
    expect(honeytokenFor('guardian_email')).toBe(HONEYTOKENS.email)
    expect(honeytokenFor('items[].variantId')).toBe(HONEYTOKENS.id)
  })

  it('column ids are valid uuids, distinct per column, recognised as Canary and never the sent id', () => {
    const a = honeyColumnId('event_id')
    const b = honeyColumnId('team_id')
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(a).not.toBe(b)
    expect(a).not.toBe(HONEYTOKENS.id)
    expect(isCanaryId(a) && isCanaryId(HONEYTOKENS.id) && isCanaryId(HONEYTOKENS.memberId)).toBe(true)
    expect(isCanaryId('00000000-0000-4000-8000-00000000a001')).toBe(false)
    expect(scanForHoneytokens({ event_id: a }, { sent: [HONEYTOKENS.id] }).length).toBe(1)
  })
})

describe('requestIdInputs', () => {
  const f = 'app/api/x/route.ts'
  it('reads query ids through searchParams in its common forms', () => {
    const src = `
      export async function GET(req) {
        const id = new URL(req.url).searchParams.get('id')
        const { searchParams } = new URL(req.url)
        const q = searchParams.get('q')
        const sp = req.nextUrl.searchParams
        const t = sp.get('teamId'); const all = sp.getAll('memberIds')
      }`
    expect(requestIdInputs(f, src)).toEqual({ query: ['id', 'memberIds', 'teamId'], body: [], fill: [] })
  })
  it('reads body ids from destructuring, property reads, formData and zod keys', () => {
    const src = `
      const Schema = z.object({ registrationId: z.string(), note: z.string() })
      export async function POST(req) {
        const { memberId, name } = await req.json()
        const body = (await req.json().catch(() => null)) as any
        const x = body.event_slug; const y = body['cohortId']
        const { token } = body
        const form = await req.formData(); form.get('spaceId')
      }`
    expect(requestIdInputs(f, src)).toEqual({
      query: [],
      body: ['cohortId', 'event_slug', 'memberId', 'registrationId', 'spaceId', 'token'],
      fill: ['name', 'note'],
    })
  })
  it('ignores zod keys in a file that reads no body, and non-id names', () => {
    expect(requestIdInputs(f, `const S = z.object({ teamId: z.string() }); export function GET() {}`)).toEqual({ query: [], body: [], fill: [] })
    expect(isIdLikeName('name')).toBe(false)
    expect(isIdLikeName('limit')).toBe(false)
    expect(isIdLikeName('workshopId')).toBe(true)
    expect(isIdLikeName('school_id')).toBe(true)
    for (const n of ['storagePath', 'path', 'pdfPath', 'ref', 'objectRef', 'email', 'guardian_email', 'items[].variantId']) {
      expect(isIdLikeName(n), n).toBe(true)
    }
    expect(isIdLikeName('items[].qty')).toBe(false)
  })
})

describe('idor targets', () => {
  it('derives URL patterns and segments', () => {
    expect(urlPatternOf('app/(stellr)/(public)/credentials/[number]/badge/route.tsx')).toBe('/credentials/[number]/badge')
    expect(segmentsOf('app/api/community/media/[...path]/route.ts')).toEqual(['...path'])
    expect(segmentsOf('app/api/members/teams/[id]/participants/[pid]/route.ts')).toEqual(['id', 'pid'])
    expect(segmentsOf('app/api/x/[[...rest]]/route.ts')).toEqual(['...rest'])
  })
  it('a route with no id input is not a target; one with any is', () => {
    expect(idorTargetFor('app/api/x/route.ts', 'participant', 'export async function GET() {}')).toBeNull()
    expect(idorTargetFor('app/api/x/[id]/route.ts', 'participant', 'export async function GET() {}')?.methods).toEqual(['GET'])
    expect(
      idorTargetFor('app/api/x/route.ts', 'public', `export async function POST(req) { const { token } = await req.json() }`),
    ).toMatchObject({ body: ['token'], methods: ['POST'] })
  })
})

describe('honey database', () => {
  type Res = { data: unknown; error: unknown; count?: number | null }
  const caller = { id: 'me', clerk_user_id: 'user_me', email: 'me@tenant-a.invalid', is_active: true }
  const db = () => {
    const state = newHoneyDbState({ members: [caller] })
    return { state, client: honeyClient(state) as { from: (t: string) => Record<string, (...a: unknown[]) => unknown> } }
  }
  const run = (q: unknown) => q as Promise<Res>

  it('an unscoped read by the foreign id returns the honey row', async () => {
    const { client, state } = db()
    const { data } = await run((client.from('teams').select('*') as any).eq('id', HONEYTOKENS.id).maybeSingle())
    expect(scanForHoneytokens(data, { sent: [HONEYTOKENS.id] }).length).toBeGreaterThan(0)
    expect(state.honeyReads).toEqual(['teams'])
  })
  it('a read scoped to the caller misses it', async () => {
    const { client } = db()
    const { data } = await run((client.from('teams').select('*') as any).eq('id', HONEYTOKENS.id).eq('owner_member_id', 'me').maybeSingle())
    expect(data).toBeNull()
    const r2 = await run((client.from('registrations').select('*') as any).or(`member_id.eq.me,guardian_email.eq.me@tenant-a.invalid`))
    expect(r2.data).toEqual([])
  })
  it('the caller resolves themselves, and the honey row ignores non-identity filters', async () => {
    const { client } = db()
    const me = await run((client.from('members').select('id') as any).eq('clerk_user_id', 'user_me').eq('is_active', true).single())
    expect((me.data as { id: string }).id).toBe('me')
    const any = await run((client.from('events').select('*') as any).eq('status', 'published').gte('starts_at', '2020-01-01'))
    expect((any.data as unknown[]).length).toBe(1)
  })
  it('embedded relations come back as nested honey rows', async () => {
    const { client } = db()
    const { data } = await run((client.from('registrations').select('id, participants(*), event:events(title)') as any).eq('id', HONEYTOKENS.id).single())
    const row = data as { participants: unknown[]; event: { title: string } }
    expect(Array.isArray(row.participants)).toBe(true)
    expect(row.event.title).toBe(HONEYTOKENS.personName)
  })
  it('records honey writes: unscoped update/delete, and inserts carrying a Canary value', async () => {
    const { client, state } = db()
    await run((client.from('teams').update({ name: 'x' }) as any).eq('id', HONEYTOKENS.id))
    await run((client.from('teams').delete() as any).eq('id', HONEYTOKENS.id).eq('owner_member_id', 'me'))
    await run(client.from('team_members').insert({ team_id: HONEYTOKENS.id, member_id: 'me' }))
    await run(client.from('audit_log').insert({ target: HONEYTOKENS.id }))
    expect(state.writes.map((w) => `${w.table}:${w.op}`)).toEqual(['teams:update', 'team_members:insert'])
  })
  it('uuid columns show a per-column Canary id unless the query pinned them', async () => {
    const { client } = db()
    const { data } = await run((client.from('registrations').select('id, event_id, team_id') as any).eq('event_id', HONEYTOKENS.id).single())
    const row = data as Record<string, string>
    expect(row.event_id).toBe(HONEYTOKENS.id)
    expect(row.id).toBe(honeyColumnId('id'))
    expect(row.team_id).toBe(honeyColumnId('team_id'))
    expect(row.team_id).not.toBe(row.id)
    expect(scanForHoneytokens({ id: row.id }, { sent: [HONEYTOKENS.id] })).toHaveLength(1)
  })
  it('an owner column matches the sent id, the Canary member id and a column id', async () => {
    for (const v of [HONEYTOKENS.id, HONEYTOKENS.memberId, honeyColumnId('member_id')]) {
      const { client } = db()
      const { data } = await run((client.from('event_participations').select('*') as any).eq('member_id', v))
      expect((data as unknown[]).length, v).toBe(1)
    }
  })
  it('an rpc carrying a Canary value is a honey write; storage and filters mark the db touched', async () => {
    const { client, state } = db()
    expect(state.touched).toBe(false)
    await run((client as any).rpc('withdraw_registration', { p_registration_id: HONEYTOKENS.id }))
    expect(state.writes.map((w) => w.table)).toEqual(['rpc:withdraw_registration'])
    expect(state.touched).toBe(true)
    const other = db()
    await run((other.client as any).rpc('count_things', { p_member_id: 'me' }))
    expect(other.state.writes).toEqual([])
    expect(other.state.touched).toBe(false)
  })
  it('an inserted email the caller typed is not a honey write; an inserted Canary id is', async () => {
    const { client, state } = db()
    await run(client.from('contact_enquiries').insert({ email: HONEYTOKENS.email, message: 'hi' }))
    expect(state.writes).toEqual([])
    expect(state.touched).toBe(true)
  })
  it('honeyAbsent removes the honey row (the differential run)', async () => {
    const state = newHoneyDbState({}, { honeyAbsent: true })
    const client = honeyClient(state) as { from: (t: string) => any }
    const { data } = await run(client.from('teams').select('*').eq('id', HONEYTOKENS.id).maybeSingle())
    expect(data).toBeNull()
  })
  it('a filter on an embedded parent’s tenant or event is an identity filter', async () => {
    const { client } = db()
    const q = (extra: (b: any) => any) => run(extra((client.from('participants').select('id, reg:registrations!inner(tenant_id)') as any).eq('id', HONEYTOKENS.id)).maybeSingle())
    expect((await q((b) => b.eq('reg.tenant_id', STELLR_TENANT_ID))).data).toBeNull()
    expect((await q((b) => b.eq('reg.tenant_id', CANARY_TENANT.id))).data).not.toBeNull()
    expect((await q((b) => b.in('reg.event_slug', ['another-event']))).data).toBeNull()
    expect((await q((b) => b.in('reg.event_slug', [HONEYTOKENS.eventSlug]))).data).not.toBeNull()
    // Any other embedded column stays a wildcard.
    expect((await q((b) => b.eq('reg.status', 'x'))).data).not.toBeNull()
  })
  it('the honey row can belong to Stellr: the filter decides by its real tenant, and reading shows it', async () => {
    const state = newHoneyDbState({}, { honeyTenantId: STELLR_TENANT_ID })
    const client = honeyClient(state) as { from: (t: string) => any }
    const byTenant = (t: string) => run(client.from('events').select('*').eq('id', HONEYTOKENS.id).eq('tenant_id', t).maybeSingle())
    expect((await byTenant(CANARY_TENANT.id)).data).toBeNull()
    expect((await byTenant(STELLR_TENANT_ID)).data).not.toBeNull()
    const open = await run(client.from('events').select('*').eq('id', HONEYTOKENS.id).maybeSingle())
    expect((open.data as { tenant_id: string }).tenant_id).toBe(STELLR_TENANT_ID)
    const orNull = await run(client.from('events').select('*').or(`tenant_id.eq.${CANARY_TENANT.id},tenant_id.is.null`))
    expect(orNull.data).toEqual([])
  })
  it('a token column answers to the listed values, and a use of one marks the db touched', async () => {
    const state = newHoneyDbState({}, { honeyTokens: ['hash-of-a-valid-link'] })
    const client = honeyClient(state) as { from: (t: string) => any }
    expect((await run(client.from('survey_invitations').select('*').eq('token_hash', 'other').maybeSingle())).data).toBeNull()
    expect(state.touched).toBe(false)
    expect((await run(client.from('survey_invitations').select('*').eq('token_hash', 'hash-of-a-valid-link').maybeSingle())).data).not.toBeNull()
    expect(state.touched).toBe(true)
  })
  it('a link’s version and expiry are not identity columns, so a fixture may set them', async () => {
    const state = newHoneyDbState({}, { honeyColumns: { token_expires_at: '2099-01-01', token: 'cannot-set-this' } })
    const client = honeyClient(state) as { from: (t: string) => any }
    const { data } = await run(client.from('agreement_recipients').select('*').eq('id', HONEYTOKENS.id).eq('token_version', 7).maybeSingle())
    const row = data as Record<string, unknown>
    expect(row.token_expires_at).toBe('2099-01-01')
    expect(row.token).toBe(HONEYTOKENS.token)
  })
  it('models 22P02 only in the malformed run, and only for a uuid column', async () => {
    const off = honeyClient(newHoneyDbState()) as { from: (t: string) => any }
    expect((await run(off.from('teams').select('*').eq('id', 'not-a-uuid').maybeSingle())).error).toBeNull()
    const on = honeyClient(newHoneyDbState({}, { modelUuidErrors: true })) as { from: (t: string) => any }
    expect((await run(on.from('teams').select('*').eq('id', 'not-a-uuid').maybeSingle())).error).toMatchObject({ code: '22P02' })
    expect((await run(on.from('teams').select('*').in('team_id', ['not-a-uuid']))).error).toMatchObject({ code: '22P02' })
    expect((await run(on.from('teams').select('*').eq('id', HONEYTOKENS.id).maybeSingle())).error).toBeNull()
    expect((await run(on.from('teams').select('*').eq('stripe_customer_id', 'cus_x').maybeSingle())).error).toBeNull()
    expect((await run(on.from('teams').select('*').eq('slug', 'text-slug').maybeSingle())).error).toBeNull()
  })
  it('unknown builder methods chain instead of throwing', async () => {
    const { client } = db()
    const q = (client.from('teams').select('*') as any).order('x').limit(5).range(0, 4).abortSignal(null).textSearch('fts', 'x')
    expect((await run(q)).error).toBeNull()
  })
})

describe('reported refusals', () => {
  const list = { 'GET app/api/a/route.ts': 'presence', 'POST app/api/b/route.ts': 'malformed' }

  it('the seal is the same in any order, and changes with a route or a comparison', () => {
    const seal = sealReportedOracles(list)
    expect(seal.count).toBe(2)
    expect(seal.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(sealReportedOracles({ 'POST app/api/b/route.ts': 'malformed', 'GET app/api/a/route.ts': 'presence' })).toEqual(seal)
    expect(sealReportedOracles({ ...list, 'POST app/api/b/route.ts': 'presence' }).hash).not.toBe(seal.hash)
    expect(sealReportedOracles({ 'GET app/api/a/route.ts': 'presence', 'POST app/api/c/route.ts': 'malformed' }).hash).not.toBe(seal.hash)
    expect(JSON.stringify(seal)).not.toContain('app/api')
  })

  it('the committed snapshot holds the count and the hash and no list', () => {
    const snap = JSON.parse(readFileSync('test/idor/idor-snapshot.json', 'utf8')) as Record<string, unknown>
    expect(snap).not.toHaveProperty('reported4xxOracles')
    expect(snap.reported4xxOracleCount).toEqual(expect.any(Number))
    expect(snap.reported4xxOracleHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('the set prints on a local run and never on CI', () => {
    const local: string[] = []
    expect(printReportedOracles(list, {}, (t) => local.push(t))).toBe(true)
    expect(local.join('\n')).toContain('GET app/api/a/route.ts presence')
    for (const env of [{ CI: 'true' }, { GITHUB_ACTIONS: 'true' }]) {
      const onCi: string[] = []
      expect(printReportedOracles(list, env, (t) => onCi.push(t))).toBe(false)
      expect(onCi).toEqual([])
    }
  })
})

describe('tenant-host cap', () => {
  const cases = (o: Record<string, string>) => ({ 'app/api/x/route.ts': o })
  const worse = (before: Record<string, string> | null, after: Record<string, string>) =>
    capRegressions(before && hostTotals(cases(before)), hostTotals(cases(after)))

  it('a case that starts failing raises the totals at its rank and below; one that stays or is refused with the id used does not', () => {
    expect(worse({ a: 'refused' }, { a: 'leak' })).toEqual(['leak or honey_write: 0 -> 1', 'oracle or worse: 0 -> 1', 'oracle_4xx or worse: 0 -> 1'])
    expect(worse({}, { a: 'oracle_4xx:presence' })).toEqual(['oracle_4xx or worse: 0 -> 1'])
    expect(worse({ a: 'leak' }, { a: 'honey_write' })).toEqual([])
    expect(worse({ a: 'leak' }, { a: 'refused' })).toEqual([])
    expect(worse({ a: 'oracle_4xx:presence' }, { a: 'ok' })).toEqual([])
    expect(worse(null, { a: 'leak' })).toEqual([])
  })

  it('a failing case that worsens raises a total without the failing count moving; one that eases raises none', () => {
    expect(worse({ a: 'oracle_4xx:presence' }, { a: 'oracle' })).toEqual(['oracle or worse: 0 -> 1'])
    expect(worse({ a: 'oracle_4xx:presence' }, { a: 'leak' })).toEqual(['leak or honey_write: 0 -> 1', 'oracle or worse: 0 -> 1'])
    expect(worse({ a: 'oracle' }, { a: 'honey_write' })).toEqual(['leak or honey_write: 0 -> 1'])
    expect(worse({ a: 'leak' }, { a: 'oracle_4xx:presence' })).toEqual([])
  })

  it('a worse case and an eased one at the same ranks raise no total: only the hash moves', () => {
    const before = { a: 'leak', b: 'refused' }
    const after = { a: 'refused', b: 'leak' }
    expect(worse(before, after)).toEqual([])
    expect(sealHostCases(cases(after)).hash).not.toBe(sealHostCases(cases(before)).hash)
    const hidden = { a: 'unexercised', b: 'refused' }
    expect(worse({ a: 'leak', b: 'unexercised' }, hidden)).toEqual([])
    expect(sealHostCases(cases(hidden)).hash).not.toBe(sealHostCases(cases({ a: 'leak', b: 'unexercised' })).hash)
  })

  it('a case that stops proving anything raises the unproven total, though it lowers the failing count', () => {
    for (const nothing of ['error', 'unexercised', UNTOUCHED, OK_UNTOUCHED]) {
      const risen = ['unproven: 0 -> 1']
      expect(worse({ a: 'honey_write' }, { a: nothing }), nothing).toEqual(risen)
      expect(worse({ a: 'oracle_4xx:presence' }, { a: nothing }), nothing).toEqual(risen)
      expect(worse({ a: 'refused' }, { a: nothing }), nothing).toEqual(risen)
      expect(worse({ a: 'ok' }, { a: nothing }), nothing).toEqual(risen)
      expect(worse({}, { a: nothing }), nothing).toEqual(risen)
    }
    expect(worse({ a: 'unexercised' }, { a: 'error' })).toEqual([])
    expect(worse({ a: 'unexercised' }, { a: 'refused' })).toEqual([])
    expect(worse({ a: 'unexercised' }, { a: 'leak' })).toHaveLength(3)
  })

  it('the seal is the same in any order, and changes with a route, a case or an entry', () => {
    const seal = sealHostCases({ 'f.ts': { a: 'leak', b: 'ok' }, 'g.ts': { a: 'refused' } })
    expect(seal.count).toBe(3)
    expect(seal.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(sealHostCases({ 'g.ts': { a: 'refused' }, 'f.ts': { b: 'ok', a: 'leak' } })).toEqual(seal)
    expect(sealHostCases({ 'f.ts': { a: 'leak', b: 'ok' }, 'g.ts': { a: 'ok' } }).hash).not.toBe(seal.hash)
    expect(sealHostCases({ 'f.ts': { a: 'leak', c: 'ok' }, 'g.ts': { a: 'refused' } }).hash).not.toBe(seal.hash)
    expect(sealHostCases({ 'f.ts': { a: 'oracle_4xx:malformed' } }).hash).not.toBe(sealHostCases({ 'f.ts': { a: 'oracle_4xx:presence' } }).hash)
  })

  it('the committed baseline holds totals and the hash and no list', () => {
    const text = readFileSync('test/baselines/tenant-host-idor.json', 'utf8')
    const committed = JSON.parse(text) as Record<string, unknown>
    expect(committed).not.toHaveProperty('cases')
    expect(Object.keys(committed).sort()).toEqual(['_comment', 'caseHash', 'totals'])
    expect(committed.caseHash).toMatch(/^[0-9a-f]{64}$/)
    expect(committed.totals).toMatchObject({ cases: expect.any(Number), failing: expect.any(Number), unproven: expect.any(Number) })
    expect(text).not.toMatch(/app\/(api|\()/)
  })

  it('the cases print on a local run and never on CI', () => {
    const local: string[] = []
    expect(printHostCases(cases({ a: 'leak' }), {}, (t) => local.push(t))).toBe(true)
    expect(local.join('\n')).toContain('app/api/x/route.ts a leak')
    for (const env of [{ CI: 'true' }, { GITHUB_ACTIONS: 'true' }]) {
      const onCi: string[] = []
      expect(printHostCases(cases({ a: 'leak' }), env, (t) => onCi.push(t))).toBe(false)
      expect(onCi).toEqual([])
    }
  })

  it('a case’s entry says when nothing was touched, whatever the status', () => {
    expect(entryOf({ outcome: 'refused', touched: false })).toBe(UNTOUCHED)
    expect(entryOf({ outcome: 'ok', touched: false })).toBe(OK_UNTOUCHED)
    expect(entryOf({ outcome: 'refused', touched: true })).toBe('refused')
    expect(entryOf({ outcome: 'ok', touched: true })).toBe('ok')
    expect(entryOf({ outcome: 'oracle_4xx', touched: true, oracleKind: 'malformed' })).toBe('oracle_4xx:malformed')
    expect(isUnprovenEntry(OK_UNTOUCHED) && isUnprovenEntry(UNTOUCHED) && isUnprovenEntry('error') && isUnprovenEntry('unexercised')).toBe(true)
    expect(isUnprovenEntry('refused') || isUnprovenEntry('ok') || isUnprovenEntry('leak')).toBe(false)
  })

  it('counts failures, oracle_4xx of both kinds included, and what proved nothing, and leaves out an accepted one', () => {
    const c = cases({ a: 'leak', b: 'oracle_4xx:malformed', c: 'refused', d: UNTOUCHED, e: 'unexercised', f: OK_UNTOUCHED, g: 'error' })
    expect(hostTotals(c)).toMatchObject({ routes: 1, cases: 7, failing: 2, unproven: 4, byOutcome: { oracle_4xx: 1, leak: 1 } })
    const approved = { outcome: 'leak', reason: 'x', approvedBy: 'owner', approvedOn: '2026-11-04' }
    expect(hostTotals(c, { 'app/api/x/route.ts a': approved }).failing).toBe(1)
    expect(isFailingEntry('oracle')).toBe(true)
    expect(isFailingEntry(UNTOUCHED)).toBe(false)
  })

  it('a reason for an unproven case is found by method and person, or by method for both', () => {
    const reasons = { 'f GET': 'both', 'f POST anonymous': 'one' }
    expect(unprovenReasonKey('f', 'GET anonymous stellr_to_canary', reasons)).toBe('f GET')
    expect(unprovenReasonKey('f', 'POST anonymous canary_to_stellr', reasons)).toBe('f POST anonymous')
    expect(unprovenReasonKey('f', 'POST participant canary_to_stellr', reasons)).toBeUndefined()
  })

  it('--since: a rise in either count fails unless acknowledged', () => {
    const at = (failing: number, unproven = 0) => ({ totals: { failing, unproven } })
    expect(capGrew(at(5), at(6))).toBe(true)
    expect(capGrew(at(5), at(5))).toBe(false)
    expect(capGrew(at(5), at(4))).toBe(false)
    expect(capGrew(at(5, 2), at(4, 3))).toBe(true)
    expect(capGrew(null, at(50))).toBe(false)
  })

  describe('--since against a real merge base', () => {
    const baseline = (entries: Record<string, string>, totals?: Record<string, unknown>) =>
      JSON.stringify({ totals: totals ?? hostTotals(cases(entries)), caseHash: sealHostCases(cases(entries)).hash })
    /** The earlier shape: totals and the per-case list, no hash. */
    const listed = (entries: Record<string, string>) => JSON.stringify({ totals: hostTotals(cases(entries)), cases: cases(entries) })
    const repo = (committed: string | null) => {
      const root = mkdtempSync(path.join(tmpdir(), 'tenant-host-cap-'))
      const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@tenant-a.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: root, stdio: 'ignore' })
      git('init', '-q')
      mkdirSync(path.join(root, 'test/baselines'), { recursive: true })
      if (committed !== null) writeFileSync(path.join(root, 'test/baselines/tenant-host-idor.json'), committed)
      writeFileSync(path.join(root, 'a.txt'), 'a')
      git('add', '-A')
      git('commit', '-q', '-m', 'base')
      git('tag', 'base')
      return root
    }
    const now = (root: string, content: string) => writeFileSync(path.join(root, 'test/baselines/tenant-host-idor.json'), content)
    const run = (root: string, ok = false) => {
      const was = process.env.TENANT_HOST_CAP_GROW_OK
      if (ok) process.env.TENANT_HOST_CAP_GROW_OK = 'true'
      else delete process.env.TENANT_HOST_CAP_GROW_OK
      const quiet = [vi.spyOn(console, 'log').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {})]
      try {
        return checkSince(root, 'base')
      } finally {
        quiet.forEach((s) => s.mockRestore())
        if (was === undefined) delete process.env.TENANT_HOST_CAP_GROW_OK
        else process.env.TENANT_HOST_CAP_GROW_OK = was
        rmSync(root, { recursive: true, force: true })
      }
    }
    const at = (before: Record<string, string>, after: Record<string, string>) => {
      const root = repo(baseline(before))
      now(root, baseline(after))
      return root
    }

    it('a fall passes; a rise fails unless the label says otherwise', () => {
      expect(run(at({ a: 'leak' }, { a: 'refused' }))).toBe(0)
      expect(run(at({ a: 'refused' }, { a: 'leak' }))).toBe(1)
      expect(run(at({ a: 'refused' }, { a: 'leak' }), true)).toBe(0)
    })

    it('a hash that moved with level totals passes, and says so in counts and hashes', () => {
      const root = at({ a: 'leak', b: 'refused' }, { a: 'refused', b: 'leak' })
      const said: string[] = []
      const log = vi.spyOn(console, 'log').mockImplementation((t: string) => void said.push(t))
      try {
        expect(checkSince(root, 'base')).toBe(0)
      } finally {
        log.mockRestore()
        rmSync(root, { recursive: true, force: true })
      }
      expect(said.join('\n')).toContain('The case set moved and no total rose')
      expect(said.join('\n')).toContain(sealHostCases(cases({ a: 'refused', b: 'leak' })).hash)
    })

    it('what it prints on a rise is counts and hashes, with no route', () => {
      const root = at({ a: 'refused' }, { a: 'leak' })
      const said: string[] = []
      const err = vi.spyOn(console, 'error').mockImplementation((t: string) => void said.push(t))
      try {
        expect(checkSince(root, 'base')).toBe(1)
      } finally {
        err.mockRestore()
        rmSync(root, { recursive: true, force: true })
      }
      expect(said.join('\n')).toContain('leak or honey_write: 0 -> 1')
      expect(said.join('\n')).not.toContain('app/api')
    })

    it('a worsening fails, with the count level; so does a case that stops proving anything', () => {
      expect(run(at({ a: 'oracle_4xx:presence' }, { a: 'leak' }))).toBe(1)
      expect(run(at({ a: 'honey_write' }, { a: 'unexercised' }))).toBe(1)
    })

    it('a merge base holding the per-case list compares by its totals', () => {
      const from = (before: Record<string, string>, after: Record<string, string>) => {
        const root = repo(listed(before))
        now(root, baseline(after))
        return root
      }
      expect(run(from({ a: 'leak' }, { a: 'leak' }))).toBe(0)
      expect(run(from({ a: 'leak' }, { a: 'refused' }))).toBe(0)
      expect(run(from({ a: 'refused' }, { a: 'leak' }))).toBe(1)
      expect(run(from({ a: 'oracle_4xx:presence' }, { a: 'leak' }))).toBe(1)
      expect(run(from({ a: 'refused' }, { a: 'unexercised' }))).toBe(1)
    })

    it('a merge base with totals it cannot compare fails closed; this tree may not hold the list', () => {
      const noOutcomes = repo(JSON.stringify({ totals: { failing: 1, unproven: 0 }, cases: {} }))
      now(noOutcomes, baseline({ a: 'refused' }))
      expect(run(noOutcomes)).toBe(1)
      const stillListed = repo(baseline({ a: 'refused' }))
      now(stillListed, listed({ a: 'refused' }))
      expect(run(stillListed)).toBe(1)
      const both = repo(baseline({ a: 'refused' }))
      now(both, JSON.stringify({ ...JSON.parse(baseline({ a: 'refused' })), cases: cases({ a: 'refused' }) }))
      expect(run(both)).toBe(1)
    })

    it('fails closed on a bad ref, a missing baseline, and totals that are not numbers', () => {
      const bad = repo(baseline({ a: 'refused' }))
      now(bad, baseline({ a: 'refused' }))
      const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(checkSince(bad, 'no-such-ref')).toBe(1)
      quiet.mockRestore()
      rmSync(bad, { recursive: true, force: true })
      expect(run(at({ a: 'refused' }, { a: 'refused' }))).toBe(0)
      const removed = repo(baseline({ a: 'refused' }))
      rmSync(path.join(removed, 'test/baselines/tenant-host-idor.json'))
      expect(run(removed)).toBe(1)
      const bare = repo(baseline({ a: 'refused' }))
      now(bare, baseline({ a: 'refused' }, { failing: undefined, unproven: 0 }))
      expect(run(bare)).toBe(1)
      const garbled = repo(baseline({ a: 'refused' }))
      now(garbled, 'not json')
      expect(run(garbled)).toBe(1)
    })

    it('no baseline at the merge base: nothing to compare, but this tree’s must still read', () => {
      const fresh = repo(null)
      now(fresh, baseline({ a: 'leak' }))
      expect(run(fresh)).toBe(0)
      const freshBad = repo(null)
      now(freshBad, baseline({ a: 'leak' }, { failing: 'x', unproven: 0 }))
      expect(run(freshBad)).toBe(1)
      const freshListed = repo(null)
      now(freshListed, listed({ a: 'leak' }))
      expect(run(freshListed)).toBe(1)
    })
  })

  it('the harness replaces lib/authz/tenant.ts only while it is the stub', () => {
    // test/idor/mocks.ts makes currentTenantId follow the case's host, which the real
    // function does not do yet. Once it reads the request, that mock hides the function
    // under test: a filter on it could pass both directions here and answer with Stellr's
    // rows on a tenant host in real life. When this fails, remove the mock so resolution
    // runs from the harness's host and header, then re-run the tenant-host suite.
    expect(readFileSync('lib/authz/tenant.ts', 'utf8')).toMatch(/export function currentTenantId\(\): string \{\s*return STELLR_TENANT_ID\s*\}/)
  })

  it('finds a staff route with no id, and no staff route is left out', () => {
    const manifest = {
      'app/api/admin/list/route.ts': 'tenant_staff',
      'app/api/admin/[id]/route.ts': 'platform_admin',
      'app/api/members/route.ts': 'participant',
      'app/(stellr)/(admin)/x/page.tsx': 'tenant_staff',
    } as const
    const read = (f: string) => (f.includes('list') ? 'export async function GET() {}' : 'export async function PATCH(req, { params }) {}')
    const found = staffTargets(read, manifest)
    expect(found.map((t) => [t.file, t.cls, t.methods])).toEqual([
      ['app/api/admin/[id]/route.ts', 'platform_admin', ['PATCH']],
      ['app/api/admin/list/route.ts', 'tenant_staff', ['GET']],
    ])
    expect(idorTargetFor('app/api/admin/list/route.ts', 'tenant_staff', read('app/api/admin/list/route.ts'))).toBeNull()
    expect(() => staffTargets(() => 'export const x = 1', { 'app/api/admin/none/route.ts': 'tenant_staff' })).toThrow('no handler')
    expect(staffTargets().map((t) => t.file)).toEqual(
      Object.entries(ROUTE_MANIFEST).filter(([f, c]) => /route\.tsx?$/.test(f) && (c === 'tenant_staff' || c === 'platform_admin' || c === 'platform_destined')).map(([f]) => f).sort(),
    )
  })

  it('every allowed route file is a target; an allowed route that names nothing throws', () => {
    expect(tenantHostTargets().map((t) => t.file)).toEqual(expect.arrayContaining([...SIGNING_SESSION_ROUTES]))
    const read = (f: string) => (f === 'app/api/check-in/route.ts' ? 'export async function GET() { return 1 }' : readFileSync(f, 'utf8'))
    expect(() => tenantHostTargets(read)).toThrow('app/api/check-in/route.ts')
  })

  it('accepted register starts empty: approval is the owner’s', () => {
    expect(TENANT_HOST_ACCEPTED).toEqual({})
  })

  it('CI compares the baseline with the merge base', () => {
    expect(readFileSync('.github/workflows/ci.yml', 'utf8')).toContain('node scripts/tenant-host-cap.mjs --since origin/dev')
  })
})

describe('canary', () => {
  it('mutate() removes exactly the marked guard line', () => {
    const src = readFileSync('test/idor/fixtures/handlers.ts', 'utf8')
    for (const m of MUTATIONS as { kind: string; file: string; line: RegExp }[]) {
      const { removed } = mutate(readFileSync(m.file, 'utf8'), m.line)
      expect(removed, `${m.file} ${m.line}`).toBe(1)
    }
    expect(mutate(src, /CANARY:nope/).removed).toBe(0)
  })

  it('the workflow is pinned, secret-free and non-blocking until CANARY_ENFORCE', () => {
    const wf = readFileSync('.github/workflows/idor-canary.yml', 'utf8')
    const uses = [...wf.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1])
    expect(uses.length).toBeGreaterThan(0)
    for (const u of uses) expect(u).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/)
    expect(wf).not.toMatch(/secrets\./)
    expect(wf).toMatch(/permissions:\s*\n\s*contents: read/)
    expect(wf).toContain("continue-on-error: ${{ vars.CANARY_ENFORCE != 'true' }}")
    expect(wf).toContain('node scripts/idor-canary.mjs')
  })
})
