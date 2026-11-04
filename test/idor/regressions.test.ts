// @vitest-environment node
//
// Regression tests for gaps a review found in the IDOR harness (4 Nov 2026).
// Each case is a deliberately unguarded (or guarded) handler run through
// runIdorCase. Before the fixes every "must be caught" case below came back
// `200 ok` or `refused`: the harness could not see it.
import './mocks'
import { readFileSync } from 'node:fs'
import { NextResponse, after } from 'next/server'
import { describe, expect, it } from 'vitest'
import { supabaseServer } from '@/lib/supabase'
import { auth } from '@clerk/nextjs/server'
import { idorTargets } from '@/lib/security/idor-targets'
import { requestIdInputs } from '@/lib/security/route-ast'
import { installNetworkGuard, runIdorCase, type CaseInput } from './harness'
import { caughtFor } from '../../scripts/idor-canary.mjs'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.idor.invalid'
process.env.SUPABASE_SECRET_KEY = 'sb_secret_idorharness'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_idorharness'

installNetworkGuard()

type Ctx = { params: Promise<Record<string, string>> }
const byId: CaseInput = { segments: ['id'], query: [], body: [], urlPattern: '/api/probe/[id]' }

async function me() {
  const { userId } = await auth()
  const { data } = await supabaseServer().from('members').select('id').eq('clerk_user_id', userId ?? '').maybeSingle()
  return data as { id: string } | null
}

describe('finding 1: a response of only ids, foreign keys and a status', () => {
  const unscoped = {
    async GET(_req: Request, { params }: Ctx) {
      const { id } = await params
      const { data } = await supabaseServer().from('registrations').select('id, event_id, status, team_id').eq('id', id).maybeSingle()
      if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      // Only these four fields: no name, email or text for the scanner to find.
      const d = data as Record<string, unknown>
      return NextResponse.json({ id: d.id, event_id: d.event_id, status: d.status, team_id: d.team_id })
    },
  }
  const oracle = {
    async GET(_req: Request, { params }: Ctx) {
      const { id } = await params
      const { data } = await supabaseServer().from('registrations').select('id').eq('id', id).maybeSingle()
      return NextResponse.json({ exists: !!data })
    },
  }
  const scoped = {
    async GET(_req: Request, { params }: Ctx) {
      const m = await me()
      const { id } = await params
      const { data } = await supabaseServer()
        .from('registrations')
        .select('id, event_id, status, team_id')
        .eq('id', id)
        .eq('member_id', m?.id ?? '')
        .maybeSingle()
      return NextResponse.json({ exists: !!data, registration: data })
    },
  }

  it('an unscoped read returning only id/event_id/status/team_id is a leak', async () => {
    const r = await runIdorCase(unscoped, byId, 'GET')
    expect(r.outcome).toBe('leak')
    expect(r.leaks.map((l) => l.value).join()).toMatch(/ca4af/)
  })
  it('an existence oracle ({ exists: !!data }) is caught by the differential run', async () => {
    const r = await runIdorCase(oracle, byId, 'GET')
    expect(r.outcome).toBe('oracle')
  })
  it('the same read scoped to the caller stays ok (no false positive)', async () => {
    const r = await runIdorCase(scoped, byId, 'GET')
    expect(r.outcome).toBe('ok')
  })
})

describe('finding 2: writes through rpc(), after() and fire-and-forget promises', () => {
  const viaRpc = {
    async POST(_req: Request, { params }: Ctx) {
      const { id } = await params
      await supabaseServer().rpc('withdraw_registration', { p_registration_id: id })
      return NextResponse.json({ ok: true })
    },
  }
  const viaAfter = {
    async POST(_req: Request, { params }: Ctx) {
      const { id } = await params
      after(async () => {
        await supabaseServer().from('registrations').delete().eq('id', id)
      })
      return NextResponse.json({ ok: true })
    },
  }
  const viaVoid = {
    async POST(_req: Request, { params }: Ctx) {
      const { id } = await params
      void (async () => {
        await new Promise((r) => setTimeout(r, 0))
        await supabaseServer().from('registrations').update({ status: 'withdrawn' }).eq('id', id)
      })()
      return NextResponse.json({ ok: true })
    },
  }
  for (const [name, mod] of [
    ['rpc()', viaRpc],
    ['after()', viaAfter],
    ['a fire-and-forget promise', viaVoid],
  ] as const) {
    it(`a write via ${name} is a honey_write`, async () => {
      const r = await runIdorCase(mod, byId, 'POST')
      expect(r.outcome).toBe('honey_write')
    })
  }
})

describe('finding 3: the canary needs the mutated case itself to report a failing outcome', () => {
  const line = (label: string, outcome: string) => JSON.stringify({ label, method: 'GET', status: 500, outcome })
  it('a crash (error outcome) is not "caught", even though the run failed', () => {
    expect(caughtFor(1, line('ownerFiltered', 'error'), 'ownerFiltered')).toBe(false)
  })
  it('a leak in a different case does not count for this mutation', () => {
    expect(caughtFor(1, line('app/api/other/route.ts', 'leak'), 'app/api/x/route.ts')).toBe(false)
  })
  it('a leak, honey_write or oracle in the mutated case does', () => {
    for (const o of ['leak', 'honey_write', 'oracle']) expect(caughtFor(1, line('ownerFiltered', o), 'ownerFiltered')).toBe(true)
    expect(caughtFor(0, line('ownerFiltered', 'leak'), 'ownerFiltered')).toBe(false)
  })
  it('a guard mutated to throw is recorded as error, so the canary reports it as SURVIVED', async () => {
    const throws = {
      async GET() {
        throw new Error('boom')
      },
    }
    const r = await runIdorCase(throws, byId, 'GET', 'participant', 'throws')
    expect(r.outcome).toBe('error')
    expect(caughtFor(1, JSON.stringify({ label: 'throws', outcome: r.outcome }), 'throws')).toBe(false)
  })
})

describe('findings 4 and 7: storage paths, emails, refs and nested body ids are id inputs', () => {
  const f = 'app/api/x/route.ts'
  it('the analyser keeps storagePath, path, email and ref, and nested array ids', () => {
    const src = `
      export async function POST(req) {
        const b = await req.json().catch(() => ({}))
        const storagePath = typeof b.storagePath === 'string' ? b.storagePath : ''
        const who = b.email; const note = b.note
        const ref = new URL(req.url).searchParams.get('ref')
        const rawItems = Array.isArray(b?.items) ? b.items : []
        for (const it of rawItems) { const id = String(it?.variantId || ''); const q = it.qty }
        b.lines.map((l) => l.productId)
      }`
    const r = requestIdInputs(f, src)
    expect(r.query).toEqual(['ref'])
    expect(r.body).toEqual(['email', 'items[].variantId', 'lines[].productId', 'storagePath'])
    expect(r.fill).toEqual(['items', 'lines', 'note'])
  })
  // idorTargets() parses every route file with the TypeScript compiler: CPU
  // bound, and over the 5 s default on a loaded CI runner (4 Nov). One call,
  // and an explicit budget.
  it('the routes the review named are now targets', { timeout: 30_000 }, () => {
    const targets = idorTargets()
    const files = targets.map((t) => t.file)
    for (const f of [
      'app/api/members/compliance/document/route.ts',
      'app/api/community/media/upload/route.ts',
      'app/api/community/resources/training-open/route.ts',
      'app/api/store/checkout/route.ts',
    ]) {
      expect(files, f).toContain(f)
    }
    const checkout = targets.find((t) => t.file === 'app/api/store/checkout/route.ts')
    expect(checkout?.body).toContain('items[].variantId')
  })
})

describe('finding 5: a caller-supplied memberId / coachId matched against an owner column', () => {
  const byMember = {
    async POST(req: Request) {
      const body = (await req.json()) as { memberId: string }
      const { data } = await supabaseServer().from('event_participations').select('*').eq('member_id', body.memberId)
      return NextResponse.json({ participations: data })
    },
  }
  const byCoach = {
    async GET(req: Request) {
      const coachId = new URL(req.url).searchParams.get('coachId') ?? ''
      const { data } = await supabaseServer().from('coaching_sessions').select('id, coach_id, starts_at').eq('coach_id', coachId)
      return NextResponse.json({ sessions: data })
    },
  }
  it('.eq(member_id, body.memberId) with no ownership check is a leak', async () => {
    const r = await runIdorCase(byMember, { segments: [], query: [], body: ['memberId'], urlPattern: '/api/probe' }, 'POST')
    expect(r.outcome).toBe('leak')
  })
  it('.eq(coach_id, ?coachId) with no ownership check is a leak', async () => {
    const r = await runIdorCase(byCoach, { segments: [], query: ['coachId'], body: [], urlPattern: '/api/probe' }, 'GET')
    expect(r.outcome).toBe('leak')
  })
})

describe('finding 6: a validation refusal before the id is used is unexercised, not refused', () => {
  const strict = {
    async POST(req: Request) {
      const b = (await req.json()) as { channelId?: string; body?: string }
      if (!b.channelId || !b.body) return NextResponse.json({ error: 'channelId and body required' }, { status: 400 })
      const { data } = await supabaseServer().from('channel_members').select('id').eq('channel_id', b.channelId).eq('member_id', 'me').maybeSingle()
      if (!data) return NextResponse.json({ error: 'Not a member' }, { status: 403 })
      return NextResponse.json({ ok: true })
    },
  }
  it('without the required non-id field the case is unexercised', async () => {
    const r = await runIdorCase(strict, { segments: [], query: [], body: ['channelId'], urlPattern: '/api/probe' }, 'POST')
    expect(r.status).toBe(400)
    expect(r.outcome).toBe('unexercised')
  })
  it('with the non-id field filled the id path runs and the scoped guard refuses', async () => {
    const r = await runIdorCase(strict, { segments: [], query: [], body: ['channelId'], fill: ['body'], urlPattern: '/api/probe' }, 'POST')
    expect(r.outcome).toBe('refused')
    expect(r.status).toBe(403)
  })
  it('the snapshot pins unexercised cases rather than calling them refused', () => {
    const snap = JSON.parse(readFileSync('test/idor/idor-snapshot.json', 'utf8')) as {
      targets: Record<string, { methods: Record<string, string | { outcome: string }> }>
    }
    const outcomes = Object.values(snap.targets).flatMap((t) => Object.values(t.methods).map((e) => (typeof e === 'string' ? e : e.outcome)))
    expect(outcomes).toContain('unexercised')
  })
})
