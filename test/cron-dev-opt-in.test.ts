// @vitest-environment node
import { readdirSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// S5 wave 7, B26a: CRON_NON_PROD_JOBS, the narrow dev cron opt-in (lib/cron-dev-opt-in).
// guardCron declines every cron outside production; on the hosted dev deployment only,
// two named exceptions can run: the email outbox, and membership-expiry's tenant consent
// sweep ALONE. Everything else stays declined whatever the variable says, the purge of
// self-registered minors above all. Unset, nothing changes; in production it is ignored.
//
// Every cron route calls guardCron(req) first (test/cron-audit.test.ts holds that), so
// guardCron's answer for a job's path is that route's answer.

const h = vi.hoisted(() => ({
  expire: vi.fn(async () => 3),
  purge: vi.fn(async (_db: unknown) => ({ scanned: 0, purged: [], cleared: [], heldGuardianSigned: [], heldAdultRoute: [], errors: [] })),
  managers: vi.fn(async (_db: unknown) => ({ errors: [] })),
  sweep: vi.fn(async (_db: unknown) => ({ scanned: 2, signed: [], expired: ['c-1'], removed: ['c-1'], held: [], voided: [], errors: [] as { consentId: string; error: string }[] })),
  drain: vi.fn(async (_db: unknown, _opts: unknown) => ({ sent: 1, failed: 0, suppressed: 0, waiting: 0, oldestWaitingHours: null, stoppedFor: null })),
  startRun: vi.fn(),
  finish: vi.fn(async (_r: unknown) => {}),
  fail: vi.fn((_k: string, _e: unknown) => {}),
}))

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({}) }))
vi.mock('@/lib/cron-runs', () => ({
  startCronRun: async (...a: unknown[]) => {
    h.startRun(...a)
    return { fail: h.fail, finish: h.finish }
  },
}))
vi.mock('@/lib/membership-grants', () => ({ expireLapsedGrants: h.expire }))
vi.mock('@/lib/pending-consent', () => ({ purgeUnconsentedAccounts: h.purge }))
vi.mock('@/lib/event-manager', () => ({ sweepEventManagers: h.managers }))
vi.mock('@/lib/registration/tenant-guardian-consent', () => ({ sweepTenantGuardianConsents: h.sweep }))
vi.mock('@/lib/email/outbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email/outbox')>()),
  drainEmailOutbox: h.drain,
}))

const SECRET = 'test-cron-secret'
const req = (job: string, secret = SECRET) =>
  new Request(`https://example.test/api/cron/${job}`, { headers: { authorization: `Bearer ${secret}` } })

/** The hosted dev deployment: the dev Vercel project's tracked branch deploys as Production. */
function hostedDev(jobs?: string) {
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'dev')
  vi.stubEnv('VERCEL_ENV', 'production')
  vi.stubEnv('CRON_SECRET', SECRET)
  vi.stubEnv('CRON_NON_PROD_JOBS', jobs)
}

const JOBS = readdirSync('app/api/cron', { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()

const DECLINED = { skipped: true, reason: 'APP_ENV=dev' }

async function guard(job: string, secret?: string) {
  const { guardCron } = await import('@/lib/cron')
  const res = guardCron(req(job, secret))
  return res ? { status: res.status, body: await res.json() } : null
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('guardCron with CRON_NON_PROD_JOBS unset', () => {
  it('declines all 24 crons on dev exactly as before', async () => {
    hostedDev(undefined)
    expect(JOBS).toHaveLength(24)
    for (const job of JOBS) expect(await guard(job), job).toEqual({ status: 200, body: DECLINED })
  })

  it('declines all 24 when the variable is blank', async () => {
    hostedDev('')
    for (const job of JOBS) expect(await guard(job), job).toEqual({ status: 200, body: DECLINED })
  })
})

describe('guardCron on the hosted dev deployment, with every job named', () => {
  // Every whole job, every job with a sub-job, and the purge under every spelling.
  const EVERYTHING = [
    ...JOBS,
    ...JOBS.map((j) => `${j}:*`),
    'membership-expiry:purge',
    'membership-expiry:pending-consent',
    'membership-expiry:purgeUnconsentedAccounts',
    'membership-expiry:expire',
    'membership-expiry:event-managers',
    'membership-expiry:tenant-consent',
  ].join(',')

  const INTEGRATIONS = [
    'apollo-reconcile',
    ...JOBS.filter((j) => j.startsWith('hubspot-')),
    ...JOBS.filter((j) => j.startsWith('campaign')),
    'alumni-upgrades',
    'background-sync',
    'motion-bookings',
  ]

  it('names the integration crons it refuses, and finds them all', () => {
    expect(INTEGRATIONS.sort()).toEqual([
      'alumni-upgrades',
      'apollo-reconcile',
      'background-sync',
      'campaign-drip',
      'campaign-events',
      'campaigns',
      'hubspot-event-options',
      'hubspot-lifecycle',
      'motion-bookings',
    ])
  })

  it.each([...INTEGRATIONS, 'surveys', 'team-profiles', 'group-invoice-sync'])('refuses %s', async (job) => {
    hostedDev(EVERYTHING)
    expect(await guard(job)).toEqual({ status: 200, body: DECLINED })
  })

  it('lets through only email-outbox and membership-expiry', async () => {
    hostedDev(EVERYTHING)
    const through: string[] = []
    for (const job of JOBS) if ((await guard(job)) === null) through.push(job)
    expect(through).toEqual(['email-outbox', 'membership-expiry'])
  })

  it('still answers 401 to a wrong secret, before anything else', async () => {
    hostedDev(EVERYTHING)
    expect(await guard('email-outbox', 'wrong')).toEqual({ status: 401, body: { error: 'Unauthorized' } })
  })

  it('declines a path that is not exactly /api/cron/<job>', async () => {
    hostedDev('email-outbox')
    const { guardCron } = await import('@/lib/cron')
    for (const url of [
      'https://example.test/api/cron/email-outbox/',
      'https://example.test/api/cron/email-outbox/extra',
      'https://example.test/x/api/cron/email-outbox',
      'https://example.test/api/cron/EMAIL-OUTBOX',
    ]) {
      const res = guardCron(new Request(url, { headers: { authorization: `Bearer ${SECRET}` } }))
      expect(res, url).not.toBeNull()
      expect(await res!.json(), url).toEqual(DECLINED)
    }
  })
})

describe('which values are honoured', () => {
  it('refuses membership-expiry as a whole job', async () => {
    hostedDev('membership-expiry')
    expect(await guard('membership-expiry')).toEqual({ status: 200, body: DECLINED })
  })

  it.each([
    'membership-expiry:purge',
    'membership-expiry:pending-consent',
    'membership-expiry:purgeUnconsentedAccounts',
    'membership-expiry:expire',
    'membership-expiry:event-managers',
    'membership-expiry:*',
    'membership-expiry:',
    'MEMBERSHIP-EXPIRY:TENANT-CONSENT',
    'email-outbox:anything',
    'EMAIL-OUTBOX',
    '*',
  ])('refuses %s', async (value) => {
    hostedDev(value)
    for (const job of JOBS) expect(await guard(job), `${value} → ${job}`).toEqual({ status: 200, body: DECLINED })
  })

  it('trims spaces around each comma-separated value', async () => {
    hostedDev(' email-outbox , membership-expiry:tenant-consent ')
    const { devCronOptIns } = await import('@/lib/cron-dev-opt-in')
    expect(devCronOptIns()).toEqual(['email-outbox', 'membership-expiry:tenant-consent'])
  })
})

describe('where the variable is read', () => {
  const ALLOWED = 'email-outbox,membership-expiry:tenant-consent'

  it.each([
    ['a preview deployment', 'dev', 'preview'],
    ['a local run', 'dev', undefined],
    ['APP_ENV unset (it defaults to dev, which includes local)', undefined, 'production'],
    ['a typo of APP_ENV', 'development', 'production'],
  ])('never on %s', async (_label, appEnv, vercelEnv) => {
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', appEnv)
    vi.stubEnv('VERCEL_ENV', vercelEnv)
    vi.stubEnv('CRON_SECRET', SECRET)
    vi.stubEnv('CRON_NON_PROD_JOBS', ALLOWED)
    const { devCronOptIns } = await import('@/lib/cron-dev-opt-in')
    expect(devCronOptIns()).toEqual([])
    expect((await guard('email-outbox'))?.body).toMatchObject({ skipped: true })
    expect((await guard('membership-expiry'))?.body).toMatchObject({ skipped: true })
  })

  it('never in production: ignored entirely, every cron runs as today', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'prod')
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('CRON_SECRET', SECRET)
    vi.stubEnv('CRON_NON_PROD_JOBS', ALLOWED)
    const { devCronOptIns } = await import('@/lib/cron-dev-opt-in')
    expect(devCronOptIns()).toEqual([])
    for (const job of JOBS) expect(await guard(job), job).toBeNull()
  })
})

describe('membership-expiry under the opt-in', () => {
  const call = async () => {
    const { GET } = await import('@/app/api/cron/membership-expiry/route')
    const res = await (GET as unknown as (r: Request) => Promise<Response>)(req('membership-expiry'))
    return { status: res.status, body: (await res.json()) as Record<string, unknown> }
  }
  const noOtherStep = () => {
    expect(h.expire).not.toHaveBeenCalled()
    expect(h.purge).not.toHaveBeenCalled()
    expect(h.managers).not.toHaveBeenCalled()
  }

  it('runs the tenant consent sweep and nothing else', async () => {
    hostedDev('membership-expiry:tenant-consent')
    vi.stubEnv('TENANT_GUARDIAN_CONSENT_ENABLED', 'true')
    const { status, body } = await call()
    expect(status).toBe(200)
    expect(h.sweep).toHaveBeenCalledTimes(1)
    noOtherStep()
    expect(body).toEqual({
      only: 'tenant-consent',
      tenantGuardianConsent: { scanned: 2, signed: 0, expired: 1, removed: 1, held: 0, voided: 0, errors: 0 },
    })
    expect(h.startRun).toHaveBeenCalledWith(expect.anything(), 'membership-expiry')
    expect(h.finish).toHaveBeenCalledWith(body)
  })

  it('never runs the purge, whatever the variable says', async () => {
    hostedDev([
      'membership-expiry',
      'membership-expiry:purge',
      'membership-expiry:pending-consent',
      'membership-expiry:purgeUnconsentedAccounts',
      'membership-expiry:*',
      'membership-expiry:tenant-consent',
    ].join(','))
    vi.stubEnv('TENANT_GUARDIAN_CONSENT_ENABLED', 'true')
    await call()
    expect(h.sweep).toHaveBeenCalledTimes(1)
    noOtherStep()
  })

  it('a purge value alone is declined before anything is read', async () => {
    hostedDev('membership-expiry:purge')
    vi.stubEnv('TENANT_GUARDIAN_CONSENT_ENABLED', 'true')
    expect(await call()).toEqual({ status: 200, body: DECLINED })
    expect(h.startRun).not.toHaveBeenCalled()
    expect(h.sweep).not.toHaveBeenCalled()
    noOtherStep()
  })

  it('with the consent flag off, sweeps nothing and says why', async () => {
    hostedDev('membership-expiry:tenant-consent')
    const { body } = await call()
    expect(h.sweep).not.toHaveBeenCalled()
    noOtherStep()
    expect(body).toEqual({ only: 'tenant-consent', tenantGuardianConsent: { skipped: true, reason: 'TENANT_GUARDIAN_CONSENT_ENABLED is off' } })
  })

  it('a failed sweep answers 500 and is recorded', async () => {
    hostedDev('membership-expiry:tenant-consent')
    vi.stubEnv('TENANT_GUARDIAN_CONSENT_ENABLED', 'true')
    h.sweep.mockRejectedValueOnce(new Error('down'))
    const { status, body } = await call()
    expect(status).toBe(500)
    expect(body).toEqual({ only: 'tenant-consent', tenantGuardianConsent: { error: 'down' } })
    expect(h.fail).toHaveBeenCalledWith('tenant-guardian-consent', expect.any(Error))
    noOtherStep()
  })

  it('in production the variable changes nothing: all four steps run, the result keys as today', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'prod')
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('CRON_SECRET', SECRET)
    vi.stubEnv('CRON_NON_PROD_JOBS', 'membership-expiry:tenant-consent')
    vi.stubEnv('TENANT_GUARDIAN_CONSENT_ENABLED', 'true')
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', '')
    const { status, body } = await call()
    expect(status).toBe(200)
    expect(h.expire).toHaveBeenCalledTimes(1)
    expect(h.purge).toHaveBeenCalledTimes(1)
    expect(h.managers).toHaveBeenCalledTimes(1)
    expect(h.sweep).toHaveBeenCalledTimes(1)
    expect(Object.keys(body).sort()).toEqual(['eventManagers', 'expired', 'pendingConsentPurge', 'tenantGuardianConsent'])
  })
})

// The route does not lean on guardCron alone to keep the purge off dev. If a second
// membership-expiry value were ever added to DEV_CRON_OPT_INS, guardCron would let the
// call through; the route must still run no step. And outside production the four-step
// path declines even when guardCron answers null.
describe('membership-expiry fails closed off production', () => {
  const call = async () => {
    const { GET } = await import('@/app/api/cron/membership-expiry/route')
    const res = await (GET as unknown as (r: Request) => Promise<Response>)(req('membership-expiry'))
    return { status: res.status, body: (await res.json()) as Record<string, unknown> }
  }
  const nothingRan = () => {
    expect(h.startRun).not.toHaveBeenCalled()
    expect(h.sweep).not.toHaveBeenCalled()
    expect(h.expire).not.toHaveBeenCalled()
    expect(h.purge).not.toHaveBeenCalled()
    expect(h.managers).not.toHaveBeenCalled()
  }

  beforeEach(() => vi.resetModules())
  afterEach(() => {
    vi.doUnmock('@/lib/cron-dev-opt-in')
    vi.doUnmock('@/lib/cron')
    vi.resetModules()
  })

  it.each([
    'membership-expiry:event-managers',
    'membership-expiry:expire',
    'membership-expiry:purge',
  ])('a hypothetical second allowlisted value, %s, runs no step on hosted dev', async (value) => {
    // As if the value had been added to DEV_CRON_OPT_INS: the helpers honour it.
    vi.doMock('@/lib/cron-dev-opt-in', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/cron-dev-opt-in')>()),
      devCronOptIns: () => [value],
      devCronOptInFor: (job: string | null) => (job && (value === job || value.startsWith(`${job}:`)) ? value : null),
    }))
    hostedDev(value)
    vi.stubEnv('TENANT_GUARDIAN_CONSENT_ENABLED', 'true')
    expect(await guard('membership-expiry')).toBeNull()
    expect(await call()).toEqual({ status: 200, body: DECLINED })
    nothingRan()
  })

  it('outside production, the four-step path declines even when guardCron answers null', async () => {
    vi.doMock('@/lib/cron', () => ({ guardCron: () => null }))
    hostedDev(undefined)
    vi.stubEnv('TENANT_GUARDIAN_CONSENT_ENABLED', 'true')
    expect(await call()).toEqual({ status: 200, body: DECLINED })
    nothingRan()
  })
})

describe('email-outbox under the opt-in', () => {
  const call = async () => {
    const { GET } = await import('@/app/api/cron/email-outbox/route')
    const res = await (GET as unknown as (r: Request) => Promise<Response>)(req('email-outbox'))
    return { status: res.status, body: (await res.json()) as Record<string, unknown> }
  }

  it('drains the outbox when named', async () => {
    hostedDev('email-outbox')
    const { status, body } = await call()
    expect(status).toBe(200)
    expect(h.drain).toHaveBeenCalledTimes(1)
    expect(body).toMatchObject({ sent: 1 })
  })

  it('declines when only the consent sweep is named', async () => {
    hostedDev('membership-expiry:tenant-consent')
    expect(await call()).toEqual({ status: 200, body: DECLINED })
    expect(h.drain).not.toHaveBeenCalled()
  })
})

// Mail sent on dev never reaches the person it names: lib/email.ts routes it to
// DEV_EMAIL_SAFELIST. That code is unchanged here; these hold its two cases that
// matter once a cron can run on dev.
describe('DEV_EMAIL_SAFELIST on dev', () => {
  async function loadEmail(safelist: string | undefined) {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'dev')
    vi.stubEnv('DEV_EMAIL_SAFELIST', safelist)
    vi.stubEnv('RESEND_API_KEY', 're_test_placeholder')
    return import('@/lib/email')
  }

  it('unset: mail goes to the role inbox, the code default', async () => {
    const { routeRecipients } = await loadEmail(undefined)
    expect(process.env.DEV_EMAIL_SAFELIST).toBeUndefined()
    expect(routeRecipients('guardian@example.test', ['other@example.test'])).toEqual({
      to: 'hello@stellreducation.org',
      cc: [],
      subjectPrefix: '[dev → guardian@example.test, other@example.test] ',
    })
  })

  it('explicitly blank: mail is suppressed, and nothing is sent', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { routeRecipients, sendEmail } = await loadEmail('')
    expect(routeRecipients('guardian@example.test').to).toBeNull()
    await expect(sendEmail({ to: 'guardian@example.test', subject: 's', html: '<p>h</p>', text: 't' })).resolves.toEqual({ id: null })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
