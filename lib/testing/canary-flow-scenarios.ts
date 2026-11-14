// The dev canary runner's scenarios (S5 wave 7, slice K8). Pure: no network, no
// database, no clock of its own (mintSessionToken uses the fetch and clock it is given). scripts/canary-tenant-flow.ts drives these over
// HTTP against the canary tenant K3 seeds (lib/testing/canary-flow-seed.ts) and
// reads the evidence back from the database its env names; this module says what
// each scenario sends, what it expects, and how a run is judged and printed.
//
//   S1  an adult registers                        start   tenant host
//   S2  a minor is held pending consent           start   tenant host (two minors)
//   S3  check-in is refused while pending         start   the desk, as canary-manager
//   S4  the pending minor is left out of mail     start   read-back only
//   S5  after the guardian signs                  settle  read-back, then a desk check-in and undo
//   S6  after the guardian declines               settle  read-back
//   S7  isolation probes                          start   the per-mode table below
//   S8  Stellr unchanged                          both    Stellr pages, Stellr's counts, app_errors
//
// The guardian signs one consent form and declines the other in the role inbox
// between the two phases (K9's manual step). Every run makes fresh addresses, so
// the per-address invitation cap (5 a day) never trips; the register route's own
// per-IP cap (3 an hour per event) is exactly the three registrations S1 and S2 make.
//
// Output is ids, counts and status codes only: no names, emails, dates of birth,
// tokens or dates. formatResults' lines go through safeOutput, which withholds
// any line that looks like an email or a date, and the test holds a full report
// to that.
import type { AuthzSource } from '../authz/decide'
import type { IndividualBody } from '../registration/individual/parse'
import type { LoadScopedMode } from '../tenancy/load-scoped-mode'
import { isInProductionTenantZone, PRODUCTION_TENANT_ZONE } from '../tenancy/host-pure'
import {
  assertCanaryFlowTarget,
  canaryHosts,
  CANARY_FLOW_EVENT,
  CANARY_FLOW_TENANT,
  CANARY_ROLE_INBOX,
  flowTargetEnvFrom,
  type CanaryPersonaHandle,
} from './canary-flow-seed'

// ── Modes ───────────────────────────────────────────────────────────────────

/** lib/authz/decide.ts AUTHZ_SOURCES and lib/tenancy/load-scoped-mode.ts LOADSCOPED_MODES, in the same order. */
export const RUN_AUTHZ_SOURCES: readonly AuthzSource[] = ['clerk', 'shadow', 'postgres']
export const RUN_LOADSCOPED_MODES: readonly LoadScopedMode[] = ['off', 'shadow', 'enforce']

export interface RunMode {
  authzSource: AuthzSource
  loadScopedMode: LoadScopedMode
}

export const ALL_RUN_MODES: readonly RunMode[] = RUN_AUTHZ_SOURCES.flatMap((authzSource) =>
  RUN_LOADSCOPED_MODES.map((loadScopedMode) => ({ authzSource, loadScopedMode })),
)

export function modeLabel(m: RunMode): string {
  return `${m.authzSource}/${m.loadScopedMode}`
}

/**
 * The modes the run is judged against. `reported` is what the target's health route
 * resolved (tenancy.authzSource.value and tenancy.loadScopedMode, read as
 * stellr-probe-admin); `stated` is what --authz-source and --loadscoped-mode say.
 * Either is enough; when both are given they must agree, so a run cannot be
 * judged against a table for modes the deployment is not in.
 */
export function resolveRunMode(reported: Partial<RunMode> | null, stated: Partial<Record<keyof RunMode, string | undefined>>): RunMode {
  const pick = <T extends string>(name: string, list: readonly T[], seen: string | undefined, said: string | undefined): T => {
    const s = said?.trim().toLowerCase()
    if (s && !(list as readonly string[]).includes(s)) throw new Error(`--${name} must be one of ${list.join(', ')}`)
    if (seen && s && seen !== s) throw new Error(`--${name} says ${s}, but the target reports ${seen}; judge the run against the modes the target is in`)
    const value = seen ?? s
    if (!value) throw new Error(`the run's ${name} is unknown: give a stellr-probe-admin session (the health route reports it) or --${name}`)
    return value as T
  }
  return {
    authzSource: pick('authz-source', RUN_AUTHZ_SOURCES, reported?.authzSource, stated.authzSource),
    loadScopedMode: pick('loadscoped-mode', RUN_LOADSCOPED_MODES, reported?.loadScopedMode, stated.loadScopedMode),
  }
}

// ── Scenarios ───────────────────────────────────────────────────────────────

export type ScenarioId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8'
export type RunPhase = 'start' | 'settle'

export interface ScenarioSpec {
  id: ScenarioId
  title: string
  phases: readonly RunPhase[]
  /** Personas whose session the scenario needs. Without one it is skipped, never passed. */
  personas: readonly CanaryPersonaHandle[]
  /** What it reads back, in words. Printed by --plan. */
  evidence: string
}

export const CANARY_SCENARIOS: readonly ScenarioSpec[] = [
  {
    id: 'S1',
    title: 'an adult registers',
    phases: ['start'],
    personas: [],
    evidence: "201; registrations and participants rows stamped dev-canary; no guardian-consent row. A 201 this env's database does not hold as dev-canary's stops the phase before S2",
  },
  {
    id: 'S2',
    title: 'a minor is held pending consent',
    phases: ['start'],
    personas: [],
    evidence: "201 with consentPending and guardianInvited, for two minors; each has a pending tenant_guardian_consents row stamped dev-canary, its window closing before the event, and a tenant_guardian_consent agreement",
  },
  {
    id: 'S3',
    title: 'check-in is refused while pending',
    phases: ['start'],
    personas: ['canary-manager'],
    evidence: "the desk's manual check-in answers 409 guardian_consent_pending, and participants.checked_in_at stays empty",
  },
  {
    id: 'S4',
    title: 'the pending minor is left out of tenant mail',
    phases: ['start'],
    personas: [],
    evidence: "unconsentedParticipantIds(dev-canary) holds both minors and not the adult; no event_email_sends row since the run started names a minor or a guardian",
  },
  {
    id: 'S5',
    title: 'after the guardian signs',
    phases: ['settle'],
    personas: ['canary-manager'],
    evidence: "the consent row is signed and settled, its agreement completed, the minor is out of the unconsented set, and the desk checks them in (then undoes it)",
  },
  {
    id: 'S6',
    title: 'after the guardian declines',
    phases: ['settle'],
    personas: [],
    evidence: "the registration and participant are removed (the consent row goes with them); a declined row still waiting for its removal is reported with its attempt count",
  },
  {
    id: 'S7',
    title: 'isolation probes',
    phases: ['start'],
    personas: ['canary-manager', 'canary-admin', 'stellr-probe-admin'],
    evidence: 'every probe answers as the table says for the run\'s AUTHZ_SOURCE and LOADSCOPED_MODE; known gaps are named by slice',
  },
  {
    id: 'S8',
    title: 'Stellr unchanged',
    phases: ['start', 'settle'],
    personas: [],
    evidence: "Stellr's pages answer 200; the Stellr event's registration count is what it was when the run started; every registration the run made is dev-canary's; every app_errors row since the run started is one the table expects",
  },
]

export function scenariosFor(phase: RunPhase): ScenarioSpec[] {
  return CANARY_SCENARIOS.filter((s) => s.phases.includes(phase))
}

// ── Targets ─────────────────────────────────────────────────────────────────

/** Stellr's production hosts. Never a canary target, whatever the flags say. */
export const PRODUCTION_HOSTS: readonly string[] = ['stellreducation.org', 'www.stellreducation.org', 'app.stellreducation.org', 'events.stellreducation.org']

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])
/** The stellr-web-dev Vercel project's deployments (scripts/canary/tenant-host-headers.mjs holds the same; the test holds them equal). */
export const DEV_DEPLOYMENT_HOST = /^stellr-web-dev[a-z0-9-]*\.vercel\.app$/

export interface CanaryBases {
  /** The canary tenant's host: canary.<zone>. */
  tenant: URL
  /** The probe host K3 leaves unmapped: nobody.<zone>, same scheme and port. */
  unmapped: URL
  /** Stellr's own host on the same deployment. */
  stellr: URL
}

function parseBase(raw: string | undefined, flag: string): URL {
  if (!raw) throw new Error(`${flag} is required`)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${flag} is not a URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`${flag} must be http or https`)
  if (url.username || url.password) throw new Error(`${flag} must not carry credentials`)
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) throw new Error(`${flag} must be an origin, with no path`)
  return new URL(url.origin)
}

function isProductionHost(hostname: string): boolean {
  return PRODUCTION_HOSTS.includes(hostname.toLowerCase())
}

/**
 * Whether a --zone value is the production tenant zone or a zone under it (W7-27).
 * Read loosely (leading dots, case, a trailing dot), so no spelling slips past.
 */
function isProductionZoneFlag(raw: string | undefined): boolean {
  return isInProductionTenantZone((raw ?? '').trim().replace(/^\.+/, ''))
}

/**
 * The three origins a run talks to, or a throw. The tenant base must be the canary
 * host under --zone (K3's canaryHosts), and the Stellr base this machine or the dev
 * deployment (stellr-web-dev on vercel.app). Stellr's production hosts are refused
 * for either, and so is every host in the production tenant zone
 * (PRODUCTION_TENANT_ZONE, its apex included) and that zone as --zone (W7-27).
 * There is no override. Pure: it runs before the runner's first request or read.
 */
export function canaryBases(opts: { base?: string; stellrBase?: string; zone?: string }): CanaryBases {
  const tenant = parseBase(opts.base, '--base')
  const stellr = parseBase(opts.stellrBase, '--stellr-base')
  for (const [flag, url] of [['--base', tenant], ['--stellr-base', stellr]] as const) {
    if (isProductionHost(url.hostname)) throw new Error(`refusing: ${flag} is a Stellr production host; the canary runs on dev only`)
    if (isInProductionTenantZone(url.hostname)) {
      throw new Error(`refusing: ${flag} is in the production tenant zone (${PRODUCTION_TENANT_ZONE}); the canary runs on dev only`)
    }
  }
  if (isProductionZoneFlag(opts.zone)) {
    throw new Error(`refusing: --zone is the production tenant zone (${PRODUCTION_TENANT_ZONE}); the canary runs on dev only`)
  }
  const hosts = canaryHosts(opts.zone ?? '')
  if (tenant.hostname !== hosts.mapped) throw new Error(`--base must be the canary host for --zone (${hosts.mapped})`)
  if (!(LOOPBACK.has(stellr.hostname) || stellr.hostname.endsWith('.localhost') || DEV_DEPLOYMENT_HOST.test(stellr.hostname))) {
    throw new Error("refusing: --stellr-base must be this machine or the stellr-web-dev deployment")
  }
  const unmapped = new URL(tenant.origin)
  unmapped.hostname = hosts.unmapped
  return { tenant, unmapped, stellr }
}

/**
 * Every guard the runner applies before its first request or read: K3's database
 * guard (the dev project or a stack on this machine; no sk_live Clerk key; no
 * APP_ENV or NEXT_PUBLIC_APP_ENV prod or preview; no VERCEL_ENV preview), then the
 * hosts. Returns the bases.
 */
export function assertCanaryRunTarget(env: Record<string, string | undefined>, opts: { base?: string; stellrBase?: string; zone?: string }): CanaryBases {
  assertCanaryFlowTarget(flowTargetEnvFrom(env, false))
  return canaryBases(opts)
}

// ── Personas' sessions ──────────────────────────────────────────────────────

/**
 * Where the runner takes a persona's session from. The runner never signs in and
 * never fetches a testing token. The operator signs each persona in on the dev
 * instance once (scripts/canary-tenant-flow.ts says how) and passes either:
 *   CANARY_SESSION_ID_<HANDLE>  the Clerk session id (sess_…). The runner mints a
 *                               fresh session token from it just before each use
 *                               (mintSessionToken), with the dev instance's sk_test_
 *                               key, so a phase can run as long as it needs.
 *   CANARY_SESSION_<HANDLE>     a session token copied by hand. It lives about a
 *                               minute, so it rarely lasts a start phase: for a
 *                               short check only.
 * The id wins when both are set. A missing one skips that persona's checks, and a
 * skip is never a pass.
 */
export function sessionEnvName(handle: CanaryPersonaHandle): string {
  return `CANARY_SESSION_${handle.toUpperCase().replace(/-/g, '_')}`
}

export function sessionIdEnvName(handle: CanaryPersonaHandle): string {
  return `CANARY_SESSION_ID_${handle.toUpperCase().replace(/-/g, '_')}`
}

/** A Clerk session id. */
export const SESSION_ID_RE = /^sess_[A-Za-z0-9]+$/

export type PersonaSession = { kind: 'session-id'; sessionId: string } | { kind: 'token'; token: string }

/** A persona's session from the env, or why there is none. Never echoes a value. */
export function personaSessionFrom(
  env: Record<string, string | undefined>,
  handle: CanaryPersonaHandle,
  now: Date,
): { session: PersonaSession; problem: null } | { session: null; problem: string } {
  const id = (env[sessionIdEnvName(handle)] ?? '').trim()
  if (id) {
    if (!SESSION_ID_RE.test(id)) return { session: null, problem: `${sessionIdEnvName(handle)} is not a Clerk session id (sess_…)` }
    if (!(env.CLERK_SECRET_KEY ?? '').trim().startsWith('sk_test_')) return { session: null, problem: 'a session id needs the dev instance\'s sk_test_ CLERK_SECRET_KEY to mint tokens' }
    return { session: { kind: 'session-id', sessionId: id }, problem: null }
  }
  const token = env[sessionEnvName(handle)]
  const problem = sessionTokenProblem(token, now)
  return problem ? { session: null, problem } : { session: { kind: 'token', token: (token as string).trim() }, problem: null }
}

/**
 * A fresh session token for a session id, from Clerk's Backend API
 * (POST /v1/sessions/{id}/tokens) at the base URL the caller passes (the script
 * holds it: lib/clerk-provisioning.guard.test.ts keeps Clerk REST URLs out of lib/), with the caller's fetch. Only with a development
 * (sk_test_) key, and the token must pass sessionTokenProblem: issued by a Clerk
 * development instance, with time left. Errors carry a status code at most, never
 * the id, the key or a token.
 */
export async function mintSessionToken(
  clerkApi: string,
  sessionId: string,
  secretKey: string | undefined,
  now: () => Date,
  fetchImpl: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>,
): Promise<string> {
  const key = (secretKey ?? '').trim()
  if (!key.startsWith('sk_test_')) throw new Error("refusing: minting a session token needs the dev instance's sk_test_ key")
  if (!SESSION_ID_RE.test(sessionId)) throw new Error('not a Clerk session id')
  const res = await fetchImpl(`${clerkApi.replace(/\/+$/, '')}/sessions/${sessionId}/tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (!res.ok) throw new Error(`Clerk did not mint a session token (${res.status}); is the session still active?`)
  let jwt: unknown
  try {
    jwt = ((await res.json()) as { jwt?: unknown } | null)?.jwt
  } catch {
    jwt = undefined
  }
  const problem = typeof jwt === 'string' ? sessionTokenProblem(jwt, now()) : 'not a session token'
  if (problem) throw new Error(`the minted token is ${problem === 'not a session token' ? 'not a session token' : `refused: ${problem}`}`)
  return (jwt as string).trim()
}

/** A Clerk development instance's issuer: https://<name>.clerk.accounts.dev. */
const DEV_ISSUER = /^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.clerk\.accounts\.dev$/

/** Seconds a token must still have, so a probe does not fail as 401 half-way. */
export const SESSION_MIN_SECONDS_LEFT = 30

/**
 * Why a session token cannot be used, or null. Read, not verified (the server
 * verifies it): it must be a JWT from a Clerk development instance that has not
 * expired. A production instance's token is refused. The token is never printed.
 */
export function sessionTokenProblem(token: string | undefined, now: Date): string | null {
  const t = (token ?? '').trim()
  if (!t) return 'not set'
  const parts = t.split('.')
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return 'not a session token'
  let payload: { exp?: unknown; iss?: unknown }
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { exp?: unknown; iss?: unknown }
  } catch {
    return 'not a session token'
  }
  if (typeof payload.iss !== 'string' || !DEV_ISSUER.test(payload.iss)) return 'not from a Clerk development instance'
  if (typeof payload.exp !== 'number' || payload.exp * 1000 - now.getTime() < SESSION_MIN_SECONDS_LEFT * 1000) {
    return 'expired, or expires within 30 seconds; mint a fresh one'
  }
  return null
}

// ── The run's synthetic people ──────────────────────────────────────────────

/** A run id: ten lower-case letters, so it can never read as a date or a number. */
export const RUN_ID_RE = /^[a-z]{10}$/

export function newRunId(bytes: Uint8Array): string {
  if (bytes.length < 10) throw new Error('newRunId needs 10 random bytes')
  return Array.from(bytes.slice(0, 10), (b) => String.fromCharCode(97 + (b % 26))).join('')
}

export function assertRunId(runId: string): void {
  if (!RUN_ID_RE.test(runId)) throw new Error('a run id is ten lower-case letters')
}

/**
 * Where a guardian's consent invitation is addressed. On dev every mail goes to
 * the safelist (lib/email.ts routeRecipients) with the intended address in the
 * subject, so either way it lands in the role inbox:
 *   example     canary-<run>-guardian-<role>@example.test (the default)
 *   role-inbox  the role inbox, plus-addressed: <local>+canary-<run>-guardian-<role>@<domain>
 */
export type GuardianMailbox = 'example' | 'role-inbox'

export function plusAddress(address: string, tag: string): string {
  const at = address.indexOf('@')
  if (at < 1 || !/^[a-z0-9-]+$/.test(tag)) throw new Error('plusAddress needs an address and a tag of letters, digits and hyphens')
  return `${address.slice(0, at)}+${tag}${address.slice(at)}`
}

export type IdentityKey = 'adult' | 'minor-sign' | 'minor-decline' | 'stellr-probe' | 'canary-host-probe'

export interface RunIdentity {
  key: IdentityKey
  email: string
  firstName: string
  lastName: string
  /** Age on the event's first day. */
  age: number
  guardian: { firstName: string; lastName: string; email: string; relationship: 'Parent' | 'Legal Guardian' } | null
}

/** The run's people, all synthetic and all derived from the run id, so state never stores them. */
export function runIdentities(runId: string, mailbox: GuardianMailbox = 'example'): Record<IdentityKey, RunIdentity> {
  assertRunId(runId)
  const registrant = (role: string) => `canary-${runId}-${role}@example.test`
  const guardianEmail = (role: 'sign' | 'decline') =>
    mailbox === 'role-inbox' ? plusAddress(CANARY_ROLE_INBOX, `canary-${runId}-guardian-${role}`) : `canary-${runId}-guardian-${role}@example.test`
  const person = (key: IdentityKey, lastName: string, age: number, guardian: RunIdentity['guardian']): RunIdentity => ({
    key,
    email: registrant(key),
    firstName: 'Canary',
    lastName: `${lastName} ${runId}`,
    age,
    guardian,
  })
  return {
    adult: person('adult', 'Adult', 30, null),
    'minor-sign': person('minor-sign', 'Minor Sign', 15, { firstName: 'Canary', lastName: `Guardian Sign ${runId}`, email: guardianEmail('sign'), relationship: 'Parent' }),
    'minor-decline': person('minor-decline', 'Minor Decline', 16, { firstName: 'Canary', lastName: `Guardian Decline ${runId}`, email: guardianEmail('decline'), relationship: 'Legal Guardian' }),
    'stellr-probe': person('stellr-probe', 'Stellr Probe', 30, null),
    'canary-host-probe': person('canary-host-probe', 'Canary Host Probe', 30, null),
  }
}

/** Every address a run made: the registrants' and the guardians'. Compared against send logs, never printed. */
export function runAddresses(ids: Record<IdentityKey, RunIdentity>): string[] {
  return Object.values(ids).flatMap((p) => [p.email, ...(p.guardian ? [p.guardian.email] : [])])
}

/**
 * A date of birth that makes someone `years` old on `eventStartsOn` (YYYY-MM-DD),
 * sixty days past their birthday, so a day either way in the event's time zone
 * changes nothing.
 */
export function birthDateForAge(eventStartsOn: string, years: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(eventStartsOn)
  if (!m) throw new Error('the event has no start date')
  const d = new Date(Date.UTC(Number(m[1]) - years, Number(m[2]) - 1, Number(m[3])))
  d.setUTCDate(d.getUTCDate() - 60)
  return d.toISOString().slice(0, 10)
}

export const CANARY_SCHOOL_NAME = 'Dev Canary Test School'

/**
 * What the runner posts to register/individual: the fields the gate requires, and a
 * guardian as the emergency contact for a minor. Nothing optional is guessed at.
 */
export type RegistrationBody = Pick<IndividualBody, 'event_slug' | 'first_name' | 'last_name' | 'school_name'> &
  Partial<Pick<IndividualBody, 'emergency_contact_first_name' | 'emergency_contact_last_name' | 'emergency_contact_email' | 'emergency_contact_relationship'>> & {
    email: string
    date_of_birth: string
  }

/** The register/individual body for one of the run's people. */
export function registrationBody(person: RunIdentity, eventSlug: string, eventStartsOn: string): RegistrationBody {
  return {
    event_slug: eventSlug,
    email: person.email,
    first_name: person.firstName,
    last_name: person.lastName,
    date_of_birth: birthDateForAge(eventStartsOn, person.age),
    school_name: CANARY_SCHOOL_NAME,
    ...(person.guardian
      ? {
          emergency_contact_first_name: person.guardian.firstName,
          emergency_contact_last_name: person.guardian.lastName,
          emergency_contact_email: person.guardian.email,
          emergency_contact_relationship: person.guardian.relationship,
        }
      : {}),
  }
}

// ── What a run keeps between its phases ─────────────────────────────────────

/** Ids only. The people are re-derived from runId and mailbox. Written outside the repo. */
export interface RunState {
  runId: string
  mailbox: GuardianMailbox
  zone: string
  /** ISO time the start phase began: app_errors and sends are read from here. */
  startedAt: string
  stellrEventSlug: string
  stellrRegistrationsAtStart: number
  registrations: Partial<Record<'adult' | 'minor-sign' | 'minor-decline', { registrationId: string; participantId: string | null; agreementId: string | null }>>
}

export function parseRunState(raw: unknown): RunState {
  const s = raw as RunState
  if (!s || typeof s !== 'object') throw new Error('the state file is not a canary run')
  assertRunId(s.runId)
  if (s.mailbox !== 'example' && s.mailbox !== 'role-inbox') throw new Error('the state file has no mailbox')
  if (typeof s.startedAt !== 'string' || Number.isNaN(Date.parse(s.startedAt))) throw new Error('the state file has no start time')
  if (typeof s.stellrEventSlug !== 'string' || typeof s.stellrRegistrationsAtStart !== 'number') throw new Error('the state file has no Stellr baseline')
  if (!s.registrations || typeof s.registrations !== 'object') throw new Error('the state file has no registrations')
  return s
}

// ── Read-back shapes and the judges ─────────────────────────────────────────

export type ScenarioStatus = 'pass' | 'fail' | 'waiting' | 'skipped'
export type FactValue = string | number | boolean | null

export interface ScenarioResult {
  id: ScenarioId
  status: ScenarioStatus
  /** Ids, counts and status codes. */
  facts: [string, FactValue][]
  /** Fixed text. Never a value from a row or a response body. */
  reasons: string[]
}

export interface HttpAnswer {
  status: number
  json: Record<string, unknown> | null
}

export interface RegistrationReadBack {
  registration: { id: string; tenant_id: string | null; event_slug: string } | null
  participants: { id: string; tenant_id: string | null; checked_in_at: string | null }[]
  consent: {
    id: string
    tenant_id: string
    status: 'pending' | 'signed' | 'declined' | 'expired'
    agreement_id: string | null
    expires_at: string
    settled_at: string | null
    removal_attempts: number
  } | null
  agreement: { id: string; tenant_id: string | null; envelope_type: string; status: string } | null
}

const CANARY_ID = CANARY_FLOW_TENANT.id

function result(id: ScenarioId, reasons: string[], facts: [string, FactValue][], status?: ScenarioStatus): ScenarioResult {
  return { id, status: status ?? (reasons.length ? 'fail' : 'pass'), facts, reasons }
}

export function skipped(id: ScenarioId, reason: string): ScenarioResult {
  return { id, status: 'skipped', facts: [], reasons: [reason] }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

/**
 * After S1: must the start phase stop before it registers the minors? Yes when the
 * target said 201 but the database this env names holds no such registration, or
 * holds one not stamped dev-canary: the server is writing somewhere else, and each
 * minor's registration would make it send a guardian invitation from its own mail
 * account before the run could fail.
 */
export function startMustStop(answer: HttpAnswer, rb: RegistrationReadBack): boolean {
  return answer.status === 201 && (!rb.registration || rb.registration.tenant_id !== CANARY_ID)
}

/** S1. */
export function judgeAdultRegistered(answer: HttpAnswer, rb: RegistrationReadBack): ScenarioResult {
  const reasons: string[] = []
  if (answer.status !== 201) reasons.push('the registration did not answer 201')
  if (answer.json?.consentPending) reasons.push('an adult was held for consent')
  if (!rb.registration) reasons.push('no registrations row read back (is the base on the database this env names?)')
  else if (rb.registration.tenant_id !== CANARY_ID) reasons.push('the registration is not stamped dev-canary')
  if (rb.participants.length !== 1) reasons.push('expected exactly one participant')
  if (rb.participants.some((p) => p.tenant_id !== CANARY_ID)) reasons.push('a participant is not stamped dev-canary')
  if (rb.consent) reasons.push('an adult has a guardian-consent row')
  return result('S1', reasons, [
    ['http', answer.status],
    ['registration', rb.registration?.id ?? null],
    ['participants', rb.participants.length],
    ['consent rows', rb.consent ? 1 : 0],
  ])
}

/** S2, for each minor. `eventStartsAt` bounds the consent window. */
export function judgeMinorPending(
  answers: { key: 'minor-sign' | 'minor-decline'; answer: HttpAnswer; rb: RegistrationReadBack }[],
  now: Date,
  eventStartsAt: string | null,
): ScenarioResult {
  const reasons: string[] = []
  const facts: [string, FactValue][] = []
  const start = eventStartsAt ? Date.parse(eventStartsAt) : NaN
  for (const { key, answer, rb } of answers) {
    const bad = (why: string) => reasons.push(`${key}: ${why}`)
    facts.push([`${key} http`, answer.status], [`${key} registration`, rb.registration?.id ?? null], [`${key} consent`, rb.consent?.status ?? null])
    if (answer.status !== 201) {
      bad(answer.status === 429 ? 'rate limited (the register cap is 3 an hour per event; wait and start a new run)' : 'did not answer 201')
      continue
    }
    if (answer.json?.consentPending !== true) bad('the answer does not say consentPending')
    if (answer.json?.guardianInvited !== true) bad("the answer does not say the guardian's invitation went")
    if (!rb.registration || rb.registration.tenant_id !== CANARY_ID) bad('no dev-canary registration read back')
    const c = rb.consent
    if (!c) {
      bad('no tenant_guardian_consents row')
      continue
    }
    if (c.status !== 'pending') bad('the consent row is not pending')
    if (c.tenant_id !== CANARY_ID) bad('the consent row is not stamped dev-canary')
    const expires = Date.parse(c.expires_at)
    if (!(expires > now.getTime())) bad("the consent window has already closed")
    if (!Number.isNaN(start) && expires > start) bad('the consent window closes after the event starts')
    if (!c.agreement_id || !rb.agreement) bad('no consent agreement recorded')
    else {
      if (rb.agreement.envelope_type !== 'tenant_guardian_consent') bad("the agreement is not a tenant_guardian_consent envelope")
      if (rb.agreement.tenant_id !== CANARY_ID) bad('the agreement is not stamped dev-canary')
      facts.push([`${key} agreement`, rb.agreement.id])
    }
    if (rb.participants.some((p) => p.checked_in_at)) bad('the participant is already checked in')
  }
  if (answers.length !== 2) reasons.push('expected two minors')
  return result('S2', reasons, facts)
}

/** S3: the desk's manual check-in for a pending minor, and the row after it. */
export function judgeCheckInRefused(desk: HttpAnswer, after: RegistrationReadBack): ScenarioResult {
  const reasons: string[] = []
  if (desk.status !== 409) reasons.push('the desk did not answer 409')
  if (desk.json?.code !== 'guardian_consent_pending') reasons.push('the answer is not guardian_consent_pending')
  if (after.participants.some((p) => p.checked_in_at)) reasons.push('the participant was checked in')
  return result('S3', reasons, [
    ['desk http', desk.status],
    ['participant', after.participants[0]?.id ?? null],
    ['checked in', after.participants.some((p) => p.checked_in_at)],
  ])
}

/** S4. `sendsNamingRun` counts event_email_sends rows since the start that name any of the run's minors or guardians. */
export function judgeMailExclusion(input: {
  unconsented: ReadonlySet<string>
  adultParticipantId: string | null
  minorParticipantIds: (string | null)[]
  sendsSinceStart: number
  sendsNamingRun: number
}): ScenarioResult {
  const reasons: string[] = []
  const minors = input.minorParticipantIds.filter((id): id is string => !!id)
  if (minors.length !== input.minorParticipantIds.length || !minors.length) reasons.push("a minor's participant id is missing")
  if (minors.some((id) => !input.unconsented.has(id))) reasons.push('a pending minor is not in the unconsented set, so tenant mail would reach them')
  if (input.adultParticipantId && input.unconsented.has(input.adultParticipantId)) reasons.push('the adult is in the unconsented set')
  if (input.sendsNamingRun > 0) reasons.push("an event email since the run started names a pending minor or their guardian")
  return result('S4', reasons, [
    ['unconsented in dev-canary', input.unconsented.size],
    ['minors left out', minors.filter((id) => input.unconsented.has(id)).length],
    ['sends since start', input.sendsSinceStart],
    ['sends naming the run', input.sendsNamingRun],
  ])
}

/** S5. Waiting until the guardian has signed; then the desk must check the minor in, and undo it. */
export function judgeSigned(input: {
  rb: RegistrationReadBack
  unconsented: ReadonlySet<string>
  checkIn: HttpAnswer | null
  checkedInAfter: boolean | null
  undo: HttpAnswer | null
  checkedInAfterUndo: boolean | null
}): ScenarioResult {
  const { rb } = input
  const facts: [string, FactValue][] = [
    ['registration', rb.registration?.id ?? null],
    ['consent', rb.consent?.status ?? null],
    ['agreement', rb.agreement?.status ?? null],
  ]
  if (rb.consent?.status === 'pending') return result('S5', ["the guardian has not signed yet: sign the 'guardian-sign' form, then settle again"], facts, 'waiting')
  const reasons: string[] = []
  if (!rb.consent) reasons.push('no consent row (was the registration removed?)')
  else {
    if (rb.consent.status !== 'signed') reasons.push('the consent row is not signed')
    if (!rb.consent.settled_at) reasons.push('the consent row has no settled time')
  }
  if (rb.agreement?.status !== 'completed') reasons.push('the agreement is not completed')
  const pid = rb.participants[0]?.id
  if (pid && input.unconsented.has(pid)) reasons.push('the signed minor is still left out of tenant mail')
  if (!input.checkIn) reasons.push('the desk check-in was not tried (no canary-manager session)')
  else {
    facts.push(['check-in http', input.checkIn.status], ['undo http', input.undo?.status ?? null])
    if (input.checkIn.status !== 200) reasons.push('the desk could not check the signed minor in')
    if (input.checkedInAfter !== true) reasons.push('checked_in_at was not set')
    if (input.undo?.status !== 200 || input.checkedInAfterUndo !== false) reasons.push('the check-in was not undone')
  }
  return result('S5', reasons, facts)
}

/** S6. Pass once the declined registration is gone; waiting while it is pending, or declined but not yet removed. */
export function judgeDeclined(rb: RegistrationReadBack): ScenarioResult {
  const facts: [string, FactValue][] = [
    ['registration rows', rb.registration ? 1 : 0],
    ['participant rows', rb.participants.length],
    ['consent', rb.consent?.status ?? null],
    ['removal attempts', rb.consent?.removal_attempts ?? null],
  ]
  if (!rb.registration && !rb.participants.length && !rb.consent) return result('S6', [], facts)
  if (rb.consent?.status === 'pending') return result('S6', ["the guardian has not declined yet: decline the 'guardian-decline' form, then settle again"], facts, 'waiting')
  if (rb.consent && (rb.consent.status === 'declined' || rb.consent.status === 'expired')) {
    return result('S6', ['declined, and the removal has not happened yet: the sweep retries it; settle again later'], facts, 'waiting')
  }
  return result('S6', ['the declined registration is still there'], facts)
}

/** S8. */
export function judgeStellrUnchanged(input: {
  pages: { path: string; status: number }[]
  stellrRegistrations: { atStart: number; now: number }
  runRegistrationsOutsideCanary: number
  appErrors: { route: string; count: number }[]
  expectedAppErrorRoutes: readonly string[]
}): ScenarioResult {
  const reasons: string[] = []
  const facts: [string, FactValue][] = input.pages.map((p) => [`stellr ${p.path}`, p.status] as [string, FactValue])
  for (const p of input.pages) if (p.status !== 200) reasons.push(`Stellr's ${p.path} did not answer 200`)
  facts.push(['stellr event registrations at start', input.stellrRegistrations.atStart], ['stellr event registrations now', input.stellrRegistrations.now])
  if (input.stellrRegistrations.atStart !== input.stellrRegistrations.now) {
    reasons.push("the Stellr event's registration count changed during the run (another writer on dev, or the run wrote to it)")
  }
  facts.push(['run registrations not dev-canary', input.runRegistrationsOutsideCanary])
  if (input.runRegistrationsOutsideCanary > 0) reasons.push('a registration the run made is not stamped dev-canary')
  const expected = new Set(input.expectedAppErrorRoutes)
  for (const e of input.appErrors) {
    const ok = expected.has(e.route)
    facts.push([`app_errors ${e.route}${ok ? ' (expected in this mode)' : ''}`, e.count])
    if (!ok) reasons.push('an app_errors row since the run started is not one the table expects; read it on dev')
  }
  return result('S8', [...new Set(reasons)], facts)
}

// ── S7: the isolation probes and their expectation table ────────────────────

/**
 * Gaps a probe is expected to show, each owned by a slice that closes it
 * (docs/TENANCY-S5.md; tracker s5-programme). A probe that matches its gap is a
 * known gap, not a failure. One that answers as the closed state says is reported
 * as differing, so the table is updated in the same change that closes the gap.
 */
export type KnownGapId = 'A11' | 'A12' | '.23' | '.24' | '.29'

export const KNOWN_GAPS: Record<KnownGapId, { owner: string; what: string }> = {
  A11: { owner: 'slice A11', what: "e-sign participant side: dev-canary's signing link and envelope have no tenant check on Stellr's host" },
  A12: { owner: 'slice A12', what: "check-in participant side: /check-in/<slug> answers for dev-canary's event on Stellr's host" },
  '.23': { owner: 'tracker s5-programme.23', what: 'the desk shows no "waiting for guardian consent" marker' },
  '.24': { owner: 'tracker s5-programme.24', what: 'a group check-in with one pending minor refuses the whole group' },
  '.29': { owner: 'tracker s5-programme.29', what: "a Stellr-only admin list (agreements) includes dev-canary's rows" },
}

export type ProbePersona = 'anonymous' | CanaryPersonaHandle
export type ProbeHost = 'tenant' | 'unmapped' | 'stellr'

export interface ProbeContext {
  canarySlug: string
  stellrSlug: string
  pendingAgreementId: string | null
  pendingParticipantId: string | null
  adultParticipantId: string | null
  /** The register body for the run's stellr-probe person on dev-canary's event (P5, on Stellr's host). */
  stellrProbeBody: RegistrationBody
  /** The register body for the run's canary-host-probe person on the Stellr event (P17, on dev-canary's host). */
  canaryHostProbeBody: RegistrationBody
}

export interface ProbeRequest {
  method: 'GET' | 'POST'
  path: string
  body?: unknown
}

export type Expectation =
  | {
      status: number
      /** The probe's marker (see `marker`), when it has one. */
      marker?: boolean
      gap?: KnownGapId
      /** app_errors route labels a shadow mode is expected to write for this probe. */
      appErrorRoutes?: string[]
    }
  | { notRun: true; gap: KnownGapId; reason: string }

export interface IsolationProbe {
  id: string
  what: string
  persona: ProbePersona
  host: ProbeHost
  /** null when an id the probe needs is missing: the probe is skipped. */
  request: (c: ProbeContext) => ProbeRequest | null
  /** A yes/no read of the response body, compared with Expectation.marker. Never printed. */
  marker?: (body: string, c: ProbeContext) => boolean | null
  expect: (m: RunMode) => Expectation
  /** A probe that may write when it differs from the table: the runner undoes the adult's check-in after it. */
  mayCheckIn?: boolean
}

const EMAILS_ROUTE = '/api/admin/events/[slug]/emails'
const DOWNLOAD_ROUTE = '/api/admin/docusigns/[id]/download'

/** lib/app-errors.ts routeLabel for a load-scoped shadow difference, and for an authz mismatch. */
export function loadScopedLabel(route: string): string {
  return `LOADSCOPED ${route}`
}
export function authzLabel(route: string): string {
  return `AUTHZ ${route}`
}

/**
 * A Stellr-wide admin scope runs eventInScope and loadScoped in the requested mode
 * (lib/tenancy/event-in-scope.ts): off answers as today, shadow answers as today
 * and logs the difference, enforce refuses another tenant's record with the
 * route's own 404.
 */
function byLoadScoped(m: RunMode, legacy: number, route: string): Expectation {
  if (m.loadScopedMode === 'enforce') return { status: 404 }
  return m.loadScopedMode === 'shadow' ? { status: legacy, appErrorRoutes: [loadScopedLabel(route)] } : { status: legacy }
}

function withAuthzShadowLog(e: Expectation, m: RunMode, route: string): Expectation {
  if ('notRun' in e || m.authzSource !== 'shadow') return e
  return { ...e, appErrorRoutes: [...(e.appErrorRoutes ?? []), authzLabel(route)] }
}

/** Does the desk manifest show a consent marker on this participant? null when they are not in it. */
export function participantHasConsentMarker(body: string, participantId: string | null): boolean | null {
  if (!participantId) return null
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return null
  }
  let found: boolean | null = null
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk)
    if (!v || typeof v !== 'object') return
    const o = v as Record<string, unknown>
    if (o.id === participantId) {
      found = Object.entries(o).some(([k, val]) => /consent/i.test(k) && val !== null && val !== false && val !== undefined)
      return
    }
    Object.values(o).forEach(walk)
  }
  walk(json)
  return found
}

export const ISOLATION_PROBES: readonly IsolationProbe[] = [
  {
    id: 'P1',
    what: 'the unmapped probe host answers 404',
    persona: 'anonymous',
    host: 'unmapped',
    request: () => ({ method: 'GET', path: '/' }),
    expect: () => ({ status: 404 }),
  },
  {
    id: 'P2',
    what: "the admin portal is not served on dev-canary's host",
    persona: 'anonymous',
    host: 'tenant',
    request: () => ({ method: 'GET', path: '/admin' }),
    expect: () => ({ status: 404 }),
  },
  {
    id: 'P3',
    what: "admin APIs are not served on dev-canary's host, even to a Stellr admin",
    persona: 'stellr-probe-admin',
    host: 'tenant',
    request: () => ({ method: 'GET', path: '/api/admin/health/integrations' }),
    expect: () => ({ status: 404 }),
  },
  {
    id: 'P4',
    what: "dev-canary's register page is unknown on Stellr's host (A7)",
    persona: 'anonymous',
    host: 'stellr',
    request: (c) => ({ method: 'GET', path: `/register/${c.canarySlug}` }),
    expect: () => ({ status: 404 }),
  },
  {
    id: 'P5',
    what: "registering for dev-canary's event through Stellr's host answers as an unknown event, and writes nothing (A7)",
    persona: 'anonymous',
    host: 'stellr',
    request: (c) => ({ method: 'POST', path: '/api/register/individual', body: c.stellrProbeBody }),
    expect: () => ({ status: 404 }),
  },
  {
    id: 'P6',
    what: "dev-canary's check-in page on Stellr's host",
    persona: 'anonymous',
    host: 'stellr',
    request: (c) => ({ method: 'GET', path: `/check-in/${c.canarySlug}` }),
    expect: () => ({ status: 200, gap: 'A12' }),
  },
  {
    id: 'P7',
    what: "canary-manager's desk for their own event, and the pending minor's consent marker",
    persona: 'canary-manager',
    host: 'stellr',
    request: (c) => (c.pendingParticipantId ? { method: 'GET', path: `/api/admin/events/${c.canarySlug}/check-in` } : null),
    marker: (body, c) => participantHasConsentMarker(body, c.pendingParticipantId),
    // lib/event-access.ts answers from the Clerk claim in every AUTHZ_SOURCE.
    expect: () => ({ status: 200, marker: false, gap: '.23' }),
  },
  {
    id: 'P8',
    what: "canary-manager on a Stellr event's desk",
    persona: 'canary-manager',
    host: 'stellr',
    request: (c) => ({ method: 'GET', path: `/api/admin/events/${c.stellrSlug}/check-in` }),
    expect: () => ({ status: 403 }),
  },
  {
    id: 'P9',
    what: 'a group check-in of the adult and a pending minor',
    persona: 'canary-manager',
    host: 'stellr',
    request: (c) =>
      c.adultParticipantId && c.pendingParticipantId
        ? { method: 'POST', path: `/api/admin/events/${c.canarySlug}/check-in`, body: { action: 'group_check_in', participantIds: [c.adultParticipantId, c.pendingParticipantId] } }
        : null,
    expect: () => ({ status: 409, gap: '.24' }),
    mayCheckIn: true,
  },
  {
    id: 'P10',
    what: "canary-admin (dev-canary's tenant_admin, no Clerk role) on Stellr's admin health route",
    persona: 'canary-admin',
    host: 'stellr',
    request: () => ({ method: 'GET', path: '/api/admin/health/integrations' }),
    expect: () => ({ status: 403 }),
  },
  {
    id: 'P11',
    what: "canary-manager on their own event's email tab, on Stellr's host",
    persona: 'canary-manager',
    host: 'stellr',
    request: (c) => ({ method: 'GET', path: `/api/admin/events/${c.canarySlug}/emails` }),
    // lib/authz.ts requireEventRoute. clerk and shadow decide as Stellr's event manager
    // (the Clerk claim, and an assignment read with no tenant counts as Stellr's), with a
    // Stellr-wide scope. postgres passes no slug to requireEventAccess, so the host's
    // tenant (Stellr) decides, and canary-manager is no event manager there, or holds
    // only dev-canary's assignment: 403 either way, before the event is read.
    // canary-flow-authz.test.ts drives requireEventRoute to hold this to the code.
    expect: (m) => withAuthzShadowLog(m.authzSource === 'postgres' ? { status: 403 } : byLoadScoped(m, 200, EMAILS_ROUTE), m, EMAILS_ROUTE),
  },
  {
    id: 'P12',
    what: "stellr-probe-admin on dev-canary's event's email tab",
    persona: 'stellr-probe-admin',
    host: 'stellr',
    request: (c) => ({ method: 'GET', path: `/api/admin/events/${c.canarySlug}/emails` }),
    // postgres: a Stellr admin covers every Stellr event, and requireEventRoute then reads
    // the event's tenant, dev-canary, which is not the caller's: the route's own 404.
    expect: (m) => withAuthzShadowLog(m.authzSource === 'postgres' ? { status: 404 } : byLoadScoped(m, 200, EMAILS_ROUTE), m, EMAILS_ROUTE),
  },
  {
    id: 'P13',
    what: "stellr-probe-admin loads dev-canary's pending consent agreement by id",
    persona: 'stellr-probe-admin',
    host: 'stellr',
    request: (c) => (c.pendingAgreementId ? { method: 'GET', path: `/api/admin/docusigns/${c.pendingAgreementId}/download` } : null),
    // Found and unsigned is a 400; enforce answers the route's own 404.
    expect: (m) => byLoadScoped(m, 400, DOWNLOAD_ROUTE),
  },
  {
    id: 'P14',
    what: "Stellr's agreements list, and whether it holds dev-canary's consent agreement",
    persona: 'stellr-probe-admin',
    host: 'stellr',
    request: (c) => (c.pendingAgreementId ? { method: 'GET', path: '/api/admin/docusigns' } : null),
    marker: (body, c) => (c.pendingAgreementId ? body.includes(c.pendingAgreementId) : null),
    expect: () => ({ status: 200, marker: true, gap: '.29' }),
  },
  {
    id: 'P15',
    what: "dev-canary's signing link on Stellr's host",
    persona: 'anonymous',
    host: 'stellr',
    request: () => null,
    expect: () => ({
      notRun: true,
      gap: 'A11',
      reason: "not probed: opening a signing link records a view on the guardian's envelope, and the runner never reads a signing token",
    }),
  },
  // The other direction of P4 and P5: a Stellr event through dev-canary's host. P17 is
  // what S8's Stellr registration count watches. Its rate-limit bucket is dev-canary's
  // host and the Stellr event (lib/rate-limit-async.ts tenantKey), so it does not use up
  // the three registrations S1 and S2 make, and its person is its own.
  {
    id: 'P16',
    what: "a Stellr event's register page is unknown on dev-canary's host",
    persona: 'anonymous',
    host: 'tenant',
    request: (c) => ({ method: 'GET', path: `/register/${c.stellrSlug}` }),
    expect: () => ({ status: 404 }),
  },
  {
    id: 'P17',
    what: "registering for a Stellr event through dev-canary's host answers as an unknown event, and writes nothing",
    persona: 'anonymous',
    host: 'tenant',
    request: (c) => ({ method: 'POST', path: '/api/register/individual', body: c.canaryHostProbeBody }),
    expect: () => ({ status: 404 }),
  },
]

export type ProbeVerdict = 'pass' | 'known-gap' | 'not-run' | 'differs' | 'skipped'

export interface ProbeObservation {
  status: number
  marker: boolean | null
}

export interface ProbeOutcome {
  id: string
  verdict: ProbeVerdict
  expected: string
  observed: string
  gap: KnownGapId | null
  note: string | null
}

export function describeExpectation(e: Expectation): string {
  if ('notRun' in e) return `not run, gap ${e.gap}`
  const parts = [String(e.status)]
  if (e.marker !== undefined) parts.push(`marker ${e.marker ? 'yes' : 'no'}`)
  if (e.gap) parts.push(`gap ${e.gap}`)
  if (e.appErrorRoutes?.length) parts.push(`logs ${e.appErrorRoutes.length}`)
  return parts.join(', ')
}

/**
 * One probe against the run's modes. `observed` null means it could not be sent
 * (a missing session or id): skipped, which is never green.
 */
export function judgeProbe(probe: IsolationProbe, m: RunMode, observed: ProbeObservation | null, skipReason?: string): ProbeOutcome {
  const e = probe.expect(m)
  const expected = describeExpectation(e)
  if ('notRun' in e) return { id: probe.id, verdict: 'not-run', expected, observed: '-', gap: e.gap, note: e.reason }
  if (!observed) return { id: probe.id, verdict: 'skipped', expected, observed: '-', gap: e.gap ?? null, note: skipReason ?? 'not sent' }
  const seen = `${observed.status}${e.marker !== undefined ? `, marker ${observed.marker === null ? 'unreadable' : observed.marker ? 'yes' : 'no'}` : ''}`
  const matches = observed.status === e.status && (e.marker === undefined || observed.marker === e.marker)
  if (matches) return { id: probe.id, verdict: e.gap ? 'known-gap' : 'pass', expected, observed: seen, gap: e.gap ?? null, note: e.gap ? KNOWN_GAPS[e.gap].owner : null }
  const note = e.gap ? `differs from the known gap; if ${KNOWN_GAPS[e.gap].owner} has landed, update this table in the same change` : null
  return { id: probe.id, verdict: 'differs', expected, observed: seen, gap: e.gap ?? null, note }
}

/** The app_errors route labels the probes that ran are expected to write in this mode. */
export function expectedAppErrorRoutes(m: RunMode, ran: readonly string[]): string[] {
  const out = new Set<string>()
  for (const p of ISOLATION_PROBES) {
    if (!ran.includes(p.id)) continue
    const e = p.expect(m)
    if (!('notRun' in e)) for (const r of e.appErrorRoutes ?? []) out.add(r)
  }
  return [...out]
}

export function judgeIsolation(outcomes: ProbeOutcome[]): ScenarioResult {
  const reasons: string[] = []
  const count = (v: ProbeVerdict) => outcomes.filter((o) => o.verdict === v).length
  if (count('differs')) reasons.push(`${count('differs')} probe(s) differ from the table`)
  if (count('skipped')) reasons.push(`${count('skipped')} probe(s) skipped (a missing session or id)`)
  const gaps = [...new Set(outcomes.map((o) => o.gap).filter((g): g is KnownGapId => !!g && outcomes.some((o2) => o2.gap === g && o2.verdict !== 'differs')))]
  return result('S7', reasons, [
    ['probes', outcomes.length],
    ['pass', count('pass')],
    ['known gaps', count('known-gap') + count('not-run')],
    ['differ', count('differs')],
    ['skipped', count('skipped')],
    ['gaps named', gaps.join(' ') || null],
  ])
}

/** One line per probe: the table for every mode (--plan), or for the run's mode. */
export function expectationTable(modes: readonly RunMode[] = ALL_RUN_MODES): string[] {
  const lines: string[] = []
  for (const p of ISOLATION_PROBES) {
    lines.push(`  ${p.id.padEnd(4)} ${p.persona.padEnd(18)} ${p.host.padEnd(8)} ${p.what}`)
    for (const m of modes) lines.push(`         ${modeLabel(m).padEnd(17)} ${describeExpectation(p.expect(m))}`)
  }
  lines.push('  Known gaps:')
  for (const [id, g] of Object.entries(KNOWN_GAPS)) lines.push(`    ${id.padEnd(4)} ${g.owner}: ${g.what}`)
  return lines
}

// ── Output ──────────────────────────────────────────────────────────────────

/** Anything that looks like an email address. */
export const EMAIL_PATTERN = /[^\s@<>()"']+@[^\s@<>()"']+\.[A-Za-z]{2,}/
/** Anything that looks like a date (ISO, or day/month/year either way). */
export const DATE_PATTERN = /\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/

export function personalDataProblem(line: string): 'email' | 'date' | null {
  if (EMAIL_PATTERN.test(line)) return 'email'
  if (DATE_PATTERN.test(line)) return 'date'
  return null
}

/** The lines, with any that looks like an email or a date withheld. The last guard before stdout. */
export function safeOutput(lines: readonly string[]): string[] {
  return lines.map((l) => (personalDataProblem(l) ? '  [line withheld: it matched an email or date pattern]' : l))
}

function factValue(v: FactValue): string {
  if (v === null) return '-'
  return String(v)
}

export function formatResults(runId: string, mode: RunMode | null, results: readonly ScenarioResult[], probes: readonly ProbeOutcome[] = []): string[] {
  const lines = [`Canary run ${runId}${mode ? ` (${modeLabel(mode)})` : ''}`]
  for (const r of results) {
    const spec = CANARY_SCENARIOS.find((s) => s.id === r.id)
    lines.push(`  ${r.id} ${r.status.toUpperCase().padEnd(7)} ${spec?.title ?? ''}`)
    for (const [k, v] of r.facts) lines.push(`        ${k}: ${factValue(v)}`)
    for (const reason of r.reasons) lines.push(`        - ${reason}`)
    if (r.id === 'S7') {
      for (const o of probes) {
        lines.push(`        ${o.id.padEnd(4)} ${o.verdict.padEnd(9)} expected ${o.expected}; observed ${o.observed}${o.note ? ` (${o.note})` : ''}`)
      }
    }
  }
  const green = results.every((r) => r.status === 'pass')
  lines.push(green ? '  Result: green' : `  Result: not green (${results.filter((r) => r.status !== 'pass').map((r) => `${r.id} ${r.status}`).join(', ')})`)
  return safeOutput(lines)
}

/** What --plan prints: the scenarios, then the table. No request, no read. */
export function describePlan(mode: RunMode | null): string[] {
  const lines = ['Canary run plan (K8): nothing is sent or read', '  Scenarios:']
  for (const s of CANARY_SCENARIOS) {
    lines.push(`  ${s.id} [${s.phases.join(', ')}] ${s.title}${s.personas.length ? ` (needs ${s.personas.join(', ')})` : ''}`)
    lines.push(`        ${s.evidence}`)
  }
  lines.push(`  Event: ${CANARY_FLOW_EVENT.slug} (dev-canary)`)
  lines.push(`  Isolation table${mode ? ` for ${modeLabel(mode)}` : ', every mode'}:`)
  lines.push(...expectationTable(mode ? [mode] : ALL_RUN_MODES))
  return safeOutput(lines)
}

/** A response body's JSON object, or null. */
export function jsonObject(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** The registration id a 201 carries, or null. */
export function registrationIdOf(answer: HttpAnswer): string | null {
  return answer.status === 201 ? str(answer.json?.registrationId) : null
}
