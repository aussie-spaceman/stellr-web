// @vitest-environment node
//
// Another tenant's survey sends no email yet (S5 wave 7, decision W7-16, lib/survey/hold.ts):
// its links are on Stellr's host, which since A10b refuses another tenant's token. Every send
// path holds it, decided from the distribution in hand, before any budget claim or consent
// read: the queued invitations are kept and labelled, nothing is sent. Stellr's surveys (a
// NULL tenant is Stellr's) send, claim and read exactly as before. The last block checks the
// source, so a new path that calls sendEmail without asking the hold cannot land.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID as STELLR } from '@/lib/tenancy/constants'
import { fakeChainDb, type ChainCall, type Row } from '@/test/helpers/fake-chain-db'

const CANARY = 'c0000000-0000-4000-8000-0000000000aa'

const h = vi.hoisted(() => ({
  sendEmail: vi.fn(async (_m: unknown) => ({ id: 'email_1' })),
  unconsented: vi.fn(async (_db: unknown, _tenantId: string) => new Set<string>()),
}))

vi.mock('@/lib/email', async (orig) => ({ ...(await orig<Record<string, unknown>>()), sendEmail: h.sendEmail }))
vi.mock('@/lib/registration/tenant-guardian-consent', () => ({ unconsentedParticipantIds: h.unconsented }))
vi.mock('@/lib/survey/events', () => ({ loadAllSurveyEvents: async () => [], loadSurveyEvent: async () => null }))

const { sendQueued, sendReminders, resendInvitation, sendLinkEmail, emptyTally } = await import('./send')
const { HELD_FOR_TENANT_SURVEY, HELD_FOR_TENANT_SURVEY_RESEND, surveySendsHeld } = await import('./hold')
const { adminSurveyView } = await import('./admin')

type Inv = Parameters<typeof sendLinkEmail>[1]
type Dist = Parameters<typeof sendLinkEmail>[2]
const DEF = { targetMinutes: { student: 5, mentor: 5, adult: 5 } } as unknown as Parameters<typeof sendQueued>[2]
const NOW = new Date('2099-05-10T12:00:00Z')
const SOON = () => Date.now() + 60_000

function distribution(tenant: string | null): Dist {
  return {
    id: 'dist-1', definition_id: 'def-1', event_slug: 'the-event', event_title: 'The Event', event_date: '2099-05-01',
    event_time_zone: 'UTC', audiences: ['student', 'mentor', 'adult'], status: 'open', opens_at: '2099-05-01T00:00:00Z',
    closes_at: '2099-05-30T00:00:00Z', opens_at_source: 'auto', schedule_flag: null, minor_agreement_override: false, tenant_id: tenant,
  } as unknown as Dist
}

function invitation(id: string, status = 'queued', extra: Row = {}): Inv {
  return {
    id, distribution_id: 'dist-1', recipient_key: `email:${id}@example.test`, participant_id: `p-${id}`, member_id: null,
    respondent_role: 'student', adult_relationship: null, first_name: id, is_minor: false, email: `${id}@example.test`, send_via: 'self',
    token_version: 1, status, sent_at: status === 'queued' ? null : '2099-05-02T00:00:00Z', send_attempts: 0, last_send_error: null,
    first_opened_at: null, last_activity_at: null, opened_from: null, reminder_count: 0, resume_reminder_count: 0, last_reminder_at: null,
    reminders_opted_out_at: null, created_at: '2099-05-01T00:00:00Z', tenant_id: null, survey_responses: null, ...extra,
  } as unknown as Inv
}

const INVITATIONS = (status = 'queued') => [invitation('inv-a', status), invitation('inv-b', status)]
const keys = (invs: Inv[]) => new Set(invs.map((i) => i.recipient_key))

function db(invitations: Inv[] = []) {
  return fakeChainDb(
    (call: ChainCall) => {
      if (call.table === 'survey_invitations' && call.op === 'select') return { data: invitations, error: null }
      if (call.table === 'survey_invitations' && call.op === 'update') return { data: [{ id: 'claimed' }], error: null }
      return { data: [], error: null }
    },
    (fn) => (fn === 'survey_claim_email' ? { data: true, error: null } : { data: null, error: null }),
  )
}

const sentTo = () => h.sendEmail.mock.calls.map((c) => (c[0] as { to: string }).to)
const claims = (rpcCalls: { fn: string }[]) => rpcCalls.filter((c) => c.fn === 'survey_claim_email').length
const updates = (calls: ChainCall[]) => calls.filter((c) => c.table === 'survey_invitations' && c.op === 'update')
const idOf = (c: ChainCall) => c.filters.find((f) => f.method === 'eq' && f.args[0] === 'id')?.args[1]
const labelled = (calls: ChainCall[]) => updates(calls).filter((c) => (c.payload as Row).last_send_error === HELD_FOR_TENANT_SURVEY).map(idOf)
const filtersOf = (c: ChainCall) => c.filters.map((f) => [f.method, ...f.args])
/** The one write that labels a held distribution's queued invitations, past the page read too. */
const BULK_LABEL = [
  ['eq', 'distribution_id', 'dist-1'],
  ['eq', 'status', 'queued'],
  ['lt', 'send_attempts', 3],
  ['or', `last_send_error.is.null,last_send_error.neq."${'Held: surveys for this organisation’s events can’t be sent yet.'}"`],
]
/** Every database call, as table:op, in order: what "the same reads and writes" means here. */
const trace = (calls: ChainCall[]) => calls.map((c) => `${c.table}:${c.op}:${Object.keys((c.payload as Row | undefined) ?? {}).sort().join(',')}`)

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubEnv('SURVEY_TOKEN_SECRET', 'placeholder-survey-token-secret-for-tests-only')
  h.sendEmail.mockClear()
  h.unconsented.mockClear()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('surveySendsHeld', () => {
  it("holds another tenant's survey and not Stellr's", () => {
    expect(surveySendsHeld(STELLR)).toBe(false)
    expect(surveySendsHeld(CANARY)).toBe(true)
  })
})

describe('the queued invitations', () => {
  it("Stellr's, a NULL tenant included, send each one and claim the budget for each, with the same calls and no consent read", async () => {
    const traces = []
    for (const tenant of [STELLR, null]) {
      const { db: client, calls, rpcCalls } = db(INVITATIONS())
      const tally = emptyTally()
      await sendQueued(client, distribution(tenant), DEF, keys(INVITATIONS()), tally, SOON(), NOW)
      expect(tally.invited).toBe(2)
      expect(claims(rpcCalls)).toBe(2)
      expect(labelled(calls)).toEqual([])
      traces.push(trace(calls))
    }
    expect(traces[0]).toEqual(traces[1])
    expect(traces[0]).toEqual([
      'survey_invitations:select:',
      'survey_invitations:update:send_attempts',
      'survey_invitations:update:last_send_error,sent_at,status',
      'survey_invitations:update:send_attempts',
      'survey_invitations:update:last_send_error,sent_at,status',
    ])
    expect(sentTo()).toEqual(['inv-a@example.test', 'inv-b@example.test', 'inv-a@example.test', 'inv-b@example.test'])
    expect(h.unconsented).not.toHaveBeenCalled()
  })

  it("another tenant's are kept queued and labelled in one write: nothing sent, no budget claimed, no consent read", async () => {
    const { db: client, calls, rpcCalls } = db(INVITATIONS())
    const tally = emptyTally()
    await sendQueued(client, distribution(CANARY), DEF, keys(INVITATIONS()), tally, SOON(), NOW)
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(rpcCalls).toEqual([])
    expect(h.unconsented).not.toHaveBeenCalled()
    // Labelled only, the whole distribution at once: no status, no attempt counted, so they send once the hold lifts.
    expect(updates(calls).map((c) => [c.payload, filtersOf(c)])).toEqual([[{ last_send_error: HELD_FOR_TENANT_SURVEY }, BULK_LABEL]])
    expect(tally).toEqual(emptyTally())
  })

  it("another tenant's past the page read are labelled too: a full page, all labelled, still writes", async () => {
    const page = Array.from({ length: 200 }, (_, n) => invitation(`inv-${n}`, 'queued', { last_send_error: HELD_FOR_TENANT_SURVEY }))
    const { db: client, calls, rpcCalls } = db(page)
    await sendQueued(client, distribution(CANARY), DEF, keys(page), emptyTally(), SOON(), NOW)
    expect(updates(calls).map(filtersOf)).toEqual([BULK_LABEL])
    expect(rpcCalls).toEqual([])
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it("another tenant's already labelled are not written again, and one no longer invitable is still expired", async () => {
    const invs = [invitation('inv-a', 'queued', { last_send_error: HELD_FOR_TENANT_SURVEY }), invitation('inv-gone', 'queued', { last_send_error: HELD_FOR_TENANT_SURVEY })]
    const { db: client, calls, rpcCalls } = db(invs)
    await sendQueued(client, distribution(CANARY), DEF, new Set([invs[0].recipient_key]), emptyTally(), SOON(), NOW)
    expect(updates(calls).map((c) => [idOf(c), c.payload])).toEqual([['inv-gone', { status: 'expired' }]])
    expect(rpcCalls).toEqual([])
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it("another tenant's past the deadline count nothing as deferred; Stellr's still do", async () => {
    const past = Date.now() - 1
    const held = emptyTally()
    await sendQueued(db(INVITATIONS()).db, distribution(CANARY), DEF, keys(INVITATIONS()), held, past, NOW)
    expect(held).toEqual(emptyTally())
    const stellr = emptyTally()
    await sendQueued(db(INVITATIONS()).db, distribution(STELLR), DEF, keys(INVITATIONS()), stellr, past, NOW)
    expect(stellr.deferred).toBe(2)
    expect(h.sendEmail).not.toHaveBeenCalled()
  })
})

describe('the reminders', () => {
  it("Stellr's, a NULL tenant included, send the due reminders and claim the budget for each", async () => {
    for (const tenant of [STELLR, null]) {
      const { db: client, calls, rpcCalls } = db(INVITATIONS('sent'))
      const tally = emptyTally()
      await sendReminders(client, distribution(tenant), DEF, keys(INVITATIONS()), tally, SOON(), NOW)
      expect(tally.reminded).toBe(2)
      expect(claims(rpcCalls)).toBe(2)
      expect(trace(calls)).toEqual(['survey_invitations:select:', 'survey_invitations:update:last_reminder_at,reminder_count', 'survey_invitations:update:last_reminder_at,reminder_count'])
    }
    expect(sentTo()).toHaveLength(4)
    expect(h.unconsented).not.toHaveBeenCalled()
  })

  it("another tenant's send none, and read nothing", async () => {
    const { db: client, calls, rpcCalls } = db(INVITATIONS('sent'))
    const tally = emptyTally()
    await sendReminders(client, distribution(CANARY), DEF, keys(INVITATIONS()), tally, SOON(), NOW)
    expect(calls).toEqual([])
    expect(rpcCalls).toEqual([])
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(h.unconsented).not.toHaveBeenCalled()
    expect(tally).toEqual(emptyTally())
  })
})

describe("an admin's resend", () => {
  it("Stellr's, a NULL tenant included, sends and claims the budget", async () => {
    for (const tenant of [STELLR, null]) {
      const { db: client, calls, rpcCalls } = db()
      expect(await resendInvitation(client, invitation('inv-a'), distribution(tenant), DEF)).toEqual({ ok: true })
      expect(claims(rpcCalls)).toBe(1)
      expect(trace(calls)).toEqual(['survey_invitations:update:last_send_error,sent_at,status'])
      expect(labelled(calls)).toEqual([])
    }
    expect(sentTo()).toEqual(['inv-a@example.test', 'inv-a@example.test'])
    expect(h.unconsented).not.toHaveBeenCalled()
  })

  it("another tenant's queued one is refused and labelled: nothing sent, no budget claimed, no consent read", async () => {
    const { db: client, calls, rpcCalls } = db()
    expect(await resendInvitation(client, invitation('inv-a'), distribution(CANARY), DEF)).toEqual({ ok: false, error: HELD_FOR_TENANT_SURVEY_RESEND })
    expect(labelled(calls)).toEqual(['inv-a'])
    expect(updates(calls)).toHaveLength(1)
    expect(rpcCalls).toEqual([])
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(h.unconsented).not.toHaveBeenCalled()
  })

  it("another tenant's that is not queued is refused and keeps its own last error: no write", async () => {
    for (const status of ['expired', 'sent', 'opened', 'started', 'bounced']) {
      const { db: client, calls, rpcCalls } = db()
      const inv = invitation('inv-a', status, { last_send_error: 'Resend said no' })
      expect(await resendInvitation(client, inv, distribution(CANARY), DEF)).toEqual({ ok: false, error: HELD_FOR_TENANT_SURVEY_RESEND })
      expect(calls, status).toEqual([])
      expect(rpcCalls, status).toEqual([])
    }
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it("another tenant's submitted one still answers as submitted", async () => {
    const { db: client, calls } = db()
    expect(await resendInvitation(client, invitation('inv-a', 'submitted'), distribution(CANARY), DEF)).toEqual({ ok: false, error: 'Already submitted.' })
    expect(calls).toEqual([])
  })
})

describe('"email me my link"', () => {
  it("Stellr's, a NULL tenant included, sends and claims the budget", async () => {
    for (const tenant of [STELLR, null]) {
      const { db: client, calls, rpcCalls } = db()
      expect(await sendLinkEmail(client, invitation('inv-a'), distribution(tenant), DEF)).toBe(true)
      expect(claims(rpcCalls)).toBe(1)
      expect(calls).toEqual([])
    }
    expect(sentTo()).toEqual(['inv-a@example.test', 'inv-a@example.test'])
  })

  it("another tenant's sends nothing, and reads, writes and claims nothing (the route answers the same)", async () => {
    const { db: client, calls, rpcCalls } = db()
    // Left to read the consent itself, it still reads nothing.
    expect(await sendLinkEmail(client, invitation('inv-a'), distribution(CANARY), DEF)).toBe(false)
    expect(await sendLinkEmail(client, invitation('inv-a'), distribution(CANARY), DEF, null)).toBe(false)
    expect(calls).toEqual([])
    expect(rpcCalls).toEqual([])
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(h.unconsented).not.toHaveBeenCalled()
  })
})

describe('the admin Survey tab', () => {
  it('shows a held invitation as held, with its label, and a failed one as failed', async () => {
    const rows = [
      { ...invitation('inv-held'), last_send_error: HELD_FOR_TENANT_SURVEY },
      // Expired after it was labelled: it never goes out, so it is not shown as held.
      { ...invitation('inv-expired', 'expired'), last_send_error: HELD_FOR_TENANT_SURVEY },
      { ...invitation('inv-failed'), last_send_error: 'Resend said no' },
      invitation('inv-fine'),
    ]
    const { db: client } = fakeChainDb((call: ChainCall) => {
      if (call.table === 'survey_distributions') return { data: distribution(STELLR), error: null }
      if (call.table === 'survey_definitions') return { data: null, error: null }
      if (call.table === 'survey_invitations') return { data: rows, error: null }
      return { data: [], error: null }
    })
    const view = await adminSurveyView(client, 'the-event', NOW)
    const byId = Object.fromEntries(view.rows.map((r) => [r.invitationId, [r.held, r.lastError]]))
    expect(byId).toEqual({
      'inv-held': [true, HELD_FOR_TENANT_SURVEY],
      'inv-expired': [false, HELD_FOR_TENANT_SURVEY],
      'inv-failed': [false, 'Resend said no'],
      'inv-fine': [false, null],
    })
  })
})

// ── Every survey email goes through the hold ─────────────────────────────────

const ROOT = process.cwd()
/** Where survey email is sent from: the survey library and the survey routes and cron. */
const SURVEY_DIRS = ['lib/survey', 'app/api/survey', 'app/api/admin/events/[slug]/survey', 'app/api/cron/surveys']

function sources(dir: string): string[] {
  const abs = path.join(ROOT, dir)
  return readdirSync(abs).flatMap((name) => {
    const full = path.join(abs, name)
    if (statSync(full).isDirectory()) return sources(path.join(dir, name))
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path.join(dir, name)] : []
  })
}

/** The source of send.ts split into its top-level functions and arrow-function consts, by name. */
function functionsOf(src: string): Map<string, string> {
  const out = new Map<string, string>()
  const starts = [...src.matchAll(/^(?:export )?(?:(?:async )?function (\w+)|const (\w+)\s*(?::[^=\n]+)?=\s*(?:async\s*)?(?:<[^\n]*?>\s*)?(?:\(|\w+\s*=>))/gm)]
  starts.forEach((m, i) => out.set(m[1] ?? m[2], src.slice(m.index, starts[i + 1]?.index ?? src.length)))
  return out
}

describe('the hold guards every survey email', () => {
  const send = readFileSync(path.join(ROOT, 'lib/survey/send.ts'), 'utf8')
  const fns = functionsOf(send)

  it('only lib/survey/send.ts calls sendEmail, once, in deliver(), after the hold', () => {
    const callers = SURVEY_DIRS.flatMap(sources).filter((f) => /\bsendEmail\b/.test(readFileSync(path.join(ROOT, f), 'utf8')))
    expect(callers).toEqual(['lib/survey/send.ts'])
    expect(send.match(/\bsendEmail\(/g)).toHaveLength(1)
    const deliver = fns.get('deliver')!
    expect(deliver).toContain('sendEmail(')
    expect(deliver.indexOf('if (sendsHeld(d)) throw')).toBeGreaterThan(-1)
    expect(deliver.indexOf('if (sendsHeld(d)) throw')).toBeLessThan(deliver.indexOf('sendEmail('))
  })

  it('every function that delivers asks the hold before it claims the budget or delivers', () => {
    const delivering = [...fns].filter(([name, body]) => name !== 'deliver' && body.includes('deliver('))
    expect(delivering.map(([name]) => name).sort()).toEqual(['resendInvitation', 'sendLinkEmail', 'sendQueued', 'sendReminders'])
    // However a new caller is written, every deliver( call is in one of these four.
    const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const count = (text: string) => (code(text).match(/\bdeliver\(/g) ?? []).length
    expect(count(send) - count(fns.get('deliver')!)).toBe(delivering.reduce((n, [, body]) => n + count(body), 0))
    for (const [name, body] of delivering) {
      const guard = body.search(/if \((sendsHeld\(d\)|tenantHeld)\)/)
      expect(guard, name).toBeGreaterThan(-1)
      expect(guard, name).toBeLessThan(body.indexOf('claimBudget('))
      expect(guard, name).toBeLessThan(body.indexOf('deliver('))
    }
  })
})
