// The cross-tenant / IDOR harness: runs a real route handler with auth and the
// database mocked at the module boundary, as a tenant-A caller naming a
// tenant-B ("Canary Academy") honeytoken id, and classifies what came back.
//
// Boundaries replaced (see test/idor/mocks.ts, which registers them):
//   @clerk/nextjs/server   auth(), currentUser(), clerkClient() → the persona
//   @supabase/supabase-js  createClient() → test/idor/honey-db.ts
//   stripe                 every call rejects, unless the case's fixture answers it
//   next/headers, next/cache, next/server's after()  → inert
//   global fetch           → 503, recorded, unless the case's fixture answers it;
//                            raw sockets refuse to connect
// No network, no real database, no secrets. Per-route fixtures, which only get a
// request further and never decide its outcome: test/idor/case-fixtures.ts.
//
// Outcomes:
//   leak         a honeytoken the caller did not send is in the response → FAIL
//   honey_write  an update/delete matched a Canary row, or an insert/upsert,
//                rpc() or storage write carried a Canary value, or a fetch
//                a fixture answered carried one the caller did not send → FAIL
//   oracle      a 2xx whose status or body changes when tenant B's row is
//                removed (an existence oracle, or a response of fields the
//                scanner cannot recognise)                               → FAIL
//   oracle_4xx   strict cases only: a refusal whose status or body changes with
//                tenant B's row present, absent, or the id malformed (a 403
//                against a 404 says the record exists)                   → FAIL
//   refused      4xx, a redirect, notFound() / redirect()
//   unexercised  400/405/413/415/422 and no Canary value reached the database:
//                request validation refused before the id was used, so the
//                case proved nothing (pinned and capped, never "refused").
//                Also any 429: a rate limit says nothing about the record.
//   ok           2xx with none of tenant B's data and no honey write
//   error        5xx, or the handler threw (the harness could not model the path)
//
// Writes made after the response count: after() callbacks run, and the
// harness lets fire-and-forget promises settle, before it classifies.
//
// Every refusal is run three ways: honey row present, absent, and the id malformed
// (with the database failing a non-uuid on a uuid column, as Postgres does). A
// difference is `oracle_4xx` in a strict case (tenant_crew, platform_admin and
// platform_destined routes, and the tenant-host suite) and otherwise is only reported, in CaseResult.reportedOracle.
// A strict case also counts an outbound request nobody answered: the send was made, and
// a uniform response must not hide one that carries tenant B's data.
//
// Personas and direction. `participant` and `anonymous` run in either direction: on
// Stellr's host naming a Canary record (the default), or on Canary's host naming a
// Stellr one. The staff personas each have one:
//   stellr_crew          a Stellr tenant admin naming a Canary record
//   canary_admin          a Canary tenant admin naming a Stellr record
//   stellr_event_manager  assigned to one Stellr event, naming another event's record
// Staff run with AUTHZ_SOURCE=postgres and LOADSCOPED_MODE=enforce: their roles are
// tenant_memberships rows, which is the only way a Canary admin can exist.
//
// IDOR_RESULTS_FILE: when set, every case appends one JSON line
// ({ label, method, status, outcome }). scripts/idor-canary.mjs reads it to
// check a mutation failed for the right reason, not because a test crashed.
import { appendFileSync } from 'node:fs'
import net from 'node:net'
import { vi } from 'vitest'
import { isCataloguedAction } from '@/lib/audit/actions'
import { auditHandlers } from '@/lib/security/audit-coverage'
import { GUARD_EXCEPTIONS } from '@/lib/security/route-guards'
import { CANARY_TENANT, HONEYTOKENS, honeytokenFor, isCanaryId, scanForHoneytokens, type HoneytokenHit } from '@/lib/testing/honeytokens'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { TENANT_ID_HEADER, TENANT_SLUG_HEADER } from '@/lib/tenancy/host'
import type { IdorTarget } from '@/lib/security/idor-targets'
import { applyEnv, CASE_FIXTURES, fixtureFor, type CaseFixture } from './case-fixtures'
// Not lib/tenancy/area-switch: it loads next/server, which this file mocks (a cycle).
import { setTenantDbDriver } from '@/lib/tenancy/db'
import { honeyClient, newHoneyDbState, type HoneyDbState, type HoneyWrite } from './honey-db'
import { honeyTenantDriver } from './tenant-db-fake'

export type Outcome = 'leak' | 'honey_write' | 'oracle' | 'oracle_4xx' | 'refused' | 'unexercised' | 'ok' | 'error'

/** Outcomes that mean tenant B's data or rows were reached: they fail unless accepted. */
export const FAILING_OUTCOMES: readonly Outcome[] = ['leak', 'honey_write', 'oracle', 'oracle_4xx']
export type Persona = 'participant' | 'anonymous' | 'stellr_crew' | 'canary_admin' | 'stellr_event_manager'
export type CrewPersona = Extract<Persona, 'stellr_crew' | 'canary_admin' | 'stellr_event_manager'>
/** Which host the caller is on, and so whose record the foreign id names. */
export type Direction = 'stellr_to_canary' | 'canary_to_stellr'
/** Why a refusal differed: with the row there and gone, or between no row and a malformed id. */
export type OracleKind = 'presence' | 'malformed'

/** Host, the caller's tenant and the honey row's tenant, for one case. */
export interface CaseContext {
  host: string
  callerTenantId: string
  honeyTenantId: string
}

export const STELLR_HOST = 'stellr.localhost'

export const DIRECTIONS: Record<Direction, CaseContext> = {
  stellr_to_canary: { host: STELLR_HOST, callerTenantId: STELLR_TENANT_ID, honeyTenantId: CANARY_TENANT.id },
  canary_to_stellr: { host: CANARY_TENANT.host, callerTenantId: CANARY_TENANT.id, honeyTenantId: STELLR_TENANT_ID },
}

/** The event a stellr_event_manager is assigned to. The honey row is always in another one. */
export const ASSIGNED_EVENT_SLUG = 'idor-assigned-event-x'

const CREW: Record<CrewPersona, { role: string; membership: string; context: CaseContext }> = {
  stellr_crew: { role: 'admin', membership: 'tenant_admin', context: DIRECTIONS.stellr_to_canary },
  // Clerk roles span subdomains, so this one holds no Clerk staff role: only a membership.
  canary_admin: { role: 'student', membership: 'tenant_admin', context: DIRECTIONS.canary_to_stellr },
  // The same tenant as the record: only the event filter can stop it.
  stellr_event_manager: {
    role: 'event_manager',
    membership: 'event_manager',
    context: { host: STELLR_HOST, callerTenantId: STELLR_TENANT_ID, honeyTenantId: STELLR_TENANT_ID },
  },
}

const isCrewPersona = (p: Persona): p is CrewPersona => p in CREW

export type CrewRouteClass = 'tenant_crew' | 'platform_admin' | 'platform_destined'

/** What each staff-facing route class runs. A platform route must refuse the tenant admin. */
export const CREW_PERSONAS_FOR: Record<CrewRouteClass, readonly CrewPersona[]> = {
  tenant_crew: ['stellr_crew', 'canary_admin', 'stellr_event_manager'],
  platform_admin: ['canary_admin'],
  platform_destined: ['canary_admin'],
}

/** Tenant A's participant: a signed-in, onboarded adult Stellr member. */
export const TENANT_A_PARTICIPANT = {
  clerkUserId: 'user_idor_tenant_a_participant',
  memberId: '00000000-0000-4000-8000-00000000a001',
  email: 'participant@tenant-a.invalid',
} as const

function tenantAMemberRow(tenantId: string) {
  return {
    id: TENANT_A_PARTICIPANT.memberId,
    tenant_id: tenantId,
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
  /** Emails asked for and outbound requests with a method other than GET. */
  sends: number
  /** Callbacks handed to next/server after(): run before the case is classified. */
  afters: unknown[]
  /** The running case's fixture, if any (test/idor/case-fixtures.ts). */
  fixture?: CaseFixture
  /** The Canary values the running case's caller sent. */
  sent: string[]
  context: CaseContext
  /** The session cookies the running request carries. */
  cookies: Record<string, string>
  /** The running case is strict: an unanswered outbound body counts as well. */
  strict: boolean
  /** The action of each platform audit event the running case wrote. */
  audits: string[]
}

export const harness: HarnessState = {
  persona: 'participant',
  db: newHoneyDbState(),
  fetches: [],
  sends: 0,
  afters: [],
  sent: [],
  context: DIRECTIONS.stellr_to_canary,
  cookies: {},
  strict: false,
  audits: [],
}

export interface ResetOptions {
  honeyAbsent?: boolean
  fixture?: CaseFixture
  context?: CaseContext
  modelUuidErrors?: boolean
  strict?: boolean
}

/** Values that, bound in a tenantDb statement, scope it to the running case's caller. */
function scopingValues(): string[] {
  const own: string[] = [TENANT_A_PARTICIPANT.memberId, TENANT_A_PARTICIPANT.clerkUserId]
  if (harness.persona === 'stellr_event_manager') own.push(ASSIGNED_EVENT_SLUG)
  // A filter on the caller's own tenant narrows only when the honey row is another tenant's.
  if (harness.context.callerTenantId !== harness.context.honeyTenantId) own.push(harness.context.callerTenantId)
  return own
}

// A converted area's tenantDb reads land on the same honey row as supabase-js reads.
// Inert until a case turns tenantDb on: a case fixture's `env` sets TENANT_DB_ENABLED
// to 'true' and TENANT_DB_AREAS to the area's path (test/idor/case-fixtures.ts).
setTenantDbDriver(honeyTenantDriver(() => ({ db: harness.db, scopingValues: scopingValues() })))

/** What a staff persona holds in the role tables: read by lib/authz under the postgres source. */
function crewRows(persona: CrewPersona, tenantId: string): Record<string, Record<string, unknown>[]> {
  const who = { clerk_user_id: TENANT_A_PARTICIPANT.clerkUserId, member_id: TENANT_A_PARTICIPANT.memberId }
  return {
    tenant_memberships: [{ ...who, tenant_id: tenantId, role: CREW[persona].membership }],
    tenants: [{ id: tenantId, status: 'active' }],
    event_manager_assignments:
      persona === 'stellr_event_manager' ? [{ clerk_user_id: who.clerk_user_id, event_slug: ASSIGNED_EVENT_SLUG, tenant_id: tenantId }] : [],
  }
}

export function resetHarness(persona: Persona = 'participant', opts: ResetOptions = {}) {
  harness.persona = persona
  harness.fixture = opts.fixture
  harness.context = opts.context ?? (isCrewPersona(persona) ? CREW[persona].context : DIRECTIONS.stellr_to_canary)
  const tenantId = harness.context.callerTenantId
  const callerRows =
    persona === 'anonymous'
      ? {}
      : {
          ...opts.fixture?.callerRows,
          ...(isCrewPersona(persona) ? crewRows(persona, tenantId) : {}),
          members: [{ ...tenantAMemberRow(tenantId), ...opts.fixture?.member }],
        }
  harness.db = newHoneyDbState(callerRows, {
    honeyAbsent: opts.honeyAbsent,
    honeyColumns: opts.fixture?.honey,
    honeyTenantId: harness.context.honeyTenantId,
    honeyTokens: opts.fixture?.honeyTokens,
    modelUuidErrors: opts.modelUuidErrors,
    rpcAnswers: opts.fixture?.rpcAnswers,
  })
  harness.fetches = []
  harness.sends = 0
  harness.afters = []
  harness.sent = []
  harness.cookies = {}
  harness.strict = opts.strict === true
  harness.audits = []
}

// ── module boundary mocks (registered by test/idor/mocks.ts) ─────────────────

const clerkRole = () => (isCrewPersona(harness.persona) ? CREW[harness.persona].role : 'student')

function sessionClaims() {
  return { sub: TENANT_A_PARTICIPANT.clerkUserId, metadata: { role: clerkRole() }, email: TENANT_A_PARTICIPANT.email }
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
    publicMetadata: { role: clerkRole() },
    privateMetadata: {},
    unsafeMetadata: {},
  }
}

export function clerkServerMock(original: Record<string, unknown>) {
  const signedIn = () => harness.persona !== 'anonymous'
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

/**
 * The Stripe calls a case's fixture may have answered. A Canary value in
 * the arguments means the id was used; one in any `metadata` (top level, or
 * nested as in `payment_intent_data.metadata`) is what the webhook acts on later,
 * so it counts as a write, as an rpc() argument does.
 */
const STRIPE_ANSWERS: Record<string, () => unknown> = {
  'stripe.checkout.sessions.create': () => ({ id: 'cs_idorharness', url: 'https://checkout.stripe.idor.invalid/cs_idorharness' }),
  'stripe.customers.create': () => ({ id: 'cus_idorharness' }),
  'stripe.customers.retrieve': () => ({ id: 'cus_idorharness' }),
}

/** Every `metadata` value in a Stripe call's arguments, at any depth. */
function stripeMetadata(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(stripeMetadata)
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([k, v]) => (k === 'metadata' ? [v] : stripeMetadata(v)))
}

function answeringStripe(path: string): unknown {
  const fallback = rejecting(path) as () => unknown
  const fn = (...args: unknown[]) => {
    const answer = STRIPE_ANSWERS[path]
    if (!answer || !harness.fixture?.stripe) return fallback()
    if (scanForHoneytokens(args).length) harness.db.touched = true
    const metadata = scanForHoneytokens(stripeMetadata(args))
    if (metadata.length) {
      harness.db.writes.push({ table: path, op: 'create', detail: `metadata carries the Canary value ${metadata[0].value}` })
    }
    return Promise.resolve(answer())
  }
  return new Proxy(fn, {
    get: (_t, p) => (p === 'then' ? undefined : typeof p === 'string' ? answeringStripe(`${path}.${p}`) : undefined),
  })
}

export function stripeMock() {
  class Stripe {
    constructor() {
      return answeringStripe('stripe') as Stripe
    }
  }
  return { default: Stripe, Stripe }
}

export function nextHeadersMock() {
  const entry = (name: string) => (name in harness.cookies ? { name, value: harness.cookies[name] } : undefined)
  const store = {
    get: (name: string) => entry(name),
    getAll: () => Object.keys(harness.cookies).map((name) => entry(name)),
    has: (name: string) => name in harness.cookies,
    set: () => store,
    delete: () => store,
    toString: () => '',
    [Symbol.iterator]: function* () {},
  }
  return {
    cookies: async () => store,
    headers: async () => {
      const { host, callerTenantId } = harness.context
      const h = new Headers({ 'x-forwarded-for': '203.0.113.9', host })
      // What the proxy will set on a tenant host. It sets nothing on Stellr's.
      if (callerTenantId !== STELLR_TENANT_ID) {
        h.set(TENANT_ID_HEADER, callerTenantId)
        h.set(TENANT_SLUG_HEADER, CANARY_TENANT.slug)
      }
      return h
    },
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

/** lib/audit/platform with audit on and nothing written: what a case audited is what it asked to. */
export function platformAuditMock(original: Record<string, unknown>) {
  return {
    ...original,
    auditEnabled: () => true,
    audit: async (input: { action: string }, opts?: { enabled?: boolean }) => {
      if (opts?.enabled === false) return { ok: false, skipped: 'disabled' }
      harness.audits.push(input.action)
      return { ok: true, id: harness.audits.length, seq: harness.audits.length }
    },
  }
}

const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']

/**
 * Why a case's audit events are wrong, or null when they hold. `audited` is the gate's
 * verdict on the handler (lib/security/audit-coverage.ts), which this checks by running
 * it: an ok mutating outcome on an audited handler wrote exactly one event. A handler
 * that has not adopted audit yet is on the baseline, so it owes nothing here. On any
 * handler an event names a catalogued action, and a refusal writes none.
 */
export function auditCaseProblem(c: { method: string; audited: boolean; result: Pick<CaseResult, 'outcome' | 'status' | 'audits'> }): string | null {
  const { method, audited, result } = c
  const unknown = result.audits.filter((a) => !isCataloguedAction(a))
  if (unknown.length) return `${method}: audited an action the catalogue does not list (lib/audit/actions.ts): ${unknown.join(', ')}`
  if (result.status >= 400 && result.status < 500 && result.audits.length) return `${method}: refused with ${result.status}, yet audited ${result.audits.join(', ')}`
  if (audited && MUTATING_METHODS.includes(method) && result.outcome === 'ok' && result.audits.length !== 1) {
    return `${method}: the gate says this handler audits, and an ok outcome wrote ${result.audits.length} events`
  }
  return null
}

/** Why one route's cases have the wrong audit events: auditCaseProblem, with the gate's verdict on its source. */
export function routeAuditProblems(file: string, source: string, results: readonly CaseResult[]): string[] {
  const audited = new Set(auditHandlers(file, source).filter((h) => h.audited).map((h) => h.method))
  const problems = results.flatMap((result) => auditCaseProblem({ method: result.method, audited: audited.has(result.method), result }) ?? [])
  if (problems.length && process.env.IDOR_RESULTS_FILE) {
    // What scripts/idor-canary.mjs reads: text in Vitest's output does not count.
    appendFileSync(process.env.IDOR_RESULTS_FILE, JSON.stringify({ label: file, outcome: AUDIT_PROBLEM }) + '\n')
  }
  return problems
}

/** The outcome routeAuditProblems records for the canary. */
export const AUDIT_PROBLEM = 'audit_problem'

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

/**
 * The body of a request a fixture answered, or any request in a strict case. A
 * Canary value in it left the system, as one in Stripe metadata does. A value the
 * caller sent is only the caller's own input passed along; any other came from a
 * tenant-B row, and counts as a write.
 */
async function recordOutboundBody(url: string, input: RequestInfo | URL, init?: RequestInit) {
  const text = init?.body != null ? await new Response(init.body).text() : input instanceof Request ? await input.clone().text() : ''
  if (scanForHoneytokens(text).length) harness.db.touched = true
  const hits = scanForHoneytokens(text, { sent: harness.sent })
  if (hits.length) {
    harness.db.writes.push({ table: `fetch:${new URL(url).host}`, op: 'fetch', detail: `request body carries the Canary value ${hits[0].value}` })
  }
}

/** An email the route asked to send. Its content left the system, as a request body does. */
export function recordOutboundEmail(email: unknown) {
  harness.sends++
  if (scanForHoneytokens(email).length) harness.db.touched = true
  const hits = scanForHoneytokens(email, { sent: harness.sent })
  if (hits.length) harness.db.writes.push({ table: 'email', op: 'send', detail: `the message carries the Canary value ${hits[0].value}` })
}

let guarded = false
/** Global fetch → 503 and recorded; raw sockets refuse to connect. */
export function installNetworkGuard() {
  if (guarded) return
  guarded = true
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    harness.fetches.push(url)
    // A GET only fetches (a renderer's font, the first time it runs). A send has a method.
    const verb = init?.method ?? (input instanceof Request ? input.method : 'GET')
    if (verb.toUpperCase() !== 'GET') harness.sends++
    // A Canary value in an outbound URL means the id was used (scanned raw and URL-encoded).
    if (scanForHoneytokens(url).length) harness.db.touched = true
    const answered = harness.fixture?.fetch?.(url)
    if (answered || harness.strict) await recordOutboundBody(url, input, init)
    if (answered) return answered
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
  /** What this route's case needs to get past validation and configuration. */
  fixture?: CaseFixture
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

/** What the malformed run sends for every id input, cookie and header: the shape of no real id. */
export const MALFORMED_ID = 'idor-malformed-id'

function inputValue(name: string, fixture?: CaseFixture, malformed = false): string | string[] {
  const key = name.replace(/^\.\.\./, '').split('.').pop() ?? name
  if (malformed) return Array.isArray(honeytokenFor(name)) ? [MALFORMED_ID] : MALFORMED_ID
  return fixture?.inputs?.[key] ?? INPUT_FORMATS[key] ?? honeytokenFor(name)
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
  /** A Canary value reached the database or an integration. */
  touched: boolean
  /** The action of each platform audit event the first run wrote. */
  audits: string[]
  error?: string
  /** For an `oracle` or `oracle_4xx` outcome: the two responses that differed. */
  oracle?: string
  /** For an `oracle_4xx` outcome: which comparison differed. */
  oracleKind?: OracleKind
  /** A case that is not strict: the refusal differed, which is reported and not failed. */
  reportedOracle?: { kind: OracleKind; detail: string }
}

/** How one case runs, beyond the persona. */
export interface CaseOptions {
  /** The caller's host and whose record it names. Staff personas fix their own. */
  direction?: Direction
  /** A refusal that differs is `oracle_4xx`, not only reported. */
  strict?: boolean
}

let ipSeq = 0

/** A handler that has not answered by then is recorded as an error, not a pass. */
export const CASE_TIMEOUT_MS = 5_000

/** The request a tenant-A caller sends to name tenant B's record. */
export async function buildRequest(input: CaseInput, method: string, opts: { malformed?: boolean } = {}) {
  // The real NextRequest: 'next/server' itself is mocked (after()), and its
  // factory imports this file, so a static import here would deadlock.
  const { NextRequest } = await vi.importActual<typeof import('next/server')>('next/server')
  const fixture = fixtureFor(input.fixture, method)
  const malformed = opts.malformed === true
  const { host, callerTenantId } = harness.context
  const sent = new Set<string>()
  // On Canary's host, its host name and tenant id are the caller's own, and never count.
  if (host === CANARY_TENANT.host) sent.add(host)
  if (callerTenantId === CANARY_TENANT.id) sent.add(callerTenantId)
  const params: Record<string, string | string[]> = {}
  let path = input.urlPattern
  for (const seg of input.segments) {
    const value = inputValue(seg, fixture, malformed)
    const name = seg.replace(/^\.\.\./, '')
    params[name] = value
    for (const v of [value].flat()) sent.add(v)
    const text = Array.isArray(value) ? value.map(encodeURIComponent).join('/') : encodeURIComponent(value)
    path = path.replace(new RegExp(`\\[\\[?(\\.\\.\\.)?${name}\\]?\\]`), text)
  }
  const url = new URL(`http://${host}${path}`)
  for (const q of input.query) {
    const v = inputValue(q, fixture, malformed)
    for (const x of [v].flat()) {
      url.searchParams.append(q, x)
      sent.add(x)
    }
  }
  const body: Record<string, unknown> = {}
  for (const f of input.fill ?? []) setBodyField(body, f, fillerFor(f))
  Object.assign(body, fixture?.body)
  for (const b of input.body) {
    if (fixture?.omitInputs?.includes(b)) continue
    const v = inputValue(b, fixture, malformed)
    setBodyField(body, b, v)
    for (const x of [v].flat()) sent.add(x)
  }
  // A formatted input (`tr:<id>`) sends the plain id too: echoing it back tells the caller nothing.
  for (const name of [...input.segments, ...input.query, ...input.body]) {
    const key = name.replace(/^\.\.\./, '').split('.').pop() ?? name
    if (INPUT_FORMATS[key]) for (const x of [honeytokenFor(name)].flat()) sent.add(x)
  }
  // A cookie or header naming the record is the caller's input as well.
  const carried = (values: Record<string, string> | undefined) =>
    Object.fromEntries(Object.entries(values ?? {}).map(([k, v]) => [k, malformed ? MALFORMED_ID : v]))
  const cookies = carried(fixture?.cookies)
  const extraHeaders = carried(fixture?.headers)
  for (const v of [...Object.values(cookies), ...Object.values(extraHeaders)]) sent.add(v)
  ipSeq = (ipSeq + 1) % 250
  const hasBody = method !== 'GET' && method !== 'HEAD'
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-forwarded-for': `203.0.113.${ipSeq + 1}`,
    'user-agent': 'idor-harness',
    host,
    'x-forwarded-host': host,
    ...extraHeaders,
  }
  if (!fixture?.omitOrigin) headers.origin = `http://${host}`
  if (callerTenantId !== STELLR_TENANT_ID) {
    headers[TENANT_ID_HEADER] = callerTenantId
    headers[TENANT_SLUG_HEADER] = CANARY_TENANT.slug
  }
  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
  if (cookieHeader) headers.cookie = cookieHeader
  const req = new NextRequest(url, { method, headers, body: hasBody ? JSON.stringify(body) : undefined })
  return { req, params, sent: [...sent], cookies }
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
async function invoke(handler: Handler, input: CaseInput, method: string, opts: { malformed?: boolean } = {}): Promise<RawRun & { sent: string[] }> {
  const { req, params, sent, cookies } = await buildRequest(input, method, opts)
  harness.sent = sent
  harness.cookies = cookies
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
  opts: CaseOptions = {},
): Promise<CaseResult> {
  const handler = mod[method] as Handler | undefined
  if (typeof handler !== 'function') throw new Error(`no ${method} export`)

  const fixture = fixtureFor(input.fixture, method)
  const crewEnv = isCrewPersona(persona) ? { AUTHZ_SOURCE: 'postgres', LOADSCOPED_MODE: 'enforce' } : undefined
  const restoreEnv = applyEnv({ ...crewEnv, ...fixture?.env })
  const context = isCrewPersona(persona) ? CREW[persona].context : DIRECTIONS[opts.direction ?? 'stellr_to_canary']
  try {
    return await classify(handler, input, method, persona, label, fixture, context, opts.strict === true)
  } finally {
    restoreEnv()
  }
}

/**
 * The staff personas a route class runs, each strict. tenant_crew and platform_admin
 * may not accept a failing outcome, so nothing here reads the snapshot.
 */
export async function runCrewPersonaCases(
  mod: Record<string, unknown>,
  input: CaseInput,
  method: string,
  cls: CrewRouteClass,
  label = input.urlPattern,
): Promise<{ persona: CrewPersona; result: CaseResult }[]> {
  const out: { persona: CrewPersona; result: CaseResult }[] = []
  for (const persona of CREW_PERSONAS_FOR[cls]) {
    out.push({ persona, result: await runIdorCase(mod, input, method, persona, label, { strict: true }) })
  }
  return out
}

/** The personas who hold the whole tenant: a route classed tenant_crew lets them in. */
const TENANT_WIDE: readonly CrewPersona[] = ['stellr_crew', 'canary_admin']

/**
 * Why a staff case on a real route proves nothing or fails, or null when it holds. Not
 * failing is not enough: a tenant_crew route that stops on the generated request, or
 * refuses a tenant admin before using the id, has shown nothing about its scope. A case
 * that really cannot get further names why in the route's fixture (`crewUnproven`).
 */
export function crewCaseProblem(c: {
  cls: CrewRouteClass
  persona: CrewPersona
  result: CaseResult
  /** The route names a record. One with no id is judged on what it returns. */
  idBearing: boolean
  exception?: string
  /**
   * The handler is in GUARD_EXCEPTIONS: it has no guard to refuse with, by a reviewed and
   * counted decision. What it returns or writes is still judged.
   */
  guardExempt?: boolean
}): string | null {
  const { cls, persona, result, idBearing, exception, guardExempt } = c
  if (FAILING_OUTCOMES.includes(result.outcome)) return `${persona}: ${result.outcome}`
  if (cls !== 'tenant_crew') {
    if (guardExempt) return null
    return [401, 403, 404].includes(result.status) ? null : `${persona}: a platform route answered a tenant admin with ${result.status}`
  }
  if (exception) return null
  if (result.outcome === 'error' || result.outcome === 'unexercised') return `${persona}: ${result.outcome} proves nothing about the scope`
  if (idBearing && TENANT_WIDE.includes(persona) && !result.touched) return `${persona}: ${result.status} with nothing touched, so the persona never reached the id`
  return null
}

/**
 * Every staff persona over every method of one tenant_crew or platform_admin route, with
 * what is wrong with each case: its scope first, then its audit events, because an ok
 * mutating outcome owes an event on these routes as on any other.
 */
export async function runCrewTarget(
  t: { file: string; cls: CrewRouteClass; methods: readonly string[]; source: string },
  mod: Record<string, unknown>,
  input: CaseInput,
  crewUnproven?: Partial<Record<CrewPersona, string>>,
): Promise<{ method: string; persona: CrewPersona; result: CaseResult; problem: string | null }[]> {
  const idBearing = input.segments.length + input.query.length + input.body.length > 0
  const out = []
  for (const method of t.methods) {
    for (const { persona, result } of await runCrewPersonaCases(mod, input, method, t.cls, t.file)) {
      const problem =
        crewCaseProblem({ cls: t.cls, persona, result, idBearing, exception: crewUnproven?.[persona], guardExempt: `${t.file}#${method}` in GUARD_EXCEPTIONS }) ??
        routeAuditProblems(t.file, t.source, [result])[0] ??
        null
      out.push({ method, persona, result, problem })
    }
  }
  return out
}

/** Same status and same body once what the caller sent is blanked out? */
function sameResponse(a: RawRun & { sent: string[] }, b: RawRun & { sent: string[] }): boolean {
  if (a.status !== b.status) return false
  const blank = (run: RawRun & { sent: string[] }) => {
    let text = run.body
    for (const v of [...run.sent].sort((x, y) => y.length - x.length)) {
      for (const form of new Set([v, encodeURIComponent(v)])) if (form) text = text.split(form).join('<sent>')
    }
    return normalise(text)
  }
  return blank(a) === blank(b)
}

/** A rate limit says nothing about the record: such a comparison proves nothing either way. */
const RATE_LIMITED = 429

/**
 * A refusal against the same request with the row gone, and with the id malformed.
 * `inconclusive` means a rate limit answered one of the runs, so nothing was compared.
 */
async function refusalDifferential(
  handler: Handler,
  input: CaseInput,
  method: string,
  persona: Persona,
  fixture: CaseFixture | undefined,
  context: CaseContext,
  first: RawRun & { sent: string[] },
): Promise<{ kind: OracleKind; detail: string } | 'inconclusive' | undefined> {
  const show = (r: RawRun) => `${r.status} ${r.body.slice(0, 120)}`
  resetHarness(persona, { honeyAbsent: true, fixture, context, modelUuidErrors: true })
  const absent = await invoke(handler, input, method)
  if (first.status === RATE_LIMITED || absent.status === RATE_LIMITED) return 'inconclusive'
  if (!sameResponse(first, absent)) {
    return { kind: 'presence', detail: `with tenant B's row: ${show(first)} | without: ${show(absent)}` }
  }
  resetHarness(persona, { fixture, context, modelUuidErrors: true })
  const malformed = await invoke(handler, input, method, { malformed: true })
  if (malformed.status === RATE_LIMITED) return 'inconclusive'
  if (sameResponse(absent, malformed)) return undefined
  return { kind: 'malformed', detail: `no such record: ${show(absent)} | malformed id: ${show(malformed)}` }
}

async function classify(
  handler: Handler,
  input: CaseInput,
  method: string,
  persona: Persona,
  label: string,
  fixture: CaseFixture | undefined,
  context: CaseContext,
  strict: boolean,
): Promise<CaseResult> {
  resetHarness(persona, { fixture, context, strict })
  const run = await invoke(handler, input, method)
  const { status, error } = run
  const leaks = scanForHoneytokens(run.text, { sent: run.sent })
  const writes = [...harness.db.writes]
  const touched = harness.db.touched
  const audits = [...harness.audits]

  let outcome: Outcome
  if (leaks.length) outcome = 'leak'
  else if (writes.length) outcome = 'honey_write'
  else if (status >= 500 || status === 0) outcome = 'error'
  else if (status === RATE_LIMITED) outcome = 'unexercised'
  else if (status >= 300) outcome = INVALID_REQUEST.includes(status) && !touched ? 'unexercised' : 'refused'
  else outcome = 'ok'

  // Differential: a 2xx must not depend on tenant B's row. Run again with the
  // honey row gone; a different status or body is an existence oracle (or B's
  // data in a shape the scanner cannot recognise).
  let oracle: string | undefined
  let oracleKind: OracleKind | undefined
  let reportedOracle: CaseResult['reportedOracle']
  if (outcome === 'ok') {
    const sends = harness.sends
    resetHarness(persona, { honeyAbsent: true, fixture, context })
    const without = await invoke(handler, input, method)
    if (without.status !== status || normalise(without.body) !== normalise(run.body)) {
      outcome = 'oracle'
      oracle = `with tenant B's row: ${status} ${run.body.slice(0, 120)} | without: ${without.status} ${without.body.slice(0, 120)}`
    } else if (strict && sends > harness.sends) {
      // Same answer to the caller, but tenant B's row made the system send something.
      outcome = 'honey_write'
      writes.push({ table: 'outbound', op: 'send', detail: `${sends} sent with tenant B's row, ${harness.sends} without` })
    }
  } else if (outcome === 'refused' || outcome === 'unexercised' || outcome === 'error') {
    // The same question of a refusal. Enforced where the case is strict, reported elsewhere.
    const differs = await refusalDifferential(handler, input, method, persona, fixture, context, run)
    if (differs === 'inconclusive') {
      // A strict case that could not compare has not passed.
      if (strict && outcome === 'refused') outcome = 'unexercised'
    } else if (differs && strict) {
      outcome = 'oracle_4xx'
      oracle = differs.detail
      oracleKind = differs.kind
    } else if (differs) {
      reportedOracle = differs
    }
  }
  resetHarness(persona)

  if (process.env.IDOR_RESULTS_FILE) {
    appendFileSync(process.env.IDOR_RESULTS_FILE, JSON.stringify({ label, method, status, outcome, touched }) + '\n')
  }
  return { method, status, outcome, leaks, writes, touched, audits, error, oracle, oracleKind, reportedOracle }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? ''
  } catch {
    return String(v)
  }
}

export function targetInput(t: IdorTarget): CaseInput {
  return { segments: t.segments, query: t.query, body: t.body, fill: t.fill, urlPattern: t.urlPattern, fixture: CASE_FIXTURES[t.file] }
}

export { HONEYTOKENS }
