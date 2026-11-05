// @vitest-environment node
//
// A case fixture may only get a request further: these prove it cannot swap the
// Canary id out, make the honey row the caller's, or hide a write.
import './mocks'
import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { describe, expect, it } from 'vitest'
import { HONEYTOKENS, scanForHoneytokens } from '@/lib/testing/honeytokens'
import { idorTargets } from '@/lib/security/idor-targets'
import { supabaseServer } from '@/lib/supabase'
import { applyEnv, CASE_FIXTURES, fixtureFor, HELD_BACK_FIXTURES, type CaseFixture } from './case-fixtures'
import { buildRequest, harness, installNetworkGuard, resetHarness, runIdorCase, TENANT_A_PARTICIPANT, type CaseInput } from './harness'
import { honeyClient, newHoneyDbState } from './honey-db'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.idor.invalid'
process.env.SUPABASE_SECRET_KEY = 'sb_secret_idorharness'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_idorharness'

installNetworkGuard()

type Ctx = { params: Promise<Record<string, string>> }
const byId: CaseInput = { segments: ['id'], query: [], body: [], urlPattern: '/api/probe/[id]' }

describe('the fixture lists', () => {
  const files = new Set(idorTargets().map((t) => t.file))

  it('name real id-bearing routes, each with its reason', () => {
    for (const [file, f] of Object.entries(CASE_FIXTURES)) {
      expect(files.has(file), file).toBe(true)
      expect(f.reason.length, file).toBeGreaterThan(10)
    }
    for (const [file, held] of Object.entries(HELD_BACK_FIXTURES)) {
      expect(files.has(file), file).toBe(true)
      expect(held.ref, file).toMatch(/^C4-F\d+$/)
      expect(held.writes.length, file).toBeGreaterThan(0)
    }
  })

  it('never exercise and hold back the same route', () => {
    expect(Object.keys(HELD_BACK_FIXTURES).filter((f) => CASE_FIXTURES[f])).toEqual([])
  })

  it('carry no Canary value: the generated id inputs are what the case tests', () => {
    expect(scanForHoneytokens(CASE_FIXTURES)).toEqual([])
    expect(scanForHoneytokens(HELD_BACK_FIXTURES)).toEqual([])
    expect(JSON.stringify(CASE_FIXTURES)).not.toMatch(/honeytoken|ca4a/i)
    expect(JSON.stringify(HELD_BACK_FIXTURES)).not.toMatch(/honeytoken|ca4a/i)
  })

  // These allow-lists are the rule that a fixture only gets a request further.
  // Widen one only for a value that cannot make a route refuse, or hide who a row
  // belongs to. The snapshot pins whatever a fixture produces, so nothing else
  // would catch a fixture that masks a missing check.
  const fixtures: [string, CaseFixture][] = [
    ...Object.entries(CASE_FIXTURES),
    ...Object.entries(HELD_BACK_FIXTURES).map(([file, held]): [string, CaseFixture] => [file, held.fixture]),
  ]

  it('set only the honey columns that let a route go on to its check', () => {
    const allowed: Record<string, unknown[]> = { type: ['group'], status: ['published'] }
    for (const [file, f] of fixtures) {
      for (const [column, value] of Object.entries(f.honey ?? {})) {
        expect(allowed[column] ?? [], `${file} sets honey.${column}`).toContain(value)
      }
    }
  })

  it('never change who the caller is, or whether they are active', () => {
    for (const [file, f] of fixtures) {
      expect(Object.keys(f.member ?? {}).filter((k) => k !== 'stripe_customer_id'), file).toEqual([])
    }
  })

  it('seed only rows the caller owns', () => {
    for (const [file, f] of fixtures) {
      for (const [table, rows] of Object.entries(f.callerRows ?? {})) {
        for (const row of rows) expect(row.member_id, `${file} ${table}`).toBe(TENANT_A_PARTICIPANT.memberId)
      }
    }
  })

  it('replace an id input only where it names no tenant record', () => {
    for (const [file, f] of fixtures) {
      // pageSlug: a key of the static landing pages (getLandingPage).
      expect(Object.keys(f.inputs ?? {}).filter((k) => k !== 'pageSlug'), file).toEqual([])
    }
  })
})

describe('buildRequest with a fixture', () => {
  const input: CaseInput = { segments: [], query: [], body: ['teamId'], fill: ['note'], urlPattern: '/api/probe' }

  it('the id input wins over a body field of the same name', async () => {
    const { req } = await buildRequest({ ...input, fixture: { reason: 'test', body: { teamId: 'mine', note: 'set' } } }, 'POST')
    expect(await req.json()).toEqual({ teamId: HONEYTOKENS.id, note: 'set' })
  })

  it('inputs replaces only the input it names', async () => {
    const two: CaseInput = { ...input, body: ['teamId', 'email'], fixture: { reason: 'test', inputs: { teamId: 'static-key' } } }
    const { req } = await buildRequest(two, 'POST')
    expect(await req.json()).toMatchObject({ teamId: 'static-key', email: HONEYTOKENS.email })
  })

  it('a fixture limited to one method leaves the others alone', async () => {
    const fixture: CaseFixture = { reason: 'test', methods: ['PATCH'], body: { note: 'set' } }
    expect(fixtureFor(fixture, 'POST')).toBeUndefined()
    const { req } = await buildRequest({ ...input, fixture }, 'POST')
    expect(await req.json()).toMatchObject({ note: 'IDOR harness text' })
  })
})

describe('honey columns', () => {
  const read = () => supabaseServer().from('registrations').select('*').eq('id', HONEYTOKENS.id).maybeSingle()

  it('set what a route branches on', async () => {
    resetHarness('participant', { fixture: { reason: 'test', honey: { type: 'group' } } })
    const { data } = await read()
    expect((data as unknown as { type: string }).type).toBe('group')
  })

  it('cannot make the row the caller’s: identity columns are ignored', async () => {
    const me = TENANT_A_PARTICIPANT.memberId
    resetHarness('participant', {
      fixture: { reason: 'test', honey: { member_id: me, teacher_member_id: me, tenant_id: me, clerk_user_id: TENANT_A_PARTICIPANT.clerkUserId } },
    })
    const { data } = await read()
    const row = data as unknown as Record<string, unknown>
    expect(row.member_id).not.toBe(me)
    expect(row.teacher_member_id).not.toBe(me)
    expect(row.tenant_id).not.toBe(me)
    expect(row.clerk_user_id).toBe(HONEYTOKENS.clerkUserId)
    const scoped = await supabaseServer().from('registrations').select('*').eq('id', HONEYTOKENS.id).eq('member_id', me).maybeSingle()
    expect(scoped.data).toBeNull()
  })

  it('let a missing ownership check show up as a leak', async () => {
    const unguarded = {
      async GET(_req: Request, { params }: Ctx) {
        const { id } = await params
        const { data } = await supabaseServer().from('registrations').select('*').eq('id', id).maybeSingle()
        const reg = data as { type: string } | null
        if (!reg) return NextResponse.json({ error: 'Not found' }, { status: 404 })
        if (reg.type !== 'group') return NextResponse.json({ error: 'Only group registrations' }, { status: 400 })
        return NextResponse.json(reg)
      },
    }
    expect((await runIdorCase(unguarded, byId, 'GET')).outcome).toBe('refused')
    const reached = await runIdorCase(unguarded, { ...byId, fixture: { reason: 'test', honey: { type: 'group' } } }, 'GET')
    expect(reached.outcome).toBe('leak')
  })
})

describe('a flag is scoped by who raised it', () => {
  it('flagged_by is an owner column, so the caller’s filter misses the honey row', async () => {
    const db = honeyClient(newHoneyDbState()) as { from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => PromiseLike<{ data: unknown[] }> } } }
    const { data } = await db.from('community_flags').select('id').eq('flagged_by', TENANT_A_PARTICIPANT.memberId)
    expect(data).toEqual([])
  })
})

describe('applyEnv', () => {
  it('puts back both a set value and an unset one', () => {
    process.env.IDOR_TEST_SET = 'before'
    delete process.env.IDOR_TEST_UNSET
    const restore = applyEnv({ IDOR_TEST_SET: 'during', IDOR_TEST_UNSET: 'during' })
    expect(process.env.IDOR_TEST_SET).toBe('during')
    expect(process.env.IDOR_TEST_UNSET).toBe('during')
    restore()
    expect(process.env.IDOR_TEST_SET).toBe('before')
    expect(process.env.IDOR_TEST_UNSET).toBeUndefined()
    delete process.env.IDOR_TEST_SET
  })

  it('is restored after a case, even one that throws', async () => {
    delete process.env.IDOR_TEST_CASE
    let during: string | undefined
    const mod = {
      async GET() {
        during = process.env.IDOR_TEST_CASE
        throw new Error('boom')
      },
    }
    const r = await runIdorCase(mod, { ...byId, fixture: { reason: 'test', env: { IDOR_TEST_CASE: 'set' } } }, 'GET')
    expect(during).toBe('set')
    expect(r.outcome).toBe('error')
    expect(process.env.IDOR_TEST_CASE).toBeUndefined()
  })
})

describe('Stripe in a case', () => {
  const stripe = () => new (Stripe as unknown as new () => { checkout: { sessions: { create: (a: unknown) => Promise<{ url: string }> } } })()

  it('rejects unless the fixture asks for answers', async () => {
    resetHarness('participant')
    await expect(stripe().checkout.sessions.create({})).rejects.toThrow(/disabled/)
  })

  it('never answers a call outside the short list', async () => {
    resetHarness('participant', { fixture: { reason: 'test', stripe: true } })
    const refunds = (stripe() as unknown as { refunds: { create: () => Promise<unknown> } }).refunds
    await expect(refunds.create()).rejects.toThrow(/disabled/)
  })

  it('a Canary value in metadata is a write; one in a URL is only the id being used', async () => {
    resetHarness('participant', { fixture: { reason: 'test', stripe: true } })
    await stripe().checkout.sessions.create({ success_url: `https://example.invalid/${HONEYTOKENS.id}` })
    expect(harness.db.writes).toEqual([])
    expect(harness.db.touched).toBe(true)
    await stripe().checkout.sessions.create({ metadata: { offeringId: HONEYTOKENS.id } })
    expect(harness.db.writes.map((w) => w.table)).toEqual(['stripe.checkout.sessions.create'])
  })

  it('a Canary value in nested metadata is a write too', async () => {
    resetHarness('participant', { fixture: { reason: 'test', stripe: true } })
    await stripe().checkout.sessions.create({ payment_intent_data: { metadata: { offeringId: HONEYTOKENS.id } } })
    expect(harness.db.writes.map((w) => w.table)).toEqual(['stripe.checkout.sessions.create'])
  })
})

describe('outbound requests in a case', () => {
  it('a fixture answers only the URLs it names; the rest stay 503', async () => {
    resetHarness('participant', {
      fixture: { reason: 'test', fetch: (url) => (url.startsWith('https://named.invalid/') ? Response.json({ ok: true }) : undefined) },
    })
    expect((await fetch('https://named.invalid/x')).status).toBe(200)
    expect((await fetch('https://other.invalid/x')).status).toBe(503)
    resetHarness('participant')
    expect((await fetch('https://named.invalid/x')).status).toBe(503)
  })

  const answers: CaseFixture = { reason: 'test', fetch: (url) => (url.startsWith('https://named.invalid/') ? Response.json({ ok: true }) : undefined) }
  const sending = (send: () => Promise<Response>) => ({
    async GET() {
      await send()
      return NextResponse.json({ ok: true })
    },
  })
  const post = (url: string, value: string) => fetch(url, { method: 'POST', body: JSON.stringify({ note: value }) })

  it('a Canary value the caller did not send, in an answered body, is a write', async () => {
    const r = await runIdorCase(sending(() => post('https://named.invalid/x', HONEYTOKENS.text)), { ...byId, fixture: answers }, 'GET')
    expect(r.outcome).toBe('honey_write')
    expect(r.writes.map((w) => w.table)).toEqual(['fetch:named.invalid'])
  })

  it('reads the body whichever way the request was built', async () => {
    const asRequest = new Request('https://named.invalid/x', { method: 'POST', body: HONEYTOKENS.text })
    const form = new URLSearchParams({ note: HONEYTOKENS.memberId })
    for (const send of [() => fetch(asRequest.clone()), () => fetch('https://named.invalid/x', { method: 'POST', body: form })]) {
      expect((await runIdorCase(sending(send), { ...byId, fixture: answers }, 'GET')).outcome).toBe('honey_write')
    }
  })

  it('what the caller sent is only passed along, but it does show the id was used', async () => {
    const r = await runIdorCase(sending(() => post('https://named.invalid/x', HONEYTOKENS.id)), { ...byId, fixture: answers }, 'GET')
    expect(r.outcome).toBe('ok')
    expect(r.writes).toEqual([])
    expect(r.touched).toBe(true)
  })

  it('a request nobody answered stored nothing', async () => {
    const r = await runIdorCase(sending(() => post('https://other.invalid/x', HONEYTOKENS.text)), { ...byId, fixture: answers }, 'GET')
    expect(r.outcome).toBe('ok')
  })
})
