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
//   honey_write  an update/delete matched a Canary row, or an insert/upsert
//                or storage write carried a Canary value               → FAIL
//   refused      4xx, a redirect, notFound() / redirect()
//   ok           2xx with none of tenant B's data and no honey write
//   error        5xx, or the handler threw (the harness could not model the path)
import net from 'node:net'
import { vi } from 'vitest'
import { HONEYTOKENS, honeytokenFor, scanForHoneytokens, type HoneytokenHit } from '@/lib/testing/honeytokens'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import type { IdorTarget } from '@/lib/security/idor-targets'
import { honeyClient, newHoneyDbState, type HoneyDbState, type HoneyWrite } from './honey-db'

export type Outcome = 'leak' | 'honey_write' | 'refused' | 'ok' | 'error'
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
}

export const harness: HarnessState = {
  persona: 'participant',
  db: newHoneyDbState(),
  fetches: [],
}

export function resetHarness(persona: Persona = 'participant') {
  harness.persona = persona
  harness.db = newHoneyDbState(persona === 'participant' ? { members: [tenantAMemberRow()] } : {})
  harness.fetches = []
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
  return { ...original, after: () => {}, connection: async () => {} }
}

let guarded = false
/** Global fetch → 503 and recorded; raw sockets refuse to connect. */
export function installNetworkGuard() {
  if (guarded) return
  guarded = true
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    harness.fetches.push(url)
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
  body: string[]
  urlPattern: string
}

export interface CaseResult {
  method: string
  status: number
  outcome: Outcome
  leaks: HoneytokenHit[]
  writes: HoneyWrite[]
  error?: string
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
    const value = honeytokenFor(seg)
    const name = seg.replace(/^\.\.\./, '')
    params[name] = value
    for (const v of [value].flat()) sent.add(v)
    const text = Array.isArray(value) ? value.map(encodeURIComponent).join('/') : encodeURIComponent(value)
    path = path.replace(new RegExp(`\\[\\[?(\\.\\.\\.)?${name}\\]?\\]`), text)
  }
  const url = new URL(`http://stellr.localhost${path}`)
  for (const q of input.query) {
    const v = honeytokenFor(q)
    for (const x of [v].flat()) {
      url.searchParams.append(q, x)
      sent.add(x)
    }
  }
  const body: Record<string, unknown> = {}
  for (const b of input.body) {
    const v = honeytokenFor(b)
    body[b] = v
    for (const x of [v].flat()) sent.add(x)
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

export async function runIdorCase(
  mod: Record<string, unknown>,
  input: CaseInput,
  method: string,
  persona: Persona = 'participant',
): Promise<CaseResult> {
  resetHarness(persona)
  const handler = mod[method] as Handler | undefined
  if (typeof handler !== 'function') throw new Error(`no ${method} export`)
  const { req, params, sent } = await buildRequest(input, method)

  let status = 0
  let text = ''
  let error: string | undefined
  try {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`IDOR harness: ${method} did not settle in ${CASE_TIMEOUT_MS} ms`)), CASE_TIMEOUT_MS)
    })
    const res = (await Promise.race([handler(req, { params: Promise.resolve(params) }), timeout]).finally(() =>
      clearTimeout(timer),
    )) as Response | undefined
    if (!res || typeof (res as Response).status !== 'number') {
      status = 200
      text = res == null ? '' : safeJson(res)
    } else {
      status = res.status
      const headers: string[] = []
      res.headers.forEach((v, k) => headers.push(`${k}: ${v}`))
      let bodyText = ''
      try {
        bodyText = new TextDecoder().decode(await res.arrayBuffer())
      } catch {
        bodyText = ''
      }
      text = `${headers.join('\n')}\n\n${bodyText}`
    }
  } catch (e) {
    const digest = digestOf(e)
    if (digest.startsWith('NEXT_REDIRECT')) {
      status = 307
      text = digest
    } else if (digest.startsWith('NEXT_HTTP_ERROR_FALLBACK;')) {
      status = Number(digest.split(';')[1]) || 404
    } else {
      status = 500
      error = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 300) : String(e).slice(0, 300)
    }
  }

  const leaks = scanForHoneytokens(text, { sent })
  const writes = [...harness.db.writes]
  let outcome: Outcome
  if (leaks.length) outcome = 'leak'
  else if (writes.length) outcome = 'honey_write'
  else if (status >= 500 || status === 0) outcome = 'error'
  else if (status >= 300) outcome = 'refused'
  else outcome = 'ok'
  return { method, status, outcome, leaks, writes, error }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? ''
  } catch {
    return String(v)
  }
}

export function targetInput(t: IdorTarget): CaseInput {
  return { segments: t.segments, query: t.query, body: t.body, urlPattern: t.urlPattern }
}

export { HONEYTOKENS }
