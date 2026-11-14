/**
 * The dev canary runner (S5 wave 7, slice K8): drives the canary tenant K3 seeds
 * ('dev-canary', lib/testing/canary-flow-seed.ts) through registration, guardian
 * consent, check-in and tenant mail over HTTP, probes isolation, and reads the
 * evidence back from the database this env names. What each scenario sends,
 * expects and prints is in lib/testing/canary-flow-scenarios.ts.
 *
 *   npx tsx scripts/canary-tenant-flow.ts --plan [--authz-source <s> --loadscoped-mode <m>]
 *       the scenarios and the isolation table; sends nothing, reads nothing
 *
 *   npx tsx scripts/canary-tenant-flow.ts --phase start --zone <zone> \
 *       --base <canary origin> --stellr-base <Stellr origin> --stellr-event <a Stellr event slug> \
 *       [--mailbox example|role-inbox] [--authz-source <s>] [--loadscoped-mode <m>] [--connect <address>] [--state <file>]
 *       S1 to S4, S7 and S8: three registrations on dev-canary's event (an adult and two
 *       minors), the desk refusal, the mail read-back and the probes. Writes the run's
 *       ids to the state file (default: <os tmpdir>/stellr-canary/<run>.json, outside
 *       the repo) and prints the manual step. Needs stellr-probe-admin's session: the
 *       health route is read first, so a target on another Clerk instance, or one that
 *       does not answer as Stellr's admin, is refused before anything is written. If S1
 *       answers 201 but this env's database holds no dev-canary registration for it, the
 *       phase stops there: the server is writing somewhere else, and nothing more is sent.
 *
 *   (manual) In the role inbox, the two consent mails name the run in their subject
 *       (dev routes every mail there, with the intended address in the subject): sign
 *       the "guardian-sign" form and decline the "guardian-decline" one.
 *
 *   npx tsx scripts/canary-tenant-flow.ts --phase settle --state <file> --zone <zone> \
 *       --base <canary origin> --stellr-base <Stellr origin> [same mode flags]
 *       S5, S6 and S8 again. Re-run it until S5 and S6 stop waiting.
 *
 * Targets. The database is .env.local's, through K3's guard (assertCanaryFlowTarget):
 * the dev project or a stack on this machine only, no sk_live Clerk key, no APP_ENV or
 * NEXT_PUBLIC_APP_ENV prod or preview, no VERCEL_ENV preview. --base must be
 * canary.<zone>, and --stellr-base this machine or the stellr-web-dev deployment;
 * Stellr's production hosts are refused, and so is every host in the production tenant
 * zone (.events.stellreducation.org, its apex included) and that zone as --zone (W7-27),
 * before any request. --connect must be this machine. There is no
 * override. Never point it at a hosted database without the owner's yes for that run (K9).
 *
 * Personas. S3, S5's check-in and most of S7 act as K3's personas. The runner never
 * signs in and never fetches a testing token. Once per K9 window the operator signs
 * each persona in on the dev host in a browser, with a Clerk testing token
 * (@clerk/testing's setupClerkTestingToken, which reads the dev instance's
 * CLERK_SECRET_KEY, an sk_test_ key), reads that session's id (window.Clerk.session.id
 * in the browser console, or the user's Sessions in the dev instance's dashboard) and
 * passes it as
 *   CANARY_SESSION_ID_CANARY_MANAGER, CANARY_SESSION_ID_CANARY_ADMIN, CANARY_SESSION_ID_STELLR_PROBE_ADMIN
 * Just before each request that needs one, the runner mints a fresh session token for
 * that id from Clerk's Backend API (POST /v1/sessions/{id}/tokens) with this env's
 * CLERK_SECRET_KEY, which must be sk_test_; a token copied by hand lives about a
 * minute, which a start phase outlasts. A token may instead be passed as
 * CANARY_SESSION_<HANDLE> for a short check. Every token is checked before each use:
 * one that is missing, expired, or not from a development instance
 * (*.clerk.accounts.dev) is not used, and what needs it is skipped, which is never
 * green. Sign the sessions out (or revoke them in the dashboard) after the window.
 *
 * Caps. The register route allows 3 an hour per event and address, which is exactly
 * what start makes on dev-canary's host: one start an hour. Every run makes fresh
 * addresses (canary-<run>-…@example.test, or the role inbox plus-addressed with
 * --mailbox role-inbox), so the guardian invitation cap (5 a day per address) never trips.
 *
 * Output: ids, counts and status codes only, through safeOutput, which withholds any
 * line that looks like an email or a date. Exit 1 unless every scenario passed.
 * VERCEL_AUTOMATION_BYPASS_SECRET, when set, is sent only on requests to a
 * stellr-web-dev deployment, the only host its protection covers.
 */
import * as dotenv from 'dotenv'
import { randomBytes } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  assertCanaryRunTarget,
  describePlan,
  expectedAppErrorRoutes,
  formatResults,
  ISOLATION_PROBES,
  judgeAdultRegistered,
  judgeCheckInRefused,
  judgeDeclined,
  judgeIsolation,
  judgeMailExclusion,
  judgeMinorPending,
  judgeProbe,
  judgeSigned,
  judgeStellrUnchanged,
  jsonObject,
  newRunId,
  parseRunState,
  registrationBody,
  registrationIdOf,
  resolveRunMode,
  runAddresses,
  runIdentities,
  safeOutput,
  mintSessionToken,
  personaSessionFrom,
  sessionTokenProblem,
  skipped,
  startMustStop,
  type CanaryBases,
  type GuardianMailbox,
  type HttpAnswer,
  type PersonaSession,
  type ProbeContext,
  type ProbeOutcome,
  type ProbePersona,
  type RegistrationReadBack,
  type RunMode,
  type RunState,
  type ScenarioResult,
} from '../lib/testing/canary-flow-scenarios'
import { CANARY_FLOW_EVENT, CANARY_FLOW_TENANT, CANARY_PERSONAS, canaryReadiness, formatReadiness, planCanaryFlowSeed, readCanaryFacts } from '../lib/testing/canary-flow-seed'
import { bypassHeadersFor, connectAddress, rawRequest } from './canary/tenant-host-headers.mjs'

const envPath = path.resolve(process.cwd(), '.env.local')
dotenv.config(fs.existsSync(envPath) ? { path: envPath } : {})

const CANARY_ID = CANARY_FLOW_TENANT.id
const SLUG = CANARY_FLOW_EVENT.slug
// Clerk's Backend API, for minting persona session tokens on the dev instance. It
// stays here, not in lib/: lib/clerk-provisioning.guard.test.ts allows no Clerk REST
// URL in app code.
const CLERK_API = 'https://api.clerk.com/v1'
const MINORS = ['minor-sign', 'minor-decline'] as const

/** `--name value` or `--name=value`; undefined when absent. */
function flagValue(name: string): string | undefined {
  const args = process.argv.slice(2)
  const eq = args.find((a) => a.startsWith(`${name}=`))
  if (eq !== undefined) return eq.slice(name.length + 1)
  const at = args.indexOf(name)
  if (at === -1) return undefined
  const next = args[at + 1]
  return next !== undefined && !next.startsWith('--') ? next : ''
}

function print(lines: string[]): void {
  for (const line of safeOutput(lines)) console.log(line)
}

// ── HTTP ────────────────────────────────────────────────────────────────────

interface Client {
  bases: CanaryBases
  sessions: Map<ProbePersona, PersonaSession>
  /** The last token minted for a session id, reused while it has time left. */
  minted: Map<ProbePersona, string>
  /** Why a persona has no usable session. */
  missing: Map<ProbePersona, string>
  connect: string | undefined
}

/**
 * A token for the persona that can be used now, or null. A session id gets a fresh
 * token whenever the last one is near its end; a token passed by hand is checked
 * again. One that cannot be had is dropped, and what needed it is skipped, rather
 * than read as a 401 the table did not expect.
 */
async function tokenFor(c: Client, persona: Exclude<ProbePersona, 'anonymous'>): Promise<string | null> {
  const session = c.sessions.get(persona)
  if (!session) return null
  let problem: string | null
  let token: string | null = null
  if (session.kind === 'token') {
    problem = sessionTokenProblem(session.token, new Date())
    token = problem ? null : session.token
  } else {
    const last = c.minted.get(persona)
    if (last && !sessionTokenProblem(last, new Date())) return last
    try {
      token = await mintSessionToken(CLERK_API, session.sessionId, process.env.CLERK_SECRET_KEY, () => new Date(), fetch)
      problem = null
      c.minted.set(persona, token)
    } catch (e) {
      problem = e instanceof Error ? e.message : 'no token minted'
    }
  }
  if (token) return token
  c.sessions.delete(persona)
  c.minted.delete(persona)
  c.missing.set(persona, problem ?? 'not set')
  return null
}

async function usable(c: Client, persona: ProbePersona): Promise<boolean> {
  return persona === 'anonymous' || (await tokenFor(c, persona)) !== null
}

async function send(c: Client, host: 'tenant' | 'unmapped' | 'stellr', persona: ProbePersona, req: { method: 'GET' | 'POST'; path: string; body?: unknown }) {
  const token = persona === 'anonymous' ? undefined : await tokenFor(c, persona)
  if (persona !== 'anonymous' && !token) throw new Error(`no ${persona} session`)
  const url = new URL(req.path, c.bases[host])
  const res = await rawRequest({
    url,
    method: req.method,
    body: req.body,
    connect: c.connect,
    headers: { ...bypassHeadersFor(url), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
  return { answer: { status: res.status, json: jsonObject(res.body) } as HttpAnswer, body: res.body }
}

/** The desk at Stellr's host, as canary-manager. null without the session. */
async function desk(c: Client, action: 'manual' | 'undo', participantId: string): Promise<HttpAnswer | null> {
  if (!(await usable(c, 'canary-manager'))) return null
  return (await send(c, 'stellr', 'canary-manager', { method: 'POST', path: `/api/admin/events/${SLUG}/check-in`, body: { action, participantId } })).answer
}

/** The modes the target's health route resolved, read as stellr-probe-admin. null without that session. */
async function reportedModes(c: Client): Promise<{ mode: Partial<RunMode>; guardianConsent: boolean | null } | null> {
  if (!(await usable(c, 'stellr-probe-admin'))) return null
  const { answer } = await send(c, 'stellr', 'stellr-probe-admin', { method: 'GET', path: '/api/admin/health/integrations' })
  const t = answer.json?.tenancy as { authzSource?: { value?: string }; loadScopedMode?: string; guardianConsent?: boolean } | undefined
  if (answer.status !== 200 || !t) throw new Error(`the health route answered ${answer.status} to stellr-probe-admin`)
  return {
    mode: { authzSource: t.authzSource?.value as RunMode['authzSource'], loadScopedMode: t.loadScopedMode as RunMode['loadScopedMode'] },
    guardianConsent: typeof t.guardianConsent === 'boolean' ? t.guardianConsent : null,
  }
}

// ── Read-back (SELECT only) ─────────────────────────────────────────────────

/** Fails with the table only: a database message can echo values. */
function must<T>(table: string, r: { data: T; error: unknown }): T {
  if (r.error) throw new Error(`${table} read failed`)
  return r.data
}

async function readBack(db: SupabaseClient, registrationId: string | null, participantHint: string | null = null): Promise<RegistrationReadBack> {
  const registration = registrationId
    ? must('registrations', await db.from('registrations').select('id, tenant_id, event_slug').eq('id', registrationId).maybeSingle())
    : null
  const participants = registrationId
    ? must('participants', await db.from('participants').select('id, tenant_id, checked_in_at').eq('registration_id', registrationId))
    : []
  const pid = (participants as { id: string }[])[0]?.id ?? participantHint
  const consent = pid
    ? must(
        'tenant_guardian_consents',
        await db.from('tenant_guardian_consents').select('id, tenant_id, status, agreement_id, expires_at, settled_at, removal_attempts').eq('participant_id', pid).maybeSingle(),
      )
    : null
  const agreementId = (consent as { agreement_id?: string | null } | null)?.agreement_id
  const agreement = agreementId
    ? must('agreements', await db.from('agreements').select('id, tenant_id, envelope_type, status').eq('id', agreementId).maybeSingle())
    : null
  return {
    registration: registration as RegistrationReadBack['registration'],
    participants: (participants ?? []) as RegistrationReadBack['participants'],
    consent: consent as RegistrationReadBack['consent'],
    agreement: agreement as RegistrationReadBack['agreement'],
  }
}

async function unconsented(db: SupabaseClient): Promise<Set<string>> {
  const { unconsentedParticipantIds } = await import('../lib/registration/tenant-guardian-consent')
  return unconsentedParticipantIds(db, CANARY_ID)
}

async function stellrRegistrationCount(db: SupabaseClient, slug: string): Promise<number> {
  const { count, error } = await db.from('registrations').select('id', { count: 'exact', head: true }).eq('event_slug', slug)
  if (error || count === null) throw new Error('registrations count failed')
  return count
}

async function stellrUnchanged(c: Client, db: SupabaseClient, state: RunState, mode: RunMode, ranProbes: string[]): Promise<ScenarioResult> {
  const pages = []
  for (const p of ['/', `/register/${state.stellrEventSlug}`]) pages.push({ path: p, status: (await send(c, 'stellr', 'anonymous', { method: 'GET', path: p })).answer.status })
  const ids = runIdentities(state.runId, state.mailbox)
  const people = must('participants', await db.from('participants').select('tenant_id').in('email', runAddresses(ids)))
  const errors = must('app_errors', await db.from('app_errors').select('route, count').gte('last_seen', state.startedAt))
  return judgeStellrUnchanged({
    pages,
    stellrRegistrations: { atStart: state.stellrRegistrationsAtStart, now: await stellrRegistrationCount(db, state.stellrEventSlug) },
    runRegistrationsOutsideCanary: ((people ?? []) as { tenant_id: string | null }[]).filter((p) => p.tenant_id !== CANARY_ID).length,
    appErrors: ((errors ?? []) as { route: string; count: number }[]).map((e) => ({ route: e.route, count: e.count })),
    expectedAppErrorRoutes: expectedAppErrorRoutes(mode, ranProbes),
  })
}

// ── The phases ──────────────────────────────────────────────────────────────

async function startPhase(
  c: Client,
  db: SupabaseClient,
  mode: RunMode,
  consentOn: boolean | null,
  zone: string,
  save: (state: RunState) => string,
): Promise<{ results: ScenarioResult[]; probes: ProbeOutcome[]; state: RunState; file: string }> {
  const plan = planCanaryFlowSeed({ zone })
  const { tenantEventSender } = await import('../lib/event-emails/tenant-mail')
  const readiness = canaryReadiness(plan, await readCanaryFacts(db, plan), { senderOf: tenantEventSender })
  print(['Canary readiness (K3 --check)', ...formatReadiness(readiness)])
  if (readiness.some((l) => !l.ok)) throw new Error('the canary is not ready (seed-two-tenants --profile flow --check); nothing was sent')

  const event = must('events', await db.from('events').select('starts_at').eq('slug', SLUG).maybeSingle()) as { starts_at: string | null } | null
  const startsOn = event?.starts_at?.slice(0, 10)
  if (!startsOn) throw new Error('the canary event has no start date')

  const stellrEventSlug = flagValue('--stellr-event')
  if (!stellrEventSlug) throw new Error('--stellr-event is required: a Stellr event slug on this deployment, for S7 and S8')
  const runId = newRunId(randomBytes(10))
  const mailbox = (flagValue('--mailbox') || 'example') as GuardianMailbox
  if (mailbox !== 'example' && mailbox !== 'role-inbox') throw new Error('--mailbox must be example or role-inbox')
  const ids = runIdentities(runId, mailbox)
  const state: RunState = {
    runId,
    mailbox,
    zone,
    startedAt: new Date().toISOString(),
    stellrEventSlug,
    stellrRegistrationsAtStart: await stellrRegistrationCount(db, stellrEventSlug),
    registrations: {},
  }
  print([`Run ${runId}: started`])
  const results: ScenarioResult[] = []
  const register = async (key: 'adult' | 'minor-sign' | 'minor-decline') => {
    const { answer } = await send(c, 'tenant', 'anonymous', { method: 'POST', path: '/api/register/individual', body: registrationBody(ids[key], SLUG, startsOn) })
    const rb = await readBack(db, registrationIdOf(answer))
    if (rb.registration) state.registrations[key] = { registrationId: rb.registration.id, participantId: rb.participants[0]?.id ?? null, agreementId: rb.agreement?.id ?? null }
    return { answer, rb }
  }

  // S1
  const adult = await register('adult')
  results.push(judgeAdultRegistered(adult.answer, adult.rb))
  if (startMustStop(adult.answer, adult.rb)) {
    const file = save(state)
    print(formatResults(runId, mode, results))
    print([`State: ${file}`])
    throw new Error('the base is not writing to the database this env names; nothing more was sent')
  }

  // S2
  const minors: { key: (typeof MINORS)[number]; answer: HttpAnswer; rb: RegistrationReadBack }[] = []
  if (consentOn === false) {
    for (const id of ['S2', 'S3', 'S4'] as const) results.push(skipped(id, 'TENANT_GUARDIAN_CONSENT_ENABLED resolves off on the target, so a minor would be refused'))
  } else {
    for (const key of MINORS) minors.push({ key, ...(await register(key)) })
    results.push(judgeMinorPending(minors, new Date(), event?.starts_at ?? null))
  }
  // Saved now, so a later failure still leaves settle (and the teardown) the run's ids.
  let file = save(state)
  const pending = minors.find((m) => m.key === 'minor-sign')
  const pendingPid = pending?.rb.participants[0]?.id ?? null

  // S3
  if (consentOn !== false) {
    const tried = pendingPid ? await desk(c, 'manual', pendingPid) : null
    if (!pendingPid) results.push(skipped('S3', 'no pending minor from S2'))
    else if (!tried) results.push(skipped('S3', `no canary-manager session (${c.missing.get('canary-manager') ?? 'not set'})`))
    else {
      const after = await readBack(db, pending!.rb.registration?.id ?? null)
      results.push(judgeCheckInRefused(tried, after))
      // A check-in the trigger should have refused went through: undo it, and S3 has failed.
      if (after.participants.some((p) => p.checked_in_at)) await desk(c, 'undo', pendingPid)
    }

    // S4
    const sends = must('event_email_sends', await db.from('event_email_sends').select('recipients').eq('event_slug', SLUG).gte('started_at', state.startedAt)) as { recipients: unknown }[] | null
    const watched = runAddresses(ids).filter((a) => a !== ids.adult.email && a !== ids['stellr-probe'].email).map((a) => a.toLowerCase())
    results.push(
      judgeMailExclusion({
        unconsented: await unconsented(db),
        adultParticipantId: adult.rb.participants[0]?.id ?? null,
        minorParticipantIds: minors.map((m) => m.rb.participants[0]?.id ?? null),
        sendsSinceStart: (sends ?? []).length,
        sendsNamingRun: (sends ?? []).filter((s) => watched.some((a) => JSON.stringify(s.recipients ?? '').toLowerCase().includes(a))).length,
      }),
    )
  }

  // S7
  const ctx: ProbeContext = {
    canarySlug: SLUG,
    stellrSlug: stellrEventSlug,
    pendingAgreementId: pending?.rb.agreement?.id ?? null,
    pendingParticipantId: pendingPid,
    adultParticipantId: adult.rb.participants[0]?.id ?? null,
    stellrProbeBody: registrationBody(ids['stellr-probe'], SLUG, startsOn),
    canaryHostProbeBody: registrationBody(ids['canary-host-probe'], stellrEventSlug, startsOn),
  }
  const probes: ProbeOutcome[] = []
  const ran: string[] = []
  for (const probe of ISOLATION_PROBES) {
    const req = probe.request(ctx)
    if (!req) {
      probes.push(judgeProbe(probe, mode, null, 'an id it needs is missing (S1 or S2 did not pass)'))
      continue
    }
    if (!(await usable(c, probe.persona))) {
      probes.push(judgeProbe(probe, mode, null, `no ${probe.persona} session (${c.missing.get(probe.persona) ?? 'not set'})`))
      continue
    }
    let sent: Awaited<ReturnType<typeof send>>
    try {
      sent = await send(c, probe.host, probe.persona, req)
    } catch {
      probes.push(judgeProbe(probe, mode, null, 'no response'))
      continue
    }
    const { answer, body } = sent
    ran.push(probe.id)
    probes.push(judgeProbe(probe, mode, { status: answer.status, marker: probe.marker ? probe.marker(body, ctx) : null }))
    // A group check-in that differs from the table may have checked the adult in: undo it.
    if (probe.mayCheckIn && ctx.adultParticipantId) {
      const after = await readBack(db, adult.rb.registration?.id ?? null)
      if (after.participants.some((p) => p.checked_in_at)) await desk(c, 'undo', ctx.adultParticipantId)
    }
  }
  results.push(judgeIsolation(probes))

  // S8
  results.push(await stellrUnchanged(c, db, state, mode, ran))
  file = save(state)
  return { results, probes, state, file }
}

async function settlePhase(c: Client, db: SupabaseClient, mode: RunMode, state: RunState): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = []
  const signed = state.registrations['minor-sign']
  if (!signed) results.push(skipped('S5', 'the start phase made no minor-sign registration'))
  else {
    const rb = await readBack(db, signed.registrationId, signed.participantId)
    let checkIn: HttpAnswer | null = null
    let checkedInAfter: boolean | null = null
    let undo: HttpAnswer | null = null
    let checkedInAfterUndo: boolean | null = null
    const pid = rb.participants[0]?.id
    if (rb.consent?.status === 'signed' && pid) {
      checkIn = await desk(c, 'manual', pid)
      if (checkIn) {
        checkedInAfter = (await readBack(db, signed.registrationId)).participants.some((p) => p.checked_in_at)
        undo = await desk(c, 'undo', pid)
        checkedInAfterUndo = (await readBack(db, signed.registrationId)).participants.some((p) => p.checked_in_at)
      }
    }
    results.push(judgeSigned({ rb, unconsented: await unconsented(db), checkIn, checkedInAfter, undo, checkedInAfterUndo }))
  }
  const declined = state.registrations['minor-decline']
  results.push(declined ? judgeDeclined(await readBack(db, declined.registrationId, declined.participantId)) : skipped('S6', 'the start phase made no minor-decline registration'))
  results.push(await stellrUnchanged(c, db, state, mode, ISOLATION_PROBES.map((p) => p.id)))
  return results
}

// ── main ────────────────────────────────────────────────────────────────────

function statePath(runId: string): string {
  return flagValue('--state') || path.join(os.tmpdir(), 'stellr-canary', `${runId}.json`)
}

async function main() {
  const stated = { authzSource: flagValue('--authz-source'), loadScopedMode: flagValue('--loadscoped-mode') }
  if (process.argv.includes('--plan')) {
    const mode = stated.authzSource && stated.loadScopedMode ? resolveRunMode(null, stated) : null
    print(describePlan(mode))
    return
  }
  const phase = flagValue('--phase')
  if (phase !== 'start' && phase !== 'settle') throw new Error('give --plan, or --phase start or --phase settle')

  let state: RunState | null = null
  if (phase === 'settle') {
    const file = flagValue('--state')
    if (!file) throw new Error('--phase settle needs --state <file> from the start phase')
    state = parseRunState(JSON.parse(fs.readFileSync(file, 'utf8')))
  }
  const zone = flagValue('--zone') ?? state?.zone
  if (state && zone !== state.zone) throw new Error('--zone differs from the zone the run started under')

  // Guards first: nothing is imported that reads the database before they pass.
  const bases = assertCanaryRunTarget(process.env, { base: flagValue('--base'), stellrBase: flagValue('--stellr-base'), zone })
  const connect = connectAddress(flagValue('--connect'))
  const sessions = new Map<ProbePersona, PersonaSession>()
  const missing = new Map<ProbePersona, string>()
  const now = new Date()
  for (const p of CANARY_PERSONAS) {
    const found = personaSessionFrom(process.env, p.handle, now)
    if (found.session) sessions.set(p.handle, found.session)
    else missing.set(p.handle, found.problem)
  }
  const c: Client = { bases, sessions, minted: new Map(), missing, connect }
  print([
    `Canary ${phase}: ${bases.tenant.host} and ${bases.stellr.host}; database ${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL as string).host}`,
    ...CANARY_PERSONAS.map((p) => {
      const s = sessions.get(p.handle)
      return `  session ${p.handle}: ${s ? (s.kind === 'session-id' ? 'session id (tokens minted per use)' : 'token') : missing.get(p.handle)}`
    }),
  ])

  const reported = await reportedModes(c)
  if (phase === 'start' && !reported) {
    throw new Error(`--phase start needs stellr-probe-admin's session (${missing.get('stellr-probe-admin') ?? 'not set'}): the health route is read before anything is written`)
  }
  const mode = resolveRunMode(reported?.mode ?? null, stated)
  const { supabaseServer } = await import('../lib/supabase')
  const db = supabaseServer()

  if (phase === 'start') {
    const save = (s: RunState): string => {
      const file = statePath(s.runId)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, `${JSON.stringify(s, null, 2)}\n`, { mode: 0o600 })
      return file
    }
    const run = await startPhase(c, db, mode, reported?.guardianConsent ?? null, zone as string, save)
    print(formatResults(run.state.runId, mode, run.results, run.probes))
    print([
      `State: ${run.file}`,
      `Next: in the role inbox, the consent mails for run ${run.state.runId} name it in their subject. Sign the "guardian-sign" form, decline the "guardian-decline" one, then run --phase settle --state <that file>.`,
    ])
    if (run.results.some((r) => r.status !== 'pass')) process.exitCode = 1
    return
  }
  const results = await settlePhase(c, db, mode, state as RunState)
  print(formatResults((state as RunState).runId, mode, results))
  if (results.some((r) => r.status !== 'pass')) process.exitCode = 1
}

main().catch((e) => {
  print([`canary-tenant-flow: ${e instanceof Error ? e.message : String(e)}`])
  process.exit(1)
})
