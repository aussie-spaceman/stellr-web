// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ALL_RUN_MODES,
  assertCanaryRunTarget,
  birthDateForAge,
  CANARY_SCENARIOS,
  canaryBases,
  describePlan,
  expectationTable,
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
  KNOWN_GAPS,
  mintSessionToken,
  newRunId,
  parseRunState,
  participantHasConsentMarker,
  personaSessionFrom,
  personalDataProblem,
  plusAddress,
  registrationBody,
  registrationIdOf,
  resolveRunMode,
  runAddresses,
  runIdentities,
  RUN_ID_RE,
  safeOutput,
  scenariosFor,
  sessionEnvName,
  sessionIdEnvName,
  sessionTokenProblem,
  skipped,
  startMustStop,
  type ProbeContext,
  type ProbeOutcome,
  type RegistrationReadBack,
  type RunMode,
  type ScenarioResult,
} from './canary-flow-scenarios'
import { CANARY_FLOW_EVENT, CANARY_FLOW_TENANT, CANARY_PERSONAS, CANARY_ROLE_INBOX } from './canary-flow-seed'
import { DEV_SUPABASE_REF } from './e2e-supabase-target'
import { PRODUCTION_SUPABASE_REF } from './two-tenant-seed'
import { ageOn, isMinorOn } from '../age'
import { guardianFromForm } from '../registration/tenant-guardian-consent'
import { hasSchool } from '../registration/individual/parse'
import { STELLR_TENANT_ID } from '../tenancy/constants'

const CLERK = 'https://api.clerk.com/v1'
import { AUTHZ_SOURCES } from '../authz/decide'
import { LOADSCOPED_MODES } from '../tenancy/load-scoped-mode'

const CANARY = CANARY_FLOW_TENANT.id
const NOW = new Date('2026-12-01T12:00:00Z')
const EVENT_STARTS_AT = '2026-12-29T07:00:00Z'
const RUN = newRunId(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))
const IDS = runIdentities(RUN)
const DEV_DB = `https://${DEV_SUPABASE_REF}.supabase.co`

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** A session token built here, signed with nothing: the runner reads it, the server verifies it. */
function token(payload: Record<string, unknown>): string {
  const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  return `${part({ alg: 'RS256' })}.${part(payload)}.${Buffer.from('placeholder-signature').toString('base64url')}`
}
const DEV_ISSUER = 'https://canary-placeholder-1.clerk.accounts.dev'
const live = (secondsLeft: number) => Math.floor(NOW.getTime() / 1000) + secondsLeft

function readBack(over: Partial<RegistrationReadBack> = {}): RegistrationReadBack {
  return {
    registration: { id: uuid(1), tenant_id: CANARY, event_slug: CANARY_FLOW_EVENT.slug },
    participants: [{ id: uuid(2), tenant_id: CANARY, checked_in_at: null }],
    consent: null,
    agreement: null,
    ...over,
  }
}

function pendingReadBack(n: number): RegistrationReadBack {
  return readBack({
    registration: { id: uuid(n), tenant_id: CANARY, event_slug: CANARY_FLOW_EVENT.slug },
    participants: [{ id: uuid(n + 1), tenant_id: CANARY, checked_in_at: null }],
    consent: {
      id: uuid(n + 2),
      tenant_id: CANARY,
      status: 'pending',
      agreement_id: uuid(n + 3),
      expires_at: '2026-12-15T12:00:00Z',
      settled_at: null,
      removal_attempts: 0,
    },
    agreement: { id: uuid(n + 3), tenant_id: CANARY, envelope_type: 'tenant_guardian_consent', status: 'sent' },
  })
}

const created = (json: Record<string, unknown>) => ({ status: 201, json: { registrationId: uuid(1), checkoutUrl: null, signInToken: null, ...json } })

const CONTEXT: ProbeContext = {
  canarySlug: CANARY_FLOW_EVENT.slug,
  stellrSlug: 'a-stellr-event',
  pendingAgreementId: uuid(20),
  pendingParticipantId: uuid(21),
  adultParticipantId: uuid(22),
  stellrProbeBody: registrationBody(IDS['stellr-probe'], CANARY_FLOW_EVENT.slug, '2026-12-29'),
  canaryHostProbeBody: registrationBody(IDS['canary-host-probe'], 'a-stellr-event', '2026-12-29'),
}

const mode = (authzSource: RunMode['authzSource'], loadScopedMode: RunMode['loadScopedMode']): RunMode => ({ authzSource, loadScopedMode })
const probe = (id: string) => ISOLATION_PROBES.find((p) => p.id === id)!

describe('the scenarios', () => {
  it('are S1 to S8, in order, each with a phase and evidence', () => {
    expect(CANARY_SCENARIOS.map((s) => s.id)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'])
    for (const s of CANARY_SCENARIOS) {
      expect(s.phases.length, s.id).toBeGreaterThan(0)
      expect(s.evidence.length, s.id).toBeGreaterThan(20)
    }
    expect(scenariosFor('start').map((s) => s.id)).toEqual(['S1', 'S2', 'S3', 'S4', 'S7', 'S8'])
    expect(scenariosFor('settle').map((s) => s.id)).toEqual(['S5', 'S6', 'S8'])
  })

  it("name only K3's personas, and S7 names every persona a probe uses", () => {
    const handles = CANARY_PERSONAS.map((p) => p.handle)
    for (const s of CANARY_SCENARIOS) for (const p of s.personas) expect(handles).toContain(p)
    const s7 = CANARY_SCENARIOS.find((s) => s.id === 'S7')!
    for (const p of ISOLATION_PROBES) if (p.persona !== 'anonymous') expect(s7.personas).toContain(p.persona)
  })
})

describe('the modes', () => {
  it("cover lib/authz's sources and load-scoped modes, nine in all", () => {
    expect(new Set(ALL_RUN_MODES.map((m) => m.authzSource))).toEqual(new Set(AUTHZ_SOURCES))
    expect(new Set(ALL_RUN_MODES.map((m) => m.loadScopedMode))).toEqual(new Set(LOADSCOPED_MODES))
    expect(ALL_RUN_MODES).toHaveLength(9)
  })

  it('come from the health report or the flags, and the two must agree', () => {
    expect(resolveRunMode({ authzSource: 'shadow', loadScopedMode: 'off' }, {})).toEqual(mode('shadow', 'off'))
    expect(resolveRunMode(null, { authzSource: 'Postgres', loadScopedMode: 'enforce' })).toEqual(mode('postgres', 'enforce'))
    expect(resolveRunMode({ authzSource: 'clerk', loadScopedMode: 'shadow' }, { authzSource: 'clerk' })).toEqual(mode('clerk', 'shadow'))
    expect(() => resolveRunMode({ authzSource: 'clerk', loadScopedMode: 'off' }, { authzSource: 'postgres' })).toThrow(/reports clerk/)
    expect(() => resolveRunMode(null, { authzSource: 'clerk' })).toThrow(/loadscoped-mode is unknown/)
    expect(() => resolveRunMode(null, { authzSource: 'postgress', loadScopedMode: 'off' })).toThrow(/must be one of/)
  })
})

describe('the targets', () => {
  it('take the canary host under --zone, this machine or the dev deployment, and derive the unmapped host', () => {
    const b = canaryBases({ base: 'http://canary.localhost:3000', stellrBase: 'http://localhost:3000', zone: 'localhost' })
    expect(b.tenant.origin).toBe('http://canary.localhost:3000')
    expect(b.unmapped.origin).toBe('http://nobody.localhost:3000')
    expect(b.stellr.origin).toBe('http://localhost:3000')
    const hosted = canaryBases({ base: 'https://canary.dev-zone.example', stellrBase: 'https://stellr-web-dev.vercel.app', zone: 'dev-zone.example' })
    expect(hosted.unmapped.origin).toBe('https://nobody.dev-zone.example')
    expect(canaryBases({ base: 'https://canary.dev-zone.example/', stellrBase: 'https://stellr-web-dev-git-dev-team.vercel.app', zone: 'dev-zone.example' }).stellr.hostname).toBe(
      'stellr-web-dev-git-dev-team.vercel.app',
    )
  })

  it("refuses Stellr's production hosts, other deployments, a host that is not the canary's, and paths", () => {
    const ok = { base: 'http://canary.localhost:3000', stellrBase: 'http://localhost:3000', zone: 'localhost' }
    for (const stellrBase of ['https://www.stellreducation.org', 'https://app.stellreducation.org', 'https://stellreducation.org', 'https://events.stellreducation.org']) {
      expect(() => canaryBases({ ...ok, stellrBase }), stellrBase).toThrow(/production host/)
    }
    expect(() => canaryBases({ ...ok, base: 'https://www.stellreducation.org', zone: 'stellreducation.org' })).toThrow(/production host/)
    expect(() => canaryBases({ ...ok, stellrBase: 'https://stellr-web.vercel.app' })).toThrow(/stellr-web-dev/)
    expect(() => canaryBases({ ...ok, stellrBase: 'https://stellr-web-git-main-team.vercel.app' })).toThrow(/stellr-web-dev/)
    expect(() => canaryBases({ ...ok, base: 'http://nobody.localhost:3000' })).toThrow(/canary host/)
    expect(() => canaryBases({ ...ok, zone: undefined })).toThrow(/--zone is required/)
    expect(() => canaryBases({ ...ok, base: 'http://canary.localhost:3000/register' })).toThrow(/no path/)
    expect(() => canaryBases({ ...ok, stellrBase: 'http://user:pw@localhost:3000' })).toThrow(/credentials/)
    expect(() => canaryBases({ ...ok, base: 'ftp://canary.localhost' })).toThrow(/http or https/)
    expect(() => canaryBases({ ...ok, base: undefined })).toThrow(/--base is required/)
  })

  it("applies K3's database guard first: production, live Clerk keys and prod or preview env are refused", () => {
    const opts = { base: 'http://canary.localhost:3000', stellrBase: 'http://localhost:3000', zone: 'localhost' }
    expect(assertCanaryRunTarget({ NEXT_PUBLIC_SUPABASE_URL: DEV_DB }, opts).tenant.hostname).toBe('canary.localhost')
    expect(assertCanaryRunTarget({ NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' }, opts).stellr.hostname).toBe('localhost')
    expect(() => assertCanaryRunTarget({ NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_REF}.supabase.co` }, opts)).toThrow(/refusing/)
    expect(() => assertCanaryRunTarget({ NEXT_PUBLIC_SUPABASE_URL: 'https://another-project.supabase.co' }, opts)).toThrow(/refusing/)
    expect(() => assertCanaryRunTarget({}, opts)).toThrow(/not set/)
    expect(() => assertCanaryRunTarget({ NEXT_PUBLIC_SUPABASE_URL: DEV_DB, CLERK_SECRET_KEY: 'sk_live_placeholder' }, opts)).toThrow(/sk_live_/)
    expect(() => assertCanaryRunTarget({ NEXT_PUBLIC_SUPABASE_URL: DEV_DB, APP_ENV: 'prod' }, opts)).toThrow(/APP_ENV is prod/)
    expect(() => assertCanaryRunTarget({ NEXT_PUBLIC_SUPABASE_URL: DEV_DB, NEXT_PUBLIC_APP_ENV: 'preview' }, opts)).toThrow(/preview/)
    expect(() => assertCanaryRunTarget({ NEXT_PUBLIC_SUPABASE_URL: DEV_DB, VERCEL_ENV: 'preview' }, opts)).toThrow(/VERCEL_ENV/)
  })
})

describe("the personas' sessions", () => {
  it('are read from one variable per persona', () => {
    expect(CANARY_PERSONAS.map((p) => sessionEnvName(p.handle))).toEqual([
      'CANARY_SESSION_CANARY_MANAGER',
      'CANARY_SESSION_CANARY_ADMIN',
      'CANARY_SESSION_STELLR_PROBE_ADMIN',
    ])
  })

  it('may be a session id per persona instead, which wins, and needs the dev sk_test_ key', () => {
    expect(CANARY_PERSONAS.map((p) => sessionIdEnvName(p.handle))).toEqual([
      'CANARY_SESSION_ID_CANARY_MANAGER',
      'CANARY_SESSION_ID_CANARY_ADMIN',
      'CANARY_SESSION_ID_STELLR_PROBE_ADMIN',
    ])
    const key = { CLERK_SECRET_KEY: 'sk_test_placeholder' }
    const tok = token({ iss: DEV_ISSUER, exp: live(300) })
    expect(personaSessionFrom({ ...key, CANARY_SESSION_ID_CANARY_MANAGER: ' sess_placeholder1 ' }, 'canary-manager', NOW)).toEqual({
      session: { kind: 'session-id', sessionId: 'sess_placeholder1' },
      problem: null,
    })
    expect(personaSessionFrom({ ...key, CANARY_SESSION_ID_CANARY_MANAGER: 'sess_placeholder1', CANARY_SESSION_CANARY_MANAGER: tok }, 'canary-manager', NOW).session).toEqual({
      kind: 'session-id',
      sessionId: 'sess_placeholder1',
    })
    expect(personaSessionFrom({ CANARY_SESSION_CANARY_ADMIN: tok }, 'canary-admin', NOW)).toEqual({ session: { kind: 'token', token: tok }, problem: null })
    expect(personaSessionFrom({ ...key, CANARY_SESSION_ID_CANARY_ADMIN: 'user_placeholder' }, 'canary-admin', NOW).problem).toMatch(/not a Clerk session id/)
    expect(personaSessionFrom({ CANARY_SESSION_ID_CANARY_ADMIN: 'sess_placeholder1' }, 'canary-admin', NOW).problem).toMatch(/sk_test_/)
    expect(personaSessionFrom({ CLERK_SECRET_KEY: 'sk_live_placeholder', CANARY_SESSION_ID_CANARY_ADMIN: 'sess_placeholder1' }, 'canary-admin', NOW).problem).toMatch(/sk_test_/)
    expect(personaSessionFrom({}, 'stellr-probe-admin', NOW)).toEqual({ session: null, problem: 'not set' })
  })

  it("mint a fresh token from a session id through Clerk's Backend API, and refuse anything but a live dev token", async () => {
    const minted = token({ iss: DEV_ISSUER, exp: live(60) })
    const calls: { url: string; init: { method: string; headers: Record<string, string>; body: string } }[] = []
    const fetchOk = (jwt: unknown, status = 200) => async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
      calls.push({ url, init })
      return { ok: status < 300, status, json: async () => ({ object: 'token', jwt }) }
    }
    expect(await mintSessionToken(CLERK, 'sess_placeholder1', 'sk_test_placeholder', () => NOW, fetchOk(minted))).toBe(minted)
    expect(calls[0].url).toBe('https://api.clerk.com/v1/sessions/sess_placeholder1/tokens')
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.headers.Authorization).toBe('Bearer sk_test_placeholder')
    // Nothing is asked of Clerk without a development key, or for something that is not a session id.
    calls.length = 0
    await expect(mintSessionToken(CLERK, 'sess_placeholder1', 'sk_live_placeholder', () => NOW, fetchOk(minted))).rejects.toThrow(/sk_test_/)
    await expect(mintSessionToken(CLERK, 'sess_placeholder1', undefined, () => NOW, fetchOk(minted))).rejects.toThrow(/sk_test_/)
    await expect(mintSessionToken(CLERK, '../users', 'sk_test_placeholder', () => NOW, fetchOk(minted))).rejects.toThrow(/session id/)
    expect(calls).toEqual([])
    // A refusal, a production instance's token, an expired one or no token at all.
    const refused = mintSessionToken(CLERK, 'sess_placeholder1', 'sk_test_placeholder', () => NOW, fetchOk(null, 404))
    await expect(refused).rejects.toThrow(/\(404\)/)
    await expect(mintSessionToken(CLERK, 'sess_placeholder1', 'sk_test_placeholder', () => NOW, fetchOk(token({ iss: 'https://clerk.stellreducation.org', exp: live(60) })))).rejects.toThrow(
      /development instance/,
    )
    await expect(mintSessionToken(CLERK, 'sess_placeholder1', 'sk_test_placeholder', () => NOW, fetchOk(token({ iss: DEV_ISSUER, exp: live(5) })))).rejects.toThrow(/expire/)
    await expect(mintSessionToken(CLERK, 'sess_placeholder1', 'sk_test_placeholder', () => NOW, fetchOk(undefined))).rejects.toThrow(/not a session token/)
    // No error names the id, the key or a token.
    for (const p of [refused, mintSessionToken(CLERK, 'sess_placeholder1', 'sk_test_placeholder', () => NOW, fetchOk(token({ iss: DEV_ISSUER, exp: live(5) })))]) {
      const message = await p.then(
        () => '',
        (e: Error) => e.message,
      )
      expect(message).not.toMatch(/sess_|sk_test_|placeholder/)
    }
  })

  it('must be live tokens from a Clerk development instance', () => {
    expect(sessionTokenProblem(token({ iss: DEV_ISSUER, exp: live(300) }), NOW)).toBeNull()
    expect(sessionTokenProblem(undefined, NOW)).toBe('not set')
    expect(sessionTokenProblem('   ', NOW)).toBe('not set')
    expect(sessionTokenProblem('placeholder', NOW)).toBe('not a session token')
    expect(sessionTokenProblem('a.%%%.c', NOW)).toBe('not a session token')
    expect(sessionTokenProblem(token({ iss: 'https://clerk.stellreducation.org', exp: live(300) }), NOW)).toBe('not from a Clerk development instance')
    expect(sessionTokenProblem(token({ iss: 'https://evil.example/x.clerk.accounts.dev', exp: live(300) }), NOW)).toBe('not from a Clerk development instance')
    expect(sessionTokenProblem(token({ exp: live(300) }), NOW)).toBe('not from a Clerk development instance')
    expect(sessionTokenProblem(token({ iss: DEV_ISSUER, exp: live(10) }), NOW)).toMatch(/expire/)
    expect(sessionTokenProblem(token({ iss: DEV_ISSUER, exp: live(-60) }), NOW)).toMatch(/expire/)
    expect(sessionTokenProblem(token({ iss: DEV_ISSUER }), NOW)).toMatch(/expire/)
  })
})

describe("the run's people", () => {
  it('have a run id of ten letters, fresh per run', () => {
    expect(RUN).toMatch(RUN_ID_RE)
    expect(newRunId(new Uint8Array(10).fill(25))).toBe('zzzzzzzzzz')
    expect(newRunId(new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9, 9, 9]))).not.toBe(RUN)
    expect(() => newRunId(new Uint8Array(4))).toThrow()
    expect(() => runIdentities('2026-12-01')).toThrow(/ten lower-case letters/)
  })

  it('use fresh, distinct, synthetic addresses, so no invitation cap trips across runs', () => {
    const all = runAddresses(IDS)
    expect(new Set(all).size).toBe(all.length)
    for (const a of all) {
      expect(a.endsWith('@example.test'), a).toBe(true)
      expect(a).toContain(RUN)
    }
    const other = runAddresses(runIdentities(newRunId(new Uint8Array(10).fill(3))))
    expect(all.filter((a) => other.includes(a))).toEqual([])
  })

  it('can address the guardians to the role inbox, plus-addressed', () => {
    const ids = runIdentities(RUN, 'role-inbox')
    const domain = CANARY_ROLE_INBOX.slice(CANARY_ROLE_INBOX.indexOf('@'))
    expect(ids['minor-sign'].guardian!.email).toBe(plusAddress(CANARY_ROLE_INBOX, `canary-${RUN}-guardian-sign`))
    expect(ids['minor-sign'].guardian!.email.endsWith(domain)).toBe(true)
    expect(ids['minor-decline'].guardian!.email).not.toBe(ids['minor-sign'].guardian!.email)
    expect(ids.adult.email.endsWith('@example.test')).toBe(true)
    expect(() => plusAddress('nobody', 'x')).toThrow()
    expect(() => plusAddress(CANARY_ROLE_INBOX, 'Bad Tag')).toThrow()
  })

  it('are the age they need to be on the event day, whatever the date', () => {
    for (const start of ['2026-12-29', '2027-02-28', '2028-02-29', '2027-03-01', '2027-01-01']) {
      const on = new Date(`${start}T00:00:00Z`)
      expect(ageOn(birthDateForAge(start, 30), on), start).toBe(30)
      expect(ageOn(birthDateForAge(start, 15), on), start).toBe(15)
      expect(ageOn(birthDateForAge(start, 16), on), start).toBe(16)
      expect(isMinorOn(birthDateForAge(start, 15), on), start).toBe(true)
      // A day either way in the event's time zone changes nothing.
      expect(ageOn(birthDateForAge(start, 15), new Date(on.getTime() - 86_400_000)), start).toBe(15)
    }
    expect(IDS.adult.age).toBeGreaterThanOrEqual(18)
    for (const k of ['minor-sign', 'minor-decline'] as const) {
      expect(IDS[k].age).toBeGreaterThanOrEqual(CANARY_FLOW_TENANT.min_participant_age)
      expect(IDS[k].age).toBeLessThan(18)
    }
    expect(() => birthDateForAge('', 15)).toThrow(/no start date/)
  })

  it("send register bodies the gate accepts: a school, and a guardian the consent flow can use for each minor", () => {
    const adult = registrationBody(IDS.adult, CANARY_FLOW_EVENT.slug, '2026-12-29')
    expect(hasSchool(adult)).toBe(true)
    expect(adult.emergency_contact_email).toBeUndefined()
    expect(guardianFromForm(adult, IDS.adult.email)).toBeNull()
    for (const k of ['minor-sign', 'minor-decline'] as const) {
      const body = registrationBody(IDS[k], CANARY_FLOW_EVENT.slug, '2026-12-29')
      expect(hasSchool(body), k).toBe(true)
      expect(body.event_slug).toBe(CANARY_FLOW_EVENT.slug)
      const guardian = guardianFromForm(body, IDS[k].email)
      expect(guardian, k).not.toBeNull()
      expect(guardian!.email).toBe(IDS[k].guardian!.email)
    }
  })
})

describe('the run state', () => {
  const state = {
    runId: RUN,
    mailbox: 'example',
    zone: 'localhost',
    startedAt: NOW.toISOString(),
    stellrEventSlug: 'a-stellr-event',
    stellrRegistrationsAtStart: 4,
    registrations: { adult: { registrationId: uuid(1), participantId: uuid(2), agreementId: null } },
  }

  it('holds ids only, and is checked when read back', () => {
    expect(parseRunState(state).runId).toBe(RUN)
    expect(JSON.stringify(state)).not.toMatch(/@/)
    expect(() => parseRunState({ ...state, runId: 'x' })).toThrow()
    expect(() => parseRunState({ ...state, mailbox: 'other' })).toThrow(/mailbox/)
    expect(() => parseRunState({ ...state, startedAt: 'soon' })).toThrow(/start time/)
    expect(() => parseRunState({ ...state, stellrRegistrationsAtStart: undefined })).toThrow(/baseline/)
    expect(() => parseRunState(null)).toThrow()
  })
})

describe('S1 to S6 and S8', () => {
  it("stops the start phase when S1's 201 is not in this env's database as dev-canary's", () => {
    expect(startMustStop(created({}), readBack())).toBe(false)
    expect(startMustStop(created({}), readBack({ registration: null, participants: [] }))).toBe(true)
    expect(startMustStop(created({}), readBack({ registration: { id: uuid(1), tenant_id: STELLR_TENANT_ID, event_slug: CANARY_FLOW_EVENT.slug } }))).toBe(true)
    expect(startMustStop(created({}), readBack({ registration: { id: uuid(1), tenant_id: null, event_slug: CANARY_FLOW_EVENT.slug } }))).toBe(true)
    // Not a 201: nothing was written there either, and S1 fails on its own.
    expect(startMustStop({ status: 404, json: null }, readBack({ registration: null, participants: [] }))).toBe(false)
  })

  it('S1 passes for a dev-canary adult with no consent row, and fails otherwise', () => {
    expect(judgeAdultRegistered(created({}), readBack()).status).toBe('pass')
    expect(registrationIdOf(created({}))).toBe(uuid(1))
    expect(registrationIdOf({ status: 400, json: { registrationId: uuid(1) } })).toBeNull()
    expect(judgeAdultRegistered({ status: 404, json: null }, readBack({ registration: null, participants: [] })).reasons).toEqual(
      expect.arrayContaining(['the registration did not answer 201', 'no registrations row read back (is the base on the database this env names?)']),
    )
    expect(judgeAdultRegistered(created({}), readBack({ registration: { id: uuid(1), tenant_id: STELLR_TENANT_ID, event_slug: 'x' } })).status).toBe('fail')
    expect(judgeAdultRegistered(created({ consentPending: true }), readBack()).status).toBe('fail')
    expect(judgeAdultRegistered(created({}), pendingReadBack(1)).status).toBe('fail')
  })

  it('S2 passes for two pending minors with a window before the event and a consent envelope', () => {
    const ok = [
      { key: 'minor-sign' as const, answer: created({ consentPending: true, guardianInvited: true }), rb: pendingReadBack(10) },
      { key: 'minor-decline' as const, answer: created({ consentPending: true, guardianInvited: true }), rb: pendingReadBack(30) },
    ]
    expect(judgeMinorPending(ok, NOW, EVENT_STARTS_AT).status).toBe('pass')
    expect(judgeMinorPending(ok.slice(0, 1), NOW, EVENT_STARTS_AT).reasons).toContain('expected two minors')
    const notInvited = [{ ...ok[0], answer: created({ consentPending: true, guardianInvited: false }) }, ok[1]]
    expect(judgeMinorPending(notInvited, NOW, EVENT_STARTS_AT).reasons).toEqual(["minor-sign: the answer does not say the guardian's invitation went"])
    const late = [{ ...ok[0], rb: { ...ok[0].rb, consent: { ...ok[0].rb.consent!, expires_at: '2027-01-30T00:00:00Z' } } }, ok[1]]
    expect(judgeMinorPending(late, NOW, EVENT_STARTS_AT).reasons).toEqual(['minor-sign: the consent window closes after the event starts'])
    const limited = [{ ...ok[0], answer: { status: 429, json: null } }, ok[1]]
    expect(judgeMinorPending(limited, NOW, EVENT_STARTS_AT).reasons[0]).toMatch(/rate limited/)
    const refused = [{ ...ok[0], answer: { status: 403, json: null }, rb: readBack({ registration: null, participants: [] }) }, ok[1]]
    expect(judgeMinorPending(refused, NOW, EVENT_STARTS_AT).status).toBe('fail')
    const wrongEnvelope = [{ ...ok[0], rb: { ...ok[0].rb, agreement: { ...ok[0].rb.agreement!, envelope_type: 'minor' } } }, ok[1]]
    expect(judgeMinorPending(wrongEnvelope, NOW, EVENT_STARTS_AT).status).toBe('fail')
  })

  it('S3 passes only for a 409 guardian_consent_pending with the row left unchecked', () => {
    const rb = pendingReadBack(10)
    expect(judgeCheckInRefused({ status: 409, json: { code: 'guardian_consent_pending' } }, rb).status).toBe('pass')
    expect(judgeCheckInRefused({ status: 200, json: { ok: true } }, { ...rb, participants: [{ ...rb.participants[0], checked_in_at: NOW.toISOString() }] }).reasons).toHaveLength(3)
    expect(judgeCheckInRefused({ status: 500, json: null }, rb).status).toBe('fail')
  })

  it('S4 passes when both minors are left out of mail and the adult is not', () => {
    const base = { adultParticipantId: uuid(2), minorParticipantIds: [uuid(11), uuid(31)], sendsSinceStart: 0, sendsNamingRun: 0 }
    expect(judgeMailExclusion({ ...base, unconsented: new Set([uuid(11), uuid(31)]) }).status).toBe('pass')
    expect(judgeMailExclusion({ ...base, unconsented: new Set([uuid(11)]) }).status).toBe('fail')
    expect(judgeMailExclusion({ ...base, unconsented: new Set([uuid(11), uuid(31), uuid(2)]) }).status).toBe('fail')
    expect(judgeMailExclusion({ ...base, unconsented: new Set([uuid(11), uuid(31)]), sendsNamingRun: 1 }).status).toBe('fail')
    expect(judgeMailExclusion({ ...base, minorParticipantIds: [null, uuid(31)], unconsented: new Set([uuid(31)]) }).status).toBe('fail')
  })

  it('S5 waits for the signature, then needs the desk to check the minor in and undo it', () => {
    const pending = pendingReadBack(10)
    const signed: RegistrationReadBack = {
      ...pending,
      consent: { ...pending.consent!, status: 'signed', settled_at: NOW.toISOString() },
      agreement: { ...pending.agreement!, status: 'completed' },
    }
    const desk = { checkIn: { status: 200, json: { ok: true } }, checkedInAfter: true, undo: { status: 200, json: { ok: true } }, checkedInAfterUndo: false }
    expect(judgeSigned({ rb: pending, unconsented: new Set([uuid(11)]), ...desk }).status).toBe('waiting')
    expect(judgeSigned({ rb: signed, unconsented: new Set(), ...desk }).status).toBe('pass')
    expect(judgeSigned({ rb: signed, unconsented: new Set([uuid(11)]), ...desk }).reasons).toEqual(['the signed minor is still left out of tenant mail'])
    expect(judgeSigned({ rb: signed, unconsented: new Set(), checkIn: null, checkedInAfter: null, undo: null, checkedInAfterUndo: null }).status).toBe('fail')
    expect(judgeSigned({ rb: signed, unconsented: new Set(), ...desk, checkIn: { status: 409, json: null }, checkedInAfter: false }).status).toBe('fail')
    expect(judgeSigned({ rb: { ...signed, agreement: { ...signed.agreement!, status: 'sent' } }, unconsented: new Set(), ...desk }).status).toBe('fail')
  })

  it('S6 passes once the declined registration is gone, and waits until then', () => {
    expect(judgeDeclined({ registration: null, participants: [], consent: null, agreement: null }).status).toBe('pass')
    expect(judgeDeclined(pendingReadBack(30)).status).toBe('waiting')
    const declined = pendingReadBack(30)
    declined.consent = { ...declined.consent!, status: 'declined', settled_at: NOW.toISOString(), removal_attempts: 1 }
    const waiting = judgeDeclined(declined)
    expect(waiting.status).toBe('waiting')
    expect(waiting.facts).toContainEqual(['removal attempts', 1])
    const signedInstead = pendingReadBack(30)
    signedInstead.consent = { ...signedInstead.consent!, status: 'signed', settled_at: NOW.toISOString() }
    expect(judgeDeclined(signedInstead).status).toBe('fail')
  })

  it("S8 passes when Stellr's pages answer, its count holds, and every app_errors row is expected", () => {
    const base = {
      pages: [{ path: '/', status: 200 }, { path: '/register/a-stellr-event', status: 200 }],
      stellrRegistrations: { atStart: 4, now: 4 },
      runRegistrationsOutsideCanary: 0,
      appErrors: [{ route: 'LOADSCOPED /api/admin/docusigns/[id]/download', count: 1 }],
      expectedAppErrorRoutes: ['LOADSCOPED /api/admin/docusigns/[id]/download'],
    }
    expect(judgeStellrUnchanged(base).status).toBe('pass')
    expect(judgeStellrUnchanged({ ...base, pages: [{ path: '/', status: 500 }] }).status).toBe('fail')
    expect(judgeStellrUnchanged({ ...base, stellrRegistrations: { atStart: 4, now: 5 } }).status).toBe('fail')
    expect(judgeStellrUnchanged({ ...base, runRegistrationsOutsideCanary: 1 }).status).toBe('fail')
    expect(judgeStellrUnchanged({ ...base, expectedAppErrorRoutes: [] }).status).toBe('fail')
  })
})

describe('S7: the isolation table', () => {
  it('has unique probes, and resolves for every mode', () => {
    expect(new Set(ISOLATION_PROBES.map((p) => p.id)).size).toBe(ISOLATION_PROBES.length)
    for (const p of ISOLATION_PROBES) for (const m of ALL_RUN_MODES) expect(p.expect(m), `${p.id} ${m.authzSource}/${m.loadScopedMode}`).toBeTruthy()
  })

  it('names each known gap by its slice, and every one of A11, A12, .23, .24 and .29 appears', () => {
    expect(Object.keys(KNOWN_GAPS).sort()).toEqual(['.23', '.24', '.29', 'A11', 'A12'])
    const named = new Set(ALL_RUN_MODES.flatMap((m) => ISOLATION_PROBES.map((p) => p.expect(m)).map((e) => ('gap' in e ? e.gap : undefined))))
    for (const gap of Object.keys(KNOWN_GAPS)) expect(named.has(gap as keyof typeof KNOWN_GAPS), gap).toBe(true)
  })

  it('answers the same in every mode where no switch reaches the route', () => {
    for (const id of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P14', 'P15', 'P16', 'P17']) {
      const first = JSON.stringify(probe(id).expect(ALL_RUN_MODES[0]))
      for (const m of ALL_RUN_MODES) expect(JSON.stringify(probe(id).expect(m)), `${id} ${m.authzSource}/${m.loadScopedMode}`).toBe(first)
    }
  })

  it('follows LOADSCOPED_MODE for a Stellr-wide scope, and AUTHZ_SOURCE where the event tenant decides', () => {
    const status = (id: string, m: RunMode) => {
      const e = probe(id).expect(m)
      return 'status' in e ? e.status : null
    }
    for (const a of ['clerk', 'shadow', 'postgres'] as const) {
      expect([status('P13', mode(a, 'off')), status('P13', mode(a, 'shadow')), status('P13', mode(a, 'enforce'))], `P13 ${a}`).toEqual([400, 400, 404])
    }
    for (const a of ['clerk', 'shadow'] as const) {
      expect([status('P11', mode(a, 'off')), status('P11', mode(a, 'shadow')), status('P11', mode(a, 'enforce'))], `P11 ${a}`).toEqual([200, 200, 404])
      expect([status('P12', mode(a, 'off')), status('P12', mode(a, 'shadow')), status('P12', mode(a, 'enforce'))], `P12 ${a}`).toEqual([200, 200, 404])
    }
    // lib/authz requireEventRoute under postgres: the host's tenant decides (P11, 403), and
    // a Stellr admin is refused on another tenant's event with the route's 404 (P12).
    // canary-flow-authz.test.ts drives the real guard for both.
    for (const l of ['off', 'shadow', 'enforce'] as const) {
      expect(status('P11', mode('postgres', l)), `P11 postgres/${l}`).toBe(403)
      expect(status('P12', mode('postgres', l)), `P12 postgres/${l}`).toBe(404)
    }
  })

  it('expects a shadow log only in a shadow mode, and names the route as lib/app-errors labels it', () => {
    expect(expectedAppErrorRoutes(mode('clerk', 'off'), ISOLATION_PROBES.map((p) => p.id))).toEqual([])
    expect(expectedAppErrorRoutes(mode('postgres', 'enforce'), ISOLATION_PROBES.map((p) => p.id))).toEqual([])
    expect(expectedAppErrorRoutes(mode('clerk', 'shadow'), ISOLATION_PROBES.map((p) => p.id)).sort()).toEqual([
      'LOADSCOPED /api/admin/docusigns/[id]/download',
      'LOADSCOPED /api/admin/events/[slug]/emails',
    ])
    expect(expectedAppErrorRoutes(mode('shadow', 'enforce'), ISOLATION_PROBES.map((p) => p.id))).toEqual(['AUTHZ /api/admin/events/[slug]/emails'])
    expect(expectedAppErrorRoutes(mode('clerk', 'shadow'), ['P1'])).toEqual([])
    // The labels the routes really use.
    expect(readFileSync('app/api/admin/docusigns/[id]/download/route.ts', 'utf8')).toContain("const ROUTE = '/api/admin/docusigns/[id]/download'")
    expect(readFileSync('app/api/admin/events/[slug]/emails/route.ts', 'utf8')).toContain("const ROUTE = '/api/admin/events/[slug]/emails'")
  })

  it('builds every request from the context, and skips a probe whose id is missing', () => {
    for (const p of ISOLATION_PROBES) {
      if (p.id === 'P15') expect(p.request(CONTEXT)).toBeNull()
      else expect(p.request(CONTEXT), p.id).not.toBeNull()
    }
    const bare: ProbeContext = { ...CONTEXT, pendingAgreementId: null, pendingParticipantId: null, adultParticipantId: null }
    expect(ISOLATION_PROBES.filter((p) => p.request(bare) === null).map((p) => p.id)).toEqual(['P7', 'P9', 'P13', 'P14', 'P15'])
    expect(probe('P9').request(CONTEXT)!.body).toEqual({ action: 'group_check_in', participantIds: [uuid(22), uuid(21)] })
    expect(probe('P5').request(CONTEXT)!.body).toBe(CONTEXT.stellrProbeBody)
    expect(probe('P8').request(CONTEXT)!.path).toBe('/api/admin/events/a-stellr-event/check-in')
  })

  it("probes the other direction: a Stellr event through dev-canary's host, as its own person", () => {
    expect(probe('P16')).toMatchObject({ persona: 'anonymous', host: 'tenant' })
    expect(probe('P16').request(CONTEXT)).toEqual({ method: 'GET', path: '/register/a-stellr-event' })
    expect(probe('P17')).toMatchObject({ persona: 'anonymous', host: 'tenant' })
    const req = probe('P17').request(CONTEXT)!
    expect(req).toMatchObject({ method: 'POST', path: '/api/register/individual' })
    expect((req.body as { event_slug: string }).event_slug).toBe('a-stellr-event')
    expect((req.body as { email: string }).email).toBe(IDS['canary-host-probe'].email)
    expect(IDS['canary-host-probe'].email).not.toBe(IDS['stellr-probe'].email)
    expect(probe('P5').request(CONTEXT)!.body).toMatchObject({ event_slug: CANARY_FLOW_EVENT.slug })
    for (const m of ALL_RUN_MODES) {
      expect(probe('P16').expect(m)).toEqual({ status: 404 })
      expect(probe('P17').expect(m)).toEqual({ status: 404 })
    }
    // S8 sees what P17 might write: its person is one of the run's addresses.
    expect(runAddresses(IDS)).toContain(IDS['canary-host-probe'].email)
  })

  it('judges a probe as passing, a known gap, differing, skipped or not run', () => {
    const m = mode('clerk', 'off')
    expect(judgeProbe(probe('P1'), m, { status: 404, marker: null }).verdict).toBe('pass')
    expect(judgeProbe(probe('P1'), m, { status: 200, marker: null }).verdict).toBe('differs')
    expect(judgeProbe(probe('P6'), m, { status: 200, marker: null })).toMatchObject({ verdict: 'known-gap', gap: 'A12', note: 'slice A12' })
    const closed = judgeProbe(probe('P6'), m, { status: 404, marker: null })
    expect(closed.verdict).toBe('differs')
    expect(closed.note).toMatch(/update this table/)
    expect(judgeProbe(probe('P14'), m, { status: 200, marker: true }).verdict).toBe('known-gap')
    expect(judgeProbe(probe('P14'), m, { status: 200, marker: false }).verdict).toBe('differs')
    expect(judgeProbe(probe('P7'), m, { status: 200, marker: null }).verdict).toBe('differs')
    expect(judgeProbe(probe('P8'), m, null, 'no canary-manager session')).toMatchObject({ verdict: 'skipped', note: 'no canary-manager session' })
    expect(judgeProbe(probe('P15'), m, null)).toMatchObject({ verdict: 'not-run', gap: 'A11' })
  })

  it('S7 is green with known gaps, and not with a difference or a skip', () => {
    const m = mode('clerk', 'off')
    const good = ISOLATION_PROBES.map((p) => {
      const e = p.expect(m)
      return judgeProbe(p, m, 'notRun' in e ? null : { status: e.status, marker: e.marker ?? null })
    })
    const s7 = judgeIsolation(good)
    expect(s7.status).toBe('pass')
    expect(s7.facts).toContainEqual(['gaps named', 'A12 .23 .24 .29 A11'])
    expect(judgeIsolation([...good, judgeProbe(probe('P1'), m, { status: 200, marker: null })]).status).toBe('fail')
    expect(judgeIsolation([...good, judgeProbe(probe('P1'), m, null)]).status).toBe('fail')
  })

  it("reads the desk's consent marker from the participant's own entry", () => {
    const body = JSON.stringify({ registrations: [{ id: uuid(1), participants: [{ id: uuid(21), first_name: 'x' }, { id: uuid(22) }] }] })
    expect(participantHasConsentMarker(body, uuid(21))).toBe(false)
    const marked = JSON.stringify({ registrations: [{ participants: [{ id: uuid(21), guardianConsentPending: true }] }] })
    expect(participantHasConsentMarker(marked, uuid(21))).toBe(true)
    expect(participantHasConsentMarker(JSON.stringify({ participants: [{ id: uuid(21), consent: null }] }), uuid(21))).toBe(false)
    expect(participantHasConsentMarker(body, uuid(99))).toBeNull()
    expect(participantHasConsentMarker('<html>', uuid(21))).toBeNull()
    expect(participantHasConsentMarker(body, null)).toBeNull()
  })
})

describe('the output', () => {
  const probes: ProbeOutcome[] = ISOLATION_PROBES.map((p) => judgeProbe(p, mode('shadow', 'shadow'), { status: 200, marker: true }))
  const results: ScenarioResult[] = [
    judgeAdultRegistered(created({}), readBack()),
    judgeMinorPending(
      [
        { key: 'minor-sign', answer: created({ consentPending: true, guardianInvited: true }), rb: pendingReadBack(10) },
        { key: 'minor-decline', answer: created({ consentPending: true, guardianInvited: true }), rb: pendingReadBack(30) },
      ],
      NOW,
      EVENT_STARTS_AT,
    ),
    judgeCheckInRefused({ status: 409, json: { code: 'guardian_consent_pending' } }, pendingReadBack(10)),
    judgeMailExclusion({ unconsented: new Set([uuid(11)]), adultParticipantId: uuid(2), minorParticipantIds: [uuid(11), uuid(31)], sendsSinceStart: 2, sendsNamingRun: 0 }),
    judgeSigned({ rb: pendingReadBack(10), unconsented: new Set(), checkIn: null, checkedInAfter: null, undo: null, checkedInAfterUndo: null }),
    judgeDeclined(pendingReadBack(30)),
    judgeIsolation(probes),
    judgeStellrUnchanged({
      pages: [{ path: '/', status: 200 }],
      stellrRegistrations: { atStart: 4, now: 4 },
      runRegistrationsOutsideCanary: 0,
      appErrors: [{ route: 'AUTHZ /api/admin/events/[slug]/emails', count: 2 }],
      expectedAppErrorRoutes: [],
    }),
    skipped('S3', 'no canary-manager session'),
  ]

  it('holds ids, counts and status codes: no line looks like an email or a date of birth', () => {
    const lines = formatResults(RUN, mode('shadow', 'shadow'), results, probes)
    const text = lines.join('\n')
    expect(lines.filter((l) => personalDataProblem(l))).toEqual([])
    expect(text).not.toContain('withheld')
    for (const a of runAddresses(IDS)) expect(text).not.toContain(a)
    for (const k of ['adult', 'minor-sign', 'minor-decline'] as const) {
      expect(text).not.toContain(birthDateForAge('2026-12-29', IDS[k].age))
      expect(text).not.toContain(IDS[k].lastName)
    }
    expect(text).toContain(uuid(1))
    expect(text).toContain('Result: not green')
    expect(text).toMatch(/P13 +differs/)
  })

  it('the plan and the table hold no email or date either', () => {
    for (const lines of [describePlan(null), describePlan(mode('postgres', 'enforce')), expectationTable()]) {
      expect(lines.filter((l) => personalDataProblem(l))).toEqual([])
    }
    expect(describePlan(null).join('\n')).toContain('clerk/off')
    expect(describePlan(mode('postgres', 'enforce')).join('\n')).not.toContain('clerk/off')
  })

  it('withholds any line that looks like an email or a date of birth', () => {
    expect(personalDataProblem(`  guardian ${IDS['minor-sign'].guardian!.email}`)).toBe('email')
    expect(personalDataProblem(`  to ${CANARY_ROLE_INBOX}`)).toBe('email')
    expect(personalDataProblem('  born 2011-10-02')).toBe('date')
    expect(personalDataProblem('  born 10/2/2011')).toBe('date')
    expect(personalDataProblem('  born 2.10.11')).toBe('date')
    expect(personalDataProblem(`  registration ${uuid(1)}`)).toBeNull()
    expect(personalDataProblem('  http 201, count 12')).toBeNull()
    expect(safeOutput(['ok', 'x a@b.example y', '2011-10-02'])).toEqual([
      'ok',
      '  [line withheld: it matched an email or date pattern]',
      '  [line withheld: it matched an email or date pattern]',
    ])
  })
})
