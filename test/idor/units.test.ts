// @vitest-environment node
// Unit tests for the IDOR harness's parts: the honeytoken scanner, the id-input
// analyser, target discovery, the honey database, the canary's mutation step
// and the canary workflow's shape.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CANARY_TENANT, HONEYTOKENS, HONEYTOKEN_VALUES, honeytokenFor, scanForHoneytokens } from '@/lib/testing/honeytokens'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { isIdLikeName, requestIdInputs } from '@/lib/security/route-ast'
import { idorTargetFor, segmentsOf, urlPatternOf } from '@/lib/security/idor-targets'
import { CREDENTIAL_NUMBER_RE } from '@/lib/credentials-core'
import { honeyClient, newHoneyDbState } from './honey-db'
import { MUTATIONS, mutate } from '../../scripts/idor-canary.mjs'

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
    expect(requestIdInputs(f, src)).toEqual({ query: ['id', 'memberIds', 'teamId'], body: [] })
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
    expect(requestIdInputs(f, src)).toEqual({ query: [], body: ['cohortId', 'event_slug', 'memberId', 'registrationId', 'spaceId', 'token'] })
  })
  it('ignores zod keys in a file that reads no body, and non-id names', () => {
    expect(requestIdInputs(f, `const S = z.object({ teamId: z.string() }); export function GET() {}`)).toEqual({ query: [], body: [] })
    expect(isIdLikeName('name')).toBe(false)
    expect(isIdLikeName('limit')).toBe(false)
    expect(isIdLikeName('workshopId')).toBe(true)
    expect(isIdLikeName('school_id')).toBe(true)
  })
})

describe('idor targets', () => {
  it('derives URL patterns and segments', () => {
    expect(urlPatternOf('app/(public)/credentials/[number]/badge/route.tsx')).toBe('/credentials/[number]/badge')
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
  it('unknown builder methods chain instead of throwing', async () => {
    const { client } = db()
    const q = (client.from('teams').select('*') as any).order('x').limit(5).range(0, 4).abortSignal(null).textSearch('fts', 'x')
    expect((await run(q)).error).toBeNull()
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
