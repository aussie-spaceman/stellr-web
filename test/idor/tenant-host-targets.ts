// What the tenant-host suite runs (test/idor/tenant-host-routes.test.ts): every route
// handler in lib/tenancy/tenant-surface.ts's allow-list, and the fixture that gets a
// VALID credential of the other tenant to it. A guessed token proves only that it was
// guessed badly, so here a survey link, a pay link, a signing link and a signing session
// are all well formed and answered by the honey row. What is under test is whether a
// real record of host B answers on host A.
//
// Allowed pages and the credential share card are not here: B10(c) covers what a page
// renders. A route file is here because it is id-bearing, or because a signing session
// names its envelope (a cookie and x-sign-ref, which the id-input analyser cannot see).
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mintToken, SESSION_COOKIE, SESSION_TTL_SECONDS, SIGN_LINK_TTL_SECONDS } from '@/lib/esign/native/tokens'
import { idorTargetFor, urlPatternOf, type IdorTarget } from '@/lib/security/idor-targets'
import { analyzeRoute, requestIdInputs } from '@/lib/security/route-ast'
import { ROUTE_MANIFEST } from '@/lib/security/route-manifest'
import { HONEYTOKENS } from '@/lib/testing/honeytokens'
import { allowedTenantFiles } from '@/lib/tenancy/tenant-surface'
import { capRegressions, isFailingEntry, isUnprovenEntry } from '../../scripts/tenant-host-cap.mjs'
import { CASE_FIXTURES, HELD_BACK_FIXTURES, type CaseFixture } from './case-fixtures'
import { TENANT_A_PARTICIPANT, type CaseResult } from './harness'
import { printReportedOracles, sealReportedOracles } from './reported-oracles'

const ROUTE_FILE = /(^|\/)route\.(ts|tsx)$/

/** Name the envelope by session, not by an input. */
export const SIGNING_SESSION_ROUTES = [
  'app/api/sign/consent/route.ts',
  'app/api/sign/context/route.ts',
  'app/api/sign/decline/route.ts',
  'app/api/sign/document/route.ts',
  'app/api/sign/submit/route.ts',
  'app/api/sign/viewed/route.ts',
] as const

/** Every allowed route handler, sorted by file. Throws on one it has no way to name a record through. */
export function tenantHostTargets(read: (file: string) => string = (f) => readFileSync(f, 'utf8')): IdorTarget[] {
  const out: IdorTarget[] = []
  for (const file of allowedTenantFiles()) {
    if (!ROUTE_FILE.test(file)) continue
    const src = read(file)
    const target = idorTargetFor(file, ROUTE_MANIFEST[file], src)
    if (target) {
      out.push(target)
      continue
    }
    if (!(SIGNING_SESSION_ROUTES as readonly string[]).includes(file)) {
      throw new Error(`${file} is allowed on tenant hosts but names no record the suite can see: say how it does`)
    }
    const methods = analyzeRoute(file, src).handlers.map((h) => h.name)
    out.push({ file, cls: ROUTE_MANIFEST[file], urlPattern: urlPatternOf(file), segments: [], query: [], body: [], fill: requestIdInputs(file, src).fill, methods: [...new Set(methods)].sort() })
  }
  return out.sort((a, b) => a.file.localeCompare(b.file))
}

// ── Valid credentials of the other tenant ────────────────────────────────────

const DUMMY_SECRET = 'x'.repeat(32)
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const FUTURE = '2099-01-01T00:00:00.000Z'
/** The honey row shows 100 for any version column. */
const HONEY_TOKEN_VERSION = 100

const STRIPE = { STRIPE_SECRET_KEY: 'sk_test_x' }

/** What lib/survey/definition.ts parses, so a case gets past the definition to the invitation. */
const page = { page: 'p1', questions: [{ key: 'q1', type: 'text', label: 'Question' }] }
const SURVEY_DEFINITION = {
  key: 'post_event',
  version: 1,
  title: 'Survey',
  intro: { heading: 'Survey', body_student: 'Survey', body_adult: 'Survey' },
  scales: {},
  branches: { student: [page], mentor: [page], adult: [page] },
}
/**
 * A survey that is running, with its definition, not yet answered. The same row answers the
 * invitation, the distribution and the response. definition_id only has to survive a copy of the row.
 */
const OPEN_SURVEY = {
  status: 'open',
  opens_at: '2020-01-01T00:00:00.000Z',
  closes_at: FUTURE,
  definition: SURVEY_DEFINITION,
  definition_id: 'shown',
  respondent_role: 'student',
  send_via: 'self',
  context: { role: 'student' },
  submitted_at: null,
}

/** 43 base64url characters (lib/survey/tokens.ts), and still recognisably Canary's. */
const LINK_TOKEN = `${HONEYTOKENS.token}xx`
const linkFixture: CaseFixture = {
  reason: 'a survey or team-profile link is 43 characters, stored only as its hash',
  inputs: { token: LINK_TOKEN },
  honeyTokens: [sha256(LINK_TOKEN)],
  honey: OPEN_SURVEY,
  env: { SURVEY_TOKEN_SECRET: DUMMY_SECRET },
}

// A person's details that pass the form's checks, on an address nobody else holds, so what
// the case tests is the event: the honey row answers an email of its own as "already there".
const PERSON_EMAIL = 'registrant@tenant-a.invalid'
const PERSON = {
  first_name: 'Tenant',
  last_name: 'Registrant',
  date_of_birth: '2000-01-01',
  phone: '0000000000',
  gender: 'prefer_not_to_say',
  t_shirt_size: 'M',
  age_bracket: 'adult',
  event_role: 'teacher',
  school_name: 'Tenant A School',
}

/** Host B's event, by slug. An offer or school of host B's would be a second record under test. */
const individualFixture: CaseFixture = {
  reason: 'a registration needs a date of birth and a school before the event is looked up, and no offer of host B to stop on first',
  body: { ...PERSON },
  inputs: { email: PERSON_EMAIL, school_email: PERSON_EMAIL, emergency_contact_email: PERSON_EMAIL },
  omitInputs: ['scholarship_token', 'school_id'],
}

/** A valid scholarship offer of host B's, for host B's event. */
const OFFER_TOKEN = sha256(`${HONEYTOKENS.token}-offer`)
const individualOfferFixture: CaseFixture = {
  ...individualFixture,
  reason: 'an offer link is 64 hex characters, for one event',
  inputs: { ...individualFixture.inputs, scholarship_token: OFFER_TOKEN },
  omitInputs: ['school_id'],
  honeyTokens: [OFFER_TOKEN],
  honey: { status: 'offered', percent_off: 100 },
}

const groupFixture: CaseFixture = {
  reason: 'a group needs an organiser object, a student count and the school terms before the event is looked up',
  body: {
    teacher: { ...PERSON, email: PERSON_EMAIL },
    teacher_poc: null,
    registrant_role: 'teacher',
    adult_count: 1,
    student_count: 2,
    total_participants: 3,
    details_method: 'email_link',
    // The event has no Stripe price, and card or invoice would stop on that, not on whose event it is.
    payment_method: 'none',
    member_pays_individually: false,
    additional_adults: [],
    students: [],
    school_dpa_agreed: true,
  },
}

/** The participant holds the role this route asks for. Only the event is another tenant's. */
const volunteerFixture: CaseFixture = {
  reason: 'only a volunteer gets as far as the event',
  callerRows: { member_roles: [{ id: '00000000-0000-4000-8000-00000000a002', member_id: TENANT_A_PARTICIPANT.memberId, role: 'volunteer', scope: 'global' }] },
}

/** A survey that is running, for host B's event. The route sends only to an invitation's own address. */
const surveyLinkFixture: CaseFixture = {
  reason: 'the send happens only for a running survey with a definition, and inside the daily budget',
  honey: OPEN_SURVEY,
  rpcAnswers: { survey_claim_email: true },
  env: { SURVEY_TOKEN_SECRET: DUMMY_SECRET },
}

/** 64 hex characters (register/pay and pay-seat). */
const PAY_TOKEN = sha256(HONEYTOKENS.token)
const payFixture: CaseFixture = {
  reason: 'a pay link is 64 hex characters, for a pending registration',
  inputs: { token: PAY_TOKEN },
  honeyTokens: [PAY_TOKEN],
  honey: { status: 'pending', type: 'individual' },
  env: STRIPE,
  member: { stripe_customer_id: 'cus_idorharness' },
  stripe: true,
}

const ESIGN_ENV = { ESIGN_TOKEN_SECRET: DUMMY_SECRET }
// What lib/esign/native/template.ts parses, so a case gets past the template to the envelope.
const FIELD_MAP = {
  roles: [{ role: 'student', order: 1 }],
  fields: [{ name: 'Signature', label: 'Signature', role: 'student', type: 'signature', source: 'signer', page: 1, x: 0, y: 0 }],
}
// envelope_row points the recipient at the honey envelope; the same row answers both.
const LIVE_RECIPIENT = { status: 'sent', token_expires_at: FUTURE, failed_token_attempts: 0, envelope_row: HONEYTOKENS.id, role_name: 'Minor', field_map: FIELD_MAP }

/** The per-recipient cookie name (lib/esign/native/http.ts cookieName, which needs next/headers). */
const SESSION_COOKIE_NAME = `${SESSION_COOKIE}_${HONEYTOKENS.id.replace(/-/g, '')}`

function withSecret<T>(fn: () => T): T {
  const was = process.env.ESIGN_TOKEN_SECRET
  process.env.ESIGN_TOKEN_SECRET = DUMMY_SECRET
  try {
    return fn()
  } finally {
    if (was === undefined) delete process.env.ESIGN_TOKEN_SECRET
    else process.env.ESIGN_TOKEN_SECRET = was
  }
}

function signLinkFixture(): CaseFixture {
  const { token } = withSecret(() => mintToken(HONEYTOKENS.id, 'sign', HONEY_TOKEN_VERSION, SIGN_LINK_TTL_SECONDS))
  return { reason: 'a signing link is an HMAC over the recipient row', inputs: { token }, honey: LIVE_RECIPIENT, env: ESIGN_ENV }
}

function downloadLinkFixture(): CaseFixture {
  const { token } = withSecret(() => mintToken(HONEYTOKENS.id, 'download', HONEY_TOKEN_VERSION, SIGN_LINK_TTL_SECONDS))
  return { reason: 'a copy link is an HMAC over the recipient row', inputs: { token }, honey: { ...LIVE_RECIPIENT, status: 'completed' }, env: ESIGN_ENV }
}

function signSessionFixture(): CaseFixture {
  const { token } = withSecret(() => mintToken(HONEYTOKENS.id, 'session', HONEY_TOKEN_VERSION, SESSION_TTL_SECONDS))
  return {
    reason: 'a signing session is a signed cookie for one recipient, named by x-sign-ref',
    cookies: { [SESSION_COOKIE_NAME]: token },
    headers: { 'x-sign-ref': HONEYTOKENS.id },
    honey: LIVE_RECIPIENT,
    env: ESIGN_ENV,
  }
}

const FIXTURES: Record<string, () => CaseFixture> = {
  'app/api/survey/[token]/route.ts': () => linkFixture,
  'app/api/survey/[token]/stop-reminders/route.ts': () => linkFixture,
  'app/api/survey/[token]/submit/route.ts': () => linkFixture,
  'app/api/team-profile/[token]/route.ts': () => linkFixture,
  'app/api/register/pay/route.ts': () => payFixture,
  'app/api/register/pay-seat/route.ts': () => payFixture,
  'app/api/sign/session/route.ts': signLinkFixture,
  'app/api/sign/copy/route.ts': downloadLinkFixture,
  'app/api/credentials/[number]/visibility/route.ts': () => ({ reason: 'the consent check past the owner check reads a grade as text', honey: { grade: '10' } }),
  'app/api/register/individual/route.ts': () => individualFixture,
  'app/api/register/group/route.ts': () => groupFixture,
  'app/api/volunteer/interest/route.ts': () => volunteerFixture,
  'app/api/survey/event/[slug]/link/route.ts': () => surveyLinkFixture,
}

/** Routes that take a second kind of record: each runs as a case of its own. */
const EXTRA_VARIANTS: Record<string, Record<string, () => CaseFixture>> = {
  'app/api/register/individual/route.ts': { scholarship_offer: () => individualOfferFixture },
}

function withBase(file: string, own: CaseFixture | undefined): CaseFixture {
  const base = CASE_FIXTURES[file] ?? HELD_BACK_FIXTURES[file]?.fixture
  const reason = [base?.reason, own?.reason].filter(Boolean).join('; ') || 'nothing further: the id input is the credential'
  return { ...base, ...own, env: { ...base?.env, ...own?.env }, reason, omitOrigin: true }
}

/**
 * The fixture a tenant-host case runs with: the generated suite's (a held-back one
 * included, since this suite pins what it finds), then the valid credential. No Origin:
 * a caller outside a browser sends none, and the same-origin check is not what isolates
 * a tenant.
 */
export function tenantHostFixture(file: string): CaseFixture {
  return withBase(file, (SIGNING_SESSION_ROUTES as readonly string[]).includes(file) ? signSessionFixture() : FIXTURES[file]?.())
}

/**
 * The cases a route runs: the plain one, and a named variant where a route takes a second
 * kind of record. A variant's cases are keyed `<METHOD> <persona> <direction> <variant>`.
 */
export function tenantHostVariants(file: string): { variant: string; fixture: CaseFixture }[] {
  const extra = EXTRA_VARIANTS[file]
  return [{ variant: '', fixture: tenantHostFixture(file) }, ...Object.entries(extra ?? {}).map(([variant, fixture]) => ({ variant, fixture: withBase(file, fixture()) }))]
}

// ── The cap ──────────────────────────────────────────────────────────────────

/** `refused` or `ok` with no Canary value used: the case proved nothing, so it says so. */
export const UNTOUCHED = 'refused_untouched'
export const OK_UNTOUCHED = 'ok_untouched'

/** What one case recorded: its outcome, and for `oracle_4xx` which comparison differed. */
export type CaseEntry = string
/** `<route file>` then `<METHOD> <persona> <direction>`. */
export type HostCases = Record<string, Record<string, CaseEntry>>

export interface HostBaseline {
  _comment: string
  totals: { routes: number; cases: number; failing: number; unproven: number; byOutcome: Record<string, number> }
  /** sha256 of the sorted case lines (sealHostCases). The cases themselves are not committed. */
  caseHash: string
}

/** A tenant-host outcome that may stay: named by case, with what it was, a reason and the owner's approval. */
export interface AcceptedHostOutcome {
  /** The entry approved. If the case comes to do something else, the approval no longer covers it. */
  outcome: CaseEntry
  reason: string
  approvedBy: string
  approvedOn: string
}

export { capRegressions, isFailingEntry, isUnprovenEntry }

/** The baseline's entry for a case. Anything that used no Canary value says so. */
export function entryOf(r: Pick<CaseResult, 'outcome' | 'touched' | 'oracleKind'>): CaseEntry {
  if (r.outcome === 'oracle_4xx') return `oracle_4xx:${r.oracleKind}`
  if (r.outcome === 'refused' && !r.touched) return UNTOUCHED
  if (r.outcome === 'ok' && !r.touched) return OK_UNTOUCHED
  return r.outcome
}

export function hostTotals(cases: HostCases, accepted: Record<string, AcceptedHostOutcome> = {}): HostBaseline['totals'] {
  const byOutcome: Record<string, number> = {}
  let count = 0
  let failing = 0
  let unproven = 0
  for (const [file, byCase] of Object.entries(cases)) {
    for (const [key, entry] of Object.entries(byCase)) {
      count++
      const outcome = entry.split(':')[0]
      byOutcome[outcome] = (byOutcome[outcome] ?? 0) + 1
      if (isFailingEntry(entry) && !accepted[`${file} ${key}`]) failing++
      if (isUnprovenEntry(entry)) unproven++
    }
  }
  return {
    routes: Object.keys(cases).length,
    cases: count,
    failing,
    unproven,
    byOutcome: Object.fromEntries(Object.entries(byOutcome).sort(([a], [b]) => a.localeCompare(b))),
  }
}

const flatCases = (cases: HostCases): Record<string, CaseEntry> =>
  Object.fromEntries(Object.entries(cases).flatMap(([file, byCase]) => Object.entries(byCase).map(([key, entry]) => [`${file} ${key}`, entry])))

/** A count and a sha256 of the sorted case lines, the same in any order, naming no route. */
export const sealHostCases = (cases: HostCases) => sealReportedOracles(flatCases(cases))

/** Prints the cases for the developer who changed them. Prints nothing on CI. Returns whether it printed. */
export function printHostCases(cases: HostCases, env: Record<string, string | undefined> = process.env, log: (text: string) => void = console.log): boolean {
  return printReportedOracles(flatCases(cases), env, log, 'The tenant-host cases now')
}

/**
 * The reason named for an unproven case, by `<route file> <METHOD> <persona>` or, for
 * both people, `<route file> <METHOD>`. A key is what a case's baseline key starts with.
 */
export function unprovenReasonKey(file: string, caseKey: string, reasons: Record<string, string>): string | undefined {
  const [method, persona] = caseKey.split(' ')
  return [`${file} ${method} ${persona}`, `${file} ${method}`].find((k) => reasons[k])
}
