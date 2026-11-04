// The cross-tenant / IDOR harness: runs a real route handler with auth and the
// database mocked at the module boundary, as a tenant-A caller naming a
// tenant-B ("Canary Academy") honeytoken id, and classifies what came back.
//
// Boundaries replaced (see test/idor/mocks.ts, which registers them):
//   @clerk/nextjs/server   auth(), currentUser(), clerkClient() → the persona
//   @supabase/supabase-js  createClient() → test/idor/honey-db.ts
//   stripe                 every call rejects
//   next/headers, next/cache, next/server's after()  → inert
//   global fetch           → 503, recorded; raw sockets refuse to connect
// No network, no real database, no secrets.
//
// Outcomes:
//   leak         a honeytoken the caller did not send is in the response → FAIL
//   honey_write  an update/delete matched a Canary row, or an insert/upsert,
//                rpc() or storage write carried a Canary value          → FAIL
//   oracle       a 2xx whose status or body changes when tenant B's row is
//                removed (an existence oracle, or a response of fields the
//                scanner cannot recognise)                               → FAIL
//   refused      4xx, a redirect, notFound() / redirect()
//   unexercised  400/405/413/415/422 and no Canary value reached the database:
//                request validation refused before the id was used, so the
//                case proved nothing (pinned and capped, never "refused")
//   ok           2xx with none of tenant B's data and no honey write
//   error        5xx, or the handler threw (the harness could not model the path)
//
// Writes made after the response count: after() callbacks run, and the
// harness lets fire-and-forget promises settle, before it classifies.
//
// IDOR_RESULTS_FILE: when set, every case appends one JSON line
// ({ label, method, status, outcome }). scripts/idor-canary.mjs reads it to
// check a mutation failed for the right reason, not because a test crashed.
import { appendFileSync } from 'node:fs'
import net from 'node:net'
import { vi } from 'vitest'
import { HONEYTOKENS, honeytokenFor, isCanaryId, scanForHoneytokens, type HoneytokenHit } from '@/lib/testing/honeytokens'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import type { IdorTarget } from '@/lib/security/idor-targets'
import { honeyClient, newHoneyDbState, type HoneyDbState, type HoneyWrite } from './honey-db'

export type Outcome = 'leak' | 'honey_write' | 'oracle' | 'refused' | 'unexercised' | 'ok' | 'error'

/** Outcomes that mean tenant B's data or rows were reached: they fail unless accepted. */
export const FAILING_OUTCOMES: readonly Outcome[] = ['leak', 'honey_write', 'oracle']
export type Persona = 'participant' | 'anonymous'

/** Tenant A's participant: a signed-in, onboarded adult Stellr member. */
export const TENANT_A_PARTICIPANT = {
  clerkUserId: 'user_idor_tenant_a_participant',
  memberId: '00000000-0000-4000-8000-00000000a001',
  email: 'participant@tenant-a.invalid',
} as const

function tenantAMemberRow() {
  return {
    id: TENANT_A_PARTICIPANT.memberId,
    tenant_id: STELLR_TENANT_ID,
    clerk_user_id: TENANT_A_PARTICIPANT.clerkUserId,
    email: TENANT_A_PARTICIPANT.email,
    first_name: 'Tenant',
    last_name: 'Participant',
    role: 'student',
    is_active: true,
    date_of_birth: '2000-01-01',
    gender: 'prefer_not_to_say',
    age_bracket: 'adult',
    event_role: 'student',
    member_memberships: [],
    onboarding_completed: true,
    onboarded_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
  }
}

interface HarnessState {
  persona: Persona
  db: HoneyDbState
  fetches: string[]
  /** Callbacks handed to next/server after(): run before the case is classified. */
  afters: unknown[]
}

export const harness: HarnessState = {
  persona: 'participant',
  db: newHoneyDbState(),
  fetches: [],
  afters: [],
}

export function resetHarness(persona: Persona = 'participant', opts: { honeyAbsent?: boolean } = {}) {
  harness.persona = persona
  harness.db = newHoneyDbState(persona === 'participant' ? { members: [tenantAMemberRow()] } : {}, opts)
  harness.fetches = []
  harness.afters = []
}

// ── module boundary mocks (registered by test/idor/mocks.ts) ─────────────────

function sessionClaims() {
  return { sub: TENANT_A_PARTICIPANT.clerkUserId, metadata: { role: 'student' }, email: TENANT_A_PARTICIPANT.email }
}

function clerkUser() {
  return {
    id: TENANT_A_PARTICIPANT.clerkUserId,
    firstName: 'Tenant',
    lastName: 'Participant',
    fullName: 'Tenant Participant',
    primaryEmailAddressId: 'idn_tenant_a',
    primaryEmailAddress: { id: 'idn_tenant_a', emailAddress: TENANT_A_PARTICIPANT.email, verification: { status: 'verified' } },
    emailAddresses: [{ id: 'idn_tenant_a', emailAddress: TENANT_A_PARTICIPANT.email, verification: { status: 'verified' } }],
    publicMetadata: { role: 'student' },
    privateMetadata: {},
    unsafeMetadata: {},
  }
}

export function clerkServerMock(original: Record<string, unknown>) {
  const signedIn = () => harness.persona === 'participant'
  const authObject = () =>
    signedIn()
      ? {
          userId: TENANT_A_PARTICIPANT.clerkUserId,
          sessionId: 'sess_idor_tenant_a',
          orgId: null,
          sessionClaims: sessionClaims(),
          has: () => false,
          getToken: async () => null,
          redirectToSignIn: () => {
            throw new Error('redirectToSignIn')
          },
        }
      : {
          userId: null,
          sessionId: null,
          orgId: null,
          sessionClaims: null,
          has: () => false,
          getToken: async () => null,
          redirectToSignIn: () => {
            throw new Error('redirectToSignIn')
          },
        }
  const auth = Object.assign(async () => authObject(), {
    protect: async () => {
      if (!signedIn()) throw Object.assign(new Error('NEXT_HTTP_ERROR_FALLBACK;404'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' })
      return authObject()
    },
  })
  const notFound = () => Object.assign(new Error('Not Found'), { status: 404, errors: [{ code: 'resource_not_found' }] })
  const users = new Proxy(
    {
      getUser: async (id: string) => {
        if (id === HONEYTOKENS.clerkUserId || isCanaryId(id)) harness.db.touched = true
        if (signedIn() && id === TENANT_A_PARTICIPANT.clerkUserId) return clerkUser()
        throw notFound()
      },
      getUserList: async () => ({ data: [], totalCount: 0 }),
    } as Record<string, unknown>,
    { get: (t, p) => (typeof p === 'string' && p in t ? t[p] : async () => ({ data: [], totalCount: 0 })) },
  )
  const client = new Proxy({ users } as Record<string, unknown>, {
    get: (t, p) =>
      typeof p === 'string' && p in t
        ? t[p]
        : new Proxy({}, { get: () => async () => ({ data: [], totalCount: 0 }) }),
  })
  return {
    ...original,
    auth,
    currentUser: async () => (signedIn() ? clerkUser() : null),
    clerkClient: Object.assign(async () => client, client),
    getAuth: () => authObject(),
  }
}

export function supabaseJsMock(original: Record<string, unknown>) {
  return { ...original, createClient: () => honeyClient(harness.db) }
}

function rejecting(path: string): unknown {
  const fn = () => Promise.reject(new Error(`IDOR harness: ${path}() is disabled`))
  return new Proxy(fn, {
    get: (_t, p) => (p === 'then' ? undefined : typeof p === 'string' ? rejecting(`${path}.${p}`) : undefined),
    apply: () => Promise.reject(new Error(`IDOR harness: ${path}() is disabled`)),
    construct: () => rejecting(path) as object,
  })
}

export function stripeMock() {
  class Stripe {
    constructor() {
      return rejecting('stripe') as Stripe
    }
  }
  return { default: Stripe, Stripe }
}

export function nextHeadersMock() {
  const store = {
    get: () => undefined,
    getAll: () => [],
    has: () => false,
    set: () => store,
    delete: () => store,
    toString: () => '',
    [Symbol.iterator]: function* () {},
  }
  return {
    cookies: async () => store,
    headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.9', host: 'stellr.localhost' }),
    draftMode: async () => ({ isEnabled: false, enable: () => {}, disable: () => {} }),
  }
}

export function nextCacheMock(original: Record<string, unknown>) {
  return {
    ...original,
    revalidatePath: () => {},
    revalidateTag: () => {},
    updateTag: () => {},
    refresh: () => {},
    unstable_noStore: () => {},
    unstable_cache: <T extends (...a: unknown[]) => unknown>(fn: T) => fn,
    cacheLife: () => {},
    cacheTag: () => {},
  }
}

export function nextServerMock(original: Record<string, unknown>) {
  // after(cb) is collected, not dropped: runIdorCase runs every callback (and
  // awaits a promise passed directly) before it reads the recorded writes.
  return {
    ...original,
    after: (task: unknown) => {
      harness.afters.push(task)
    },
    connection: async () => {},
  }
}

/** Runs collected after() tasks, then lets fire-and-forget promises settle. */
async function settle() {
  for (let round = 0; round < 3; round++) {
    const tasks = harness.afters.splice(0)
    for (const t of tasks) {
      try {
        await (typeof t === 'function' ? (t as () => unknown)() : t)
      } catch {
        // A failing after() task does not change the response; its writes still count.
      }
    }
    // Macrotask turns: `void (async () => { await db…update() })()` chains
    // resolve on microtasks, so a few turns flush them.
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r))
    // …and a short timer turn for one that waits on a timer (`setTimeout(…, 0)`).
    await new Promise((r) => setTimeout(r, 2))
  }
}

let guarded = false
/** Global fetch → 503 and recorded; raw sockets refuse to connect. */
export function installNetworkGuard() {
  if (guarded) return
  guarded = true
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    harness.fetches.push(url)
    // A Canary value in an outbound URL means the id was used (scanned raw and URL-encoded).
    if (scanForHoneytokens(url).length) harness.db.touched = true
    return new Response(JSON.stringify({ error: 'network disabled in the IDOR harness' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  const connect = net.Socket.prototype.connect
  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
    const opts = args[0] as { path?: string } | undefined
    // Local IPC (a Unix socket path) is the test runner's own plumbing.
    if (opts && typeof opts === 'object' && typeof opts.path === 'string') {
      return (connect as (...a: unknown[]) => net.Socket).apply(this, args)
    }
    throw new Error('IDOR harness: network access is disabled')
  } as typeof connect
}

// ── running a case ───────────────────────────────────────────────────────────

export interface CaseInput {
  segments: string[]
  query: string[]
  /** Id-like body fields; `items[].variantId` names a field of an array element. */
  body: string[]
  /** Other body fields the handler reads: filled with plausible values so validation passes. */
  fill?: string[]
  urlPattern: string
}

/**
 * Id inputs whose value has a format around the id. Keyed by input name; the
 * value replaces honeytokenFor()'s plain id. Add one when a case reports
 * `unexercised` because the route parses the id out of a larger string.
 */
export const INPUT_FORMATS: Record<string, string> = {
  // community/resources/training-open: `ref=tr:<training item id>`
  ref: `tr:${HONEYTOKENS.id}`,
}

function inputValue(name: string): string | string[] {
  const key = name.replace(/^\.\.\./, '').split('.').pop() ?? name
  return INPUT_FORMATS[key] ?? honeytokenFor(name)
}

/** A plausible value for a non-id body field, so request validation lets the id through. */
export function fillerFor(name: string): unknown {
  const n = name.toLowerCase()
  if (/^(is|has|can|allow|show|enabled|active|accept|agree|consent|confirm)/.test(n)) return true
  if (/(^|_)(time)$|time$/.test(n) && !/datetime/.test(n)) return '10:00'
  if (/(date|_at$|at$|^start|^end|when|deadline|due)/.test(n)) return '2026-12-01T10:00:00.000Z'
  if (/(count|qty|quantity|amount|seats|rating|score|minutes|hours|duration|age|grade|year|limit|position|order|index|size|price)/.test(n)) return 1
  if (/(items|list|ids|entries|rows|options|tags)$/.test(n)) return []
  if (/(status|state)$/.test(n)) return 'completed'
  if (/(reaction|emoji)/.test(n)) return '👍'
  if (/(filetype|mimetype|contenttype|mime)$/.test(n)) return 'image/png'
  if (/(url|link|href)$/.test(n)) return 'https://example.invalid/idor'
  return 'IDOR harness text'
}

/** Sets `items[].variantId` (and plain `teamId`) on a body object. */
function setBodyField(body: Record<string, unknown>, field: string, value: unknown) {
  const m = field.match(/^([^[]+)\[\]\.(.+)$/)
  if (!m) {
    body[field] = value
    return
  }
  const list = Array.isArray(body[m[1]]) && (body[m[1]] as unknown[]).length ? (body[m[1]] as Record<string, unknown>[]) : [{}]
  list[0] = { ...(list[0] ?? {}), [m[2]]: value }
  body[m[1]] = list
}

export interface CaseResult {
  method: string
  status: number
  outcome: Outcome
  leaks: HoneytokenHit[]
  writes: HoneyWrite[]
  error?: string
  /** For an `oracle` outcome: the two responses that differed. */
  oracle?: string
}

let ipSeq = 0

/** A handler that has not answered by then is recorded as an error, not a pass. */
export const CASE_TIMEOUT_MS = 5_000

/** The request a tenant-A caller sends to name tenant B's record. */
export async function buildRequest(input: CaseInput, method: string) {
  // The real NextRequest: 'next/server' itself is mocked (after()), and its
  // factory imports this file, so a static import here would deadlock.
  const { NextRequest } = await vi.importActual<typeof import('next/server')>('next/server')
  const sent = new Set<string>()
  const params: Record<string, string | string[]> = {}
  let path = input.urlPattern
  for (const seg of input.segments) {
    const value = inputValue(seg)
    const name = seg.replace(/^\.\.\./, '')
    params[name] = value
    for (const v of [value].flat()) sent.add(v)
    const text = Array.isArray(value) ? value.map(encodeURIComponent).join('/') : encodeURIComponent(value)
    path = path.replace(new RegExp(`\\[\\[?(\\.\\.\\.)?${name}\\]?\\]`), text)
  }
  const url = new URL(`http://stellr.localhost${path}`)
  for (const q of input.query) {
    const v = inputValue(q)
    for (const x of [v].flat()) {
      url.searchParams.append(q, x)
      sent.add(x)
    }
  }
  const body: Record<string, unknown> = {}
  for (const f of input.fill ?? []) setBodyField(body, f, fillerFor(f))
  for (const b of input.body) {
    const v = inputValue(b)
    setBodyField(body, b, v)
    for (const x of [v].flat()) sent.add(x)
  }
  // A formatted input (`tr:<id>`) sends the plain id too: echoing it back tells the caller nothing.
  for (const name of [...input.segments, ...input.query, ...input.body]) {
    const key = name.replace(/^\.\.\./, '').split('.').pop() ?? name
    if (INPUT_FORMATS[key]) for (const x of [honeytokenFor(name)].flat()) sent.add(x)
  }
  ipSeq = (ipSeq + 1) % 250
  const hasBody = method !== 'GET' && method !== 'HEAD'
  const req = new NextRequest(url, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `203.0.113.${ipSeq + 1}`,
      'user-agent': 'idor-harness',
      origin: 'http://stellr.localhost',
    },
    body: hasBody ? JSON.stringify(body) : undefined,
  })
  return { req, params, sent: [...sent] }
}

function digestOf(e: unknown): string {
  if (e && typeof e === 'object' && 'digest' in e && typeof (e as { digest: unknown }).digest === 'string') {
    return (e as { digest: string }).digest
  }
  return ''
}

type Handler = (req: Request, ctx: { params: Promise<Record<string, string | string[]>> }) => unknown

interface RawRun {
  status: number
  /** Response headers and body. */
  text: string
  /** Body only, for the differential comparison. */
  body: string
  error?: string
}

/** One call of the handler, then after() tasks and stray promises are settled. */
async function invoke(handler: Handler, input: CaseInput, method: string): Promise<RawRun & { sent: string[] }> {
  const { req, params, sent } = await buildRequest(input, method)
  let status = 0
  let text = ''
  let body = ''
  let error: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`IDOR harness: ${method} did not settle in ${CASE_TIMEOUT_MS} ms`)), CASE_TIMEOUT_MS)
  })
  try {
    const res = (await Promise.race([handler(req, { params: Promise.resolve(params) }), timeout])) as Response | undefined
    if (!res || typeof (res as Response).status !== 'number') {
      status = 200
      body = res == null ? '' : safeJson(res)
      text = body
    } else {
      status = res.status
      const headers: string[] = []
      res.headers.forEach((v, k) => headers.push(`${k}: ${v}`))
      try {
        body = new TextDecoder().decode(await res.arrayBuffer())
      } catch {
        body = ''
      }
      text = `${headers.join('\n')}\n\n${body}`
      const location = res.headers.get('location')
      if (location) body = `location: ${location}\n${body}`
    }
  } catch (e) {
    const digest = digestOf(e)
    if (digest.startsWith('NEXT_REDIRECT')) {
      status = 307
      text = digest
      body = digest
    } else if (digest.startsWith('NEXT_HTTP_ERROR_FALLBACK;')) {
      status = Number(digest.split(';')[1]) || 404
    } else {
      status = 500
      error = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 300) : String(e).slice(0, 300)
    }
  }
  try {
    await Promise.race([settle(), timeout])
  } catch (e) {
    error ??= e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300)
  } finally {
    clearTimeout(timer)
  }
  return { status, text, body, error, sent }
}

/** Strips what legitimately differs between two runs: timestamps and random ids. */
function normalise(s: string): string {
  return s
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, '<ts>')
    .replace(/\b\d{12,}\b/g, '<n>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (u) => (isCanaryId(u) ? u : '<uuid>'))
}

/** Statuses that reject the request's shape, not the caller: with nothing touched, the id was never tried. */
const INVALID_REQUEST = [400, 405, 413, 415, 422]

export async function runIdorCase(
  mod: Record<string, unknown>,
  input: CaseInput,
  method: string,
  persona: Persona = 'participant',
  label = input.urlPattern,
): Promise<CaseResult> {
  const handler = mod[method] as Handler | undefined
  if (typeof handler !== 'function') throw new Error(`no ${method} export`)

  resetHarness(persona)
  const run = await invoke(handler, input, method)
  const { status, error } = run
  const leaks = scanForHoneytokens(run.text, { sent: run.sent })
  const writes = [...harness.db.writes]
  const touched = harness.db.touched

  let outcome: Outcome
  if (leaks.length) outcome = 'leak'
  else if (writes.length) outcome = 'honey_write'
  else if (status >= 500 || status === 0) outcome = 'error'
  else if (status >= 300) outcome = INVALID_REQUEST.includes(status) && !touched ? 'unexercised' : 'refused'
  else outcome = 'ok'

  // Differential: a 2xx must not depend on tenant B's row. Run again with the
  // honey row gone; a different status or body is an existence oracle (or B's
  // data in a shape the scanner cannot recognise).
  let oracle: string | undefined
  if (outcome === 'ok') {
    resetHarness(persona, { honeyAbsent: true })
    const without = await invoke(handler, input, method)
    if (without.status !== status || normalise(without.body) !== normalise(run.body)) {
      outcome = 'oracle'
      oracle = `with tenant B's row: ${status} ${run.body.slice(0, 120)} | without: ${without.status} ${without.body.slice(0, 120)}`
    }
  }
  resetHarness(persona)

  if (process.env.IDOR_RESULTS_FILE) {
    appendFileSync(process.env.IDOR_RESULTS_FILE, JSON.stringify({ label, method, status, outcome }) + '\n')
  }
  return { method, status, outcome, leaks, writes, error, oracle }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? ''
  } catch {
    return String(v)
  }
}

export function targetInput(t: IdorTarget): CaseInput {
  return { segments: t.segments, query: t.query, body: t.body, fill: t.fill, urlPattern: t.urlPattern }
}

export { HONEYTOKENS }
